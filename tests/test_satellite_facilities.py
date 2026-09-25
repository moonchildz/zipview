"""Geometry regressions for multiscale satellite detections."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('detector', Path(__file__).resolve().parents[1]/'scripts/detect-satellite-facilities.py')
detector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(detector)


def item(label,score=0.8,x=0):
    return {'label':label,'score':score,'quad':[[x,10],[x+20,10],[x+20,30],[x,30]]}


class GeometryTests(unittest.TestCase):
    def test_all_classes_survive_and_different_classes_do_not_suppress(self):
        result=detector.merge_candidates([item('tennis court'),item('building'),item('tennis court',0.6)],100,100)
        self.assertEqual({o['label'] for o in result},{'tennis court','building'})
        self.assertEqual(len(result),2)

    def test_vehicle_subclasses_merge_at_grid_boundary(self):
        result=detector.merge_candidates([item('small-vehicle',0.9,250),item('large vehicle',0.7,252)],500,500)
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]['score'],0.9)

    def test_invalid_and_outside_boxes_removed(self):
        invalid=item('bridge'); invalid['quad'][0][0]=float('nan')
        self.assertEqual(len(detector.merge_candidates([invalid,item('bridge',x=110),item('bridge',x=10)],100,100)),1)

    def test_windows_cover_edges_without_duplicate_full_frame(self):
        self.assertEqual(detector.positions(4096,1024,256),[0,768,1536,2304,3072])
        self.assertEqual(detector.positions(700,1024,256),[0])


if __name__=='__main__':unittest.main()
