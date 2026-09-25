"""Resume local Korean OCR / legacy XLS extraction without touching originals.

One worker, page-level durable cache. OCR mentions never assert site identity.
"""
import argparse
import csv
import importlib.util
import io
import json
import os
import re
import sqlite3
import subprocess
import tempfile
import time
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import ahocorasick
import pymupdf
import xlrd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'research/linkage/generated/connected-materials'
spec = importlib.util.spec_from_file_location('material_index', ROOT/'scripts/connect-downloaded-materials.py')
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)


def documents(raw, ext, prefix='', depth=0):
    if ext == '.pdf':
        yield prefix, raw
    elif ext == '.zip' and depth < 3:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            budget = 0
            for entry in archive.infolist():
                suffix = Path(entry.filename).suffix.lower()
                if suffix not in {'.pdf', '.zip'} or entry.file_size > 80_000_000:
                    continue
                budget += entry.file_size
                if budget > 200_000_000:
                    raise ValueError('archive OCR budget exceeded; remaining entries require review')
                name = entry.filename
                if not entry.flag_bits & 0x800:
                    try: name = name.encode('cp437').decode('cp949')
                    except UnicodeError: pass
                yield from documents(archive.read(entry), suffix, prefix+'entry:'+name+'/', depth+1)


def matcher(db):
    terms = defaultdict(set)
    for eid, name, address in db.execute("SELECT id,name,address FROM entities WHERE source IN ('kb','sh','builder')"):
        name = core.norm(name)
        if len(name) >= 5: terms[name].add((eid, 'name'))
        address = re.sub(r'\([^)]*\)', '', address or '')
        match = re.search(r'([가-힣A-Za-z0-9·]+(?:로|길)\s*\d+(?:번길\s*\d+)?(?:-\d+)?)\s*$', address)
        if match and len(core.norm(match[1])) >= 6:
            terms[core.norm(match[1])].add((eid, 'address'))
    auto = ahocorasick.Automaton()
    for term, pairs in terms.items(): auto.add_word(term, (term, list(pairs)))
    auto.make_automaton()
    return auto


def connect(db, auto, file, pages, basis):
    # Replace only this extractor's evidence; preserve all other sources.
    db.execute('DELETE FROM evidence WHERE file=? AND basis=?', (file, basis))
    method_prefix = 'recovery-ocr-' if basis.startswith('ocr') else 'recovery-xls-'
    db.execute('DELETE FROM links WHERE file=? AND method LIKE ?', (file, method_prefix+'%'))
    owners = [r[0] for r in db.execute('SELECT DISTINCT entity FROM attachments WHERE file=?', (file,))]
    for locator, text in pages:
        roles = core.roles(text)
        for role in roles:
            hit = re.search(core.ROLES[role], text, re.I)
            snippet = text[max(0,hit.start()-80):hit.end()+160]
            for eid in owners:
                db.execute('INSERT INTO evidence VALUES(?,?,?,?,?,?)', (eid,file,locator,role,basis,snippet))
        found = defaultdict(set)
        compact = core.norm(text)
        for end, (term,pairs) in auto.iter(compact):
            if term[-1:].isdigit() and end+1<len(compact) and compact[end+1].isdigit(): continue
            for eid,kind in pairs: found[eid].add(kind)
        for target,kinds in found.items():
            # All name-only matches stay weak, including OCR spelling ambiguity.
            status = 'candidate' if 'address' in kinds else 'weak'
            for owner in owners or ['unassigned-file']:
                if owner != target:
                    db.execute('INSERT INTO links VALUES(?,?,?,?,?,?,?)', (owner,target,method_prefix+'-and-'.join(sorted(kinds)),status,file,locator,json.dumps({'roles':roles,'basis':basis})))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=0)
    args = parser.parse_args()
    if (OUT/'indexer.lock').exists():
        raise SystemExit('Main indexer is active; finish it before document recovery.')
    lock = OUT/'recovery.lock'
    with lock.open('x') as handle: handle.write(str(os.getpid()))
    try: run(args)
    finally: lock.unlink(missing_ok=True)


