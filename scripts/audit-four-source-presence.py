"""Offline source-presence matrix. No modeling or network acquisition."""
import csv
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from pyproj import Transformer
from shapely import from_wkb
from shapely.geometry import Point

root = Path(__file__).resolve().parents[1]
dest = root / 'research/linkage/generated/material-readiness'
providers = json.loads((dest / 'providers.json').read_text(encoding='utf-8'))
spatial = {x['providerId']: x for x in json.loads((dest / 'spatial.json').read_text(encoding='utf-8'))}
transform = Transformer.from_crs(4326, 5179, always_xy=True)
db = sqlite3.connect((root / 'research/osm/generated/south-korea-roads.sqlite').as_uri() + '?mode=ro', uri=True)
rows = []
for p in providers:
    if p.get('existingPilot', False) or not p['completePlanLookup']:
        continue
    s = spatial[p['providerId']]
    x, y = transform.transform(*p['point'])
    area = Point(x, y).buffer(400)
    roads = 0
    for surface, line in db.execute('''SELECT r.surface_wkb,r.line_wkb FROM roads r
        JOIN road_bounds b ON r.osm_id=b.osm_id
        WHERE r.ground=1 AND b.maxx>=? AND b.minx<=? AND b.maxy>=? AND b.miny<=?''',
        (x-400, x+400, y-400, y+400)):
        if from_wkb(surface or line).intersects(area):
            roads += 1
    map_present = bool(s['buildingsArchives'] and (s['contoursArchives'] or s['elevationPointsArchives']))
    image_present = s['satellite400mCatalogFootprintCovered']
    site_candidates = sum(len(c.get('features', {}).get('sitePlan', [])) for c in p['publicSourceCandidates'])
    rows.append(dict(providerId=p['providerId'], name=p['name'], units=p['expectedUnits'],
                     floorplanUnitImagesPresent=True, siteDrawingCandidateFiles=site_candidates,
                     map1000ExtentCandidate=map_present, imagery400mFootprint=image_present,
                     osmLocalGroundRoads=roads,
                     fourSourcePresenceCandidate=bool(map_present and image_present and roads),
                     apartmentPlacementSourceCompleteness='unverified'))
db.close()
summary = dict(checkedAt=datetime.now(timezone.utc).isoformat(), providerSnapshot='2026-09-22',
               checkedComplexes=len(rows), localOsmPresent=sum(r['osmLocalGroundRoads'] > 0 for r in rows),
               fourSourceCandidates=sum(r['fourSourcePresenceCandidate'] for r in rows),
               candidateUnits=sum(r['units'] for r in rows if r['fourSourcePresenceCandidate']),
               allRequiredDataCompleteComplexes=None,
               limitations=['Source presence only; not proof of complete data for every building/type/unit.',
                            'Apartment placement sources are unresolved; floorplan/unit image linkage is not a site layout.',
                            'Map extent overlap and 400m catalogue imagery coverage are screening proxies.',
                            'Local OSM geometries exist; unmapped internal paths may remain.',
                            'Uses previous provider and map/imagery snapshot; newly collected public files are not included.'])
(dest / 'four-source-presence.json').write_text(json.dumps(dict(summary=summary, rows=rows), ensure_ascii=False, indent=2), encoding='utf-8')
with (dest / 'four-source-presence.csv').open('w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0]))
    w.writeheader()
    w.writerows(rows)
print(json.dumps(summary, ensure_ascii=True))
