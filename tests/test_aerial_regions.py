import importlib.util
import pathlib
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location("regions", pathlib.Path(__file__).parents[1] / "scripts/detect-aerial-regions.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RegionTests(unittest.TestCase):
    def test_nearby_canopy_is_one_region_not_individual_trees(self):
        probability = np.zeros((60, 60))
        probability[10:30, 10:25] = 1
        probability[10:30, 28:43] = 1
        regions, mask = module.vegetation_regions(probability, [])
        self.assertEqual(len(regions), 1)
        self.assertGreater((mask > 0).sum(), 600)

    def test_exclusion_is_not_filled_by_morphology(self):
        probability = np.ones((60, 60))
        regions, mask = module.vegetation_regions(probability, [[28, 0, 32, 60]])
        self.assertEqual(len(regions), 2)
        self.assertEqual(mask[:, 28:32].sum(), 0)

    def test_holes_are_preserved(self):
        probability = np.zeros((70, 70))
        probability[5:65, 5:65] = 1
        probability[25:45, 25:45] = 0
        regions, _ = module.vegetation_regions(probability, [])
        self.assertEqual(len(regions[0]["holes"]), 1)

    def test_class_aware_deduplication(self):
        items = [{"box": [0, 0, 10, 10], "kind": "vehicle", "score": 0.4},
                 {"box": [1, 1, 10, 10], "kind": "vehicle", "score": 0.3},
                 {"box": [1, 1, 10, 10], "kind": "playground", "score": 0.3}]
        self.assertEqual(len(module.deduplicate(items, [])), 2)
        self.assertEqual(module.deduplicate(items, [[5, 5, 6, 6]]), [])


if __name__ == "__main__":
    unittest.main()
