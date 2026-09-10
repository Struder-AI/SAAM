from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from nonplanar_cladding_continuous_toolpath import (
    ContinuousCoupon,
    build_continuous_coupon,
    transition_distances,
    validate_continuous_coupon,
)


class ContinuousNonplanarCouponTests(unittest.TestCase):
    def setUp(self):
        self.coupon = ContinuousCoupon()
        self.layers = build_continuous_coupon(self.coupon)

    def test_geometry_validates(self):
        validate_continuous_coupon(self.coupon, self.layers)

    def test_no_perimeter_groups(self):
        self.assertFalse(any("perimeter" in layer.name for layer in self.layers))

    def test_slope_starts_on_layer_three(self):
        layer3 = self.layers[2]
        self.assertEqual(layer3.number, 3)
        self.assertGreater(min(point[1] for point in layer3.points[1:]), -self.coupon.half)

    def test_mesh_alternates_x_y(self):
        mesh = [layer for layer in self.layers if "mesh" in layer.name]
        axes = [layer.name.rsplit(" ", 1)[-1] for layer in mesh]
        self.assertEqual(axes[0], "Y")
        self.assertTrue(all(a != b for a, b in zip(axes, axes[1:])))

    def test_no_cross_coupon_layer_shift(self):
        self.assertLess(max(transition_distances(self.layers)), 1e-8)


if __name__ == "__main__":
    unittest.main()
