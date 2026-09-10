import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from nonplanar_gable_cladding_toolpath import (
    GableCoupon, build_cosmetic_gable_coupon, build_cross_ironing_paths,
    build_gable_coupon, build_ironing_paths, square_spiral_base,
    validate_gable_coupon, validate_ironing_paths,
)


def test_gable_geometry_and_continuity():
    c = GableCoupon()
    layers = build_gable_coupon(c)
    validate_gable_coupon(c, layers)
    assert math.isclose(c.ridge_z, 7.9794046853, rel_tol=0, abs_tol=1e-8)
    assert layers[-1].name == "solid finish - gable Y/Z"
    assert layers[-1].points[-1][1] == 0.0


def test_finishing_rows_climb_and_descend():
    c = GableCoupon()
    layers = build_gable_coupon(c)
    skin = next(layer for layer in layers if layer.name == "50% skin - gable Y/Z")
    zs = [p[2] for p in skin.points]
    assert max(zs) == c.ridge_z
    assert any(zs[i] < zs[i + 1] > zs[i + 2] for i in range(len(zs) - 2))


def test_two_ironing_passes_follow_surface_and_end_on_ridge():
    c = GableCoupon()
    paths = build_ironing_paths(c)
    validate_ironing_paths(c, paths)
    assert len(paths) == 2
    assert paths[0].points[0][0] == c.half
    assert paths[1].points[0][0] == -c.half + c.ironing_stagger
    assert all(path.points[-1][1] == 0.0 for path in paths)


def test_cosmetic_base_is_one_outer_to_inner_path():
    c = GableCoupon(angle_deg=30.0)
    base = square_spiral_base(c)
    assert base.points[0] == (-20.0, -20.0, 0.0)
    assert abs(base.points[-1][0]) < 1.0
    assert abs(base.points[-1][1]) < 1.0
    layers = build_cosmetic_gable_coupon(c)
    assert layers[1].points[0] == base.points[-1]


def test_cross_ironing_overruns_and_explicitly_visits_ridge():
    c = GableCoupon(angle_deg=30.0)
    p1, p2 = build_cross_ironing_paths(c, overrun=1.0)
    assert min(p[0] for p in p1.points) == -21.0
    assert max(p[0] for p in p1.points) == 21.0
    assert min(p[1] for p in p1.points) == -21.0
    assert max(p[1] for p in p1.points) == 21.0
    # Every full Y/Z row contains a y=0 ridge breakpoint.
    for a, b in zip(p2.points, p2.points[1:]):
        if a[0] == b[0] and a[1]*b[1] < 0:
            raise AssertionError("Y/Z ironing chord skipped the ridge")
