"""Inspect ZIP geometry in memory; never extract archive paths."""
import json
import math
import struct
import sys
import zipfile
from pyproj import CRS, Transformer


def inspect(filename):
    boxes = []
    with zipfile.ZipFile(filename) as archive:
        names = {name.lower(): name for name in archive.namelist()}
        for name in archive.namelist():
            if not name.lower().endswith('.shp'):
                continue
            with archive.open(name) as stream:
                header = stream.read(100)
            if len(header) != 100 or struct.unpack_from('>i', header)[0] != 9994:
                raise ValueError('Invalid SHP header')
            if struct.unpack_from('>i', header, 24)[0] <= 50:
                continue
            bounds = struct.unpack_from('<4d', header, 36)
            if not all(math.isfinite(v) for v in bounds) or bounds[0] > bounds[2] or bounds[1] > bounds[3]:
                raise ValueError('Invalid SHP bounds')
            prj = names.get(name[:-4].lower() + '.prj')
            if not prj:
                raise ValueError('Missing layer CRS')
            crs = CRS.from_wkt(archive.read(prj).decode('utf-8-sig'))
            boxes.append(Transformer.from_crs(crs, 5179, always_xy=True).transform_bounds(*bounds))
    if not boxes:
        raise ValueError('No geometry')
    bounds = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
    if not all(math.isfinite(v) for v in bounds):
        raise ValueError('Invalid transformed bounds')
    return {'crs': 'EPSG:5179', 'bounds': bounds, 'layers': len(boxes)}


if __name__ == '__main__':
    print(json.dumps(inspect(sys.argv[1])))
