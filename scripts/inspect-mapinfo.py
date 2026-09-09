"""Inspect zipped NGII shapefiles without extracting or changing the app scene."""
import io
import json
import sys
import zipfile
from pathlib import Path

import shapefile
from pyproj import CRS, Transformer

sys.stdout.reconfigure(encoding='utf-8')
target = (126.9547, 37.5611)
for archive in sorted(Path('mapinfo').glob('*.zip')):
    with zipfile.ZipFile(archive) as z:
        crs = CRS.from_wkt(z.read(next(n for n in z.namelist() if n.endswith('.prj'))).decode())
        to_local = Transformer.from_crs(4326, crs, always_xy=True)
        to_geo = Transformer.from_crs(crs, 4326, always_xy=True)
        x, y = to_local.transform(*target)
        print('\nARCHIVE', archive.name, 'EPSG', crs.to_epsg())
        for name in z.namelist():
            if not name.endswith('.shp'):
                continue
            base = name[:-4]
            reader = shapefile.Reader(shp=io.BytesIO(z.read(name)),
                                      dbf=io.BytesIO(z.read(base+'.dbf')),
                                      encoding='cp949')
            bounds = reader.bbox
            nearby = []
            for sr in reader.iterShapeRecords():
                points = sr.shape.points
                if not points:
                    continue
                d = min(((px-x)**2+(py-y)**2)**0.5 for px, py, *_ in points)
                if d <= 180:
                    record = sr.record.as_dict()
                    nearby.append({'distance': round(d, 1), 'record': record,
                                   'point': list(points[0]),
                                   'z': list(getattr(sr.shape, 'z', []))[:3]})
            if nearby:
                print(base, 'count', len(reader), 'nearby', len(nearby),
                      'fields', [f[0] for f in reader.fields[1:]])
                if base[4] in 'BFG' or base.startswith('N1P'):
                    print(json.dumps(sorted(nearby, key=lambda v:v['distance'])[:5], ensure_ascii=False))
