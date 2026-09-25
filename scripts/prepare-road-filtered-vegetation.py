"""Subtract mapped road polygons from canopy/low vegetation; create review geometry."""
import io,json,zipfile,hashlib,importlib.util,argparse
from pathlib import Path
import numpy as np
import cv2,shapefile
from PIL import Image,ImageDraw
from pyproj import CRS,Transformer
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.warp import transform_geom
spec=importlib.util.spec_from_file_location('osm_paths',Path(__file__).with_name('osm-path-mask.py'));osm_paths=importlib.util.module_from_spec(spec);spec.loader.exec_module(osm_paths)

def build(site,osm_db=None):
 out=Path('verification')/(site+'-grove');data=json.loads((out/'scene.json').read_text(encoding='utf-8'))
 cx,cy=data['center5179'];w,d=data['widthMeters'],data['depthMeters'];n=data['sizePixels'];sx,sy=w/n,d/n
 shapes=[];sources=[];transforms={}
 for file in Path('mapinfo').glob('*.zip'):
  with zipfile.ZipFile(file) as z:
   name=next((s for s in z.namelist() if s.endswith('N1A_A0010000.shp')),None)
   if not name:continue
   base=name[:-4];wkt=z.read(base+'.prj').decode()
   if wkt not in transforms:transforms[wkt]=(CRS.from_wkt(wkt),Transformer.from_crs(CRS.from_wkt(wkt),5179,always_xy=True))
   crs,t=transforms[wkt];r=shapefile.Reader(shp=io.BytesIO(z.read(name)));bb=r.bbox
   pts=np.array([t.transform(x,y) for x in [bb[0],bb[2]] for y in [bb[1],bb[3]]]);lo=pts.min(axis=0);hi=pts.max(axis=0)
   if hi[0]<cx-w/2 or lo[0]>cx+w/2 or hi[1]<cy-d/2 or lo[1]>cy+d/2:continue
   count=0
   for s in r.iterShapes():
    geom=transform_geom(crs.to_wkt(),'EPSG:5179',s.__geo_interface__)
    shapes.append((geom,1));count+=1
   if count:sources.append({'file':file.name,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'features':count})
 assert shapes,'No mapped road polygons'
 roads=rasterize(shapes,out_shape=(n,n),transform=from_origin(cx-w/2,cy+d/2,sx,sy),fill=0,dtype='uint8',all_touched=False).astype(bool)
 ngii=roads.copy();osm=np.zeros_like(roads);osm_info=None
 if osm_db:
  from osm_road_store import query
  cached=query(osm_db,[cx-w/2,cy-d/2,cx+w/2,cy+d/2])
  surfaces=[(r['surface'],1) for r in cached['roads'] if r['surface']['type'] in ['Polygon','MultiPolygon']]
  osm=rasterize(surfaces,out_shape=(n,n),transform=from_origin(cx-w/2,cy+d/2,sx,sy),fill=0,dtype='uint8').astype(bool) if surfaces else np.zeros_like(roads)
  osm_info={'source':str(osm_db),'sourceManifest':cached['source'],'records':[{k:r[k] for k in ['id','kind','widthMeters','widthBasis']} for r in cached['roads']],'note':'offline OSM ground surfaces; estimated widths marked per record'}
  (out/'osm-road-cache.json').write_text(json.dumps(cached,ensure_ascii=False),encoding='utf-8')
  roads|=osm
 elif site=='xi':
  osm,osm_info=osm_paths.path_mask(data,Path('research/gyeonghuigung-xi/scene.json'));roads|=osm
 Image.fromarray(ngii.astype('uint8')*255).save(out/'ngii-road-mask.png')
 Image.fromarray(osm.astype('uint8')*255).save(out/'osm-path-mask.png')
 Image.fromarray(roads.astype('uint8')*255).save(out/'road-mask.png')
 water=np.asarray(Image.open(out/'water-mask.png'))>0 if (out/'water-mask.png').exists() else np.zeros_like(roads)
 mask=np.asarray(Image.open(out/'mask.png'));tree=(mask==1)&~roads&~water
 def regions(binary):
  cs,h=cv2.findContours(binary.astype('uint8'),cv2.RETR_CCOMP,cv2.CHAIN_APPROX_SIMPLE);result=[]
  def ring(c):return [[(float(x)-n/2)*sx,(float(y)-n/2)*sy] for x,y in c.reshape(-1,2)]
  for i,c in enumerate(cs):
   if h[0][i][3]!=-1 or cv2.contourArea(c)<64 or len(c)<3:continue
   holes=[];j=int(h[0][i][2])
   while j!=-1:
    if len(cs[j])>=3:holes.append(ring(cs[j]))
    j=int(h[0][j][0])
   result.append({'id':f'road-filtered-{i}','ring':ring(c),'holes':holes,'heightMeters':8})
  return result
 output={'roadSources':sources,'roadLayer':'N1A_A0010000','roadPixels':int(roads.sum()),'canopyRemovedPixels':int(((mask==1)&roads).sum()),'regions':regions(tree),'low':{},'heightStatus':'low vegetation height assumed 0.4 m; not measured shrub locations'}
 output['osm']=osm_info;output['osmAdditionalPixels']=int((osm&~ngii).sum());output['osmAdditionalCanopyRemovedPixels']=int((osm&~ngii&(mask==1)).sum())
 output['waterExcludedPixels']=int(water.sum())
 Image.fromarray(tree.astype('uint8')*255).save(out/'canopy-road-filtered.png')
 for key in ['035','050']:
  rgba=np.asarray(Image.open(out/f'low-vegetation-{key}.png')).copy();before=rgba[:,:,3]>0;selected=before&~roads&~water;rgba[roads|water]=0;Image.fromarray(rgba).save(out/f'low-vegetation-road-{key}.png')
  # Conservative inscribed circular patches, preserving roads and holes.
  distance=cv2.distanceTransform(np.pad(selected.astype('uint8'),1),cv2.DIST_L2,cv2.DIST_MASK_PRECISE)[1:-1,1:-1];patches=[]
  for y in range(3,n,6):
   for x in range(3,n,6):
    radius=min(2.0,(float(distance[y,x])-1)*min(sx,sy))
    if radius>=.4:patches.append([round((x+.5-n/2)*sx,3),round((y+.5-n/2)*sy,3),round(radius,3)])
  output['low'][key]={'patches':patches,'retainedPixels':int(selected.sum()),'removedPixels':int((before&roads).sum()),'threshold':.35 if key=='035' else .5}
  output['low'][key]['osmAdditionalRemovedPixels']=int((before&osm&~ngii).sum())
  assert not np.any(selected&roads)
 assert not np.any(tree&roads)
 (out/'road-filtered-vegetation.json').write_text(json.dumps(output,ensure_ascii=False),encoding='utf-8')
 rgb=np.asarray(Image.open(out/'source.jpg').convert('RGB'));im=rgb.copy();im[roads]=(rgb[roads]*.5+np.array([70,150,240])*.5).astype('uint8');selected=(np.asarray(Image.open(out/'low-vegetation-road-035.png'))[:,:,3]>0);im[selected]=(rgb[selected]*.4+np.array([220,210,55])*.6).astype('uint8');im[tree]=(rgb[tree]*.4+np.array([25,190,100])*.6).astype('uint8');Image.fromarray(im).save(out/'road-filtered-review.jpg',quality=95)
 print(site,json.dumps({k:v for k,v in output.items() if k not in ['regions','low','roadSources','osm']}),{k:{'patches':len(v['patches']),'removed':v['removedPixels'],'osmAdditional':v['osmAdditionalRemovedPixels']} for k,v in output['low'].items()},flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--site',choices=['xi','northwest','yangjae','han']);p.add_argument('--osm-db',type=Path);a=p.parse_args()
 for site in ([a.site] if a.site else ['xi','northwest']):build(site,a.osm_db)
