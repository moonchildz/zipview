"""Incremental offline document index and evidence-preserving apartment crosswalk.

Original downloads are never modified. A mention is not an identity assertion.
"""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import sqlite3
import struct
import time
import unicodedata
import zipfile
import zlib
from collections import defaultdict
from collections import deque
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import xml.etree.ElementTree as ET

import ahocorasick
import pymupdf as fitz
import olefile
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'research/linkage/generated/connected-materials'
DOWNLOADS = ROOT / 'research/linkage/downloads'
VERSION = 1
fitz.TOOLS.mupdf_display_errors(False)
fitz.TOOLS.mupdf_display_warnings(False)
TEXT_EXT = {'.pdf', '.hwp', '.hwpx', '.docx', '.xlsx', '.pptx', '.zip', '.txt', '.csv', '.xml'}
IMAGES = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff', '.bmp'}
ROLES = {'floorplan': r'평면도|단위세대|단위평면|세대평면|floor.?plan',
         'site_layout': r'단지배치|배치도|site.?plan',
         'unit_layout': r'동[·ㆍ\s]?호수?\s*배치|동호배치|동호수표|동호표',
         'unit_inventory': r'공급주택\s*(목록|내역)|동호수|주택목록',
         'height': r'층고|건축물\s*높이|건물\s*높이|최고높이|최고층',
         'brochure': r'팸플릿|팜플렛|팜플릿|브로슈어|카탈로그|catalog|brochure',
         'cad': r'\.dwg\b|\.dxf\b|\.ifc\b'}


def norm(s):
    s = str(s or '')
    # Avoid quadratic normalization on very large Korean CSV text.
    if len(s) > 8192:
        return ''.join(norm(s[i:i+8192]) for i in range(0,len(s),8192))
    return re.sub(r'[\s()\[\]·ㆍ,._-]', '', unicodedata.normalize('NFKC', s).lower())


def address(s):
    s = re.sub(r'\([^)]*\)', '', str(s or ''))
    return norm(s.replace('서울특별시', '서울').replace('서울시', '서울').replace('경기도', '경기'))


def roles(text):
    return [k for k, pattern in ROLES.items() if re.search(pattern, text, re.I)]


def rel(p):
    return Path(os.path.abspath(p)).relative_to(ROOT).as_posix()


def downloaded_paths():
    for folder, _, files in os.walk(DOWNLOADS):
        for name in files:
            if name.startswith('partial-') or Path(name).suffix.lower() in {'.part','.tmp','.lock'}:
                continue
            yield Path(folder)/name


def load(p):
    return json.loads(Path(p).read_text(encoding='utf-8-sig'))


def j(x):
    return json.dumps(x, ensure_ascii=False)


def hwp_text(raw):
    result = []
    with olefile.OleFileIO(io.BytesIO(raw)) as doc:
        header = doc.openstream('FileHeader').read()
        flags = struct.unpack_from('<I', header, 36)[0]
        if flags & 2:
            raise ValueError('encrypted-hwp')
        for stream in doc.listdir():
            if len(stream) != 2 or stream[0] != 'BodyText':
                continue
            data = doc.openstream(stream).read()
            if flags & 1:
                data = zlib.decompress(data, -15)
            offset, texts = 0, []
            while offset + 4 <= len(data):
                tag = struct.unpack_from('<I', data, offset)[0]
                offset += 4
                size = tag >> 20
                if size == 4095:
                    if offset + 4 > len(data):
                        break
                    size = struct.unpack_from('<I', data, offset)[0]
                    offset += 4
                if tag & 1023 == 67:
                    texts.append(data[offset:offset+size].decode('utf-16le', errors='replace'))
                offset += size
            result.append(('/'.join(stream), '\n'.join(texts)))
    return result


