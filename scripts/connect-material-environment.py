"""Attach local map, imagery, and OSM references to every geolocated source record."""
import json
import csv
import re
import sqlite3
from pathlib import Path
from datetime import datetime, timezone
from pyproj import Transformer
from shapely import from_wkb
from shapely.geometry import Point, Polygon, box
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'research/linkage/generated/connected-materials'
load=lambda p:json.loads(p.read_text(encoding='utf8'))


def main():
    db=sqlite3.connect(OUT/'library.sqlite')
    photo_conflicts=0
    for eid,file,label in db.execute("SELECT a.entity,a.file,a.label FROM attachments a JOIN files f ON a.file=f.path WHERE a.kind='type-plan' AND f.status='image-header-valid'").fetchall():
        if re.search(r'사진|조감도|투시도|현관|거실|주방|욕실|작은방|큰방|안방|침실',label or '') and not re.search(r'평면|도면|plan',label or '',re.I):
            db.execute("UPDATE evidence SET role='image-review',basis='photo-label-conflict' WHERE entity=? AND file=? AND role='floorplan' AND basis='metadata-candidate'",(eid,file))
            photo_conflicts+=1
    for source in ['sh','lh']:
        state_path=ROOT/f'research/linkage/downloads/portal-library/{source}/state.json'
        if not state_path.exists():continue
        state=load(state_path)
        for target in state.get('targets',[]):
            eid=f"{source}:{target['id']}"
            row=db.execute('SELECT metadata FROM entities WHERE id=?',(eid,)).fetchone()
            if not row:continue
            meta=json.loads(row[0]);meta['collectionStatus']=target.get('status');meta['collectionErrorCount']=len(target.get('errors',[]))
            meta['queueStatusUpdatedAt']=state.get('updatedAt')
            db.execute('UPDATE entities SET metadata=? WHERE id=?',(json.dumps(meta,ensure_ascii=False),eid))
    db.execute('CREATE TABLE IF NOT EXISTS type_assets(entity TEXT,source_type_key TEXT,file TEXT,display_type TEXT,PRIMARY KEY(entity,source_type_key,file))')
    for eid,file,typ in db.execute("SELECT entity,file,type FROM attachments WHERE type!=''").fetchall():
        key=Path(file).stem.split('-')[0] if eid.startswith('kb:') else typ
        db.execute('INSERT OR IGNORE INTO type_assets VALUES(?,?,?,?)',(eid,key,file,typ))
    # Previously collected official building/household records carry real data,
    # even though they are JSON rather than drawings. Preserve their source IDs.
    for kind,relative in [('building-register','research/linkage/downloads/hub/target-buildings.json'),
                          ('official-households','research/linkage/downloads/housing/target-units.json')]:
        path=ROOT/relative
        if not path.exists():continue
        source=load(path)
        for target in source.get('targets',[]):
            eid=f"official:{kind}:{target['id']}"
            metadata={'sourceTargetId':target['id'],'buildingCount':len(target.get('buildings',[])),
                      'unitCount':len(target.get('units',[])),'originalSource':source.get('source'),'sourceLocator':'targets[id='+target['id']+']'}
            name=target.get('name') or next((u.get('name') for u in target.get('units',[]) if u.get('name')),target['id'])
            db.execute('INSERT OR REPLACE INTO entities VALUES(?,?,?,?,?,?,?)',(eid,'official',name,target.get('address',''),'null',relative,json.dumps(metadata,ensure_ascii=False)))
            db.execute('DELETE FROM attachments WHERE entity=?',(eid,))
            db.execute('INSERT INTO attachments VALUES(?,?,?,?,?,?,?)',(eid,relative,kind,'',kind,source.get('source'),path.stat().st_size))
            db.execute('DELETE FROM evidence WHERE entity=?',(eid,))
            role='height' if kind=='building-register' else 'unit_inventory'
            db.execute('INSERT INTO evidence VALUES(?,?,?,?,?,?)',(eid,relative,metadata['sourceLocator'],role,'structured-source-record',json.dumps(metadata,ensure_ascii=False)))
            normalized=lambda s:re.sub(r'\([^)]*\)|\s','',str(s or '')).replace('서울특별시','서울').replace('서울시','서울')
            matches=[r for r in db.execute("SELECT id,address FROM entities WHERE source='kb'") if normalized(r[1])==normalized(target.get('address')) and target.get('address')]
            db.execute('DELETE FROM links WHERE source=?',(eid,))
            for tid,_ in matches:
                db.execute('INSERT INTO links VALUES(?,?,?,?,?,?,?)',(eid,tid,'official-record-address','candidate',relative,metadata['sourceLocator'],target.get('address','')))
    if (OUT/'households.sqlite').exists():
        eid='official:national-households-2025';relative='research/linkage/downloads/housing/housing-2025.zip'
        hh=sqlite3.connect((OUT/'households.sqlite').as_uri()+'?mode=ro',uri=True)
        meta=json.loads(hh.execute("SELECT value FROM metadata WHERE key='summary'").fetchone()[0])
        db.execute('INSERT OR REPLACE INTO entities VALUES(?,?,?,?,?,?,?)',(eid,'official','2025 전국 공동주택 공시가격 원본','','null',relative,json.dumps(meta,ensure_ascii=False)))
        db.execute('DELETE FROM attachments WHERE entity=?',(eid,))
        db.execute('INSERT INTO attachments VALUES(?,?,?,?,?,?,?)',(eid,relative,'공식 동호수·전용면적 CSV 전체','','official-households','https://www.data.go.kr/data/3073746/fileData.do',(ROOT/relative).stat().st_size))
        db.execute('DELETE FROM evidence WHERE entity=?',(eid,))
        db.execute('INSERT INTO evidence VALUES(?,?,?,?,?,?)',(eid,relative,'national-csv','unit_inventory','hash-verified-structured-source',json.dumps(meta,ensure_ascii=False)))
        db.execute('DELETE FROM links WHERE source=?',(eid,))
        # Replace generic CSV text-window evidence with exact source-row joins.
        db.execute("UPDATE links SET status='weak' WHERE file=? AND method LIKE 'page-%'",(relative,))
        for target,method,count in hh.execute('SELECT entity,method,count(*) FROM matches GROUP BY entity,method'):
            db.execute('INSERT INTO links VALUES(?,?,?,?,?,?,?)',(eid,target,'official-'+method,'candidate',relative,'households.sqlite:matches.entity='+target,json.dumps({'sourceRows':count,'year':2025})))
        hh.close()
    osm=sqlite3.connect((ROOT/'research/osm/generated/south-korea-roads.sqlite').as_uri()+'?mode=ro',uri=True)
    tiles=load(ROOT/'research/linkage/generated/material-readiness/map-index.json')['tiles']
    indexes={}
    for layer in ['buildings','contours','elevationPoints']:
        records=[t for t in tiles if t['scale']==1000 and layer in t['bounds'] and (ROOT/t['file']).is_file()]
        shapes=[box(*t['bounds'][layer]) for t in records]
        indexes[layer]=(STRtree(shapes),records,shapes)
    project=Transformer.from_crs(4326,5179,always_xy=True).transform
    transfers=load(ROOT/'.tools/cas-imagery/transfers.json')
    scenes=[]
    for s in load(ROOT/'.tools/cas-imagery/plan.json')['selected']:
        files=[f for f in transfers.get('scenes',{}).get(s['id'],{}).get('files',[]) if f.get('band') in ['R_PS','G_PS','B_PS']]
        if len(set(f['band'] for f in files))!=3:continue
        if not all(Path(f['path']).is_file() and Path(f['path']).stat().st_size==f['bytes'] for f in files):continue
        scenes.append((s['id'],transform(project,Polygon(s['ring'])),files))
    coverage=unary_union([s[1] for s in scenes])
    counts={'coordinateRecords':0,'buildingMapCandidate':0,'terrainMapCandidate':0,'imagery400m':0,'osmRoadsPresent':0}
    entities=db.execute('SELECT id,point FROM entities').fetchall()
    for eid,raw in entities:
        point=json.loads(raw)
        if not point or len(point)!=2 or not (124<point[0]<132 and 33<point[1]<39.5):continue
        counts['coordinateRecords']+=1
        center=Point(*project(*point));area=center.buffer(400)
        record={'point':point,'crs':'EPSG:5179','radiusMeters':400,'mapScale':1000,'verification':'source-presence-and-spatial-candidates-only'}
        for layer,(tree,records,shapes) in indexes.items():
            selected=[int(i) for i in tree.query(area) if shapes[int(i)].intersects(area)]
            record[layer+'Archives']=[records[i]['file'] for i in selected]
        record['satelliteScenes']=[{'id':sid,'files':files} for sid,geom,files in scenes if geom.intersects(area)]
        record['satellite400mCatalogFootprintCovered']=coverage.covers(area)
        minx,miny,maxx,maxy=area.bounds
        ids=[]
        for osm_id,surface,line in osm.execute('''SELECT r.osm_id,r.surface_wkb,r.line_wkb FROM roads r
            JOIN road_bounds b ON b.osm_id=r.osm_id WHERE r.ground=1 AND b.maxx>=? AND b.minx<=? AND b.maxy>=? AND b.miny<=?''',(minx,maxx,miny,maxy)):
            if from_wkb(surface or line).intersects(area):ids.append(osm_id)
        record['osm']={'database':'research/osm/generated/south-korea-roads.sqlite','groundRoadIds':ids,'count':len(ids)}
        record['heightAttributes']='not-verified'
        record['limitations']=['Map bounding boxes do not prove full terrain coverage.','Imagery catalogue footprints do not verify valid pixels.','OSM presence does not guarantee all internal paths are mapped.']
        db.execute('INSERT OR REPLACE INTO environment VALUES(?,?)',(eid,json.dumps(record,ensure_ascii=False)))
        counts['buildingMapCandidate']+=bool(record['buildingsArchives'])
        counts['terrainMapCandidate']+=bool(record['contoursArchives'] or record['elevationPointsArchives'])
        counts['imagery400m']+=record['satellite400mCatalogFootprintCovered']
        counts['osmRoadsPresent']+=bool(ids)
        if counts['coordinateRecords']%500==0:
            db.commit();print(json.dumps(counts),flush=True)
    counts['updatedAt']=datetime.now(timezone.utc).isoformat()
    counts['countUnit']='source records, not deduplicated complexes'
    summary=json.loads(db.execute("SELECT value FROM metadata WHERE key='summary'").fetchone()[0])
    normalize=lambda s:re.sub(r'[\s()\[\]·ㆍ,._-]','',str(s or '')).lower()
    source_rows={r[0]:dict(name=r[1],address=r[2],meta=json.loads(r[3])) for r in db.execute('SELECT id,name,address,metadata FROM entities')}
    names={}
    for row in source_rows.values():
        if row['address']:names.setdefault(normalize(row['name']),set()).add(normalize(row['address']))
    provinces={'서울':'11','부산':'26','대구':'27','인천':'28','광주':'29','대전':'30','울산':'31','경기':'41','강원':'42','충청북':'43','충청남':'44','전라북':'45','전라남':'46','경상북':'47','경상남':'48','제주':'50'}
    weak=0
    for rowid,sid,tid in db.execute("SELECT rowid,source,target FROM links WHERE method IN ('page-name','notice-title-mention')").fetchall():
        target=source_rows[tid];source=source_rows.get(sid,{})
        n=normalize(target['name']);region=str(source.get('meta',{}).get('region',''))
        target_region=next((code for prefix,code in provinces.items() if target['address'].startswith(prefix)),None)
        ambiguous=len(names.get(n,set()))>1 or bool(re.fullmatch(r'(주공|현대|삼성|한신|대우|우성|건영|벽산)\d*(단지|차)?',n))
        mismatch=region and target_region and region!=target_region
        if ambiguous or mismatch:
            db.execute("UPDATE links SET status='weak' WHERE rowid=?",(rowid,));weak+=1
    summary['weakNameOnlyLinks']=weak
    summary['environment']=counts
    summary['typePlanPhotoLabelConflicts']=photo_conflicts
    summary['entitiesBySource']=dict(db.execute('SELECT source,count(*) FROM entities GROUP BY source'))
    summary['sourceLinks']=dict(db.execute('SELECT method,count(*) FROM links GROUP BY method'))
    summary['roles']=dict(db.execute('SELECT role,count(DISTINCT file) FROM evidence GROUP BY role'))
    summary['fileStatus']=dict(db.execute('SELECT status,count(*) FROM files GROUP BY status'))
    if (OUT/'households-summary.json').exists():summary['nationalHouseholds']=load(OUT/'households-summary.json')
    if (OUT/'household-plans-summary.json').exists():summary['householdPlans']=load(OUT/'household-plans-summary.json')
    summary['documentFlags']=dict(db.execute("SELECT value,count(*) FROM files,json_each(files.detail) WHERE value IN ('ocr-needed','archive-content-deferred','large-file-content-deferred','page-text-truncated','xml-text-truncated','pdf-repaired-by-parser') GROUP BY value"))
    summary['kbWithPublicCandidates']=db.execute("SELECT count(DISTINCT target) FROM links WHERE target LIKE 'kb:%' AND source NOT LIKE 'kb:%' AND status!='weak'").fetchone()[0]
    summary['spatialScope']='All geolocated source records: local 1:1000 map index, current downloaded RGB files, exact local OSM intersections. Invalid/missing coordinates remain unlinked.'
    db.execute("UPDATE metadata SET value=? WHERE key='summary'",(json.dumps(summary,ensure_ascii=False),))
    for filename,query,header in [('entities.csv','SELECT id,source,name,address,manifest,metadata FROM entities ORDER BY id',['id','source','name','address','manifest','metadata']),
                                  ('links.csv','SELECT * FROM links',['source','target','method','status','file','locator','evidence']),
                                  ('attachments.csv','SELECT * FROM attachments',['entity','file','label','type','kind','source_url','expected_bytes']),
                                  ('type-assets.csv','SELECT * FROM type_assets',['entity','source_type_key','file','display_type']),
                                  ('file-review.csv',"SELECT path,status,detail FROM files WHERE status IN ('missing','parse-error','empty','no-extracted-text','legacy-office-unparsed','cad-present-unparsed')",['path','status','detail'])]:
        with (OUT/filename).open('w',encoding='utf-8-sig',newline='') as f:
            writer=csv.writer(f);writer.writerow(header);writer.writerows(db.execute(query))
    household_counts={};plan_counts={}
    if (OUT/'households.sqlite').exists():
        h=sqlite3.connect((OUT/'households.sqlite').as_uri()+'?mode=ro',uri=True)
        household_counts=dict(h.execute('SELECT entity,count(*) FROM matches GROUP BY entity'));h.close()
    if (OUT/'household-plans.sqlite').exists():
        h=sqlite3.connect((OUT/'household-plans.sqlite').as_uri()+'?mode=ro',uri=True)
        plan_counts=dict(h.execute("SELECT entity,count(*) FROM links WHERE status='provider-unit-area-consistent' GROUP BY entity"));h.close()
    with (OUT/'material-matrix.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.writer(f)
        writer.writerow(['id','source','name','address','direct_floorplan_candidates','direct_site_layout_candidates','direct_unit_layout_candidates','cross_source_candidates','official_household_rows','provider_unit_and_area_consistent_rows','map_building_extent','map_terrain_extent','imagery_400m_footprint','osm_roads','completeness'])
        for eid,source,name,addr in db.execute('SELECT id,source,name,address FROM entities ORDER BY id').fetchall():
            counts_by_role=dict(db.execute('SELECT role,count(DISTINCT file) FROM evidence WHERE entity=? GROUP BY role',(eid,)))
            related=db.execute("SELECT count(DISTINCT source) FROM links WHERE target=? AND status!='weak'",(eid,)).fetchone()[0]
            env=db.execute('SELECT data FROM environment WHERE entity=?',(eid,)).fetchone()
            env=json.loads(env[0]) if env else {}
            writer.writerow([eid,source,name,addr,counts_by_role.get('floorplan',0),counts_by_role.get('site_layout',0),counts_by_role.get('unit_layout',0),related,household_counts.get(eid,0),plan_counts.get(eid,0),
                             bool(env.get('buildingsArchives')) if 'buildingsArchives' in env else 'unknown',
                             bool(env.get('contoursArchives') or env.get('elevationPointsArchives')) if 'contoursArchives' in env else 'unknown',
                             env.get('satellite400mCatalogFootprintCovered','unknown'),env.get('osm',{}).get('count','unknown'),'unverified'])
    db.commit();db.close();osm.close()
    (OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
    (OUT/'progress.json').write_text(json.dumps(dict(stage='complete',**summary),ensure_ascii=False),encoding='utf8')
    (OUT/'environment-summary.json').write_text(json.dumps(counts,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(counts),flush=True)


if __name__=='__main__':main()
