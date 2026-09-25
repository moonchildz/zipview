"""Tile an NGII EPSG:5179 administrative polygon into bounded CAS target jobs."""
import argparse,json,math
from pathlib import Path
from pyproj import Transformer
from shapely import wkt
from shapely.geometry import box

def grid(area,step=500):
    geom=wkt.loads(area['wkt'])
    if geom.is_empty or not geom.is_valid or geom.geom_type not in ('Polygon','MultiPolygon'):
        raise ValueError('Valid administrative polygon is required; no bounding-box completion claim')
    if not 50<=step<=500:raise ValueError('Grid step must be 50..500 metres')
    x0,y0,x1,y1=geom.bounds
    if not (500000<x0<x1<1500000 and 1400000<y0<y1<2500000):
        raise ValueError('Administrative coordinates are not plausible EPSG:5179 metres')
    if (x1-x0)*(y1-y0)/step**2>200000:raise ValueError('Area too large; subdivide first')
    t=Transformer.from_crs(5179,4326,always_xy=True);cells=[]
    for iy in range(math.floor(y0/step),math.ceil(y1/step)):
        for ix in range(math.floor(x0/step),math.ceil(x1/step)):
            tile=box(ix*step,iy*step,(ix+1)*step,(iy+1)*step)
            if not geom.intersects(tile):continue
            lon,lat=t.transform((ix+.5)*step,(iy+.5)*step)
            if not 124<=lon<=132 or not 33<=lat<=39.5:raise ValueError('Out-of-range target')
            cells.append({'id':f'{ix}:{iy}','name':f'grid-{ix}-{iy}','point':[lon,lat]})
    return cells

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    data=json.loads(a.input.read_text(encoding='utf-8'));cells=grid(data['area']);a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(cells,ensure_ascii=False),encoding='utf-8');print(json.dumps({'cells':len(cells)}))
