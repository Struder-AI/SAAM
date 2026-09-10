from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from triangular_wall_geometry import derive_geometry


class TriangularWallGeometryTests(unittest.TestCase):
    def test_bounded_current_geometry_regenerates_repeat_count(self):
        geometry = derive_geometry(
            guide_radius_mm=30.0,
            total_envelope_mm=8.0,
            line_spacing_mm=0.78,
            inner_perimeter_count=1,
            outer_perimeter_count=2,
        )

        self.assertAlmostEqual(geometry.inner_core_radius_mm, 26.78)
        self.assertAlmostEqual(geometry.outer_core_radius_mm, 32.44)
        self.assertAlmostEqual(geometry.core_width_mm, 5.66)
        self.assertEqual(geometry.repeat_count, 13)
        self.assertAlmostEqual(geometry.apex_angle_deg, 89.739, places=3)
        self.assertAlmostEqual(geometry.fillet_radius_mm, 0.566)

    def test_repeat_count_changes_when_bounds_change(self):
        unbounded = derive_geometry(
            guide_radius_mm=30.0,
            total_envelope_mm=8.0,
            line_spacing_mm=0.78,
            inner_perimeter_count=0,
            outer_perimeter_count=0,
        )
        bounded = derive_geometry(
            guide_radius_mm=30.0,
            total_envelope_mm=8.0,
            line_spacing_mm=0.78,
            inner_perimeter_count=1,
            outer_perimeter_count=2,
        )

        self.assertNotEqual(unbounded.repeat_count, bounded.repeat_count)

    def test_rejects_bounds_that_consume_envelope(self):
        with self.assertRaisesRegex(ValueError, "consume"):
            derive_geometry(
                guide_radius_mm=30.0,
                total_envelope_mm=2.0,
                line_spacing_mm=0.78,
                inner_perimeter_count=2,
                outer_perimeter_count=2,
            )


if __name__ == "__main__":
    unittest.main()
