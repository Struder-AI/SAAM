import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from nonplanar_cladding_toolpath import CladdingCouponGeometry, build_coupon_paths, build_y_slope_coupon_paths, validate_coupon


class NonplanarCladdingTests(unittest.TestCase):
    def setUp(self):
        self.g = CladdingCouponGeometry()
        self.paths = build_coupon_paths(self.g)

    def test_geometry(self):
        self.assertAlmostEqual(self.g.roof_rise, 20*math.tan(math.radians(10)))
        self.assertAlmostEqual(self.g.slope_speed, 3*math.cos(math.radians(10)))
        self.assertAlmostEqual(self.g.flat_roof_z, 4.2)

    def test_all_paths_validate(self):
        validate_coupon(self.g, self.paths)

    def test_cladding_orientations(self):
        self.assertTrue(all(abs(s.end[1]-s.start[1]) < 1e-9 for s in self.paths["cladding-a"]))
        self.assertTrue(all(abs(s.end[0]-s.start[0]) < 1e-9 for s in self.paths["cladding-b"]))
        self.assertTrue(all(abs(s.end[1]-s.start[1]) < 1e-9 for s in self.paths["cladding-c"]))

    def test_uphill_and_downhill_alternate(self):
        for key in ("cladding-a", "cladding-c"):
            signs = [math.copysign(1, s.end[2]-s.start[2]) for s in self.paths[key]]
            self.assertTrue(all(a != b for a, b in zip(signs, signs[1:])))

    def test_40mm_rotation_moves_slope_to_y(self):
        g = CladdingCouponGeometry(size=40.0)
        paths = build_y_slope_coupon_paths(g)
        strokes = paths["cladding-a"]
        self.assertTrue(all(abs(s.end[0]-s.start[0]) < 1e-9 for s in strokes))
        self.assertTrue(all(abs(s.end[2]-s.start[2]) > 1.0 for s in strokes))


if __name__ == "__main__":
    unittest.main()
