"""Offline OSM highway store: EPSG:5179 centerlines/surfaces and an R-tree.

Only mapped features are represented. Width estimates are not measurements.
Builds publish atomically; the previous complete database remains queryable.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3

import osmium
from pyproj import Transformer
from shapely import from_wkb, to_wkb
from shapely.geometry import LineString, Polygon, box, mapping

DEFAULT_DB = Path('research/osm/generated/south-korea-roads.sqlite')
WIDTHS = dict(motorway=14, trunk=12, primary=12, secondary=10, tertiary=8,
              residential=6, unclassified=6, service=4, living_street=4,
              footway=1.8, path=1.5, pedestrian=3, steps=1.8, cycleway=2,
              track=3, bridleway=2)
WALK = {'footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway'}
PROJECT = Transformer.from_crs(4326, 5179, always_xy=True)


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(path, algorithm='sha256'):
    h = hashlib.new(algorithm)
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def profile(tags):
    """Keep exclusions and provenance instead of silently discarding bridges."""
    kind = tags.get('highway', '')
    base = kind.removesuffix('_link')
    reasons = []
    for key in ('bridge', 'tunnel', 'covered'):
        if tags.get(key, 'no') not in ('no', 'false', '0', ''):
            reasons.append(key)
    for key in ('layer', 'level'):
        try:
            if float(tags.get(key, '0')) != 0:
                reasons.append(key)
        except ValueError:
            reasons.append('unknown-' + key)
    if tags.get('indoor', 'no') not in ('no', 'false', '0', ''):
        reasons.append('indoor')
    if base not in WIDTHS:
        reasons.append('unsupported-highway')
    match = re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(m)?\s*', tags.get('width', ''))
    width = float(match[1]) if match else None
    basis = 'osm-width'
    if width is None or not 0 < width <= 100:
        lanes = tags.get('lanes', '')
        if re.fullmatch(r'\d+', lanes) and 0 < int(lanes) <= 12 and base not in WALK:
            width, basis = min(35, int(lanes) * 3 + .5), 'lanes-assumption'
        else:
            width, basis = WIDTHS.get(base), 'class-assumption'
            if width and tags.get('oneway') == 'yes' and base in {'primary', 'secondary', 'trunk'}:
                width *= .55
    return dict(width=width, widthSource=basis, walk=base in WALK,
                groundEligible=not reasons, exclusionReasons=reasons)


class Importer(osmium.SimpleHandler):
    def __init__(self, db):
        super().__init__()
        self.db = db
        self.counts = Counter()

    def way(self, way):
        if 'highway' not in way.tags:
            return
        self.counts['highwayWaysSeen'] += 1
        tags = dict(way.tags)
        if any(not n.location.valid() for n in way.nodes):
            self.counts['missingNodeWays'] += 1
            return
        coords = [PROJECT.transform(n.lon, n.lat) for n in way.nodes]
        self.store_way(way.id, tags, coords)

    def store_way(self, osm_id, tags, coords):
        if len(coords) < 2 or not all(math.isfinite(v) for p in coords for v in p):
            self.counts['invalidWays'] += 1
            return
        line = LineString(coords)
        if line.length <= 0:
            self.counts['invalidWays'] += 1
            return
        p = profile(tags)
        surface = None
        if tags.get('area') == 'yes':
            # Only standalone, valid closed highway areas; relations need separate assembly.
            if len(coords) >= 4 and coords[0] == coords[-1]:
                candidate = Polygon(coords)
                if candidate.is_valid and not candidate.is_empty:
                    surface = candidate
                    p['widthSource'] = 'mapped-area'
            if surface is None:
                p['groundEligible'] = False
                p['exclusionReasons'].append('invalid-area')
        elif p['width']:
            surface = line.buffer(p['width'] / 2, quad_segs=6)
        indexed = surface if surface is not None else line
        minx, miny, maxx, maxy = indexed.bounds
        self.db.execute('INSERT INTO roads VALUES (?,?,?,?,?,?,?,?,?,?)', (
            osm_id, tags['highway'], json.dumps(tags, ensure_ascii=False), p['width'],
            p['widthSource'], int(p['groundEligible']), json.dumps(p['exclusionReasons']),
            to_wkb(line), to_wkb(surface) if surface is not None else None, int(p['walk'])))
        self.db.execute('INSERT INTO road_bounds VALUES (?,?,?,?,?)', (osm_id, minx, maxx, miny, maxy))
        self.counts['storedWays'] += 1
        self.counts['groundWays' if p['groundEligible'] else 'excludedWays'] += 1
        self.counts[p['widthSource']] += 1
        if self.counts['storedWays'] % 25000 == 0:
            self.db.commit()
            print(json.dumps(dict(self.counts)), flush=True)


def build(source, target, source_url=None, scope='regional'):
    source, target = Path(source), Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(target.name + '.building')
    # This exact scratch file belongs to this importer, never the published database.
    temp.unlink(missing_ok=True)
    db = sqlite3.connect(temp)
    try:
        db.executescript('''
            CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE roads (
                osm_id INTEGER PRIMARY KEY, kind TEXT NOT NULL, tags TEXT NOT NULL,
                width REAL, width_source TEXT, ground INTEGER NOT NULL,
                exclusions TEXT NOT NULL, line_wkb BLOB NOT NULL, surface_wkb BLOB, walk INTEGER);
            CREATE VIRTUAL TABLE road_bounds USING rtree(osm_id,minx,maxx,miny,maxy);
        ''')
        worker = Importer(db)
        if source.suffix == '.json':
            # Legacy scene cache uses local equirectangular x/z, not native OSM nodes.
            legacy = json.loads(source.read_text(encoding='utf-8'))
            lon0, lat0 = legacy['center']
            mx = 111195 * math.cos(math.radians(lat0))
            timestamp = None
            for road in legacy['roads']:
                tags = dict(road['tags']); tags.setdefault('highway', road['kind'])
                coords = [PROJECT.transform(lon0+x/mx, lat0-z/111195) for x,z in road['points']]
                worker.counts['highwayWaysSeen'] += 1
                worker.store_way(int(road['id']), tags, coords)
        else:
            with osmium.io.Reader(str(source)) as reader:
                header = reader.header()
                timestamp = header.get('osmosis_replication_timestamp')
            worker.apply_file(str(source), locations=True, idx='flex_mem')
        if not worker.counts['storedWays']:
            raise ValueError('No roads found; refusing to publish empty database')
        metadata = dict(schemaVersion=1, processingVersion=1, scope=scope, builtAt=now(),
                        source=str(source.resolve()), sourceUrl=source_url, sourceSha256=digest(source),
                        osmTimestamp=timestamp or None, crs='EPSG:5179', counts=dict(worker.counts),
                        attribution='© OpenStreetMap contributors', license='ODbL-1.0',
                        licenseUrl='https://www.openstreetmap.org/copyright',
                        limitations=['OSM mapping completeness is not guaranteed.',
                                     'Widths without valid width tags are assumptions.',
                                     'Relation-based highway areas are not assembled.',
                                     'Ground eligibility uses tags, not measured elevation.'])
        if source.suffix == '.json':
            metadata['limitations'].append('Legacy merged scene: local coordinates inverted; mixed source dates and no complete coverage guarantee.')
        db.execute('INSERT INTO metadata VALUES (?,?)', ('manifest', json.dumps(metadata, ensure_ascii=False)))
        db.execute('CREATE INDEX road_kind ON roads(kind)')
        db.commit()
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Database integrity check failed')
    finally:
        db.close()
    temp.replace(target)
    target.with_suffix('.manifest.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(metadata), flush=True)
    return metadata


def query(db_path, bounds, ground_only=True):
    """Exact surface intersection, with buffered bounds to include edge-crossing roads."""
    minx, miny, maxx, maxy = bounds
    if not minx < maxx or not miny < maxy:
        raise ValueError('Expected minx,miny,maxx,maxy in EPSG:5179')
    area = box(*bounds)
    db = sqlite3.connect(Path(db_path).resolve().as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    try:
        meta = json.loads(db.execute("SELECT value FROM metadata WHERE key='manifest'").fetchone()[0])
        records = []
        rows = db.execute('''SELECT r.* FROM roads r JOIN road_bounds b ON b.osm_id=r.osm_id
            WHERE b.maxx>=? AND b.minx<=? AND b.maxy>=? AND b.miny<=?''', (minx, maxx, miny, maxy))
        for row in rows:
            if ground_only and not row['ground']:
                continue
            geom = from_wkb(row['surface_wkb'] or row['line_wkb'])
            if not geom.intersects(area):
                continue
            records.append(dict(id=row['osm_id'], kind=row['kind'], widthMeters=row['width'],
                                widthBasis=row['width_source'], groundEligible=bool(row['ground']),
                                exclusions=json.loads(row['exclusions']), tags=json.loads(row['tags']),
                                surface=mapping(geom.intersection(area)),
                                centerline=mapping(from_wkb(row['line_wkb']))))
    finally:
        db.close()
    return dict(crs='EPSG:5179', bounds=list(bounds), source=meta, roads=records)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    b = sub.add_parser('build'); b.add_argument('source', type=Path)
    b.add_argument('--db', type=Path, default=DEFAULT_DB); b.add_argument('--source-url')
    b.add_argument('--scope', default='regional')
    q = sub.add_parser('query'); q.add_argument('--db', type=Path, default=DEFAULT_DB)
    q.add_argument('--bbox', type=float, nargs=4, required=True, metavar=('MINX','MINY','MAXX','MAXY'))
    q.add_argument('--output', type=Path, required=True); q.add_argument('--include-elevated', action='store_true')
    args = p.parse_args()
    if args.command == 'build':
        build(args.source, args.db, args.source_url, args.scope)
    else:
        data = query(args.db, args.bbox, not args.include_elevated)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        print(json.dumps(dict(output=str(args.output), roads=len(data['roads']))))


if __name__ == '__main__':
    main()
