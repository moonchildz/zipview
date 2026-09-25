"""Connect official household rows to already collected provider type evidence.

Provider dong/ho evidence and area-only candidates are deliberately separate.
No candidate modifies the app's plan assignment or model catalogue.
"""
import json
import os
import re
import sqlite3
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'research/linkage/generated/connected-materials'


def unit_key(value):
    text=re.sub(r'[동호]\s*$','',str(value or '').strip())
    return str(int(text)) if text.isdigit() else text


def decimal(value):
    try:return Decimal(str(value))
    except (InvalidOperation,ValueError):return None


def choose(area, known, plans):
    area=decimal(area)
    if len(known)>1:return sorted(known),'provider-unit-conflict'
    if known:
        key=next(iter(known));expected=plans.get(key)
        if expected is None or area is None:return [key],'provider-unit-area-unchecked'
        if abs(area-expected)<Decimal('0.01'):return [key],'provider-unit-area-consistent'
        return [key],'provider-unit-area-conflict'
    exact=[key for key,a in plans.items() if a is not None and a==area]
    if exact:return exact,'area-only-candidate' if len(exact)==1 else 'ambiguous-area'
    if area is not None:
        rounded=[key for key,a in plans.items() if a is not None and a.quantize(Decimal('.01'),rounding=ROUND_HALF_UP)==area.quantize(Decimal('.01'),rounding=ROUND_HALF_UP)]
        if rounded:return rounded,'rounded-area-candidate' if len(rounded)==1 else 'ambiguous-rounded-area'
    return [],'type-unmatched'


def main():
    housing=sqlite3.connect((OUT/'households.sqlite').as_uri()+'?mode=ro',uri=True)
    temp=OUT/'household-plans.build.sqlite';temp.unlink(missing_ok=True)
    db=sqlite3.connect(temp)
    db.executescript('CREATE TABLE links(entity TEXT,source_row INTEGER,area_ids TEXT,status TEXT,image_files TEXT,PRIMARY KEY(entity,source_row));CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);')
    totals=Counter();complexes=0
    for eid, in housing.execute("SELECT DISTINCT entity FROM matches WHERE entity LIKE 'kb:%'").fetchall():
        provider=ROOT/f"research/linkage/providers/kb/{eid.split(':')[1]}.json"
        if not provider.exists():continue
        p=json.loads(provider.read_text(encoding='utf8'))
        plans={str(t['areaId']):decimal(t.get('area')) for t in p.get('plans',[])}
        files={str(t['areaId']):[a['file'] for a in t.get('variants',[]) if a.get('file') and (ROOT/a['file']).is_file()] for t in p.get('plans',[])}
        units=defaultdict(set)
        for u in p.get('units',[]):units[(unit_key(u.get('building')),unit_key(u.get('unit')))].add(str(u.get('areaId')))
        for row_id,bld,unit,area in housing.execute('SELECT u.source_row,u.building,u.unit,u.exclusive_area FROM units u JOIN matches m ON u.source_row=m.source_row WHERE m.entity=?',(eid,)):
            keys,status=choose(area,units.get((unit_key(bld),unit_key(unit)),set()),plans)
            images=[f for key in keys for f in files.get(key,[])]
            db.execute('INSERT INTO links VALUES(?,?,?,?,?)',(eid,row_id,json.dumps(keys),status,json.dumps(images)))
            totals[status]+=1
            if images:totals['with-image-candidate']+=1
        complexes+=1
        if complexes%100==0:
            db.commit();print(json.dumps(dict(complexes=complexes,counts=totals)),flush=True)
    summary=dict(providerComplexes=complexes,counts=dict(totals),
                 caveats=['Counts are household-to-provider links, not unique national homes or completed models.',
                          'Provider-unit matches inherit the household address/parcel crosswalk; source identity still needs review.',
                          'Area-only and rounded-area results are candidates; equal areas do not distinguish all subtypes.',
                          'Image file presence does not guarantee a dimensioned floor plan.'])
    db.execute('INSERT INTO metadata VALUES(?,?)',('summary',json.dumps(summary)))
    db.commit();assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    housing.close();db.close();os.replace(temp,OUT/'household-plans.sqlite')
    (OUT/'household-plans-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(summary),flush=True)


if __name__=='__main__':main()