def extract(raw, ext, locator='', depth=0):
    """Read text without executing macros or extracting archive paths to disk."""
    pages, flags = [], []
    if ext == '.pdf':
        with fitz.open(stream=raw, filetype='pdf') as doc:
            if doc.is_repaired:
                flags.append('pdf-repaired-by-parser')
            if doc.needs_pass:
                return [], ['encrypted-pdf']
            for i, page in enumerate(doc):
                text = page.get_text()
                pages.append((f'{locator}page:{i+1}', text[:100000]))
                if len(text) > 100000:
                    flags.append('page-text-truncated')
            if not any(len(t.strip()) > 30 for _, t in pages):
                flags.append('ocr-needed')
    elif ext == '.hwp':
        pages = [(locator + k, v) for k, v in hwp_text(raw)]
    elif ext in {'.zip', '.hwpx', '.xlsx', '.docx', '.pptx'}:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            budget = 0
            for item in archive.infolist():
                if item.is_dir():
                    continue
                name = item.filename
                if not item.flag_bits & 0x800:
                    try:
                        name = name.encode('cp437').decode('cp949')
                    except (UnicodeError, LookupError):
                        pass
                key = locator + 'entry:' + name
                pages.append((key, name))
                child_ext = Path(name).suffix.lower()
                if ext != '.zip' and child_ext == '.xml':
                    if item.file_size > 30_000_000:
                        flags.append('archive-entry-too-large'); continue
                    budget += item.file_size
                    if budget > 150_000_000:
                        flags.append('archive-budget-exceeded'); break
                    tree = ET.fromstring(archive.read(item))
                    # Formatting attributes are excluded; shared strings remain searchable.
                    text = ' '.join(t.strip() for t in tree.itertext() if t.strip())
                    pages.append((key, text[:300000]))
                    if len(text) > 300000:
                        flags.append('xml-text-truncated')
                elif ext == '.zip' and child_ext in TEXT_EXT:
                    if depth >= 2 or item.file_size > 80_000_000 or budget + item.file_size > 200_000_000:
                        flags.append('archive-content-deferred'); continue
                    budget += item.file_size
                    try:
                        child_pages, child_flags = extract(archive.read(item), child_ext, key + '/', depth+1)
                        pages.extend(child_pages); flags.extend(child_flags)
                    except Exception as e:
                        flags.append('entry-error:' + name + ':' + str(e)[:100])
    else:
        for encoding in ['utf-8-sig', 'cp949', 'utf-16']:
            try:
                text = raw.decode(encoding)
                pages = [(locator + f'text-chunk:{i//16000+1}', text[i:i+16100]) for i in range(0,len(text),16000)]
                break
            except UnicodeError:
                pass
        if not pages:
            flags.append('encoding-unresolved')
    return pages, sorted(set(flags))


def inspect_file(file):
    p,ext=ROOT/file,Path(file).suffix.lower()
    pages,flags,size,mtime,payload,signature,cache_hit=[],[],0,0,None,None,False
    try:
        stat=p.stat();size,mtime=stat.st_size,stat.st_mtime
        status='present'
        if not size:status='empty'
        elif ext in TEXT_EXT:
            signature=f'{VERSION}:{stat.st_size}:{stat.st_mtime_ns}'
            cache=sqlite3.connect((OUT/'text-cache.sqlite').as_uri()+'?mode=ro',uri=True)
            try:
                try:cached=cache.execute('SELECT payload FROM documents WHERE path=? AND signature=?',(file,signature)).fetchone()
                except sqlite3.OperationalError:cached=None
            finally:cache.close()
            if cached:
                pages,flags=json.loads(zlib.decompress(cached[0]));cache_hit=True
            else:
                if size>250_000_000:flags=['large-file-content-deferred']
                else:pages,flags=extract(p.read_bytes(),ext)
                payload=zlib.compress(j([pages,flags]).encode('utf8'))
            status='text-indexed' if any(len(t.strip())>30 for _,t in pages) else 'no-extracted-text'
        elif ext in IMAGES:
            with Image.open(p) as im:flags=[f'image:{im.width}x{im.height}','visual-review-needed']
            status='image-header-valid'
        elif ext in {'.dwg','.dxf','.ifc'}:status='cad-present-unparsed'
        elif ext in {'.xls','.doc','.ppt'}:status='legacy-office-unparsed'
        elif ext in {'.json','.html','.js','.css'}:status='metadata-or-web-cache'
    except FileNotFoundError:status='missing'
    except Exception as e:status='parse-error';flags=[type(e).__name__+':'+str(e)[:250]]
    return file,ext,size,mtime,status,pages,flags,payload,signature,cache_hit


