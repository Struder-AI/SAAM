import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from bounded_triangular_toolpath import circle_through
from walled_truss_toolpath import build_walled_truss_preview


class WalledTrussTests(unittest.TestCase):
    def test_geometry_and_repeat_selection(self):
        g, _, _, apex = build_walled_truss_preview()
        self.assertAlmostEqual(g.inner_wall, 26.0)
        self.assertAlmostEqual(g.outer_wall, 34.0)
        self.assertEqual(g.repeat_count, 8)
        self.assertLess(abs(apex - 90.0), 1.0)
        self.assertAlmostEqual(g.tie_overlap, g.bead_width * 0.5)
        center_distance = math.hypot(
            g.outer_turn_center - g.inner_turn_center * math.cos(g.step / 2.0),
            g.inner_turn_center * math.sin(g.step / 2.0),
        )
        self.assertGreater(center_distance, 2.0 * g.turn_radius)

    def test_turnarounds_are_two_mm(self):
        _, _, paths, _ = build_walled_truss_preview()
        for moves in paths.values():
            for move in moves:
                if move.group == "turnback":
                    _, radius = circle_through(move.start, move.midpoint, move.end)
                    self.assertAlmostEqual(radius, 2.0, places=6)

    def test_pattern_phases_differ_by_half_repeat(self):
        g, _, paths, _ = build_walled_truss_preview()
        outer_apex_angles = {}
        for name in ("pattern-a", "pattern-b"):
            outer_apex_angles[name] = [
                math.atan2(move.midpoint.y, move.midpoint.x) % (2 * math.pi)
                for move in paths[name]
                if move.group == "turnback"
                and abs(math.hypot(move.midpoint.x, move.midpoint.y) - g.outer_apex) < 1.0e-6
            ]
        expected = g.step / 2.0
        error = min(
            abs((angle - expected + math.pi) % (2 * math.pi) - math.pi)
            for angle in outer_apex_angles["pattern-b"]
        )
        self.assertLess(error, 1.0e-6)

    def test_foundation_ring_spacing_has_no_crowded_final_ring(self):
        g, _, paths, _ = build_walled_truss_preview()
        radii = sorted({
            round(math.hypot(move.start.x, move.start.y), 6)
            for move in paths["foundation"]
            if move.group == "foundation"
        })
        gaps = [b - a for a, b in zip(radii, radii[1:])]
        self.assertTrue(gaps)
        self.assertLessEqual(max(gaps), g.spacing + 1.0e-6)
        self.assertLess(max(gaps) - min(gaps), 1.0e-5)


if __name__ == "__main__":
    unittest.main()
