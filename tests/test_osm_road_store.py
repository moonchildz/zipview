"""Exercise saved spatial queries and ground-mask safety with real OSM XML."""
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from osm_road_store import build, profile, query, PROJECT
import collect_osm_roads as collector


class RoadStoreTests(unittest.TestCase):
    def test_legacy_scene_retains_ids_and_crossing_geometry(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=root/'scene.json';db=root/'roads.sqlite'
            source.write_text(json.dumps({'center':[127,37.5],'roads':[
                {'id':81,'kind':'footway','tags':{},'points':[[-100,0],[100,0]]},
                {'id':82,'kind':'primary','tags':{'bridge':'yes'},'points':[[-100,0],[100,0]]}
            ]}),encoding='utf-8')
            build(source,db)
            x,y=PROJECT.transform(127,37.5);bounds=[x-5,y-5,x+5,y+5]
            self.assertEqual([r['id'] for r in query(db,bounds)['roads']],[81])
            self.assertEqual({r['id'] for r in query(db,bounds,False)['roads']},{81,82})

    def test_resume_checksum_and_final_publication(self):
        import hashlib
        import io
        class Response(io.BytesIO):
            status=206
            headers={'Content-Range':'bytes 3-5/6'}
        with tempfile.TemporaryDirectory() as folder:
            raw=Path(folder)/'test.pbf'; partial=raw.with_suffix('.pbf.partial')
            partial.write_bytes(b'abc')
            with patch.object(collector,'RAW',raw), patch.object(collector,'EXPECTED_BYTES',6), \
                 patch.object(collector,'EXPECTED_MD5',hashlib.md5(b'abcdef').hexdigest()), \
                 patch.object(collector,'status'), patch.object(collector.urllib.request,'urlopen',return_value=Response(b'def')) as get:
                collector.download()
                self.assertEqual(get.call_args.args[0].headers['Range'],'bytes=3-')
                self.assertEqual(raw.read_bytes(),b'abcdef')
                self.assertFalse(partial.exists())
                collector.download()
                self.assertEqual(get.call_count,1)

    def test_invalid_checksum_never_publishes(self):
        with tempfile.TemporaryDirectory() as folder:
            raw=Path(folder)/'test.pbf'; raw.with_suffix('.pbf.partial').write_bytes(b'broken')
            with patch.object(collector,'RAW',raw),patch.object(collector,'EXPECTED_BYTES',6),patch.object(collector,'status'):
                with self.assertRaises(ValueError):collector.download()
                self.assertFalse(raw.exists())

    def test_ground_separation_and_width_provenance(self):
        for tags in ({'bridge':'yes'}, {'tunnel':'yes'}, {'layer':'1'}, {'layer':'-1'},
                     {'level':'1'}, {'indoor':'yes'}, {'layer':'0;1'}):
            self.assertFalse(profile({'highway':'footway', **tags})['groundEligible'])
        self.assertEqual(profile({'highway':'footway', 'width':'2.4 m'})['width'], 2.4)
        self.assertEqual(profile({'highway':'footway', 'width':'unknown'})['widthSource'], 'class-assumption')
        self.assertEqual(profile({'highway':'residential', 'lanes':'2'})['widthSource'], 'lanes-assumption')
        self.assertFalse(profile({'highway':'construction'})['groundEligible'])

    def test_published_database_exact_queries_and_failed_build(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); src = root/'fixture.osm'; db = root/'roads.sqlite'
            src.write_text('''<osm version="0.6">
              <node id="1" lon="127.0" lat="37.5"/><node id="2" lon="127.01" lat="37.5"/>
              <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="footway"/><tag k="width" v="4"/></way>
              <way id="11"><nd ref="1"/><nd ref="2"/><tag k="highway" v="service"/><tag k="bridge" v="yes"/></way>
              <way id="12"><nd ref="1"/><nd ref="2"/><tag k="highway" v="path"/><tag k="layer" v="-1"/></way>
              </osm>''', encoding='utf-8')
            build(src, db)
            x,y = PROJECT.transform(127.005,37.5)
            bounds = [x-10,y-10,x+10,y+10]
            self.assertEqual([r['id'] for r in query(db,bounds)['roads']], [10])
            self.assertEqual(len(query(db,bounds,False)['roads']), 3)
            # No endpoints inside the query: crossing ways must still be returned.
            row = query(db,bounds)['roads'][0]
            self.assertEqual(row['widthMeters'],4)
            self.assertEqual(row['surface']['type'],'Polygon')
            self.assertEqual(query(db,[x,y+100,x+10,y+110])['roads'], [])
            before = db.read_bytes()
            empty=root/'empty.osm'; empty.write_text('<osm version="0.6"/>')
            with self.assertRaises(ValueError): build(empty,db)
            self.assertEqual(db.read_bytes(),before)
            with closing(sqlite3.connect(db)) as conn:
                self.assertEqual(conn.execute('PRAGMA integrity_check').fetchone()[0], 'ok')


if __name__ == '__main__':
    unittest.main()
