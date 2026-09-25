"""Interpolate NGII contours and elevation points in the review's EPSG:5179 frame."""
import argparse,io,json,zipfile,hashlib
from pathlib import Path
import numpy as np
import shapefile
from pyproj import CRS,Transformer
from scipy.interpolate import LinearNDInterpolator

def build(folder):
    path=folder/'scene.json';data=json.loads(path.read_text(encoding='utf-8'))
    cx,cy=data['center5179'];half=max(data['widthMeters'],data['depthMeters'])/2
    margin=half+250;samples=[];sources=[];transforms={}
    for archive in sorted(Path('mapinfo').glob('*.zip')):
        with zipfile.ZipFile(archive) as z:
            names=z.namelist();used=0
            for layer,field in [('N1L_F0010000','등고수치'),('N1P_F0020000','수치')]:
                shp=next((n for n in names if n.endswith(layer+'.shp')),None)
                if not shp:continue
                base=shp[:-4];wkt=z.read(base+'.prj').decode()
                if wkt not in transforms:transforms[wkt]=Transformer.from_crs(CRS.from_wkt(wkt),5179,always_xy=True)
                t=transforms[wkt];raw=z.read(shp)
                # Read only geometry bounds before loading attributes for nearby sheets.
                reader=shapefile.Reader(shp=io.BytesIO(raw))
                bb=reader.bbox
                pts=[t.transform(x,y) for x,y in [(bb[0],bb[1]),(bb[0],bb[3]),(bb[2],bb[1]),(bb[2],bb[3])]]
                xx,yy=np.array(pts).T
                if max(xx)<cx-margin or min(xx)>cx+margin or max(yy)<cy-margin or min(yy)>cy+margin:continue
                reader=shapefile.Reader(shp=io.BytesIO(raw),dbf=io.BytesIO(z.read(base+'.dbf')),encoding='cp949')
                for sr in reader.iterShapeRecords():
                    h=sr.record.as_dict().get(field)
                    if h is None or not np.isfinite(float(h)):continue
                    x,y=t.transform(*np.asarray(sr.shape.points).T);p=np.column_stack((x-cx,cy-y))
                    if p[:,0].max()<-margin or p[:,0].min()>margin or p[:,1].max()<-margin or p[:,1].min()>margin:continue
                    used+=1
                    if layer.startswith('N1P'):
                        if np.max(np.abs(p[0]))<=margin:samples.append([*p[0],float(h)])
                        continue
                    parts=list(sr.shape.parts)+[len(p)]
                    for start,end in zip(parts,parts[1:]):
                        for a,b in zip(p[start:end-1],p[start+1:end]):
                            if np.minimum(a,b).max()>margin or np.maximum(a,b).min()<-margin:continue
                            steps=max(1,int(np.ceil(np.linalg.norm(b-a)/5)))
                            for q in np.linspace(a,b,steps+1):
                                if np.max(np.abs(q))<=margin:samples.append([*q,float(h)])
            if used:sources.append({'file':archive.name,'features':used,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()})
    a=np.asarray(samples);assert len(a)>10,'Insufficient elevation samples'
    xy,inv=np.unique(np.round(a[:,:2],3),axis=0,return_inverse=True)
    h=np.bincount(inv,weights=a[:,2])/np.bincount(inv)
    conflict=float(np.max(np.abs(a[:,2]-h[inv])))
    if conflict>1:raise ValueError(f'Coincident source heights disagree by {conflict} m')
    interp=LinearNDInterpolator(xy,h)
    n=257;xs=np.linspace(-data['widthMeters']/2,data['widthMeters']/2,n);zs=np.linspace(-data['depthMeters']/2,data['depthMeters']/2,n)
    x,z=np.meshgrid(xs,zs);grid=interp(x,z)
    if not np.isfinite(grid).all():raise ValueError('Incomplete terrain support; no extrapolation allowed')
    # Fit residual is only a numerical check, not independent terrain accuracy.
    residual=float(np.nanmax(np.abs(interp(xy)-h)))
    terrain={'size':n,'widthMeters':data['widthMeters'],'depthMeters':data['depthMeters'],
             'heights':np.round(grid,3).ravel().tolist(),'referenceElevation':round(float(np.median(grid)),3),
             'min':float(grid.min()),'max':float(grid.max()),'method':'linear TIN interpolation of NGII contours and spot elevations',
             'status':'estimated ground surface; no walls, overhangs or building roofs',
             'samples':len(xy),'sourceConflictMeters':conflict,'fitResidualMeters':residual,'independentAccuracyMeters':None,'sources':sources}
    data['terrain']=terrain;path.write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')
    print(json.dumps({k:v for k,v in terrain.items() if k not in ['heights','sources']}),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('folder',type=Path);build(p.parse_args().folder)
