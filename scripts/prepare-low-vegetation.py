"""Render cached SegFormer low-vegetation candidates without inventing shrub classes."""
import json,argparse
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw

p=argparse.ArgumentParser();p.add_argument('--site',choices=['xi','northwest','yangjae','han']);args=p.parse_args()
configs=[
    ('xi','xi-2025','verification/xi-vegetation',0),
    ('northwest','north-sports-2024','verification/satellite-vegetation',1024),
    ('yangjae','yangjae-2024','verification/yangjae-vegetation',0),
    ('han','han-2024','verification/han-vegetation',0)]
for site,region,cache,offset in configs:
    if args.site and site!=args.site:continue
    if not args.site and site in ['yangjae','han']:continue
    out=Path('verification')/(site+'-grove');root=Path(cache)/region
    land=np.load(root/'landcover.npz');canopy=np.load(root/'canopy.npz')['probability']
    window=np.s_[offset:offset+2048,offset:offset+2048]
    grass=land['grass'][window];labels=land['labels'][window];trees=canopy[window]>=.5
    rgb=Image.open(out/'source.jpg').convert('RGB');a=np.asarray(rgb);stats={};layers=[]
    for threshold,key in [(.35,'035'),(.5,'050')]:
        selected=(labels==2)&(grass>=threshold)&~trees
        rgba=np.zeros((*selected.shape,4),np.uint8);rgba[selected]=[236,204,45,180]
        Image.fromarray(rgba).save(out/f'low-vegetation-{key}.png')
        marked=a.copy();marked[selected]=(a[selected]*.45+np.array([236,204,45])*.55).astype(np.uint8)
        im=Image.fromarray(marked);im.save(out/f'low-vegetation-{key}.jpg',quality=95);layers.append(im)
        stats[key]={'threshold':threshold,'pixels':int(selected.sum()),'coveragePercent':round(float(selected.mean()*100),2)}
    (out/'low-vegetation.json').write_text(json.dumps({'model':'nave1616/SegFormer-landcover-FT','class':'rangeland','meaning':'grass/low vegetation candidate, not verified flowerbeds, shrubs or flowers','argmaxRequired':True,'canopyPriorityThreshold':.5,'counts':stats},indent=2),encoding='utf-8')
    # Central apartment area at a readable scale; identical crop in all panels.
    box=(512,512,1536,1536);sheet=Image.new('RGB',(1800,640),'#13202b');draw=ImageDraw.Draw(sheet)
    for i,(im,label) in enumerate(zip([rgb,*layers],['Original','Low vegetation >= 0.35','Low vegetation >= 0.50'])):
        sheet.paste(im.crop(box).resize((600,600)),(600*i,40));draw.text((600*i+12,12),label,fill='white')
    sheet.save(out/'low-vegetation-comparison.jpg',quality=95)
    print(site,stats)