def run(args):
    db = sqlite3.connect(OUT/'library.sqlite', timeout=60)
    db.execute('PRAGMA journal_mode=WAL')
    cache = sqlite3.connect(OUT/'recovery.sqlite')
    cache.execute('PRAGMA journal_mode=WAL')
    cache.executescript('''CREATE TABLE IF NOT EXISTS pages(file TEXT,signature TEXT,locator TEXT,text TEXT,PRIMARY KEY(file,signature,locator));
    CREATE TABLE IF NOT EXISTS jobs(file TEXT PRIMARY KEY,signature TEXT,status TEXT,detail TEXT,updated TEXT);''')
    auto = matcher(db)
    todo = db.execute("SELECT path,status,detail FROM files WHERE status IN ('legacy-office-unparsed','parse-error') OR detail LIKE '%ocr-needed%' OR detail LIKE '%legacy-xls-text-extracted%' ORDER BY CASE WHEN format='.xls' THEN 0 WHEN status='parse-error' THEN 1 ELSE 2 END,path").fetchall()
    initial = len(todo)
    processed = 0
    started = time.monotonic()
    def progress(current='', stage='running'):
        report = dict(stage=stage,pid=os.getpid(),updatedAt=datetime.now(timezone.utc).isoformat(),queueAtStart=initial,processedThisRun=processed,seconds=round(time.monotonic()-started),current=current,
                      jobs=dict(cache.execute('SELECT status,count(*) FROM jobs GROUP BY status')),cachedPages=cache.execute('SELECT count(*) FROM pages').fetchone()[0],
                      evidence=db.execute("SELECT count(*) FROM evidence WHERE basis IN ('ocr-text-candidate','legacy-xls-text-candidate')").fetchone()[0])
        temp=OUT/'recovery-progress.tmp'
        temp.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
        os.replace(temp,OUT/'recovery-progress.json')
    for file,old_status,detail in todo:
        path = ROOT/file
        stat = path.stat()
        signature = f'win-ko-v1:{stat.st_size}:{stat.st_mtime_ns}'
        previous = cache.execute('SELECT signature,status FROM jobs WHERE file=?',(file,)).fetchone()
        if previous and previous == (signature,'complete'):
            if path.suffix.lower()=='.xls':
                if 'legacy-xls-text-extracted' in detail and cache.execute('SELECT 1 FROM pages WHERE file=? AND signature=? LIMIT 1',(file,signature)).fetchone(): continue
            elif 'ocr-processed' in detail: continue
        pages = []; flags = json.loads(detail); state='complete'; note=''
        try:
            progress(file)
            if old_status == 'parse-error':
                raw = path.read_bytes()
                if raw.lstrip().startswith((b'<script',b'<!DOCTYPE',b'<html')):
                    note='download-returned-html-instead-of-document'
                elif raw.startswith(b'HWP Document File V3.00'):
                    note='legacy-hwp-v3-unsupported-not-an-ole-corruption'
                else: note='original-document-parser-error-unresolved'
                state='review-required'
                flags = sorted(set(flags+[note]))
            elif path.suffix.lower()=='.xls':
                book = xlrd.open_workbook(path,on_demand=True)
                try:
                    for sheet in book.sheets():
                        for row in range(sheet.nrows):
                            text=' | '.join(str(v) for v in sheet.row_values(row))
                            if text.strip(): pages.append((f'sheet:{sheet.name}/row:{row+1}',text))
                finally: book.release_resources()
                cache.executemany('INSERT OR REPLACE INTO pages VALUES(?,?,?,?)',[(file,signature,locator,text) for locator,text in pages]);cache.commit()
                connect(db,auto,file,pages,'legacy-xls-text-candidate')
                flags.append('legacy-xls-text-extracted')
            else:
                pdf_count=0
                with tempfile.TemporaryDirectory(prefix='material-ocr-') as temp:
                    png=Path(temp)/'page.png'
                    for prefix,raw in documents(path.read_bytes(),path.suffix.lower()):
                        pdf_count+=1
                        with pymupdf.open(stream=raw,filetype='pdf') as pdf:
                            if pdf.needs_pass: raise ValueError('encrypted PDF')
                            for i,page in enumerate(pdf):
                                locator=prefix+f'page:{i+1}'
                                text=page.get_text()
                                if len(text.strip())<=30:
                                    saved=cache.execute('SELECT text FROM pages WHERE file=? AND signature=? AND locator=?',(file,signature,locator)).fetchone()
                                    if saved: text=saved[0]
                                    else:
                                        scale=min(2.5,2400/max(page.rect.width,page.rect.height))
                                        page.get_pixmap(matrix=pymupdf.Matrix(scale,scale),alpha=False).save(png)
                                        result=subprocess.run(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'scripts/ocr-material-page.ps1'),'-ImagePath',str(png)],capture_output=True,timeout=90,encoding='utf-8')
                                        if result.returncode: raise RuntimeError('Windows OCR process failed: '+result.stderr[-400:])
                                        text='\n'.join(json.loads(result.stdout)['lines'])
                                        cache.execute('INSERT OR REPLACE INTO pages VALUES(?,?,?,?)',(file,signature,locator,text));cache.commit()
                                        progress(file+'#'+locator)
                                pages.append((locator,text))
                if not pdf_count: raise ValueError('No supported PDF entries found')
                connect(db,auto,file,pages,'ocr-text-candidate')
                flags=[f for f in flags if f!='ocr-needed']+['ocr-processed','ocr-review-required']
            if state=='complete':
                status = 'ocr-text-indexed' if path.suffix.lower()!='.xls' else 'text-indexed'
                if not any(len(t.strip())>30 for _,t in pages): status='no-extracted-text';flags.append('no-readable-text-after-recovery')
            else: status=old_status
            db.execute('UPDATE files SET status=?,detail=? WHERE path=?',(status,json.dumps(sorted(set(flags))),file))
            db.commit()
        except Exception as exc:
            db.rollback();state='error';note=type(exc).__name__+':'+str(exc)[:500]
        cache.execute('INSERT OR REPLACE INTO jobs VALUES(?,?,?,?,?)',(file,signature,state,note,datetime.now(timezone.utc).isoformat()));cache.commit()
        processed+=1;progress(file)
        if processed%10==0: print(json.dumps({'processed':processed,'jobs':dict(cache.execute('SELECT status,count(*) FROM jobs GROUP BY status'))}),flush=True)
        if args.limit and processed>=args.limit: break
    summary=json.loads(db.execute("SELECT value FROM metadata WHERE key='summary'").fetchone()[0])
    summary['fileStatus']=dict(db.execute('SELECT status,count(*) FROM files GROUP BY status'))
    summary['roles']=dict(db.execute('SELECT role,count(DISTINCT file) FROM evidence GROUP BY role'))
    summary['sourceLinks']=dict(db.execute('SELECT method,count(*) FROM links GROUP BY method'))
    summary['documentFlags']=dict(db.execute("SELECT value,count(*) FROM files,json_each(files.detail) WHERE value IN ('ocr-needed','ocr-processed','ocr-review-required','legacy-xls-text-extracted','archive-content-deferred','large-file-content-deferred','page-text-truncated','xml-text-truncated','pdf-repaired-by-parser') GROUP BY value"))
    db.execute("UPDATE metadata SET value=? WHERE key='summary'",(json.dumps(summary,ensure_ascii=False),));db.commit()
    (OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
    for filename,query,header in [
        ('links.csv','SELECT * FROM links',['source','target','method','status','file','locator','evidence']),
        ('file-review.csv',"SELECT path,status,detail FROM files WHERE status IN ('missing','parse-error','empty','no-extracted-text','legacy-office-unparsed','cad-present-unparsed') OR detail LIKE '%ocr-review-required%'",['path','status','detail'])]:
        with (OUT/filename).open('w',encoding='utf-8-sig',newline='') as stream:
            writer=csv.writer(stream);writer.writerow(header);writer.writerows(db.execute(query))
    progress(stage='batch-complete' if args.limit else 'complete')
    db.close();cache.close()


if __name__=='__main__': main()
