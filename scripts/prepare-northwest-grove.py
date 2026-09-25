"""Build a reviewable, provisional NGII/satellite registration and canopy scene."""
import io,json,zipfile,hashlib,argparse
from pathlib import Path
import cv2
import numpy as np
import shapefile
from pyproj import Transformer,CRS
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--site',choices=['northwest','xi','yangjae','han'],default='northwest');args=p.parse_args();site=args.site;is_xi=site!='northwest'
OUT=ROOT/f'verification/{site}-grove'
OUT.mkdir(parents=True,exist_ok=True)
manifest=json.loads((ROOT/(f'verification/{site}-satellite/manifest.json' if is_xi else 'verification/satellite-facilities/manifest.json')).read_text(encoding='utf-8'))
sid=manifest['scenes'][0]['id'] if is_xi else 'C1_20240606014634_17816_00340169'
scene=next(s for s in manifest['scenes'] if s['id']==sid)
plan=json.loads((ROOT/'.tools/cas-imagery/plan.json').read_text(encoding='utf-8'))
catalog=next(s for s in plan['selected'] if s['id']==sid)
project=Transformer.from_crs(4326,5179,always_xy=True)
corners=np.array([project.transform(*p) for p in catalog['ring']])
west,south=corners.min(axis=0);east,north=corners.max(axis=0)
sx=(east-west)/scene['width'];sy=(north-south)/scene['height']
assert abs(sx-.5)<.001 and abs(sy-.5)<.001
region=manifest['regions'][0] if is_xi else next(r for r in manifest['regions'] if r['id']=='north-sports-2024')
offset=0 if is_xi else 1024
# A 1,024 m square with forest and urban buildings, preserving native pixels.
ox,oy=region['x']+offset,region['y']+offset
size=2048
cx=west+(ox+size/2)*sx;cy=north-(oy+size/2)*sy
image=Image.open(region['image']).crop((offset,offset,offset+size,offset+size)).convert('RGB')
image.save(OUT/'source.jpg',quality=96)
maskroot=ROOT/(f'verification/{site}-vegetation' if is_xi else 'verification/satellite-vegetation-grass035')
mask=np.asarray(Image.open(maskroot/region['id']/'mask.png'))[offset:offset+size,offset:offset+size]
Image.fromarray(mask).save(OUT/'mask.png')
canopy=(mask==1).astype('uint8')
contours,hierarchy=cv2.findContours(canopy,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_SIMPLE)
regions=[]
def local_ring(c):
    points=cv2.approxPolyDP(c,1,True).reshape(-1,2)
    return [[round((float(x)-size/2)*sx,3),round((float(y)-size/2)*sy,3)] for x,y in points]
for i,c in enumerate(contours):
    if hierarchy[0][i][3]!=-1 or cv2.contourArea(c)<64:continue
    ring=local_ring(c)
    if len(ring)<3:continue
    holes=[];child=int(hierarchy[0][i][2])
    while child!=-1:
        h=local_ring(contours[child])
        if len(h)>=3:holes.append(h)
        child=int(hierarchy[0][child][0])
    regions.append({'id':f'canopy-{i}','ring':ring,'holes':holes,'heightMeters':8})
buildings=[];sources=[];transforms={}
for i,path in enumerate(sorted((ROOT/'mapinfo').glob('*.zip'))):
    with zipfile.ZipFile(path) as z:
        names=z.namelist();shp=next((n for n in names if n.endswith('N1A_B0010000.shp')),None)
        if not shp:continue
        base=shp[:-4]
        wkt=z.read(base+'.prj').decode()
        if wkt not in transforms:transforms[wkt]=Transformer.from_crs(CRS.from_wkt(wkt),5179,always_xy=True)
        trans=transforms[wkt]
        reader=shapefile.Reader(shp=io.BytesIO(z.read(shp)),dbf=io.BytesIO(z.read(base+'.dbf')),encoding='cp949')
        bb=reader.bbox
        bx,by=trans.transform([bb[0],bb[2]],[bb[1],bb[3]])
        if max(bx)<cx-520 or min(bx)>cx+520 or max(by)<cy-520 or min(by)>cy+520:continue
        count=0
        for sr in reader.iterShapeRecords():
            px,py=trans.transform(*np.asarray(sr.shape.points).T)
            if max(px)<cx-512 or min(px)>cx+512 or max(py)<cy-512 or min(py)>cy+512:continue
            parts=list(sr.shape.parts)+[len(px)];rings=[]
            for start,end in zip(parts,parts[1:]):
                rings.append([[round(float(px[j]-cx),3),round(float(cy-py[j]),3)] for j in range(start,end)])
            attrs=sr.record.as_dict()
            buildings.append({'rings':rings,'source':path.name,'attributes':dict(attrs)})
            count+=1
        if count:sources.append({'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'count':count})
    if i%500==0:print('sheets',i,flush=True)
# Remove exact duplicate geometry where map sheets contain repeated records.
unique={json.dumps(b['rings']):b for b in buildings};buildings=list(unique.values())
overlay=image.copy();draw=ImageDraw.Draw(overlay)
for b in buildings:
    for ring in b['rings']:
        points=[(x/sx+size/2,z/sy+size/2) for x,z in ring]
        draw.line(points,fill='#ff5577',width=3)
overlay.save(OUT/'registration.jpg',quality=96)
data={'sceneId':sid,'regionId':region['id'],'sizePixels':size,'widthMeters':size*sx,'depthMeters':size*sy,
      'center5179':[cx,cy],'pixelOrigin':[ox,oy],'metersPerPixel':[sx,sy],
      'registration':{'status':'provisional','basis':'catalog EPSG:5179 rectangle; native dimensions agree with XML 0.5 m GSD','independentControlPoints':0,'accuracyMeters':None},
      'terrain':'flat review plane, not measured terrain','treeHeight':'assumed 8 m with procedural variation; not individual-tree detections',
      'regions':regions,'buildings':buildings,'mapSources':sources}
(OUT/'scene.json').write_text(json.dumps(data,ensure_ascii=False,default=str),encoding='utf-8')
print(json.dumps({'canopyRegions':len(regions),'buildings':len(buildings),'sheets':len(sources),'center5179':[cx,cy],'mpp':[sx,sy]}),flush=True)
