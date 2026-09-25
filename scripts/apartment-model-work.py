"""Create and run resumable apartment model work from the saved source library.

The output is a draft: plan vectors and unit stacks keep their inference method
and never turn unknown rotation, reflection, window geometry, or height into fact.
"""
import argparse
import csv
import collections
import hashlib
import json
import math
import os
import re
import sqlite3
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
LINKAGE = ROOT/'research/linkage'
OUT = LINKAGE/'generated/apartment-model-work'
DB = OUT/'work.sqlite'


def now(): return datetime.now(timezone.utc).isoformat()
def dump(value): return json.dumps(value, ensure_ascii=False, separators=(',', ':'))
def load(path): return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def atomic_json(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix+'.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf8')
    for attempt in range(12):
        try:
            os.replace(temp, path);return
        except PermissionError:
            if attempt==11: raise
            time.sleep(.05*(attempt+1))


def source_evidence():
    result = collections.defaultdict(list)
    library = LINKAGE/'generated/connected-materials/library.sqlite'
    if not library.exists(): return result
    db = sqlite3.connect(f'file:{library.resolve().as_posix()}?mode=ro', uri=True)
    targets=collections.defaultdict(set)
    for source,target in db.execute("SELECT source,target FROM links WHERE target LIKE 'kb:%' AND status!='weak'"):
        targets[source].add(target)
    seen = set()
    for entity,role,file,locator,basis in db.execute('SELECT entity,role,file,locator,basis FROM evidence'):
        owners={entity} if entity.startswith('kb:') else targets.get(entity,set())
        for owner in owners:
            key=(owner,role,file,locator)
            if key in seen: continue
            seen.add(key); result[owner].append(dict(role=role,file=file,locator=locator,basis=basis))
    db.close()
    return result


