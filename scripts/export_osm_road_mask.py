"""Save a scene-sized road cache/mask without contacting an external API."""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image
from rasterio.features import rasterize
from rasterio.transform import from_origin
from osm_road_store import DEFAULT_DB, query


def export(scene_path, out, db=DEFAULT_DB):
    data = json.loads(Path(scene_path).read_text(encoding='utf-8'))
    x,y = data['center5179']; w,d = data['widthMeters'],data['depthMeters']; n=data['sizePixels']
    cache = query(db,[x-w/2,y-d/2,x+w/2,y+d/2])
    all_roads = query(db,cache['bounds'],ground_only=False)
    excluded = [r for r in all_roads['roads'] if not r['groundEligible']]
    excluded_shapes = [(r['surface'],1) for r in excluded if r['surface']['type'] in ('Polygon','MultiPolygon')]
    excluded_mask = rasterize(excluded_shapes,out_shape=(n,n),transform=from_origin(x-w/2,y+d/2,w/n,d/n),dtype='uint8') if excluded_shapes else np.zeros((n,n),np.uint8)
    surfaces = [(r['surface'],1) for r in cache['roads'] if r['surface']['type'] in ('Polygon','MultiPolygon')]
    mask = rasterize(surfaces,out_shape=(n,n),transform=from_origin(x-w/2,y+d/2,w/n,d/n),dtype='uint8') if surfaces else np.zeros((n,n),np.uint8)
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    (out/'roads.json').write_text(json.dumps(cache,ensure_ascii=False),encoding='utf-8')
    (out/'excluded-roads.json').write_text(json.dumps(excluded,ensure_ascii=False),encoding='utf-8')
    Image.fromarray(mask*255).save(out/'road-mask.png')
    Image.fromarray(excluded_mask*255).save(out/'excluded-road-mask.png')
    source=Path(scene_path).parent/'source.jpg'
    if source.exists():
        rgb=np.asarray(Image.open(source).convert('RGB'));marked=rgb.copy();inside=mask>0
        marked[inside]=(rgb[inside]*.4+np.array([30,150,240])*.6).astype('uint8')
        Image.fromarray(marked).save(out/'road-review.jpg',quality=94)
        elevated=excluded_mask>0
        marked[elevated]=(rgb[elevated]*.3+np.array([255,150,35])*.7).astype('uint8')
        Image.fromarray(marked).save(out/'road-context-review.jpg',quality=94)
    report=dict(roads=len(cache['roads']),excludedRoads=len(excluded),pixels=int(mask.sum()),database=str(db),bounds=cache['bounds'])
    (out/'summary.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report))
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('scene',type=Path);p.add_argument('output',type=Path)
    p.add_argument('--db',type=Path,default=DEFAULT_DB);a=p.parse_args();export(a.scene,a.output,a.db)
