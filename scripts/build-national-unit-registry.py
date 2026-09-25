"""Index every row of the locally downloaded 2025 national apartment inventory.

Original row numbers are stable keys. Group keys are source-based hypotheses,
not a claim that all historical/current apartment phases are one complex.
"""
import argparse
import csv
import hashlib
import io
import json
import os
import sqlite3
import time
import zipfile
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'research/linkage/generated/national-units'
SOURCE=ROOT/'research/linkage/downloads/housing/housing-2025.zip'
MANIFEST=ROOT/'research/linkage/downloads/housing/manifest.json'
BUILD=OUT/'units.build.sqlite'
FINAL=OUT/'units.sqlite'


class HashReader(io.RawIOBase):
    def __init__(self,source,digest):self.source,self.digest=source,digest
    def readable(self):return True
    def readinto(self,buffer):
        value=self.source.read(len(buffer));self.digest.update(value);buffer[:len(value)]=value;return len(value)


def now():return datetime.now(timezone.utc).isoformat()


def publish_json(path,value):
    temp=path.with_suffix('.tmp');temp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8')
    for attempt in range(12):
        try:os.replace(temp,path);return
        except PermissionError:
            if attempt==11:raise
            time.sleep(.05*(attempt+1))


@lru_cache(maxsize=250_000)
def group_id(legal,road,bun,ji,name,code):
    key='\0'.join([legal,road,bun,ji,name,code]).encode('utf8')
    return hashlib.blake2b(key,digest_size=12).hexdigest()


def initialize(db):
    db.executescript('''PRAGMA journal_mode=DELETE;PRAGMA synchronous=OFF;PRAGMA temp_store=MEMORY;
    CREATE TABLE units(source_row INTEGER PRIMARY KEY,complex_id TEXT NOT NULL,building TEXT,unit TEXT,exclusive_area TEXT,
        registry_id TEXT,building_code TEXT,unit_code TEXT);
    CREATE TABLE complexes(id TEXT PRIMARY KEY,legal_code TEXT,road_address TEXT,bun TEXT,ji TEXT,name TEXT,complex_code TEXT,
        province TEXT,district TEXT,unit_count INTEGER DEFAULT 0,building_count INTEGER DEFAULT 0);
    CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);''')


def progress(stage,rows,complexes,started,error=None):
    publish_json(OUT/'progress.json',dict(stage=stage,updatedAt=now(),startedAt=started,pid=os.getpid(),rows=rows,complexes=complexes,error=error))


def main(limit=0):
    OUT.mkdir(parents=True,exist_ok=True)
    lock=OUT/'build.lock'
    with lock.open('x') as stream:stream.write(str(os.getpid()))
    try:run(limit)
    except Exception as error:
        current=OUT/'progress.json'
        state=json.loads(current.read_text(encoding='utf8')) if current.exists() else {}
        progress('error',state.get('rows',0),state.get('complexes'),state.get('startedAt',now()),str(error))
        raise
    finally:lock.unlink(missing_ok=True)


