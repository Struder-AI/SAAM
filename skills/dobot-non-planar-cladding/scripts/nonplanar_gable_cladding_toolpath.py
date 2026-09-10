"""Continuous 40 mm gable-roof non-planar coupon geometry.

The printable path is deliberately continuous after extrusion begins.  Every
within-footprint connector is deposited; the only low-Z non-print approach is
kept 15 mm outside the coupon boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
import math

from nonplanar_cladding_continuous_toolpath import (
    ContinuousLayer,
    _inherit_previous_endpoint,
    _nearest_candidate,
    _raster_candidates,
)
from nonplanar_cladding_toolpath import even_positions

Point3 = tuple[float, float, float]


@dataclass(frozen=True)
class GableCoupon:
    size: float = 40.0
    angle_deg: float = 20.0
    layer_rise: float = 0.70
    solid_spacing: float = 0.78
    sparse_spacing: float = 3.12
    slope_begins_z: float = 0.70
    print_speed: float = 3.0
    clearance: float = 15.0
    ironing_z_offset: float = 0.0
    ironing_spacing: float = 0.25
    ironing_stagger: float = 0.125

    @property
    def half(self) -> float:
        return self.size / 2.0

    @property
    def slope(self) -> float:
        return math.tan(math.radians(self.angle_deg))

    @property
    def ridge_z(self) -> float:
        return self.slope_begins_z + self.half * self.slope

    def roof_z(self, y: float, offset: float = 0.0) -> float:
        return self.slope_begins_z + (self.half - abs(y)) * self.slope + offset


def _gable_rows(c: GableCoupon, spacing: float, offset: float,
                previous: Point3) -> list[Point3]:
    """Raster in Y/Z with a ridge-ending final half-row.

    The first row starts at the inherited point. Interior rows cross the full
    gable. The final row stops at the ridge so the path ends at maximum Z.
    """
    xs = even_positions(-c.half, c.half, spacing)
    # Choose the X ordering nearest the preceding endpoint.
    if abs(previous[0] - xs[-1]) < abs(previous[0] - xs[0]):
        xs.reverse()
    pts: list[Point3] = [previous]
    side = -c.half if previous[1] <= 0 else c.half
    # Bring the inherited point onto the first eave as a deposited connector.
    first = (xs[0], side, c.roof_z(side, offset))
    if pts[-1] != first:
        pts.append(first)
    for i, x in enumerate(xs):
        if i == len(xs) - 1:
            pts.append((x, 0.0, c.roof_z(0.0, offset)))
            break
        other = -side
        pts.extend(((x, 0.0, c.roof_z(0.0, offset)),
                    (x, other, c.roof_z(other, offset))))
        side = other
        nx = xs[i + 1]
        pts.append((nx, side, c.roof_z(side, offset)))
    return pts


def build_gable_coupon(c: GableCoupon | None = None) -> list[ContinuousLayer]:
    c = c or GableCoupon()
    h = c.half
    layers: list[ContinuousLayer] = []
    previous: Point3 | None = None

    points = _nearest_candidate(
        _raster_candidates(-h, h, -h, h, c.solid_spacing, True,
                           lambda _x, _y: 0.0), previous)
    layers.append(ContinuousLayer(1, "solid base - X", tuple(points), c.print_speed))
    previous = points[-1]

    # Symmetric sparse scaffold: layer 2 is full; layer 3 starts the gable.
    top_index = math.floor(c.ridge_z / c.layer_rise + 1e-9)
    for number in range(2, top_index + 2):
        z = (number - 1) * c.layer_rise
        ylim = h if number == 2 else h - (z - c.slope_begins_z) / c.slope
        ylim = max(0.0, min(h, ylim))
        along_x = number % 2 == 1
        points = _inherit_previous_endpoint(_nearest_candidate(
            _raster_candidates(-h, h, -ylim, ylim, c.sparse_spacing,
                               along_x, lambda _x, _y, z=z: z), previous), previous)
        layers.append(ContinuousLayer(number, "25% mesh - " + ("X" if along_x else "Y"),
                                      tuple(points), c.print_speed))
        previous = points[-1]

    number = layers[-1].number
    # First Y/Z skin ends on the ridge. The X skin uses a deposited roof-edge
    # connector, and the final Y/Z skin ends on the ridge again.
    number += 1
    points = _gable_rows(c, c.solid_spacing / 0.50, 0.0, previous)
    layers.append(ContinuousLayer(number, "50% skin - gable Y/Z", tuple(points),
                                  c.print_speed * math.cos(math.radians(c.angle_deg))))
    previous = points[-1]

    number += 1
    points = _inherit_previous_endpoint(_nearest_candidate(
        _raster_candidates(-h, h, -h, h, c.solid_spacing, True,
                           lambda _x, y: c.roof_z(y, c.layer_rise)), previous), previous)
    layers.append(ContinuousLayer(number, "solid skin - X", tuple(points), c.print_speed))
    previous = points[-1]

    number += 1
    points = _gable_rows(c, c.solid_spacing, 2 * c.layer_rise, previous)
    layers.append(ContinuousLayer(number, "solid finish - gable Y/Z", tuple(points),
                                  c.print_speed * math.cos(math.radians(c.angle_deg))))
    return layers


def square_spiral_base(c: GableCoupon | None = None) -> ContinuousLayer:
    """Outer outline flowing continuously inward at calibrated solid spacing."""
    c = c or GableCoupon()
    left = bottom = -c.half
    right = top = c.half
    points: list[Point3] = [(left, bottom, 0.0)]
    while left <= right + 1e-9 and bottom <= top + 1e-9:
        points.extend(((right, bottom, 0.0),
                       (right, top, 0.0),
                       (left, top, 0.0)))
        old_left = left
        left += c.solid_spacing
        right -= c.solid_spacing
        bottom += c.solid_spacing
        top -= c.solid_spacing
        if left > right + 1e-9 or bottom > top + 1e-9:
            break
        # Descend the current left boundary, leaving one bead-width seam gap,
        # then step inward along the next bottom run. No contour stop occurs.
        points.extend(((old_left, bottom, 0.0),
                       (left, bottom, 0.0)))
    return ContinuousLayer(1, "cosmetic square spiral base", tuple(points), c.print_speed)


def build_cosmetic_gable_coupon(c: GableCoupon | None = None) -> list[ContinuousLayer]:
    c = c or GableCoupon()
    layers = build_gable_coupon(c)
    layers[0] = square_spiral_base(c)
    center_x = layers[0].points[-1][0]
    z = c.layer_rise
    second: list[Point3] = [layers[0].points[-1], (center_x, c.half, z)]
    current_y = c.half
    right_n = max(1, math.ceil((c.half-center_x)/c.sparse_spacing))
    for i in range(1, right_n+1):
        x = center_x+i*(c.half-center_x)/right_n
        second.extend(((x,current_y,z),(x,-current_y,z)))
        current_y = -current_y
    left_n = max(1, math.ceil((center_x+c.half)/c.sparse_spacing))
    for i in range(1, left_n+1):
        x = center_x-i*(center_x+c.half)/left_n
        second.extend(((x,current_y,z),(x,-current_y,z)))
        current_y = -current_y
    layers[1] = ContinuousLayer(layers[1].number, layers[1].name,
                                tuple(second), layers[1].speed)
    return layers


def build_cross_ironing_paths(c: GableCoupon | None = None,
                              overrun: float = 1.0) -> tuple[ContinuousLayer, ContinuousLayer]:
    """Perpendicular X pass followed by breakpoint-safe Y/Z gable pass."""
    c = c or GableCoupon()
    low, high = -c.half-overrun, c.half+overrun
    offset = 2*c.layer_rise+c.ironing_z_offset

    def iz(y: float) -> float:
        return c.slope_begins_z + max(0.0, c.half-abs(y))*c.slope + offset

    intervals = math.ceil((high-low)/c.ironing_spacing)
    step = (high-low)/intervals
    # Assume the final deposited path ends at +X ridge, as the deterministic
    # cosmetic coupon does. Reposition only along Y/Z then X path families.
    p1: list[Point3] = [(c.half, 0.0, iz(0.0)),
                        (c.half, low, iz(low)),
                        (high, low, iz(low))]
    x = high
    for i in range(intervals+1):
        y = low+i*step
        other = -x
        p1.append((other, y, iz(y)))
        x = other
        if i < intervals:
            ny = low+(i+1)*step
            p1.append((x, ny, iz(ny)))

    start_x, end_x = x, -x
    p2: list[Point3] = [(start_x, high, iz(high))]
    x_intervals = math.ceil(abs(end_x-start_x)/c.ironing_spacing)
    x_step = (end_x-start_x)/x_intervals
    side = high
    for i in range(x_intervals+1):
        xx = start_x+i*x_step
        if i > 0:
            p2.append((xx, side, iz(side)))
        if i == x_intervals:
            p2.append((xx, 0.0, iz(0.0)))
            break
        other = -side
        # Ridge breakpoint is mandatory; direct eave chords collide.
        p2.extend(((xx, 0.0, iz(0.0)), (xx, other, iz(other))))
        side = other
    return (
        ContinuousLayer(1, "dry ironing pass 1 - X overrun", tuple(p1), c.print_speed),
        ContinuousLayer(2, "dry ironing pass 2 - Y/Z overrun", tuple(p2),
                        c.print_speed*math.cos(math.radians(c.angle_deg))),
    )


def validate_gable_coupon(c: GableCoupon, layers: list[ContinuousLayer]) -> None:
    if layers[0].name != "solid base - X":
        raise ValueError("Layer 1 must be the solid perimeterless base")
    if layers[1].name != "25% mesh - Y" or layers[2].name != "25% mesh - X":
        raise ValueError("Scaffold orientation must alternate X, Y, X")
    for a, b in zip(layers, layers[1:]):
        if math.dist(a.points[-1], b.points[0]) > 1e-8:
            raise ValueError("Every layer must inherit the prior endpoint")
    for layer in layers:
        for x, y, z in layer.points:
            if not (-c.half - 1e-8 <= x <= c.half + 1e-8 and
                    -c.half - 1e-8 <= y <= c.half + 1e-8 and z >= -1e-8):
                raise ValueError("Path leaves coupon bounds")
    if abs(layers[-1].points[-1][1]) > 1e-8:
        raise ValueError("Final path must end at the high ridge")


def _ironing_pass(c: GableCoupon, xs: list[float], start_side: float) -> tuple[Point3, ...]:
    """Make a surface-following Y/Z serpentine that starts and ends at ridge Z."""
    offset = 2 * c.layer_rise + c.ironing_z_offset
    pts: list[Point3] = [(xs[0], 0.0, c.roof_z(0.0, offset))]
    side = start_side
    pts.append((xs[0], side, c.roof_z(side, offset)))
    for i, x in enumerate(xs[1:], 1):
        pts.append((x, side, c.roof_z(side, offset)))
        if i == len(xs) - 1:
            pts.append((x, 0.0, c.roof_z(0.0, offset)))
            break
        other = -side
        pts.extend(((x, 0.0, c.roof_z(0.0, offset)),
                    (x, other, c.roof_z(other, offset))))
        side = other
    return tuple(pts)


def build_ironing_paths(c: GableCoupon | None = None) -> tuple[ContinuousLayer, ContinuousLayer]:
    c = c or GableCoupon()
    count = max(1, math.ceil(c.size / c.ironing_spacing))
    step = c.size / count
    xs1 = [c.half - i * step for i in range(count + 1)]
    # Half-step stagger stays inside both X boundaries.
    xs2 = [-c.half + c.ironing_stagger + i * step
           for i in range(count)
           if -c.half < -c.half + c.ironing_stagger + i * step < c.half]
    p1 = _ironing_pass(c, xs1, c.half)
    p2 = _ironing_pass(c, xs2, -c.half)
    return (
        ContinuousLayer(1, "dry ironing pass 1 - Y/Z", p1,
                        c.print_speed * math.cos(math.radians(c.angle_deg))),
        ContinuousLayer(2, "dry ironing pass 2 - Y/Z staggered", p2,
                        c.print_speed * math.cos(math.radians(c.angle_deg))),
    )


def validate_ironing_paths(c: GableCoupon, paths: tuple[ContinuousLayer, ContinuousLayer]) -> None:
    for path in paths:
        if abs(path.points[0][1]) > 1e-9 or abs(path.points[-1][1]) > 1e-9:
            raise ValueError("Each ironing pass must start and end on the ridge")
        for x, y, z in path.points:
            if not (-c.half - 1e-9 <= x <= c.half + 1e-9 and
                    -c.half - 1e-9 <= y <= c.half + 1e-9):
                raise ValueError("Ironing path leaves the coupon")
            expected = c.roof_z(y, 2*c.layer_rise + c.ironing_z_offset)
            if abs(z - expected) > 1e-8:
                raise ValueError("Ironing move does not follow the final surface")
