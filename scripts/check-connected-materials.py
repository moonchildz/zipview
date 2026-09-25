import json
import sqlite3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'research/linkage/generated/connected-materials'
db=sqlite3.connect((OUT/'library.sqlite').as_uri()+'?mode=ro',uri=True)
checks={}
checks['integrity']=db.execute('PRAGMA integrity_check').fetchone()[0]
checks['attachmentsWithoutFileRecord']=db.execute('SELECT count(*) FROM attachments a LEFT JOIN files f ON a.file=f.path WHERE f.path IS NULL').fetchone()[0]
checks['attachmentsWithoutEntity']=db.execute('SELECT count(*) FROM attachments a LEFT JOIN entities e ON a.entity=e.id WHERE e.id IS NULL').fetchone()[0]
checks['linksWithoutTarget']=db.execute('SELECT count(*) FROM links l LEFT JOIN entities e ON l.target=e.id WHERE e.id IS NULL').fetchone()[0]
checks['documentLinksWithoutFileRecord']=db.execute("SELECT count(*) FROM links l LEFT JOIN files f ON l.file=f.path WHERE l.file!='' AND f.path IS NULL").fetchone()[0]
checks['invalidSourceTypeKeys']=0
for eid,meta in db.execute("SELECT id,metadata FROM entities WHERE source='kb'").fetchall():
    allowed={str(p['areaId']) for p in json.loads(meta).get('plans',[])}
    for key, in db.execute('SELECT DISTINCT source_type_key FROM type_assets WHERE entity=?',(eid,)):
        if key not in allowed:checks['invalidSourceTypeKeys']+=1
checks['supportedLinks']=db.execute("SELECT count(*) FROM links WHERE status='supported'").fetchone()[0]
checks['candidateLinks']=db.execute("SELECT count(*) FROM links WHERE status='candidate'").fetchone()[0]
checks['typeAssetLinks']=db.execute('SELECT count(*) FROM type_assets').fetchone()[0]
checks['documentEvidence']=db.execute("SELECT count(*) FROM evidence WHERE basis='document-text-candidate'").fetchone()[0]
checks['fileStatus']=dict(db.execute('SELECT status,count(*) FROM files GROUP BY status'))
checks['linkMethods']=dict(db.execute('SELECT method,count(*) FROM links GROUP BY method'))
db.close()
checks['pilotHouseholdRows']={}
housing=sqlite3.connect((OUT/'households.sqlite').as_uri()+'?mode=ro',uri=True)
old=json.loads((ROOT/'research/linkage/downloads/housing/target-units.json').read_text(encoding='utf8'))
for target in old['targets']:
    expected={int(u['sourceRow']) for u in target['units']}
    retained=set()
    for row_id, in housing.execute('SELECT source_row FROM units WHERE road_address=? AND bun=? AND ji=?',(target['address'],target['bun'],target['ji'])):
        if row_id in expected:retained.add(row_id)
    checks['pilotHouseholdRows'][target['id']]={'expected':len(expected),'retained':len(retained)}
housing.close()
(OUT/'validation.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(checks,ensure_ascii=True))
assert checks['integrity']=='ok'
for key in ['attachmentsWithoutFileRecord','attachmentsWithoutEntity','linksWithoutTarget','documentLinksWithoutFileRecord','invalidSourceTypeKeys']:
    assert checks[key]==0,(key,checks[key])
for key,value in checks['pilotHouseholdRows'].items():
    assert value['expected']==value['retained'],(key,value)
