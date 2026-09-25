import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec=importlib.util.spec_from_file_location('vegetation',Path(__file__).resolve().parents[1]/'scripts/segment-satellite-vegetation.py')
v=importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)

class VegetationTests(unittest.TestCase):
    def test_lower_grass_threshold_keeps_argmax_and_canopy_threshold(self):
        canopy=np.array([[.4,.1,.1,.6]])
        grass=np.array([[.4,.4,.34,.4]])
        labels=np.array([[2,5,2,2]])
        valid=np.ones((1,4),bool)
        np.testing.assert_array_equal(v.classify(canopy,grass,labels,valid,.5,.35),[[2,0,0,1]])

    def test_overlap_priority_and_nodata(self):
        canopy=np.array([[.9,.1,.9,.1,.1]])
        grass=np.array([[.9,.9,.9,.9,.49]])
        labels=np.array([[2,2,2,5,2]])
        valid=np.array([[True,True,False,True,True]])
        np.testing.assert_array_equal(v.classify(canopy,grass,labels,valid),[[1,2,0,0,0]])

    def test_tiling_covers_edges_with_positive_weights(self):
        for length in [100,512,513,4096]:
            coverage=np.zeros(length)
            for start in v.positions(length):
                end=min(start+512,length)
                coverage[start:end]+=v.blend_weights(512)[256,:end-start]
            self.assertTrue(np.all(coverage>0))
            self.assertEqual(v.positions(length)[-1],max(0,length-512))

if __name__=='__main__':unittest.main()
