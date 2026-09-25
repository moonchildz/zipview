"""SegFormer canopy and low-vegetation masks on the previous native-pixel satellite crops."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time

import cv2
import numpy as np
from PIL import Image

CANOPY = 'restor/tcd-segformer-mit-b3'
LANDCOVER = 'nave1616/SegFormer-landcover-FT'
COLORS = {1: (24, 191, 133), 2: (224, 220, 54)}


def positions(length, tile=512, overlap=128):
    return [0] if length <= tile else sorted(set([*range(0,length-tile,tile-overlap),length-tile]))


def blend_weights(size):
    line=np.maximum(0.1,1-np.abs(np.linspace(-1,1,size,dtype=np.float32)))
    return line[:,None]*line[None,:]


def classify(canopy, grass, landcover, valid, threshold=0.5, grass_threshold=None):
    if grass_threshold is None: grass_threshold=threshold
    mask=np.zeros(valid.shape,np.uint8)
    mask[valid & (landcover==2) & (grass>=grass_threshold)]=2
    # Canopy has priority: do not double-count a tree as low vegetation.
    mask[valid & (canopy>=threshold)]=1
    return mask


def overlay(rgb, mask, alpha=0.42):
    result=rgb.copy()
    for cls,color in COLORS.items():
        selected=mask==cls
        result[selected]=(rgb[selected]*(1-alpha)+np.asarray(color)*alpha).astype(np.uint8)
        contours,_=cv2.findContours(selected.astype(np.uint8),cv2.RETR_LIST,cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(result,contours,-1,color,1)
    return Image.fromarray(result)


def valid_pixels(region, scenes):
    import rasterio
    from rasterio.windows import Window
    scene=next(s for s in scenes if s['id']==region['scene'])
    size=region['size']
    valid=np.ones((size,size),bool)
    for band in scene['bands']:
        with rasterio.open(band['path']) as dataset:
            valid &= dataset.read(1,window=Window(region['x'],region['y'],size,size)) > 0
    return valid


def infer(image, model, processor, device, selected_channels=None):
    import torch
    size=512
    width,height=image.size
    windows=[(x,y) for y in positions(height) for x in positions(width)]
    channels=model.config.num_labels if selected_channels is None else len(selected_channels)
    accumulated=np.zeros((channels,height,width),np.float32)
    denominator=np.zeros((height,width),np.float32)
    weights=blend_weights(size)
    for i in range(0,len(windows),4):
        batch=windows[i:i+4]
        crops=[image.crop((x,y,x+size,y+size)) for x,y in batch]
        inputs=processor(images=crops,return_tensors='pt',do_resize=False).to(device)
        with torch.inference_mode(),torch.autocast(device_type=device,dtype=torch.float16,enabled=device=='cuda'):
            logits=model(**inputs).logits
        logits=torch.nn.functional.interpolate(logits.float(),size=(size,size),mode='bilinear',align_corners=False)
        probabilities=logits.softmax(dim=1)
        if selected_channels is not None: probabilities=probabilities[:,selected_channels]
        values=probabilities.cpu().numpy()
        if not np.isfinite(values).all(): raise ValueError('Non-finite model output')
        for value,(x,y) in zip(values,batch):
            hh,ww=min(size,height-y),min(size,width-x)
            accumulated[:,y:y+hh,x:x+ww]+=value[:,:hh,:ww]*weights[:hh,:ww]
            denominator[y:y+hh,x:x+ww]+=weights[:hh,:ww]
        if (i//4)%10==0: print(f'  tiles {min(i+4,len(windows))}/{len(windows)}',flush=True)
    if not np.all(denominator>0): raise ValueError('Uncovered pixels')
    accumulated/=denominator[None]
    return accumulated,len(windows)


def main():
    for stream in (sys.stdout,sys.stderr):
        if hasattr(stream,'reconfigure'): stream.reconfigure(encoding='utf-8',errors='replace')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,default=Path('verification/satellite-facilities/manifest.json'))
    parser.add_argument('--output',type=Path,default=Path('verification/satellite-vegetation'))
    parser.add_argument('--region',help='Optional single region for a trial')
    parser.add_argument('--resume',action='store_true')
    parser.add_argument('--render-only',action='store_true')
    parser.add_argument('--offline',action='store_true',help='Use cached model revisions without network checks')
    parser.add_argument('--cache-dir',type=Path,help='Read existing inference files here when rendering only')
    parser.add_argument('--canopy-threshold',type=float,default=0.5)
    parser.add_argument('--grass-threshold',type=float,default=0.5)
    args=parser.parse_args()
    if not all(0 <= t <= 1 for t in [args.canopy_threshold,args.grass_threshold]):
        parser.error('Thresholds must be between 0 and 1')
    if args.cache_dir and not args.render_only: parser.error('--cache-dir requires --render-only')
    root=Path(__file__).resolve().parents[1]
    os.environ.setdefault('HF_HOME',str(root/'.tools/hf-cache'))
    if args.offline:os.environ['HF_HUB_OFFLINE']='1'
    from huggingface_hub import model_info
    import torch
    import transformers
    from transformers import SegformerForSemanticSegmentation,SegformerImageProcessor
    torch.set_num_threads(4)
    device='cuda' if torch.cuda.is_available() else 'cpu'
    manifest=json.loads(args.input.read_text(encoding='utf-8'))
    regions=[r for r in manifest['regions'] if not args.region or r['id']==args.region]
    if not regions: parser.error('Region not found')
    args.output.mkdir(parents=True,exist_ok=True)
    if not args.render_only:
        for key,name in [('canopy',CANOPY),('landcover',LANDCOVER)]:
            if args.offline:
                revision=(Path(os.environ['HF_HOME'])/'hub'/('models--'+name.replace('/','--'))/'refs/main').read_text().strip()
            else:revision=model_info(name).sha
            model=SegformerForSemanticSegmentation.from_pretrained(name,revision=revision).to(device).eval()
            if key=='canopy':
                processor=SegformerImageProcessor.from_pretrained(name,revision=revision)
                if model.config.id2label.get(1)!='tree': raise ValueError('Unexpected canopy labels')
            else:
                # Publisher omits processor config. Use the documented base model's
                # standard ImageNet normalization; record this assumption explicitly.
                processor=SegformerImageProcessor(do_resize=False,do_rescale=True,
                            image_mean=[0.485,0.456,0.406],image_std=[0.229,0.224,0.225])
                if model.config.id2label.get(2)!='rangeland' or model.config.id2label.get(5)!='tree':
                    raise ValueError('Unexpected landcover labels')
            metadata={'name':name,'revision':revision,'architecture':model.config.model_type,
                      'classes':{str(k):v for k,v in model.config.id2label.items()},
                      'processor':processor.to_dict(),'transformers':transformers.__version__,
                      'torch':torch.__version__,'device':device,'tileSize':512,'overlap':128,
                      'blending':'triangular weights, positive floor 0.1; average probabilities',
                      'normalizationBasis':'published processor' if key=='canopy' else 'base-model ImageNet normalization assumed; fine-tune processor not published'}
            # Match the JSON representation used by cached records (tuples become lists).
            metadata=json.loads(json.dumps(metadata))
            for region in regions:
                folder=args.output/region['id'];folder.mkdir(exist_ok=True)
                src=Path(region['image'])
                source_hash=hashlib.sha256(src.read_bytes()).hexdigest()
                if source_hash!=region['sha256']: raise ValueError('Source changed: '+region['id'])
                record=folder/(key+'.json');npz=folder/(key+'.npz')
                if args.resume and record.exists() and npz.exists():
                    cached=json.loads(record.read_text(encoding='utf-8'))
                    if cached['model']==metadata and cached['sourceSha256']==source_hash and (key!='landcover' or 'water' in np.load(npz).files):
                        print('Reuse '+key+' '+region['id'],flush=True);continue
                print(key+' '+region['id'],flush=True)
                started=time.time()
                scores,tiles=infer(Image.open(src).convert('RGB'),model,processor,device,[1] if key=='canopy' else None)
                if key=='canopy':np.savez_compressed(npz,probability=scores[0].astype(np.float16))
                else:
                    if model.config.id2label.get(6)!='water':raise ValueError('Unexpected water class')
                    np.savez_compressed(npz,grass=scores[2].astype(np.float16),water=scores[6].astype(np.float16),labels=scores.argmax(axis=0).astype(np.uint8))
                record.write_text(json.dumps({'model':metadata,'sourceSha256':source_hash,
                    'tiles':tiles,'seconds':round(time.time()-started,2)},ensure_ascii=False,indent=2),encoding='utf-8')
                del scores
                print('  saved '+str(npz),flush=True)
            del model
            if device=='cuda':torch.cuda.empty_cache()
    entries=[]
    for region in regions:
        folder=args.output/region['id']
        cache=(args.cache_dir or args.output)/region['id']
        if not all((cache/(k+'.npz')).exists() for k in ['canopy','landcover']):
            raise FileNotFoundError('Missing inference files: '+str(cache))
        folder.mkdir(parents=True,exist_ok=True)
        canopy=np.load(cache/'canopy.npz')['probability'].astype(np.float32)
        land=np.load(cache/'landcover.npz');grass=land['grass'].astype(np.float32);labels=land['labels']
        valid=valid_pixels(region,manifest['scenes'])
        mask=classify(canopy,grass,labels,valid,args.canopy_threshold,args.grass_threshold)
        Image.fromarray(mask).save(folder/'mask.png')
        rgb=np.asarray(Image.open(region['image']).convert('RGB'))
        marked=overlay(rgb,mask);marked.save(folder/'overlay.jpg',quality=95)
        for cls,name in [(1,'canopy'),(2,'grass')]:
            rgba=np.zeros((*mask.shape,4),np.uint8);rgba[mask==cls]=[*COLORS[cls],165]
            Image.fromarray(rgba).save(folder/(name+'-layer.png'))
        thumb=marked.copy();thumb.thumbnail((1200,1200));thumb.save(folder/'preview.jpg',quality=94)
        counts={name:int((mask==cls).sum()) for cls,name in [(1,'canopy'),(2,'grass')]}
        entry={**region,'sourceRelative':os.path.relpath(region['image'],args.output).replace('\\','/'),
               'validPixels':int(valid.sum()),'pixels':counts,
               'coveragePercent':{k:round(v/max(int(valid.sum()),1)*100,2) for k,v in counts.items()},
               'thresholds':{'canopy':args.canopy_threshold,'grass':args.grass_threshold},
               'models':{key:json.loads((cache/(key+'.json')).read_text(encoding='utf-8'))['model'] for key in ['canopy','landcover']}}
        (folder/'vegetation.json').write_text(json.dumps(entry,ensure_ascii=False,indent=2),encoding='utf-8')
        entries.append(entry)
        print(region['id'],entry['coveragePercent'],flush=True)
    summary={'regions':entries,'classes':{'1':'tree-and-forest-canopy','2':'grass-and-low-vegetation-candidate'},
             'thresholds':{'canopy':args.canopy_threshold,'grass':args.grass_threshold},'colors':COLORS,'limitations':[
                 'Tree and forest share the canopy class; no individual-tree count or forest land-use classification.',
                 'Rangeland is a proxy for grass/low vegetation, not a validated lawn-only class.',
                 'Canopy overrides grass where both models respond.',
                 'Landcover preprocessing uses base-model normalization because the publisher provides no processor.',
                 'Source dates 2021/2024; pixel coordinates only; 12 sample regions, not full-scene coverage.',
                 'Predicted pixel coverage is not measured area or accuracy. Shadows, roofs, shrubs and artificial turf may confuse the models.']}
    (args.output/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    template=Path(__file__).with_name('vegetation-review-template.html').read_text(encoding='utf-8')
    template=template.replace('__CANOPY_THRESHOLD__',str(args.canopy_threshold)).replace('__GRASS_THRESHOLD__',str(args.grass_threshold))
    (args.output/'review.html').write_text(template.replace('__PAYLOAD__',json.dumps(summary,ensure_ascii=False).replace('</','<\\/')),encoding='utf-8')


if __name__=='__main__':main()
