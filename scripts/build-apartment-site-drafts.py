"""Build address-matched 1:1,000 site footprint drafts for apartment work packages."""
import collections
import io
import json
import os
import re
import sqlite3
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import shapefile
from pyproj import CRS, Transformer

ROOT=Path(__file__).resolve().parents[1]
LINKAGE=ROOT/'research/linkage'
OUT=LINKAGE/'generated/apartment-model-work'


def norm(value):return re.sub(r'[^0-9A-Za-z가-힣]','',str(value or '')).lower()
def road_key(address):
    matches=list(re.finditer(r'([0-9A-Za-z가-힣·]+(?:대로|로|길))\s+(\d+)(?:-(\d+))?',str(address or '')))
    return (norm(matches[-1].group(1)),int(matches[-1].group(2)),int(matches[-1].group(3) or 0)) if matches else None
def atomic(path,value):
    path=Path(path);temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8')
    for attempt in range(12):
        try:os.replace(temp,path);return
        except PermissionError:
            if attempt==11:raise
            time.sleep(.05*(attempt+1))
def load(path):return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def dong_number(text):
    hits=re.findall(r'(?<!\d)(\d{1,4})\s*동',str(text or ''))
    return hits[-1].lstrip('0') or '0' if hits else None


def main():
    spatial={str(r['providerId']):r for r in load(LINKAGE/'generated/material-readiness/spatial.json')}
    providers={}
    archive_targets=collections.defaultdict(list)
    to5179=Transformer.from_crs(4326,5179,always_xy=True)
    for file in (LINKAGE/'providers/kb').glob('*.json'):
        p=load(file);pid=str(p['providerId']);point=p.get('point');key=road_key(p.get('address'))
        if not point or not key:continue
        cx,cy=to5179.transform(*point);buildings={str(x.get('building','')).lstrip('0') for x in p.get('buildings',[])}
        providers[pid]=dict(provider=p,center=(cx,cy),road=key,buildingNames=buildings)
        for archive in spatial.get(pid,{}).get('buildingsArchives',[]):archive_targets[archive].append(pid)
    found=collections.defaultdict(dict);transforms={};errors=[];started=datetime.now(timezone.utc).isoformat();total=len(archive_targets)
    for index,(relative,pids) in enumerate(sorted(archive_targets.items()),1):
        path=ROOT/relative.replace('\\','/')
        try:
            with zipfile.ZipFile(path) as z:
                shp=next((n for n in z.namelist() if n.endswith('N1A_B0010000.shp')),None)
                if not shp:continue
                base=shp[:-4];wkt=z.read(base+'.prj').decode('utf-8-sig')
                if wkt not in transforms:transforms[wkt]=Transformer.from_crs(CRS.from_wkt(wkt),5179,always_xy=True)
                reader=shapefile.Reader(shp=io.BytesIO(z.read(shp)),shx=io.BytesIO(z.read(base+'.shx')),dbf=io.BytesIO(z.read(base+'.dbf')),encoding='cp949')
                for sr in reader.iterShapeRecords():
                    attrs=sr.record.as_dict();key=(norm(attrs.get('도로명')),int(attrs.get('건물본번') or 0),int(attrs.get('건물부번') or 0))
                    targets=[pid for pid in pids if providers[pid]['road']==key]
                    if not targets:continue
                    px,py=transforms[wkt].transform(*zip(*sr.shape.points));parts=list(sr.shape.parts)+[len(px)]
                    for pid in targets:
                        cx,cy=providers[pid]['center'];rings=[]
                        for start,end in zip(parts,parts[1:]):
                            ring=[[round(float(px[j]-cx),3),round(float(cy-py[j]),3)] for j in range(start,end)]
                            if ring:rings.append(ring)
                        if not rings:continue
                        # Guard malformed address attributes far from the provider point.
                        distance=min((x*x+z*z)**.5 for ring in rings for x,z in ring)
                        if distance>500:continue
                        name=str(attrs.get('명칭') or '');note=str(attrs.get('주기') or '');dong=dong_number(name+' '+note)
                        ufid=str(attrs.get('UFID') or '')
                        identifier=ufid or json.dumps(rings,ensure_ascii=False,separators=(',',':'))
                        found[pid][identifier]=dict(ufid=ufid,name=name,note=note,building=dong if dong in providers[pid]['buildingNames'] else None,buildingLabelCandidate=dong,levels=int(attrs.get('층수') or 0) or None,heightMetersCandidate=round(int(attrs.get('층수') or 0)*2.9,1) if attrs.get('층수') else None,heightMethod='map-levels-times-2.9' if attrs.get('층수') else None,usage=attrs.get('용도'),surveyMethod=attrs.get('측량방법'),roadName=attrs.get('도로명'),roadNumber=[attrs.get('건물본번'),attrs.get('건물부번')],rings=rings,source=relative)
        except Exception as exc:errors.append(dict(file=relative,error=type(exc).__name__+':'+str(exc)[:250]))
        if index%25==0:atomic(OUT/'site-progress.json',dict(stage='running',startedAt=started,updatedAt=datetime.now(timezone.utc).isoformat(),archives=index,totalArchives=total,complexesWithCandidates=len(found),features=sum(len(x) for x in found.values()),errors=len(errors)))
    db=sqlite3.connect(OUT/'work.sqlite');matched=0;height=0;named=0;features=0
    for pid,meta in providers.items():
        rows=list(found.get(pid,{}).values());features+=len(rows)
        if rows:
            matched+=1;named+=int(any(r['building'] for r in rows));height+=int(any(r['levels'] for r in rows))
        output=f'research/linkage/generated/apartment-model-work/complexes/{pid}/site-draft.json'
        record=dict(version=1,providerId=pid,name=meta['provider'].get('name'),address=meta['provider'].get('address'),center5179=[round(x,3) for x in meta['center']],method='1:1000-map-exact-road-address',confidence='candidate',features=rows,summary=dict(features=len(rows),namedBuildingMatches=sum(bool(r['building']) for r in rows),levelsPresent=sum(bool(r['levels']) for r in rows)),unknown=['same-address phase conflicts','unnamed building-to-dong assignment','entrances and cores','footprint-to-unit-line rotation','measured floor elevations'])
        atomic(ROOT/output,record)
        complex_file=OUT/f'complexes/{pid}/complex.json'
        if complex_file.exists():
            complex=load(complex_file);complex['siteDraft']=output;complex['siteDraftStatus']='candidate' if rows else 'no-exact-address-feature';atomic(complex_file,complex)
        if rows:
            db.execute("UPDATE tasks SET status='candidate-complete',output=?,finished_at=? WHERE provider_id=? AND kind='acquire-site-layout' AND status='needs-source'",(output,datetime.now(timezone.utc).isoformat(),pid))
        if any(r['levels'] for r in rows):
            db.execute("UPDATE tasks SET status='candidate-complete',output=?,finished_at=? WHERE provider_id=? AND kind='resolve-height' AND status='needs-source'",(output,datetime.now(timezone.utc).isoformat(),pid))
    db.commit()
    task_counts=dict(db.execute('SELECT status,count(*) FROM tasks GROUP BY status'));db.close()
    summary=dict(stage='complete',startedAt=started,finishedAt=datetime.now(timezone.utc).isoformat(),archives=total,providerCoordinates=len(providers),complexesWithExactAddressFeatures=matched,complexesWithNamedDongMatches=named,complexesWithLevelCandidates=height,features=features,errors=errors,taskCounts=task_counts,notes=['Only 1:1,000 building layers are used.','Road-address equality is a candidate link; same-address phases remain unresolved.','Height is levels times 2.9 m and is not a measured building height.'])
    atomic(OUT/'site-progress.json',summary)
    # Regenerate the lightweight dashboard and remaining-source CSV.
    import importlib.util
    spec=importlib.util.spec_from_file_location('model_work',ROOT/'scripts/apartment-model-work.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);module.write_review()
    print(json.dumps({**summary,'errors':len(errors)},ensure_ascii=False,indent=2))


if __name__=='__main__':main()
