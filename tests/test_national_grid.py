import importlib.util,unittest
from pathlib import Path
from shapely.geometry import box
spec=importlib.util.spec_from_file_location('grid',Path(__file__).parents[1]/'scripts/national-grid.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class GridTests(unittest.TestCase):
 def test_polygon_hole_and_stable_ids(self):
  area=box(950001,1950001,951999,1951999).difference(box(950400,1950400,951100,1951100))
  a={'wkt':area.wkt};cells=m.grid(a)
  self.assertEqual(cells,m.grid(a));self.assertEqual(len(cells),15)
  self.assertEqual(len({c['id'] for c in cells}),15)
  self.assertTrue(all(124<c['point'][0]<132 for c in cells))
 def test_reject_lonlat_as_projected(self):
  with self.assertRaises(ValueError):m.grid({'wkt':box(126,37,127,38).wkt})
if __name__=='__main__':unittest.main()
