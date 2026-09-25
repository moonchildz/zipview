"""Multiscale all-class YOLO OBB and prompted YOLOE satellite pilot.

Inputs are native-pixel RGB crops from prepare-satellite-pilot.py. Outputs are
unverified candidates, with both crop and original scene pixel coordinates.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time

import cv2
import numpy as np
from PIL import Image

PROMPTS = ['building', 'parking lot', 'playground', 'road', 'bridge', 'railway',
           'train', 'bus', 'truck', 'car', 'storage tank', 'solar panel', 'greenhouse',
           'swimming pool', 'tennis court', 'basketball court', 'soccer field',
           'baseball field', 'running track', 'stadium', 'construction site', 'crane',
           'shipping container', 'boat', 'pier', 'tree', 'fountain', 'helipad',
           'roundabout', 'power transmission tower']


def positions(length, size, overlap):
    if length <= size:
        return [0]
    return sorted(set([*range(0, length-size, size-overlap), length-size]))


def rotated_iou(a, b):
    a, b = np.asarray(a, np.float32), np.asarray(b, np.float32)
    intersection, _ = cv2.intersectConvexConvex(a, b)
    union = abs(cv2.contourArea(a)) + abs(cv2.contourArea(b)) - intersection
    return float(intersection / union) if union > 0 else 0


def merge_candidates(items, width, height, threshold=0.35):
    """Spatial-indexed polygon NMS; only vehicle subclasses share a group."""
    kept, grid = [], defaultdict(set)
    for item in sorted(items, key=lambda o: -o['score']):
        quad = np.asarray(item['quad'], dtype=np.float32)
        if quad.shape != (4, 2) or not np.isfinite(quad).all():
            continue
        if quad[:,0].max() <= 0 or quad[:,1].max() <= 0 or quad[:,0].min() >= width or quad[:,1].min() >= height:
            continue
        if abs(cv2.contourArea(quad)) < 4:
            continue
        box = [float(quad[:,0].min()), float(quad[:,1].min()), float(quad[:,0].max()), float(quad[:,1].max())]
        label = item['label'].replace('-', ' ').replace('_', ' ')
        group = 'vehicle' if label in ['small vehicle', 'large vehicle'] else label
        cells = [(group, x, y) for x in range(math.floor(box[0]/256), math.floor(box[2]/256)+1)
                 for y in range(math.floor(box[1]/256), math.floor(box[3]/256)+1)]
        neighbors = set().union(*(grid[c] for c in cells))
        if any(rotated_iou(quad, kept[i]['quad']) > threshold for i in neighbors):
            continue
        index = len(kept)
        kept.append({**item, 'box': box, 'status': 'unverified', 'id': index+1})
        for c in cells:
            grid[c].add(index)
    return kept


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'): stream.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('verification/satellite-facilities'))
    parser.add_argument('--mode', choices=['obb','open'], default='obb')
    parser.add_argument('--weights', type=Path)
    parser.add_argument('--confidence', type=float, default=0.15)
    parser.add_argument('--device', default='0')
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    if not 0 < args.confidence < 1: parser.error('confidence must be in (0,1)')
    args.root = args.root.resolve()
    manifest = json.loads((args.root/'manifest.json').read_text(encoding='utf-8'))
    model_dir = Path('.tools/models').resolve()
    model_dir.mkdir(parents=True, exist_ok=True)
    weights = (args.weights or model_dir/('yolo26m-obb.pt' if args.mode == 'obb' else 'yoloe-26m-seg.pt')).resolve()
    os.environ.setdefault('YOLO_CONFIG_DIR', str(model_dir.parent/'yolo-config'))
    Path(os.environ['YOLO_CONFIG_DIR']).mkdir(parents=True, exist_ok=True)
    # Text encoder artifacts and downloaded weights stay in the ignored tools directory.
    os.chdir(model_dir)
    import torch
    import ultralytics
    from ultralytics import YOLO, YOLOE
    torch.set_num_threads(4)
    model = (YOLO if args.mode == 'obb' else YOLOE)(str(weights))
    if args.mode == 'open': model.set_classes(PROMPTS)
    elif model.task != 'obb': parser.error('OBB checkpoint required')
    model_info = {'weights': weights.name, 'sha256': hashlib.sha256(weights.read_bytes()).hexdigest(),
                  'ultralytics': ultralytics.__version__, 'torch': torch.__version__,
                  'classes': {str(k):v for k,v in model.names.items()}, 'confidence': args.confidence, 'imgsz': 1024,
                  'tileSizes': [1024,2048,4096], 'overlapFraction': 0.25, 'mergeIou': 0.35,
                  'device': args.device, 'prompts': PROMPTS if args.mode == 'open' else None}
    print(json.dumps(model_info),flush=True)
    for region in manifest['regions']:
        folder = args.root/region['id']
        output = folder/(args.mode+'.json')
        source_hash = hashlib.sha256(Path(region['image']).read_bytes()).hexdigest()
        if source_hash != region['sha256']: raise ValueError('Source changed: '+region['id'])
        if args.resume and output.exists():
            prior = json.loads(output.read_text(encoding='utf-8'))
            if prior['model'] == model_info and prior['source']['sha256'] == source_hash:
                print('Reuse '+region['id'],flush=True)
                continue
        image = Image.open(region['image']).convert('RGB')
        width,height = image.size
        windows = sorted(set((x,y,min(x+size,width),min(y+size,height))
                         for size in [1024,2048,4096]
                         for y in positions(height,size,size//4)
                         for x in positions(width,size,size//4)))
        started = time.time()
        raw = []
        for i, (x,y,x2,y2) in enumerate(windows):
            crop = image.crop((x,y,x2,y2))
            result = model.predict(crop, imgsz=1024, conf=args.confidence, iou=0.5,
                                   device=args.device, verbose=False, save=False,
                                   max_det=2000, quantize=16 if args.device != 'cpu' else 32)[0]
            if args.mode == 'obb':
                quads = result.obb.xyxyxyxy.cpu().tolist()
                scores, classes = result.obb.conf.cpu().tolist(), result.obb.cls.cpu().tolist()
            else:
                quads = [[[a,b],[c,b],[c,d],[a,d]] for a,b,c,d in result.boxes.xyxy.cpu().tolist()]
                scores, classes = result.boxes.conf.cpu().tolist(), result.boxes.cls.cpu().tolist()
            for quad, score, cls in zip(quads,scores,classes):
                raw.append({'quad': [[a+x,b+y] for a,b in quad], 'score': score,
                            'label': model.names[int(cls)], 'window': [x,y,x2,y2]})
            if (i+1)%10 == 0: print(f"{args.mode} {region['id']} {i+1}/{len(windows)}: {len(raw)} raw",flush=True)
        objects = merge_candidates(raw,width,height)
        for obj in objects:
            obj['sceneQuad'] = [[x+region['x'],y+region['y']] for x,y in obj['quad']]
        counts = {str(t): dict(Counter(o['label'] for o in objects if o['score'] >= t)) for t in [0.15,0.25,0.5]}
        document = {'source':region,'model':model_info,'windows':windows,'objects':objects,
                    'counts': counts, 'rawCount':len(raw),'seconds':round(time.time()-started,1),
                    'limitations':['Candidates are not verified facilities or accuracy measurements.',
                                   'Crops are a pilot subset, not full-scene coverage.',
                                   'No geographic positions or heights inferred.',
                                   'YOLOE prompts do not establish reliable recognition of every named class.',
                                   'Cross-class overlap may represent conflicting labels; review required.']}
        output.write_text(json.dumps(document,ensure_ascii=False,indent=2),encoding='utf-8')
        (folder/(args.mode+'-raw.json')).write_text(json.dumps(raw),encoding='utf-8')
        print(json.dumps({'region':region['id'],'seconds':document['seconds'],'counts':counts}),flush=True)


if __name__ == '__main__':
    main()
