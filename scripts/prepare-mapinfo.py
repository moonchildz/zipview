"""Build an explicitly estimated local terrain patch from supplied NGII contours."""
import io
import json
import zipfile
from pathlib import Path

import numpy as np
import shapefile
from pyproj import CRS, Transformer
from scipy.interpolate import LinearNDInterpolator

root = Path('research/sinchon-prugio/outlook')
scene = json.loads((root/'scene.json').read_text(encoding='utf-8'))
to_geo = Transformer.from_crs(5186, 4326, always_xy=True)
lon0, lat0 = scene['center']
mx = 111195*np.cos(np.radians(lat0))
def local(points):
    a=np.asarray(points); lon,lat=to_geo.transform(a[:,0],a[:,1])
    return np.column_stack(((lon-lon0)*mx, -(lat-lat0)*111195))

def sample(grid,x,z):
    n=grid['size']; e=grid['extent']; h=np.asarray(grid['heights'])
    gx=np.clip((x+e)/(2*e)*(n-1),0,n-1); gz=np.clip((z+e)/(2*e)*(n-1),0,n-1)
    c=np.minimum(n-2,np.floor(gx).astype(int)); r=np.minimum(n-2,np.floor(gz).astype(int))
    u=gx-c; v=gz-r; i=r*n+c
    return np.where(u+v<=1,h[i]+(h[i+1]-h[i])*u+(h[i+n]-h[i])*v,
                    h[i+n+1]+(h[i+n]-h[i+n+1])*(1-u)+(h[i+1]-h[i+n+1])*(1-v))

samples=[]; named={}; sources=[]
for path in sorted(Path('mapinfo').glob('*.zip')):
    with zipfile.ZipFile(path) as archive:
        crs=CRS.from_wkt(archive.read(next(n for n in archive.namelist() if n.endswith('.prj'))).decode())
        assert crs.to_epsg()==5186
        sources.append(path.name)
        for layer in ['N1L_F0010000','N1P_F0020000','N1A_B0010000']:
            reader=shapefile.Reader(shp=io.BytesIO(archive.read(layer+'.shp')),
                                    dbf=io.BytesIO(archive.read(layer+'.dbf')),encoding='cp949')
            for sr in reader.iterShapeRecords():
                p=local(sr.shape.points); d=sr.record.as_dict()
                if layer=='N1A_B0010000':
                    if d['도로명']=='북아현로1길' and d['건물본번']==50:
                        named.setdefault(d['주기'],[]).append((p,d))
                    continue
                # Expand beyond the patch so triangulation has support at its boundary.
                if p[:,0].min()>400 or p[:,0].max()<-400 or p[:,1].min()>400 or p[:,1].max()<-400: continue
                if layer=='N1P_F0020000':
                    samples.append([*p[0],d['수치']]); continue
                parts=list(sr.shape.parts)+[len(p)]
                for start,end in zip(parts,parts[1:]):
                    for a,b in zip(p[start:end-1],p[start+1:end]):
                        count=max(1,int(np.ceil(np.linalg.norm(b-a)/3)))
                        for t in np.linspace(0,1,count+1):
                            q=a+(b-a)*t
                            if np.max(np.abs(q))<420: samples.append([*q,d['등고수치']])
points=np.asarray(samples)
# Merge coincident samples; record disagreement rather than silently choose one.
keys=np.round(points[:,:2],3); unique,inverse=np.unique(keys,axis=0,return_inverse=True)
values=np.bincount(inverse,weights=points[:,2])/np.bincount(inverse)
conflict=float(np.max(np.abs(points[:,2]-values[inverse])))
if conflict>0.5: raise ValueError(f'Conflicting contour samples: {conflict}m')
interp=LinearNDInterpolator(unique,values)
extent=250; size=251
axis=np.linspace(-extent,extent,size); x,z=np.meshgrid(axis,axis)
estimated=interp(x,z)
if not np.isfinite(estimated).all(): raise ValueError('Insufficient contour coverage; no nearest-neighbor fallback')
coarse=sample(scene['terrain'],x,z)
# 25 m boundary transition matches the coarse rendered triangles exactly at the edge.
weight=np.clip((extent-np.maximum(abs(x),abs(z)))/25,0,1)
heights=estimated*weight+coarse*(1-weight)
terrain={'extent':extent,'size':size,'heights':heights.ravel().tolist(),
         'source':'NGII 2025 1:1000 contours/spot heights; linear interpolation; 2m rendering grid',
         'status':'estimated; not surveyed first-floor elevation; retaining-wall steps not reconstructed'}
overrides=[]
for b in scene['buildings']:
    p=np.asarray(b['points']); center=p[:-1].mean(axis=0)
    if np.max(np.abs(p))>=225: continue
    base=float(sample(terrain,*center))
    item={'id':b['id'],'base':round(base,3),'baseSource':'NGII contours interpolated at footprint vertex mean; first-floor datum unverified',
          'previousBase':b['base']}
    # Only unambiguous, single-polygon buildings; leave 209/210 identity conflict unresolved.
    if b['id'] in [902872241,902872243]:
        candidates=named.get(b['name'].replace('동','')+'동',[])
        if len(candidates)!=1: raise ValueError('Ambiguous building geometry')
        shape,attributes=candidates[0]
        if np.linalg.norm(shape[:-1].mean(axis=0)-center)>15: raise ValueError('Building position mismatch')
        item.update(points=shape.tolist(),levels=attributes['층수'],height=attributes['층수']*2.9,
                    heightSource='ngii-levels-times-2.9',geometrySource=attributes['UFID'],
                    geometryStatus='NGII photo-survey footprint; floor height assumed 2.9m')
        item['base']=round(float(sample(terrain,*shape[:-1].mean(axis=0))),3)
    overrides.append(item)
output={'version':1,'sources':sources,'terrain':terrain,'buildings':overrides,
        'status':'지형 보간·207/208동 외곽/층수 반영 · 1층 표고, 209/210동 대응 미검증',
        'sampleCount':len(unique),'maxCoincidentSampleDeviationM':conflict}
(root/'mapinfo-correction.json').write_text(json.dumps(output,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print(json.dumps({'samples':len(unique),'buildings':len(overrides),'targets':[b for b in overrides if b['id'] in [777716407,902872238,902872241,902872243]]},ensure_ascii=True))