def run(limit):
    manifest=json.loads(MANIFEST.read_text(encoding='utf8'))
    started=now()
    if FINAL.exists():
        db=sqlite3.connect(f'file:{FINAL.resolve().as_posix()}?mode=ro',uri=True)
        count=db.execute('SELECT count(*) FROM units').fetchone()[0];db.close()
        if count==manifest['expectedRows']:
            progress('complete',count,None,started);print(json.dumps({'stage':'already-complete','rows':count}));return
        raise RuntimeError('Published registry has unexpected row count; manual inspection required')
    resumed=BUILD.exists();db=sqlite3.connect(BUILD)
    if not resumed:initialize(db)
    db.execute('PRAGMA synchronous=OFF');db.execute('PRAGMA temp_store=MEMORY')
    checkpoint=db.execute('SELECT max(source_row) FROM units').fetchone()[0] or 0
    seen={r[0] for r in db.execute('SELECT id FROM complexes')}
    digest=hashlib.sha256();rows=0;units=[];groups=[]
    progress('running',checkpoint,len(seen),started)
    with zipfile.ZipFile(SOURCE) as z:
        member=next(i for i in z.infolist() if i.filename.endswith('.csv') and i.file_size>1_000_000_000)
        with z.open(member) as raw:
            stream=io.TextIOWrapper(io.BufferedReader(HashReader(raw,digest),1024*1024),encoding='utf-8-sig',newline='')
            reader=csv.reader(stream);next(reader)
            for row in reader:
                rows+=1;source_row=rows+1
                if source_row<=checkpoint:continue
                # Columns are verified against the published CSV header and
                # kept by position to avoid locale-dependent console encodings.
                legal,road,province,district,bun,ji,name,building,unit,area,code,bcode,ucode,registry=(row[i] for i in (2,3,4,5,9,10,12,13,14,15,17,18,19,20))
                gid=group_id(legal,road,bun,ji,name,code)
                units.append((source_row,gid,building,unit,area,registry,bcode,ucode))
                if gid not in seen:
                    seen.add(gid);groups.append((gid,legal,road,bun,ji,name,code,province,district))
                if len(units)>=50_000:
                    db.executemany('INSERT INTO units VALUES(?,?,?,?,?,?,?,?)',units)
                    db.executemany('INSERT INTO complexes(id,legal_code,road_address,bun,ji,name,complex_code,province,district) VALUES(?,?,?,?,?,?,?,?,?)',groups)
                    db.commit();units.clear();groups.clear();progress('running',source_row-1,len(seen),started)
                    if (source_row-1)%1_000_000==0:print(json.dumps({'rows':source_row-1,'complexes':len(seen)}),flush=True)
                if limit and rows>=limit:break
    if units:
        db.executemany('INSERT INTO units VALUES(?,?,?,?,?,?,?,?)',units)
        db.executemany('INSERT INTO complexes(id,legal_code,road_address,bun,ji,name,complex_code,province,district) VALUES(?,?,?,?,?,?,?,?,?)',groups)
        db.commit()
    if limit:
        progress('batch-complete',rows,len(seen),started);db.close();return
    sha=digest.hexdigest()
    if rows!=manifest['expectedRows'] or sha!=manifest['expectedCsvSha256']:
        raise RuntimeError(f'Original CSV changed: rows={rows}, sha256={sha}')
    progress('indexing',rows,len(seen),started)
    db.executescript('''CREATE INDEX units_complex ON units(complex_id,building,unit);
        CREATE INDEX complexes_address ON complexes(road_address);
        CREATE INDEX complexes_name ON complexes(name);''')
    db.execute('UPDATE complexes SET unit_count=(SELECT count(*) FROM units WHERE units.complex_id=complexes.id)')
    db.execute('UPDATE complexes SET building_count=(SELECT count(DISTINCT building) FROM units WHERE units.complex_id=complexes.id)')
    # Preserve existing provider matches, including conflicts and weak candidates.
    linked=ROOT/'research/linkage/generated/connected-materials'
    db.execute('CREATE TABLE provider_links(source_row INTEGER,entity TEXT,area_ids TEXT,status TEXT,image_files TEXT,PRIMARY KEY(source_row,entity))')
    if (linked/'household-plans.sqlite').exists():
        db.execute('ATTACH DATABASE ? AS plans',(str(linked/'household-plans.sqlite'),))
        db.execute('INSERT INTO provider_links SELECT source_row,entity,area_ids,status,image_files FROM plans.links')
        db.commit();db.execute('DETACH DATABASE plans')
    db.execute('CREATE INDEX provider_links_entity ON provider_links(entity,source_row)')
    db.execute("INSERT INTO metadata VALUES('source',?)",(json.dumps(dict(archive=str(SOURCE.relative_to(ROOT)),csvSha256=sha,rows=rows,checkedAt=now()),ensure_ascii=False),))
    db.commit()
    integrity=db.execute('PRAGMA integrity_check').fetchone()[0]
    if integrity!='ok':raise RuntimeError('SQLite integrity check failed: '+integrity)
    summary=dict(builtAt=now(),sourceYear=2025,sourceRows=rows,sourceSha256=sha,complexGroups=len(seen),providerLinks=db.execute('SELECT count(*) FROM provider_links').fetchone()[0] if (linked/'household-plans.sqlite').exists() else 0,
        providerLinkedUnits=db.execute('SELECT count(DISTINCT source_row) FROM provider_links').fetchone()[0] if (linked/'household-plans.sqlite').exists() else 0,
        note='This is the 2025 official apartment inventory, not every current building or a finished view model. Same-address complex groups are source-derived and need phase review.')
    db.close();os.replace(BUILD,FINAL);publish_json(OUT/'summary.json',summary);progress('complete',rows,len(seen),started)
    print(json.dumps(summary,ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--limit',type=int,default=0);args=parser.parse_args();main(args.limit)
