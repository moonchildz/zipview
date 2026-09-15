import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location(
    "aerial", pathlib.Path(__file__).parents[1] / "scripts" / "detect-aerial-trees.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DetectionTests(unittest.TestCase):
    def row(self, box, score=0.8):
        return dict(zip(["xmin", "ymin", "xmax", "ymax", "score"], [*box, score]))

    def test_filter_and_clip(self):
        rows = [self.row([-3, 5, 10, 20]), self.row([20, 20, 30, 30], 0.1),
                self.row([float("nan"), 0, 4, 5]), self.row([110, 0, 120, 3])]
        trees = module.normalize_predictions(rows, 100, 100, [], 0.35)
        self.assertEqual(len(trees), 1)
        self.assertEqual(trees[0]["box"], [0, 5, 10, 20])

    def test_labels_exclude_even_partial_overlap(self):
        rows = [self.row([10, 10, 30, 30]), self.row([50, 50, 70, 70])]
        trees = module.normalize_predictions(rows, 100, 100, [[25, 25, 40, 40]], 0.35)
        self.assertEqual([t["box"] for t in trees], [[50, 50, 70, 70]])

    def test_repeatable_spatial_ids(self):
        rows = [self.row([50, 50, 70, 70]), self.row([10, 10, 30, 30])]
        self.assertEqual(module.normalize_predictions(rows, 100, 100, [], 0.35),
                         module.normalize_predictions(rows[::-1], 100, 100, [], 0.35))

    def test_color_plausibility_is_not_just_any_green_cast(self):
        from PIL import Image
        for color, expected in [((47, 75, 59), 1), ((86, 106, 91), 0), ((99, 117, 102), 0)]:
            self.assertEqual(module.vegetation_fraction(Image.new("RGB", (4, 4), color), [0, 0, 4, 4]), expected)


if __name__ == "__main__":
    unittest.main()
