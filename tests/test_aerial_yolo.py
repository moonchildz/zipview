import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("yolo_pilot", pathlib.Path(__file__).parents[1] / "scripts/detect-aerial-yolo.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ObbTests(unittest.TestCase):
    def test_rotated_overlap_and_deduplication_across_vehicle_subclasses(self):
        q = [[10, 5], [15, 10], [10, 15], [5, 10]]
        self.assertAlmostEqual(module.rotated_iou(q, q), 1)
        items = [{"label": "small vehicle", "quad": q, "score": 0.8},
                 {"label": "large-vehicle", "quad": q, "score": 0.6}]
        result = module.merge_vehicles(items, [], 100, 100)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["quad"], q)
        self.assertEqual(result[0]["box"], [5, 5, 15, 15])
        self.assertEqual(result[0]["orientationStatus"], "detected-axis-heading-unknown")

    def test_labels_and_out_of_image_corners_excluded(self):
        q = [[10, 5], [15, 10], [10, 15], [5, 10]]
        items = [{"label": "small vehicle", "quad": q, "score": 0.8}]
        self.assertEqual(module.merge_vehicles(items, [[9, 9, 11, 11]], 100, 100), [])
        self.assertEqual(module.merge_vehicles(items, [], 12, 12), [])
        self.assertEqual(module.merge_vehicles([{**items[0], "label": "tennis court"}], [], 100, 100), [])


if __name__ == "__main__":
    unittest.main()
