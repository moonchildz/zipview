"""Export semantic water candidates, preserving model and image provenance."""
import argparse,json
from pathlib import Path
import numpy as np
from PIL import Image
p=argparse.ArgumentParser();p.add_argument('site',choices=['yangjae','han']);site=p.parse_args().site
folder=Path(f'verification/{site}-grove');source=Path(f'verification/{site}-vegetation/{site}-2024')
land=np.load(source/'landcover.npz');water=(land['labels']==6)&(land['water']>=.5)
Image.fromarray(water.astype('uint8')*255).save(folder/'water-mask.png')
rgba=np.zeros((*water.shape,4),np.uint8);rgba[water]=[30,150,215,155];Image.fromarray(rgba).save(folder/'water-layer.png')
rgb=np.asarray(Image.open(folder/'source.jpg').convert('RGB'));im=rgb.copy();im[water]=(rgb[water]*.45+np.array([30,150,215])*.55).astype('uint8')
Image.fromarray(im).save(folder/'water-review.jpg',quality=95)
data={'class':'water','classId':6,'threshold':.5,'argmaxRequired':True,'pixels':int(water.sum()),'coveragePercent':round(float(water.mean()*100),2),'model':json.loads((source/'landcover.json').read_text(encoding='utf-8')),'surface':'terrain-draped candidate layer; no measured water level or depth'}
(folder/'water.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8');print(site,data['coveragePercent'],flush=True)
