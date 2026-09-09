"""Generate a source comparison; never overwrite model geometry with unverified matches."""
import io
import json
import zipfile
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import shapefile
from pyproj import CRS, Transformer

plt.rcParams['font.family'] = 'Malgun Gothic'
plt.rcParams['axes.unicode_minus'] = False
root = Path('research/sinchon-prugio')
out = root / 'mapinfo-review'
out.mkdir(exist_ok=True)
scene = json.loads((root/'outlook/scene.json').read_text(encoding='utf-8'))
transform = Transformer.from_crs(4326, 5186, always_xy=True)
origin = np.array(transform.transform(*scene['center']))
features, inventory = [], []
layers = ['N1A_B0010000', 'N1L_F0010000', 'N1P_F0020000', 'N1L_F0040000']
for archive in sorted(Path('mapinfo').glob('*.zip')):
    sheet = archive.name.split('_')[1]
    with zipfile.ZipFile(archive) as z:
        prj = z.read(next(n for n in z.namelist() if n.endswith('.prj'))).decode()
        assert CRS.from_wkt(prj).to_epsg() == 5186
        counts = {}
        for layer in layers:
            if layer+'.shp' not in z.namelist():
                continue
            reader = shapefile.Reader(shp=io.BytesIO(z.read(layer+'.shp')),
                                      dbf=io.BytesIO(z.read(layer+'.dbf')), encoding='cp949')
            counts[layer] = len(reader)
            for sr in reader.iterShapeRecords():
                points = np.asarray(sr.shape.points)
                if not len(points):
                    continue
                local = points - origin
                lo, hi = local.min(axis=0), local.max(axis=0)
                if hi[0] < -180 or lo[0] > 150 or hi[1] < -180 or lo[1] > 160:
                    continue
                parts = list(sr.shape.parts) if hasattr(sr.shape, 'parts') else [0]
                parts = parts or [0]
                features.append({'sheet': sheet, 'layer': layer,
                                 'properties': sr.record.as_dict(),
                                 'points': local.tolist(), 'parts': parts})
        inventory.append({'sheet': sheet, 'counts': counts})

fig, ax = plt.subplots(figsize=(13, 11))
for f in features:
    p = np.asarray(f['points']); d = f['properties']; layer = f['layer']
    ends = f['parts'][1:] + [len(p)]
    for start, end in zip(f['parts'], ends):
        q = p[start:end]
        if layer == 'N1A_B0010000':
            ax.fill(q[:,0], q[:,1], color='#cbd5e1', alpha=.55)
            ax.plot(q[:,0], q[:,1], color='#475569', lw=.7)
        elif layer == 'N1L_F0010000':
            ax.plot(q[:,0], q[:,1], color='#15803d', lw=1, alpha=.8)
            valid = q[(abs(q[:,0]) < 160) & (abs(q[:,1]) < 140)]
            if len(valid):
                at = valid[len(valid)//2]
                ax.text(*at, f"{d['등고수치']:g}m", fontsize=8, color='#166534')
        elif layer == 'N1L_F0040000':
            ax.plot(q[:,0], q[:,1], color='#b45309', lw=1.5)
            at = q[len(q)//2]
            if -90 < at[0] < 110 and -80 < at[1] < 80 and d['높이'] > 0:
                ax.text(*at, f"벽 {d['높이']:g}m", fontsize=7, color='#92400e')
        else:
            ax.scatter(q[:,0], q[:,1], color='#15803d', marker='+', s=60)
            ax.text(*q[0], f"표고 {d['수치']:g}m", fontsize=9)
    if layer == 'N1A_B0010000' and d['주기'] and d['건물본번'] == 50:
        at = p[:-1].mean(axis=0)
        ax.text(*at, f"{d['주기']}\n{d['층수']}층", fontsize=9,
                ha='center', va='center', bbox={'facecolor':'white','alpha':.8,'edgecolor':'none'})

targets = []
for building in scene['buildings']:
    if building['id'] not in [777716407, 902872238]:
        continue
    lonlat = [(scene['center'][0]+x/(111195*np.cos(np.radians(scene['center'][1]))),
               scene['center'][1]-z/111195) for x,z in building['points']]
    p = np.array([transform.transform(*xy) for xy in lonlat])-origin
    ax.plot(p[:,0],p[:,1], color='#dc2626', lw=2, linestyle='--')
    at = p[:-1].mean(axis=0)
    ax.annotate(f"현재 OSM {building['name']}동", xy=at, xytext=(at[0]+40,at[1]+60),
                arrowprops={'arrowstyle':'->','color':'#dc2626'}, color='#dc2626', fontsize=10)
    distances=[]
    for f in features:
        if f['layer'] != 'N1L_F0010000':
            continue
        q=np.array(f['points']); best=float('inf')
        for start,end in zip(f['parts'],f['parts'][1:]+[len(q)]):
            a=q[start:end-1]; b=q[start+1:end]; v=b-a
            if not len(v): continue
            t=np.clip(np.sum((at-a)*v,axis=1)/np.maximum(np.sum(v*v,axis=1),1e-20),0,1)
            best=min(best,float(np.linalg.norm(a+t[:,None]*v-at,axis=1).min()))
        distances.append({'distanceM':round(best,2),'elevationM':f['properties']['등고수치'],
                          'sheet':f['sheet'],'ufid':f['properties']['UFID']})
    targets.append({'osmId':building['id'],'osmName':building['name'],
                    'currentBaseM':building['base'],'currentHeightM':building['height'],
                    'nearestContours':sorted(distances,key=lambda d:d['distanceM'])[:5]})
ax.set(xlim=(-180,150),ylim=(-180,160),xlabel='동쪽 거리 (m)',ylabel='북쪽 거리 (m)',
       title='신촌푸르지오 2단지 — 수치지도 / 현재 OSM 외곽선 대조\n회색: 수치지도 건물 · 녹색: 등고선 · 갈색: 옹벽 · 빨간 점선: 현재 모델')
ax.set_aspect('equal'); ax.grid(alpha=.15)
fig.text(.5,.015,'층수·등고선·옹벽 높이는 원자료 속성. 등고선은 건물 1층 표고를 직접 측정한 값이 아님.',ha='center',fontsize=10)
fig.tight_layout(rect=(0,.03,1,1))
fig.savefig(out/'comparison.png',dpi=160)
payload={'crs':'EPSG:5186','origin':origin.tolist(),'inventory':inventory,'targets':targets,'features':features}
(out/'source-review.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'inventory':inventory,'targets':targets,'featureCount':len(features)},ensure_ascii=True))
