"""Extract an available, catalog-located Xi crop for the SegFormer pipeline."""
import json,hashlib,importlib.util,argparse
from pathlib import Path
from contextlib import ExitStack
import numpy as np
import rasterio
from rasterio.windows import Window
from pyproj import Transformer
from PIL import Image
spec=importlib.util.spec_from_file_location('prep',Path(__file__).with_name('prepare-satellite-pilot.py'));prep=importlib.util.module_from_spec(spec);spec.loader.exec_module(prep)
p=argparse.ArgumentParser();p.add_argument('--site',choices=['xi','yangjae','han'],default='xi');site=p.parse_args().site
root=Path(f'verification/{site}-satellite');root.mkdir(parents=True,exist_ok=True)
sid='C1_20250406014951_22435_00552767' if site=='xi' else 'C1_20240611014916_17892_00718251';inbox=Path('C:/Users/User/Downloads/satellite_01')
check=prep.cas.verify(inbox,sid);assert check['status']=='downloaded-header-checked'
plan=json.loads(Path('.tools/cas-imagery/plan.json').read_text(encoding='utf-8'));cat=next(s for s in plan['selected'] if s['id']==sid)
project=Transformer.from_crs(4326,5179,always_xy=True);corners=np.array([project.transform(*p) for p in cat['ring']]);west,south=corners.min(axis=0);east,north=corners.max(axis=0)
center=json.loads(Path('research/gyeonghuigung-xi/scene.json').read_text(encoding='utf-8'))['center'] if site=='xi' else {'yangjae':[127.051,37.481],'han':[127.003,37.516]}[site];cx,cy=project.transform(*center)
with ExitStack() as stack:
 ds=[stack.enter_context(rasterio.open(f['path'])) for f in check['files']];w,h=ds[0].width,ds[0].height;sx=(east-west)/w;sy=(north-south)/h;size=2048
 x=round((cx-west)/sx-size/2);y=round((north-cy)/sy-size/2);assert x>=0 and y>=0 and x+size<=w and y+size<=h
 overview=np.stack([d.read(1,out_shape=(round(h*1600/w),1600)) for d in ds],axis=2);valid=np.all(overview>0,axis=2)
 limits=[np.percentile(overview[:,:,i][valid],[2,98]).tolist() for i in range(3)]
 rgb=np.stack([d.read(1,window=Window(x,y,size,size)) for d in ds],axis=2);image=root/'source.png';Image.fromarray(prep.stretch(rgb,limits)).save(image)
scene={'id':sid,'width':w,'height':h,'bands':check['files'],'limits':limits}
region={'scene':sid,'id':site+('-2025' if site=='xi' else '-2024'),'x':x,'y':y,'size':size,'image':str(image.resolve()),'sha256':hashlib.sha256(image.read_bytes()).hexdigest(),'validFraction':float(np.all(rgb>0,axis=2).mean())}
(root/'manifest.json').write_text(json.dumps({'scenes':[scene],'regions':[region]},indent=2),encoding='utf-8');print(json.dumps(region))
