import importlib.util, io, unittest
from pathlib import Path
import shapefile

spec=importlib.util.spec_from_file_location('repair',Path(__file__).parents[1]/'scripts/repair-ngii-review.py')
repair=importlib.util.module_from_spec(spec);spec.loader.exec_module(repair)

class RepairTest(unittest.TestCase):
    def test_rebuilt_index_matches_original(self):
        shp,shx,dbf=io.BytesIO(),io.BytesIO(),io.BytesIO()
        w=shapefile.Writer(shp=shp,shx=shx,dbf=dbf,shapeType=shapefile.POLYLINE)
        w.field('HEIGHT','N',decimal=2)
        for points in [[[0,0],[10,10]],[[20,20],[30,20],[40,40]]]:
            w.line([points]);w.record(12.5)
        w.close()
        self.assertEqual(repair.make_shx(shp.getvalue()),shx.getvalue())
        with self.assertRaises(ValueError):repair.make_shx(shp.getvalue()[:-1])

if __name__=='__main__':unittest.main()
