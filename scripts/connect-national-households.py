"""Stream the already downloaded national household CSV into source-linked records.

No household/plan assignment is invented: road-address-only matches are candidates,
and parcel conflicts are rejected. Original row IDs and identifiers are retained.
"""
import csv
import hashlib
import io
import json
import os
import re
import sqlite3
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'research/linkage/generated/connected-materials'


@lru_cache(maxsize=200000)
def address(value):
    return re.sub(r'\([^)]*\)|\s','',value).replace('서울특별시','서울').replace('서울시','서울').replace('경기도','경기')


class HashReader(io.RawIOBase):
    def __init__(self, source, digest):self.source,self.digest=source,digest
    def readable(self):return True
    def readinto(self, buffer):
        data=self.source.read(len(buffer));self.digest.update(data);buffer[:len(data)]=data;return len(data)


def main():
    source_db=OUT/'library.sqlite'
    if not source_db.exists():source_db=OUT/'library.build.sqlite'
    source=sqlite3.connect(source_db.as_uri()+'?mode=ro',uri=True)
    targets=defaultdict(list)
    for eid,addr,meta in source.execute("SELECT id,address,metadata FROM entities WHERE source IN ('kb','sh')"):
        if not addr or addr=='-':continue
        data=json.loads(meta);parcel=None
        match=re.search(r'(\d+)(?:-(\d+))?\s*$',data.get('landAddress') or '')
        if match:parcel=(int(match[1]),int(match[2] or 0))
        targets[address(addr)].append((eid,parcel))
    source.close()
    temp=OUT/'households.build.sqlite';temp.unlink(missing_ok=True)
    db=sqlite3.connect(temp)
    db.executescript('''CREATE TABLE units(source_row INTEGER PRIMARY KEY,year TEXT,month TEXT,legal_code TEXT,road_address TEXT,
        bun INTEGER,ji INTEGER,complex_name TEXT,building TEXT,unit TEXT,exclusive_area TEXT,registry_id TEXT,complex_code TEXT,building_code TEXT,unit_code TEXT);
        CREATE TABLE matches(entity TEXT,source_row INTEGER,method TEXT,PRIMARY KEY(entity,source_row));
        CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);''')
    manifest=json.loads((ROOT/'research/linkage/downloads/housing/manifest.json').read_text(encoding='utf8'))
    archive=ROOT/'research/linkage/downloads/housing/housing-2025.zip'
    digest=hashlib.sha256();rows=matched=links=parcel_conflicts=0
    with zipfile.ZipFile(archive) as z:
        member=next(i for i in z.infolist() if i.filename.endswith('.csv') and i.file_size>1_000_000_000)
        with z.open(member) as raw:
            stream=io.TextIOWrapper(io.BufferedReader(HashReader(raw,digest),1024*1024),encoding='utf-8-sig',newline='')
            reader=csv.reader(stream);header=next(reader)
            index={k:header.index(k) for k in ['기준연도','기준월','법정동코드','도로명주소','본번','부번','단지명','동명','호명','전용면적','건축물대장PK','단지코드','동코드','호코드']}
            for row in reader:
                rows+=1
                road=row[index['도로명주소']]
                # Cache repeated addresses while streaming; never retain the
                # full national table or infer household type from area alone.
                candidates=targets.get(address(road),[])
                if candidates:
                    bun,ji=int(row[index['본번']] or 0),int(row[index['부번']] or 0)
                    accepted=[]
                    for eid,parcel in candidates:
                        if parcel is not None and parcel!=(bun,ji):parcel_conflicts+=1;continue
                        accepted.append((eid,'road-address-and-parcel' if parcel else 'road-address-candidate'))
                    if accepted:
                        value=lambda key:row[index[key]]
                        db.execute('INSERT INTO units VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(rows+1,value('기준연도'),value('기준월'),value('법정동코드'),road,bun,ji,value('단지명'),value('동명'),value('호명'),value('전용면적'),value('건축물대장PK'),value('단지코드'),value('동코드'),value('호코드')))
                        db.executemany('INSERT INTO matches VALUES(?,?,?)',[(eid,rows+1,method) for eid,method in accepted])
                        matched+=1;links+=len(accepted)
                if rows%100000==0:db.commit()
                if rows%1000000==0:
                    print(json.dumps(dict(rows=rows,matchedRows=matched,links=links)),flush=True)
    sha=digest.hexdigest()
    if rows!=manifest['expectedRows'] or sha!=manifest['expectedCsvSha256']:
        raise RuntimeError(f'National CSV integrity mismatch: {rows}, {sha}')
    db.execute('CREATE INDEX matches_entity ON matches(entity)')
    summary=dict(checkedAt=datetime.now(timezone.utc).isoformat(),rows=rows,sha256=sha,matchedUniqueRows=matched,entityUnitLinks=links,
                 matchedSourceRecords=db.execute('SELECT count(DISTINCT entity) FROM matches').fetchone()[0],
                 matchedKbRecords=db.execute("SELECT count(DISTINCT entity) FROM matches WHERE entity LIKE 'kb:%'").fetchone()[0],
                 rejectedParcelConflicts=parcel_conflicts,archive=str(archive.relative_to(ROOT)),member=member.filename,
                 limitations=['2025 official stock, not guaranteed current occupancy/completeness.','Same road address can contain multiple phases; parcel guard used where available.','Source records overlap across KB/SH: do not add their household counts.','Exclusive area alone does not establish plan subtype, orientation, or mirror.'])
    db.execute('INSERT INTO metadata VALUES(?,?)',('summary',json.dumps(summary,ensure_ascii=False)))
    db.commit()
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    db.close();os.replace(temp,OUT/'households.sqlite')
    (OUT/'households-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(summary,ensure_ascii=True),flush=True)


if __name__=='__main__':main()