def inspect_bounded(files):
    # Two isolated parsers, eight pending files: bound CPU and memory, and avoid
    # PyMuPDF's unsupported multithreaded document parsing.
    with ProcessPoolExecutor(max_workers=2) as executor:
        pending=deque();iterator=iter(files)
        for _ in range(8):
            try:pending.append(executor.submit(inspect_file,next(iterator)))
            except StopIteration:break
        while pending:
            yield pending.popleft().result()
            try:pending.append(executor.submit(inspect_file,next(iterator)))
            except StopIteration:pass


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    if (OUT/'recovery.lock').exists():
        raise SystemExit('Document recovery is active; finish it before rebuilding the index.')
    start = datetime.now(timezone.utc).isoformat()
    lock = OUT / 'indexer.lock'
    # Exclusive creation protects simultaneous runs, even before SQLite is opened.
    try:
        handle = lock.open('x')
    except FileExistsError:
        raise SystemExit('Indexer lock exists; inspect indexer.lock/process before restarting.')
    with handle:
        handle.write(str(os.getpid()))
    try:
        build(start)
    finally:
        lock.unlink(missing_ok=True)


def build(start):
    temporary = OUT / 'library.build.sqlite'
    resume = os.environ.get('MATERIAL_RESUME_INVENTORY') == '1' and temporary.exists()
    if not resume:
        temporary.unlink(missing_ok=True)
    db = sqlite3.connect(temporary)
    if not resume:
        db.executescript('''
          CREATE TABLE entities(id TEXT PRIMARY KEY,source TEXT,name TEXT,address TEXT,point TEXT,manifest TEXT,metadata TEXT);
          CREATE TABLE files(path TEXT PRIMARY KEY,bytes INTEGER,mtime REAL,present INTEGER,format TEXT,status TEXT,detail TEXT);
          CREATE TABLE attachments(entity TEXT,file TEXT,label TEXT,type TEXT,kind TEXT,source_url TEXT,expected_bytes INTEGER);
          CREATE INDEX attachment_entity ON attachments(entity);
          CREATE INDEX attachment_file ON attachments(file);
          CREATE TABLE evidence(entity TEXT,file TEXT,locator TEXT,role TEXT,basis TEXT,snippet TEXT);
          CREATE INDEX evidence_entity ON evidence(entity);
          CREATE TABLE links(source TEXT,target TEXT,method TEXT,status TEXT,file TEXT,locator TEXT,evidence TEXT);
          CREATE INDEX links_target ON links(target);
          CREATE INDEX links_source ON links(source);
          CREATE TABLE environment(entity TEXT PRIMARY KEY,data TEXT);
          CREATE TABLE issues(kind TEXT,path TEXT,detail TEXT);
          CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
        ''')
    cache = sqlite3.connect(OUT / 'text-cache.sqlite')
    cache.execute('PRAGMA journal_mode=WAL')
    cache.execute('CREATE TABLE IF NOT EXISTS documents(path TEXT PRIMARY KEY, signature TEXT, payload BLOB)')
    if resume:
        db.execute("DELETE FROM files WHERE status='parse-error' AND detail LIKE '%database is locked%'")
        entities = {}
        for eid, source, name, addr, point, manifest, meta in db.execute('SELECT * FROM entities'):
            entities[eid] = dict(id=eid,source=source,name=name,address=addr,point=json.loads(point),manifest=manifest,metadata=json.loads(meta))
        assets = {}
        for eid,file,label,typ,kind in db.execute('SELECT entity,file,label,type,kind FROM attachments'):
            assets.setdefault(file,[]).append((eid,label,typ,kind))
        orphan_count = 0
        for file in downloaded_paths():
            f=rel(file)
            if f not in assets:
                assets[f]=[];orphan_count+=1
        db.execute("DELETE FROM links WHERE method='notice-title-mention'")
        print(j(dict(stage='resumed-inventory',entities=len(entities),files=len(assets))),flush=True)
    else:
        entities, assets, address_index = {}, {}, defaultdict(set)
        read_errors = []

        def asset(eid, a, type_name='', kind=''):
            file = a.get('file')
            if not file:
                return
            try:
                file = rel(ROOT / file)
            except (ValueError, OSError):
                db.execute('INSERT INTO issues VALUES(?,?,?)', ('external-path', str(file), eid)); return
            if file not in assets:
                assets[file] = []
            label = str(a.get('label') or a.get('name') or a.get('originalFileName') or a.get('url') or '')
            typ = str(a.get('type') or type_name or '')
            actual_kind = a.get('kind') or kind
            assets[file].append((eid, label, typ, actual_kind))
            db.execute('INSERT INTO attachments VALUES(?,?,?,?,?,?,?)', (eid, file, label, typ, actual_kind, a.get('url'), a.get('bytes')))
            for role in set(roles(label) + (['floorplan'] if actual_kind in ['provider-plan', 'type-plan'] else [])):
                db.execute('INSERT INTO evidence VALUES(?,?,?,?,?,?)', (eid, file, 'attachment-label', role, 'metadata-candidate', label[:500]))

        def entity(eid, source, name, addr, point, manifest, metadata):
            record = dict(id=eid, source=source, name=name or '', address=addr or '', point=point, manifest=manifest, metadata=metadata)
            entities[eid] = record
            db.execute('INSERT INTO entities VALUES(?,?,?,?,?,?,?)', (eid, source, record['name'], record['address'], j(point), manifest, j(metadata)))
            if source != 'lh' and len(address(addr)) > 8:
                address_index[address(addr)].add(eid)

        snapshots = []
        for source, folder, pattern in [('kb', ROOT/'research/linkage/providers/kb', '*.json'),
                                         ('sh', DOWNLOADS/'portal-library/sh', 'complex-*.json'),
                                         ('lh', DOWNLOADS/'portal-library/lh', 'notice-*.json'),
                                         ('builder', DOWNLOADS/'official-builders', '*/state.json')]:
            for file in sorted(folder.glob(pattern)):
                if source == 'kb' and not file.stem.isdigit():
                    continue
                snapshots.append((source, file))
        for manifest_number, (source, file) in enumerate(snapshots, 1):
            try:
                m = load(file)
                eid = source + ':' + str(m.get('providerId') if source == 'kb' else m.get('id'))
                point = m.get('point')
                if source == 'sh':
                    detail = m.get('detail', {})
                    try:
                        point = [float(detail['posY']), float(detail['posX'])]
                    except (KeyError, TypeError, ValueError):
                        point = None
                meta = {k:m[k] for k in ['households', 'buildingCount', 'region', 'year', 'types', 'detail'] if k in m}
                if source == 'kb':
                    meta['plans'] = [{k:t.get(k) for k in ['areaId', 'displayType', 'area', 'supply', 'households']} for t in m.get('plans', [])]
                    meta['unitCount'] = len(m.get('units', []))
                    meta['unitsSource'] = rel(file)
                    meta['landAddress'] = m.get('landAddress')
                entity(eid, source, m.get('name'), m.get('address'), point, rel(file), meta)
                for a in m.get('assets', []):
                    asset(eid, a)
                if source == 'kb':
                    for t in m.get('plans', []):
                        for a in t.get('variants', []):
                            asset(eid, a, t.get('displayType', ''), 'provider-plan')
            except Exception as e:
                read_errors.append((rel(file), str(e)))
            if manifest_number % 500 == 0:
                progress = dict(startedAt=start, stage='manifests', processed=manifest_number, total=len(snapshots), attachedFiles=len(assets))
                (OUT/'progress.json').write_text(j(progress), encoding='utf8')
                print(j(progress), flush=True)
        for file, error in read_errors:
            db.execute('INSERT INTO issues VALUES(?,?,?)', ('manifest-read-error', file, error))
        # Preserve all other downloaded files too, including old evidence/attachments
        # that are absent from current manifests. Never discard unmatched assets.
        orphan_count = 0
        for file in downloaded_paths():
            f = rel(file)
            if f not in assets:
                assets[f] = []
                orphan_count += 1
        print(j(dict(stage='inventory', entities=len(entities), physicalPaths=len(assets), unreferencedPaths=orphan_count)), flush=True)
        # Separate source records stay separate: exact address alone can describe
        # multiple buildings/phases, so no irreversible merge is performed.
        for ids in address_index.values():
            for sid in sorted(ids):
                if not sid.startswith('sh:'):
                    continue
                kb = sorted(x for x in ids if x.startswith('kb:'))
                for tid in kb:
                    same_name = norm(entities[sid]['name']) == norm(entities[tid]['name'])
                    method = 'exact-address-and-name' if same_name else 'exact-address'
                    db.execute('INSERT INTO links VALUES(?,?,?,?,?,?,?)', (sid, tid, method, 'supported' if same_name and len(kb)==1 else 'candidate', '', 'source-record', entities[sid]['address']))
    # Names and road addresses found in page text are searchable evidence, not
    # an assignment of every attachment of a multi-complex notice to each site.
    terms = defaultdict(set)
    for eid, e in entities.items():
        if e['source'] == 'lh':
            continue
        n = norm(e['name'])
        if len(n) >= 5:
            terms[n].add((eid, 'name'))
        for addr in [e['address'], e['metadata'].get('landAddress')]:
            a = re.sub(r'\([^)]*\)', '', str(addr or ''))
            match = re.search(r'([가-힣A-Za-z0-9·]+(?:로|길)\s*\d+(?:번길\s*\d+)?(?:-\d+)?)\s*$', a)
            if match and len(norm(match[1])) >= 6:
                terms[norm(match[1])].add((eid, 'address'))
    automaton = ahocorasick.Automaton()
    for term, values in terms.items():
        automaton.add_word(term, (term, list(values)))
    automaton.make_automaton()

    def mentions(text):
        found = defaultdict(set)
        compact = norm(text)
        for end, (term, pairs) in automaton.iter(compact):
            # Address 12 must not match 123 or 12-3 after normalization.
            if term[-1:].isdigit() and end + 1 < len(compact) and compact[end+1].isdigit():
                continue
            for eid, kind in pairs:
                found[eid].add(kind)
        return found

    for eid, e in entities.items():
        if e['source'] != 'lh':
            continue
        for target, kinds in mentions(e['name']).items():
            db.execute('INSERT INTO links VALUES(?,?,?,?,?,?,?)', (eid, target, 'notice-title-mention', 'candidate', '', 'title', e['name']))
    db.commit()
    counts = defaultdict(int, dict(db.execute('SELECT status,count(*) FROM files GROUP BY status')))
    completed = set(r[0] for r in db.execute('SELECT path FROM files'))
    started = time.monotonic()
    todo = [f for f in sorted(assets) if f not in completed]
    print(j(dict(stage='document-workers',alreadyProcessed=len(completed),remaining=len(todo),workers=2)),flush=True)
    for number, result in enumerate(inspect_bounded(todo), len(completed)+1):
        file,ext,size,mtime,status,pages,flags,payload,signature,cache_hit=result
        owners=assets[file]
        if cache_hit:counts['cacheHits']+=1
        if payload is not None:
            cache.execute('INSERT OR REPLACE INTO documents VALUES(?,?,?)',(file,signature,payload))
        counts[status] += 1
        db.execute('INSERT INTO files VALUES(?,?,?,?,?,?,?)', (file,size,mtime,int(status!='missing'),ext,status,j(flags)))
        expected = db.execute('SELECT DISTINCT expected_bytes FROM attachments WHERE file=? AND expected_bytes IS NOT NULL', (file,)).fetchall()
        if any(b != size for (b,) in expected):
            db.execute('INSERT INTO issues VALUES(?,?,?)', ('size-mismatch', file, j(dict(actual=size, expected=expected))))
        for locator, text in pages:
            classified = roles(text)
            found = mentions(text)
            snippet = text[:600]
            for role in classified:
                hit = re.search(ROLES[role], text, re.I)
                evidence = text[max(0,hit.start()-80):hit.end()+160] if hit else snippet
                for eid, _, _, _ in owners:
                    db.execute('INSERT INTO evidence VALUES(?,?,?,?,?,?)', (eid, file, locator, role, 'document-text-candidate', evidence))
            for target, kinds in found.items():
                # A name and address on one page is stronger, still requires
                # review for pages listing several complexes or advertisements.
                method = 'page-name-and-address' if kinds == {'name','address'} else 'page-' + '-'.join(sorted(kinds))
                for source in sorted(set(o[0] for o in owners)) or ['unassigned-file']:
                    if source == target:
                        continue
                    db.execute('INSERT INTO links VALUES(?,?,?,?,?,?,?)', (source,target,method,'candidate',file,locator,j(dict(kinds=sorted(kinds),roles=classified))))
        if number % 50 == 0:
            db.commit(); cache.commit()
            progress = dict(startedAt=start, stage='documents',processed=number,total=len(assets),seconds=round(time.monotonic()-started),counts=dict(counts))
            (OUT/'progress.json').write_text(j(progress),encoding='utf8')
            if number % 1000 == 0:
                print(j(progress),flush=True)
    db.commit(); cache.commit(); cache.close()
    # Link existing raw spatial records by provider identity, never by name.
    spatial_path = ROOT/'research/linkage/generated/material-readiness/spatial.json'
    spatial = load(spatial_path) if spatial_path.exists() else []
    for s in spatial:
        db.execute('INSERT OR REPLACE INTO environment VALUES(?,?)', ('kb:'+s['providerId'],j(s)))
    osm_path = ROOT/'research/linkage/generated/material-readiness/four-source-presence.json'
    osm = {r['providerId']:r for r in load(osm_path)['rows']} if osm_path.exists() else {}
    for s in spatial:
        if s['providerId'] in osm:
            s['osmAudit'] = osm[s['providerId']]
            db.execute('UPDATE environment SET data=? WHERE entity=?',(j(s),'kb:'+s['providerId']))
    # Group summaries are source records; LH notices are never counted as sites.
    summary = dict(startedAt=start, finishedAt=datetime.now(timezone.utc).isoformat(), entitiesBySource={},
                   files=len(assets), fileStatus=dict(counts), scope='all saved SH/LH/builder manifests, KB providers and all linkage download files at snapshot',
                   spatialScope='existing 1:1000 map/imagery snapshot for KB providers; OSM per-site check for previous 296 candidates',
                   sourceLinks={}, roles={}, allRequiredDataCompleteComplexes=None)
    for source, count in db.execute('SELECT source,count(*) FROM entities GROUP BY source'):
        summary['entitiesBySource'][source] = count
    for method, count in db.execute('SELECT method,count(*) FROM links GROUP BY method'):
        summary['sourceLinks'][method] = count
    for role, count in db.execute('SELECT role,count(DISTINCT file) FROM evidence GROUP BY role'):
        summary['roles'][role] = count
    summary['kbWithPublicCandidates'] = db.execute("SELECT count(DISTINCT target) FROM links WHERE target LIKE 'kb:%' AND source NOT LIKE 'kb:%'").fetchone()[0]
    summary['unreferencedDownloadedFiles'] = orphan_count
    summary['issues'] = db.execute('SELECT count(*) FROM issues').fetchone()[0]
    db.execute('INSERT INTO metadata VALUES(?,?)', ('summary',j(summary)))
    db.execute('CREATE INDEX evidence_file ON evidence(file)')
    db.commit()
    check = db.execute('PRAGMA integrity_check').fetchone()[0]
    if check != 'ok':
        raise RuntimeError(check)
    with (OUT/'entities.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer = csv.writer(f); writer.writerow(['id','source','name','address','manifest','metadata'])
        writer.writerows(db.execute('SELECT id,source,name,address,manifest,metadata FROM entities ORDER BY id'))
    with (OUT/'links.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.writer(f);writer.writerow(['source','target','method','status','file','locator','evidence'])
        writer.writerows(db.execute('SELECT * FROM links'))
    db.close()
    os.replace(temporary, OUT/'library.sqlite')
    (OUT/'summary.json').write_text(j(summary),encoding='utf8')
    (OUT/'progress.json').write_text(j(dict(stage='complete',**summary)),encoding='utf8')
    print(j(summary),flush=True)


if __name__ == '__main__':
    main()