def prepare():
    OUT.mkdir(parents=True, exist_ok=True)
    audit = {str(r['providerId']):r for r in load(LINKAGE/'generated/plan-audit/complexes.json')}
    spatial_path = LINKAGE/'generated/material-readiness/spatial.json'
    spatial = {str(r['providerId']):r for r in load(spatial_path)} if spatial_path.exists() else {}
    evidence = source_evidence()
    build = OUT/'work.build.sqlite'
    for suffix in ['', '-wal', '-shm']: Path(str(build)+suffix).unlink(missing_ok=True)
    db = sqlite3.connect(build)
    db.executescript('''PRAGMA journal_mode=WAL;
    CREATE TABLE complexes(provider_id TEXT PRIMARY KEY,name TEXT,address TEXT,lane TEXT,expected_units INTEGER,known_units INTEGER,type_count INTEGER,types_with_images INTEGER,status TEXT,point TEXT,spatial TEXT,evidence TEXT,source_file TEXT);
    CREATE TABLE plan_types(provider_id TEXT,area_id TEXT,display_type TEXT,area REAL,variant TEXT,image_file TEXT,image_sha256 TEXT,status TEXT,draft_file TEXT,PRIMARY KEY(provider_id,area_id,variant));
    CREATE TABLE tasks(id INTEGER PRIMARY KEY,provider_id TEXT,area_id TEXT,variant TEXT,kind TEXT,status TEXT,priority INTEGER,input TEXT,output TEXT,attempts INTEGER DEFAULT 0,error TEXT,started_at TEXT,finished_at TEXT,UNIQUE(provider_id,area_id,variant,kind));
    CREATE INDEX tasks_queue ON tasks(status,priority,id);
    CREATE INDEX tasks_provider ON tasks(provider_id);
    CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);''')
    counts=collections.Counter(); task=lambda *x: db.execute('INSERT OR IGNORE INTO tasks(provider_id,area_id,variant,kind,status,priority,input,output) VALUES(?,?,?,?,?,?,?,?)',x)
    for file in sorted((LINKAGE/'providers/kb').glob('*.json'), key=lambda p:int(p.stem)):
        provider=load(file); pid=str(provider['providerId']); row=audit[pid]
        lane='primary' if row['completeProviderLookup'] else ('partial' if row['typesWithImages'] else 'source-needed')
        counts[lane]+=1
        ev=evidence.get('kb:'+pid,[])
        db.execute('INSERT INTO complexes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(pid,provider.get('name',''),provider.get('address',''),lane,int(provider.get('households') or 0),len({(str(u.get('building')),str(u.get('unit'))) for u in provider.get('units',[])}),len(provider.get('plans',[])),row['typesWithImages'],'queued',dump(provider.get('point')),dump(spatial.get(pid,{})),dump(ev),file.relative_to(ROOT).as_posix()))
        base=10 if lane=='primary' else 100
        for plan in provider.get('plans',[]):
            area_id=str(plan.get('areaId')); variants=plan.get('variants') or []
            if not variants:
                task(pid,area_id,'','acquire-plan','needs-source',base,dump(dict(displayType=plan.get('displayType'),area=plan.get('area'),references=plan.get('references',[]))), '')
            for variant in variants:
                image=variant.get('file',''); path=ROOT/image
                if not image or not path.exists():
                    task(pid,area_id,str(variant.get('variant','')),'acquire-plan','needs-source',base,dump(variant),'')
                    continue
                draft=f'research/linkage/generated/apartment-model-work/complexes/{pid}/plans/{area_id}-{variant.get("variant","plan")}.json'
                db.execute('INSERT OR REPLACE INTO plan_types VALUES(?,?,?,?,?,?,?,?,?)',(pid,area_id,str(plan.get('displayType','')),float(plan.get('area') or 0),str(variant.get('variant','')),image,str(variant.get('sha256','')),'queued',draft))
                task(pid,area_id,str(variant.get('variant','')),'trace-plan','queued',base,dump(dict(image=image,sha256=variant.get('sha256'),area=plan.get('area'),displayType=plan.get('displayType'))),draft)
        task(pid,'','','infer-unit-stacks','queued',base+20,dump(dict(source=file.relative_to(ROOT).as_posix())),f'research/linkage/generated/apartment-model-work/complexes/{pid}/unit-stacks.json')
        task(pid,'','','assemble-complex','queued',base+30,'',f'research/linkage/generated/apartment-model-work/complexes/{pid}/complex.json')
        # These remain explicit acquisition/verification work while draft inference continues.
        if not any(x['role']=='site_layout' for x in ev): task(pid,'','','acquire-site-layout','needs-source',base+40,'','')
        if not any(x['role']=='height' for x in ev): task(pid,'','','resolve-height','needs-source',base+41,'','')
        if row.get('missingUnitRecords'): task(pid,'','','complete-unit-inventory','needs-source',base+42,dump(dict(missing=row['missingUnitRecords'])),'')
        if row.get('conflictingUnits'): task(pid,'','','resolve-unit-conflicts','needs-review',base+43,dump(dict(conflicts=row['conflictingUnits'])),'')
    summary=dict(preparedAt=now(),complexes=len(audit),lanes=dict(counts),tasks=dict(db.execute('SELECT status,count(*) FROM tasks GROUP BY status')),planVariants=db.execute('SELECT count(*) FROM plan_types').fetchone()[0],notes=['Primary means complete provider plan-image and unit lookup, not a verified finished model.','Draft vectors infer scale from exclusive area and detected image silhouette.','Unit stacks use building/unit identifiers; geographic rotation and reflection stay unknown.'])
    db.execute('INSERT INTO metadata VALUES(?,?)',('summary',dump(summary)));db.commit();db.close()
    os.replace(build,DB); atomic_json(OUT/'progress.json',dict(stage='prepared',**summary)); write_review()
    print(json.dumps(summary,ensure_ascii=False,indent=2))


def decode_image(path):
    data=np.fromfile(path,dtype=np.uint8); image=cv2.imdecode(data,cv2.IMREAD_COLOR)
    if image is None: raise ValueError('image decode failed')
    return image


def trace_plan(payload, output):
    source=ROOT/payload['image']; image=decode_image(source); height,width=image.shape[:2]
    gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY);hsv=cv2.cvtColor(image,cv2.COLOR_BGR2HSV)
    raw=((gray<238)|((hsv[:,:,1]>22)&(hsv[:,:,2]<250))).astype(np.uint8)*255
    margin=max(2,min(width,height)//100);raw[:margin,:]=0;raw[-margin:,:]=0;raw[:,:margin]=0;raw[:,-margin:]=0
    kernel=max(5,(min(width,height)//45)|1)
    joined=cv2.morphologyEx(raw,cv2.MORPH_CLOSE,np.ones((kernel,kernel),np.uint8),iterations=2)
    contours,_=cv2.findContours(joined,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    contours=[c for c in contours if cv2.contourArea(c)>width*height*.004]
    if not contours: raise ValueError('no plan silhouette candidate')
    center=np.array([width/2,height/2])
    contour=max(contours,key=lambda c:cv2.contourArea(c)/(1+np.linalg.norm(np.mean(c[:,0,:],axis=0)-center)/max(width,height)))
    contour_area=cv2.contourArea(contour);x,y,w,h=cv2.boundingRect(contour)
    if contour_area<=0: raise ValueError('empty plan silhouette')
    area=float(payload.get('area') or 0); scale=math.sqrt(area/contour_area) if area>0 else None
    perimeter=cv2.arcLength(contour,True);poly=cv2.approxPolyDP(contour,.006*perimeter,True)[:,0,:]
    def point(p):
        return [round((float(p[0])-x)*(scale or 1),4),round((float(p[1])-y)*(scale or 1),4)]
    mask=np.zeros_like(gray);cv2.drawContours(mask,[contour],-1,255,-1)
    edges=cv2.Canny(gray,55,155);edges=cv2.bitwise_and(edges,mask)
    raw_lines=cv2.HoughLinesP(edges,1,np.pi/180,threshold=max(20,min(w,h)//18),minLineLength=max(18,min(w,h)//12),maxLineGap=max(5,min(w,h)//80))
    lines=[];seen=set()
    for line in ([] if raw_lines is None else raw_lines.reshape(-1,4)):
        x1,y1,x2,y2=map(int,line);length=math.hypot(x2-x1,y2-y1);angle=abs(math.degrees(math.atan2(y2-y1,x2-x1)))%180
        axis=min(angle,abs(angle-90),abs(angle-180))
        if axis>10 and length<min(w,h)*.22: continue
        key=tuple(round(v/5) for v in (x1,y1,x2,y2))
        reverse=(key[2],key[3],key[0],key[1])
        if key in seen or reverse in seen: continue
        seen.add(key);lines.append(dict(a=point((x1,y1)),b=point((x2,y2)),source='image-line-candidate'))
    lines=lines[:400]
    ratio=contour_area/(w*h);confidence='medium' if .35<=ratio<=.92 and len(poly)>=4 else 'low'
    record=dict(version=1,providerId=payload['providerId'],areaId=payload['areaId'],displayType=payload.get('displayType'),variant=payload['variant'],source=dict(file=payload['image'],sha256=payload.get('sha256'),pixels=[width,height]),draft=dict(exterior=[point(p) for p in poly],wallLineCandidates=lines,approximateSizeMeters=[round(w*(scale or 1),3),round(h*(scale or 1),3)],ceilingHeightAssumptionMeters=2.55,scaleMetersPerPixel=round(scale,7) if scale else None,scaleMethod='exclusive-area-to-detected-silhouette' if scale else 'unscaled-pixels',confidence=confidence),unknown=['room semantics','doors','window openings and sill heights','as-built changes','rotation','reflection'])
    target=ROOT/output;target.parent.mkdir(parents=True,exist_ok=True);atomic_json(target,record)
    preview=image.copy();cv2.drawContours(preview,[contour],-1,(0,70,255),3)
    for item in lines[:200]:
        a=item['a'];b=item['b'];factor=scale or 1
        cv2.line(preview,(round(a[0]/factor+x),round(a[1]/factor+y)),(round(b[0]/factor+x),round(b[1]/factor+y)),(255,70,0),1)
    if max(width,height)>1000:
        factor=1000/max(width,height);preview=cv2.resize(preview,None,fx=factor,fy=factor,interpolation=cv2.INTER_AREA)
    ok,encoded=cv2.imencode('.jpg',preview,[cv2.IMWRITE_JPEG_QUALITY,76])
    if ok: encoded.tofile(target.with_suffix('.jpg'))


def unit_stacks(payload, output):
    provider=load(ROOT/payload['source']); groups=collections.defaultdict(list); rejected=[]
    for unit in provider.get('units',[]):
        name=str(unit.get('unit',''));match=re.search(r'(\d+)$',name)
        if not match or len(match.group(1))<3: rejected.append(name);continue
        digits=match.group(1);floor=int(digits[:-2]);line=int(digits[-2:])
        groups[(str(unit.get('building','')),line)].append((floor,str(unit.get('areaId','')),name))
    buildings=collections.defaultdict(list)
    for (building,line),units in sorted(groups.items()):
        type_counts=collections.Counter(area for _,area,_ in units);default=type_counts.most_common(1)[0][0]
        buildings[building].append(dict(line=line,floors=[min(x[0] for x in units),max(x[0] for x in units)],units=len(units),defaultAreaId=default,typeCounts=dict(type_counts),exceptions=[dict(floor=f,unit=u,areaId=a) for f,a,u in units if a!=default]))
    record=dict(version=1,providerId=str(provider['providerId']),method='numeric-unit-last-two-digits',confidence='candidate',buildings=[dict(building=k,providerDongId=next((str(x.get('providerDongId')) for x in provider.get('buildings',[]) if str(x.get('building'))==k),None),lines=v,geographicTransform=dict(rotation=None,reflection=None,footprint=None)) for k,v in buildings.items()],rejectedUnitLabels=rejected,unknown=['line order along facade','core and entrances','geographic rotation','reflection','special-floor geometry'])
    atomic_json(ROOT/output,record)


def assemble(db, provider_id, output):
    c=db.execute('SELECT * FROM complexes WHERE provider_id=?',(provider_id,)).fetchone();columns=[x[0] for x in db.execute('SELECT * FROM complexes LIMIT 0').description];c=dict(zip(columns,c))
    plans=[dict(areaId=a,displayType=d,area=area,variant=v,sourceImage=i,status=s,draftFile=o) for a,d,area,v,i,s,o in db.execute('SELECT area_id,display_type,area,variant,image_file,status,draft_file FROM plan_types WHERE provider_id=? ORDER BY display_type,variant',(provider_id,))]
    stack=f'research/linkage/generated/apartment-model-work/complexes/{provider_id}/unit-stacks.json'
    needs=[dict(kind=k,status=s,input=json.loads(i) if i else None) for k,s,i in db.execute("SELECT kind,status,input FROM tasks WHERE provider_id=? AND status IN ('needs-source','needs-review')",(provider_id,))]
    record=dict(version=1,providerId=provider_id,name=c['name'],address=c['address'],lane=c['lane'],status='draft-work-package',point=json.loads(c['point']),sourceFile=c['source_file'],plans=plans,unitStacks=stack if (ROOT/stack).exists() else None,spatialCandidates=json.loads(c['spatial']),documentEvidence=json.loads(c['evidence']),remainingWork=needs,modelPolicy=dict(unknownTransformsRemainNull=True,assumedCeilingHeightMeters=2.55,releaseReady=False))
    atomic_json(ROOT/output,record)


def refresh(db, stage='running', current=None):
    summary=dict(stage=stage,updatedAt=now(),pid=os.getpid(),current=current,tasks=dict(db.execute('SELECT status,count(*) FROM tasks GROUP BY status')),kinds={k:dict(db.execute('SELECT status,count(*) FROM tasks WHERE kind=? GROUP BY status',(k,))) for k, in db.execute('SELECT DISTINCT kind FROM tasks')},complexes=dict(db.execute('SELECT lane,count(*) FROM complexes GROUP BY lane')),draftPlans=db.execute("SELECT count(*) FROM plan_types WHERE status='complete'").fetchone()[0],draftComplexes=db.execute("SELECT count(*) FROM tasks WHERE kind='assemble-complex' AND status='complete'").fetchone()[0])
    atomic_json(OUT/'progress.json',summary);return summary


def run(limit=0):
    lock=OUT/'worker.lock'
    with lock.open('x') as stream: stream.write(str(os.getpid()))
    db=sqlite3.connect(DB);db.row_factory=sqlite3.Row;processed=0
    try:
        while not limit or processed<limit:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute("SELECT * FROM tasks WHERE status='queued' ORDER BY priority,id LIMIT 1").fetchone()
            if not row: db.commit();break
            db.execute("UPDATE tasks SET status='running',attempts=attempts+1,started_at=?,error='' WHERE id=?",(now(),row['id']));db.commit()
            try:
                payload=json.loads(row['input']) if row['input'] else {};payload.update(providerId=row['provider_id'],areaId=row['area_id'],variant=row['variant'])
                if row['kind']=='trace-plan': trace_plan(payload,row['output']);db.execute("UPDATE plan_types SET status='complete' WHERE provider_id=? AND area_id=? AND variant=?",(row['provider_id'],row['area_id'],row['variant']))
                elif row['kind']=='infer-unit-stacks': unit_stacks(payload,row['output'])
                elif row['kind']=='assemble-complex': assemble(db,row['provider_id'],row['output']);db.execute("UPDATE complexes SET status='draft-complete' WHERE provider_id=?",(row['provider_id'],))
                else: raise ValueError('unsupported automatic task: '+row['kind'])
                db.execute("UPDATE tasks SET status='complete',finished_at=? WHERE id=?",(now(),row['id']))
            except Exception as exc:
                db.execute("UPDATE tasks SET status='error',error=?,finished_at=? WHERE id=?",(type(exc).__name__+':'+str(exc)[:800],now(),row['id']))
            db.commit();processed+=1
            if processed%25==0: refresh(db,current=dict(id=row['id'],providerId=row['provider_id'],kind=row['kind']))
        result=refresh(db,stage='batch-complete' if limit else 'complete');write_review(db)
        print(json.dumps(result,ensure_ascii=False,indent=2))
    finally: db.close();lock.unlink(missing_ok=True)


def write_review(open_db=None):
    own=open_db is None;db=open_db or sqlite3.connect(DB);db.row_factory=sqlite3.Row
    progress=json.loads((OUT/'progress.json').read_text(encoding='utf8')) if (OUT/'progress.json').exists() else {}
    rows=[dict(r) for r in db.execute('''SELECT c.provider_id,c.name,c.address,c.lane,c.expected_units,c.known_units,c.status,
      (SELECT count(*) FROM plan_types p WHERE p.provider_id=c.provider_id AND p.status='complete') draft_plans,
      (SELECT count(*) FROM plan_types p WHERE p.provider_id=c.provider_id) queued_plans,
      (SELECT count(*) FROM tasks t WHERE t.provider_id=c.provider_id AND t.status IN ('needs-source','needs-review')) remaining
      FROM complexes c ORDER BY CASE lane WHEN 'primary' THEN 0 WHEN 'partial' THEN 1 ELSE 2 END,expected_units DESC''')]
    with (OUT/'remaining-work.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.writer(stream);writer.writerow(['provider_id','name','address','lane','kind','status','area_id','variant','detail'])
        writer.writerows(db.execute('''SELECT t.provider_id,c.name,c.address,c.lane,t.kind,t.status,t.area_id,t.variant,t.input
          FROM tasks t JOIN complexes c ON c.provider_id=t.provider_id
          WHERE t.status IN ('needs-source','needs-review') ORDER BY t.priority,t.provider_id,t.kind,t.area_id'''))
    if own:db.close()
    payload=json.dumps(dict(progress=progress,rows=rows),ensure_ascii=False).replace('<','\\u003c')
    html='''<!doctype html><html lang="ko"><meta charset="utf-8"><title>아파트 모델 제작 현황</title><style>body{font:15px system-ui;margin:28px;background:#f3f6f8;color:#234}input,select{padding:10px;margin:6px}table{width:100%;border-collapse:collapse;background:white}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left}small{display:block;color:#647584}.cards{display:flex;gap:12px;flex-wrap:wrap}.card{background:white;padding:14px;border-radius:7px}a{color:#075f9f}</style><h1>아파트 모델 제작 현황</h1><div id="cards" class="cards"></div><p>평면 벡터와 동·호 라인은 자동 초안입니다. 회전·좌우반전·창호·층고·건물 외곽 정합은 근거가 생길 때까지 미확정으로 둡니다.</p><p><a href="remaining-work.csv">남은 원본·검토 작업 CSV</a></p><input id="q" placeholder="단지명·주소"><select id="lane"><option value="">전체</option><option value="primary">296개 우선 제작</option><option value="partial">보유 타입부터 제작</option><option value="source-needed">원본 확보 필요</option></select><span id="count"></span><table><thead><tr><th>단지</th><th>구분</th><th>평면 초안</th><th>세대</th><th>남은 자료 작업</th></tr></thead><tbody id="body"></tbody></table><script>const data='''+payload+''';const e=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const p=data.progress;document.querySelector('#cards').innerHTML=[['상태',p.stage],['평면 초안',p.draftPlans||0],['단지 작업 묶음',p.draftComplexes||0],['원본/검토 작업',p.tasks?.['needs-source']||0],['오류',p.tasks?.error||0]].map(x=>'<div class="card">'+e(x[0])+'<br><b>'+e(x[1])+'</b></div>').join('');function render(){const q=document.querySelector('#q').value,l=document.querySelector('#lane').value,a=data.rows.filter(r=>(!l||r.lane===l)&&(r.name+' '+r.address).includes(q));document.querySelector('#count').textContent=a.length+'개';document.querySelector('#body').innerHTML=a.map(r=>'<tr><td><b>'+e(r.name)+'</b><small>'+e(r.address)+' / '+e(r.provider_id)+'</small><a target="_blank" href="complexes/'+encodeURIComponent(r.provider_id)+'/complex.json">작업 묶음</a></td><td>'+e(r.lane)+'</td><td>'+r.draft_plans+' / '+r.queued_plans+'</td><td>'+Number(r.known_units).toLocaleString()+' / '+Number(r.expected_units).toLocaleString()+'</td><td>'+r.remaining+'</td></tr>').join('')}document.querySelector('#q').oninput=render;document.querySelector('#lane').onchange=render;render()</script></html>'''
    (OUT/'review.html').write_text(html,encoding='utf8')


def main():
    parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='command',required=True)
    sub.add_parser('prepare');run_parser=sub.add_parser('run');run_parser.add_argument('--limit',type=int,default=0);sub.add_parser('status')
    args=parser.parse_args()
    if args.command=='prepare':prepare()
    elif args.command=='run':run(args.limit)
    else:
        db=sqlite3.connect(DB);result=refresh(db,stage='complete',current=None);write_review(db);print(json.dumps(result,ensure_ascii=False,indent=2));db.close()


if __name__=='__main__':main()
