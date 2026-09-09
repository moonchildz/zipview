"""Cross-check saved OSM facade bearings using WGS84 geodesics (pyproj)."""
import json
import xml.etree.ElementTree as ET
from pathlib import Path
from pyproj import Geod

root = Path(__file__).resolve().parents[1]
folder = root / 'research/gyeonghuigung-xi'
scene = json.loads((folder / 'scene.json').read_text(encoding='utf-8'))
xml = ET.parse(folder / 'osm.xml').getroot()
nodes = {n.attrib['id']: (float(n.attrib['lon']), float(n.attrib['lat'])) for n in xml.findall('node')}
way = next(w for w in xml.findall('way') if w.attrib['id'] == str(scene['targetBuildingId']))
points = [nodes[n.attrib['ref']] for n in way.findall('nd')]
geod = Geod(ellps='WGS84')
results = []
for facade in scene['facadeCandidates']:
    edge = facade['edge']
    azimuth, _, length = geod.inv(*points[edge], *points[edge + 1])
    normals = [(azimuth + 90) % 360, (azimuth - 90) % 360]
    delta = lambda a, b: (a - b + 180) % 360 - 180
    bearing = min(normals, key=lambda a: abs(delta(a, facade['bearing'])))
    difference = delta(bearing, facade['bearing'])
    if abs(difference) > 0.5:
        raise ValueError(f'Facade {edge}: coordinate conversion mismatch')
    results.append(dict(edge=edge, modelBearing=facade['bearing'], wgs84Bearing=bearing,
                        differenceDegrees=difference, lengthMeters=length))
output = dict(method='pyproj.Geod WGS84 inverse on original OSM vertices; outward side from scene polygon',
              unitWindowVerified=False, facades=results)
(folder / 'direction-check.json').write_text(json.dumps(output, indent=2) + '\n', encoding='utf-8')
print(json.dumps(output))
