"""Reproject stored OSM centerlines and rasterize width-based ground-level paths."""
import json,re,math,hashlib
from pathlib import Path
import numpy as np
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_origin

def path_mask(data,source):
 raw=source.read_bytes();osm=json.loads(raw);lon0,lat0=osm['center'];mx=111195*math.cos(math.radians(lat0))
 t=Transformer.from_crs(4326,5179,always_xy=True);cx,cy=data['center5179'];w,d=data['widthMeters'],data['depthMeters'];n=data['sizePixels']
 shapes=[];records=[];skipped=0
 for road in osm['roads']:
  if road['kind'] not in ['footway','path','pedestrian','steps','service','living_street']:continue
  tags=road.get('tags',{});profile=road.get('profile')
  if tags.get('bridge','no')!='no' or tags.get('tunnel','no')!='no' or str(tags.get('layer','0')) not in ['0','0.0']:continue
  points=np.array([t.transform(lon0+x/mx,lat0-z/111195) for x,z in road['points']])
  if len(points)<2:continue
  # First retain only lines potentially intersecting the review square.
  lo=points.min(axis=0);hi=points.max(axis=0)
  if hi[0]<cx-w/2-15 or lo[0]>cx+w/2+15 or hi[1]<cy-d/2-15 or lo[1]>cy+d/2+15:continue
  match=re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(?:m)?\s*',str(tags.get('width','')))
  width=float(match[1]) if match else (profile or {}).get('width')
  basis='OSM width tag' if match else (profile or {}).get('widthSource')
  if not isinstance(width,(int,float)) or not math.isfinite(width) or not 0<width<=30:skipped+=1;continue
  radius=width/2;start=len(shapes)
  for a,b in zip(points[:-1],points[1:]):
   length=np.linalg.norm(b-a)
   if length==0:continue
   normal=np.array([-(b-a)[1],(b-a)[0]])/length*radius
   ring=[(a+normal).tolist(),(b+normal).tolist(),(b-normal).tolist(),(a-normal).tolist(),(a+normal).tolist()]
   shapes.append(({'type':'Polygon','coordinates':[ring]},1))
  for p in points:
   circle=[(p+radius*np.array([math.cos(a),math.sin(a)])).tolist() for a in np.linspace(0,2*math.pi,25)]
   shapes.append(({'type':'Polygon','coordinates':[circle]},1))
  if len(shapes)>start:records.append({'id':road['id'],'kind':road['kind'],'widthMeters':width,'widthBasis':basis,'url':f"https://www.openstreetmap.org/way/{road['id']}"})
 mask=rasterize(shapes,out_shape=(n,n),transform=from_origin(cx-w/2,cy+d/2,w/n,d/n),fill=0,dtype='uint8').astype(bool) if shapes else np.zeros((n,n),bool)
 return mask,{'source':str(source),'sha256':hashlib.sha256(raw).hexdigest(),'records':records,'skippedUnknownWidth':skipped,'note':'centerline buffers; ground-level only; widths without tags are assumptions'}
