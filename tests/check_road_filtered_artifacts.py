"""Check actual raster outputs and low-model footprints, including image edges."""
import json
from pathlib import Path
import numpy as np
from PIL import Image
for site in ['xi','northwest','yangjae','han']:
 p=Path('verification')/(site+'-grove');roads=np.asarray(Image.open(p/'road-mask.png'))>0
 canopy=np.asarray(Image.open(p/'canopy-road-filtered.png'))>0
 if (p/'water-mask.png').exists():roads=roads|(np.asarray(Image.open(p/'water-mask.png'))>0)
 assert not np.any(roads&canopy)
 data=json.loads((p/'road-filtered-vegetation.json').read_text(encoding='utf-8'))
 s=json.loads((p/'scene.json').read_text(encoding='utf-8'));n=s['sizePixels'];sx,sy=s['metersPerPixel']
 for key in ['035','050']:
  mask=np.asarray(Image.open(p/f'low-vegetation-road-{key}.png'))[:,:,3]>0
  assert not np.any(roads&mask)
  for x,z,radius in data['low'][key]['patches']:
   ix=x/sx+n/2-.5;iy=z/sy+n/2-.5;angles=np.linspace(0,2*np.pi,32)
   px=np.rint(ix+radius/sx*np.cos(angles)).astype(int);py=np.rint(iy+radius/sy*np.sin(angles)).astype(int)
   assert np.all((px>=0)&(py>=0)&(px<n)&(py<n)),(site,key,x,z,'outside image')
   assert np.all(mask[py,px]) and not np.any(roads[py,px]),(site,key,x,z,'outside mask')
 print(site,'PASS: masks and sampled 3D patch perimeters exclude roads and remain inside image')
