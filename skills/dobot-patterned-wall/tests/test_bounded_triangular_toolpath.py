import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from bounded_triangular_toolpath import (
    Calibration,
    Geometry,
    Point,
    build_preview_paths,
    circle_through,
    sample_move,
    solve_couching_shifts,
    validate_controller_arc,
    validate_controller_path,
)


class BoundedTriangularToolpathTests(unittest.TestCase):
    def test_derived_bounded_geometry(self):
        g = Geometry()
        self.assertAlmostEqual(g.inner_perimeter, 26.00)
        self.assertAlmostEqual(g.inner_core, 26.78)
        self.assertAlmostEqual(g.outer_core, 32.44)
        self.assertAlmostEqual(g.outer_perimeter_2, 33.22)
        self.assertAlmostEqual(g.outer_perimeter_1, 34.00)
        self.assertAlmostEqual(g.fillet_radius, 0.566)
        self.assertEqual(g.repeat_count, 28)

    def test_couching_shift_solution_fits_repeat_pitch(self):
        g = Geometry()
        outer, inner = solve_couching_shifts(g)
        half = math.pi / g.repeat_count
        self.assertGreater(outer, 0.0)
        self.assertGreater(inner, 0.0)
        self.assertLess(outer, half)
        self.assertLess(inner, half)
        self.assertAlmostEqual(math.degrees(outer), 2.411, places=2)
        self.assertAlmostEqual(math.degrees(inner), 3.673, places=2)

    def test_every_arc3_is_non_collinear_and_continuous(self):
        _, _, paths = build_preview_paths()
        for moves in paths.values():
            for previous, current in zip(moves, moves[1:]):
                self.assertAlmostEqual(previous.end.x, current.start.x, places=6)
                self.assertAlmostEqual(previous.end.y, current.start.y, places=6)
            for move in moves:
                if move.kind == "arc3":
                    _, radius = circle_through(move.start, move.midpoint, move.end)
                    self.assertGreater(radius, 0.05)
                    self.assertLess(radius, 100.0)

    def test_predicted_paths_are_finite(self):
        _, calibration, paths = build_preview_paths()
        for moves in paths.values():
            for move in moves:
                for point in sample_move(move, calibration):
                    self.assertTrue(math.isfinite(point.x))
                    self.assertTrue(math.isfinite(point.y))

    def test_predicted_concentric_arcs_remain_within_tolerance(self):
        g, calibration, paths = build_preview_paths()
        radii = (
            g.inner_perimeter,
            g.inner_core,
            g.outer_core,
            g.outer_perimeter_2,
            g.outer_perimeter_1,
        )
        for moves in paths.values():
            for move in moves:
                if move.group not in ("perimeter", "core-boundary"):
                    continue
                start_radius = math.hypot(move.start.x, move.start.y)
                target = min(radii, key=lambda radius: abs(radius - start_radius))
                error = max(
                    abs(math.hypot(point.x, point.y) - target)
                    for point in sample_move(move, calibration, samples=32)
                )
                self.assertLessEqual(error, 0.04)

    def test_all_desired_turnback_arcs_have_exact_scaled_radius(self):
        g, _, paths = build_preview_paths()
        for moves in paths.values():
            for move in moves:
                if move.group == "turnback" and move.kind == "arc3":
                    _, radius = circle_through(move.start, move.midpoint, move.end)
                    self.assertAlmostEqual(radius, g.fillet_radius, places=6)

    def test_every_complete_path_passes_controller_arc_safety(self):
        _, calibration, paths = build_preview_paths()
        for moves in paths.values():
            validate_controller_path(moves, calibration)

    def test_near_degenerate_alarm_arc_is_rejected(self):
        calibration = Calibration()
        from bounded_triangular_toolpath import Move, Point

        risky = Move(
            "arc3",
            Point(32.409035, 1.417060),
            Point(32.439123, -0.238505),
            Point(32.434644, 0.589469),
            "core-boundary",
            1,
            3.0,
        )
        with self.assertRaisesRegex(ValueError, "Controller-risk Arc3"):
            validate_controller_arc(risky, calibration)

    def test_no_current_path_contains_the_three_alarm_risk_shapes(self):
        _, calibration, paths = build_preview_paths()
        for moves in paths.values():
            for move in moves:
                if move.kind != "arc3":
                    continue
                start = calibration.forward(move.start)
                midpoint = calibration.forward(move.midpoint)
                end = calibration.forward(move.end)
                twice_area = abs(
                    (midpoint.x - start.x) * (end.y - start.y)
                    - (midpoint.y - start.y) * (end.x - start.x)
                )
                self.assertGreaterEqual(twice_area, 0.05)

    def test_layer_a_finishes_with_complete_inner_skin(self):
        g, _, paths = build_preview_paths()
        inner_skin_arcs = [
            move
            for move in paths["layer-a"]
            if move.group == "perimeter"
            and abs(math.hypot(move.start.x, move.start.y) - g.inner_perimeter) < 1.0e-6
        ]
        self.assertGreaterEqual(len(inner_skin_arcs), 2)
        self.assertAlmostEqual(
            math.hypot(paths["layer-a"][-1].end.x, paths["layer-a"][-1].end.y),
            g.inner_perimeter,
            places=6,
        )

    def test_calibration_round_trip(self):
        calibration = Calibration()
        point = Point(31.2, -17.8)
        recovered = calibration.inverse(calibration.forward(point))
        self.assertAlmostEqual(point.x, recovered.x)
        self.assertAlmostEqual(point.y, recovered.y)


if __name__ == "__main__":
    unittest.main()
