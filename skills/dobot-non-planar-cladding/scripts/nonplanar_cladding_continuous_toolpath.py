"""Corner-continuous 40 mm / 20 degree non-planar demo geometry."""

from __future__ import annotations

from dataclasses import dataclass
import math

from nonplanar_cladding_toolpath import even_positions


Point3 = tuple[float, float, float]


@dataclass(frozen=True)
class ContinuousLayer:
    number: int
    name: str
    points: tuple[Point3, ...]
    speed: float


@dataclass(frozen=True)
class ContinuousCoupon:
    size: float = 40.0
    angle_deg: float = 20.0
    layer_rise: float = 0.70
    solid_spacing: float = 0.78
    sparse_spacing: float = 3.12
    slope_begins_z: float = 0.70
    print_speed: float = 3.0

    @property
    def half(self) -> float:
        return self.size / 2.0

    @property
    def slope(self) -> float:
        return math.tan(math.radians(self.angle_deg))

    @property
    def roof_high_z(self) -> float:
        return self.slope_begins_z + self.size * self.slope

    def roof_z(self, y: float, offset: float = 0.0) -> float:
        return self.slope_begins_z + (y + self.half) * self.slope + offset


def _raster_candidates(
    x0: float,
    x1: float,
    y0: float,
    y1: float,
    spacing: float,
    along_x: bool,
    z_at,
) -> list[list[Point3]]:
    positions = even_positions(y0, y1, spacing) if along_x else even_positions(x0, x1, spacing)
    candidates: list[list[Point3]] = []
    for reverse_rows in (False, True):
        rows = list(reversed(positions)) if reverse_rows else positions
        for reverse_first in (False, True):
            points: list[Point3] = []
            for index, value in enumerate(rows):
                if along_x:
                    a = (x0, value, z_at(x0, value))
                    b = (x1, value, z_at(x1, value))
                else:
                    a = (value, y0, z_at(value, y0))
                    b = (value, y1, z_at(value, y1))
                if bool(index % 2) ^ reverse_first:
                    a, b = b, a
                if not points:
                    points.append(a)
                points.append(b)
                if index + 1 < len(rows):
                    next_value = rows[index + 1]
                    if along_x:
                        points.append((b[0], next_value, z_at(b[0], next_value)))
                    else:
                        points.append((next_value, b[1], z_at(next_value, b[1])))
            candidates.append(points)
    return candidates


def _nearest_candidate(candidates: list[list[Point3]], previous: Point3 | None) -> list[Point3]:
    if previous is None:
        return candidates[0]
    return min(candidates, key=lambda pts: math.dist(previous, pts[0]))


def _inherit_previous_endpoint(points: list[Point3], previous: Point3 | None) -> list[Point3]:
    """Start the new layer at the exact endpoint of the previous layer.

    The Z rise and any small wedge-edge retreat are blended into the first
    structural raster stroke instead of emitted as a standalone layer-shift
    command.
    """
    if previous is not None:
        points[0] = previous
    return points


def build_continuous_coupon(c: ContinuousCoupon | None = None) -> list[ContinuousLayer]:
    c = c or ContinuousCoupon()
    h = c.half
    layers: list[ContinuousLayer] = []
    previous: Point3 | None = None

    # Layer 1: dense raster only. There are no outer or inner perimeter loops.
    points = _nearest_candidate(
        _raster_candidates(-h, h, -h, h, c.solid_spacing, True, lambda _x, _y: 0.0),
        previous,
    )
    layers.append(ContinuousLayer(1, "solid base — X", tuple(points), c.print_speed))
    previous = points[-1]

    # Layer 2 is the only full rectangular sparse layer. The 20-degree stepped
    # wedge begins on layer 3, alternating X and Y rasters without perimeters.
    top_index = math.floor(c.roof_high_z / c.layer_rise + 1e-9)
    for number in range(2, top_index + 2):
        z = (number - 1) * c.layer_rise
        y0 = -h if number == 2 else -h + (z - c.slope_begins_z) / c.slope
        y0 = max(-h, min(h, y0))
        # Layer 1 runs along X, so layer 2 must run along Y. Continue strict
        # perpendicular alternation throughout the sparse wedge.
        along_x = number % 2 == 1
        points = _inherit_previous_endpoint(_nearest_candidate(
            _raster_candidates(-h, h, y0, h, c.sparse_spacing, along_x, lambda _x, _y, z=z: z),
            previous,
        ), previous)
        layers.append(ContinuousLayer(number, "25% mesh — " + ("X" if along_x else "Y"), tuple(points), c.print_speed))
        previous = points[-1]

    # Retain the successful three-skin schedule: 50% along the Y/Z slope,
    # followed by solid X and solid Y/Z finishing skins.
    schedules = (
        ("50% skin — Y/Z", False, c.solid_spacing / 0.50, 0.0, c.print_speed * math.cos(math.radians(c.angle_deg))),
        ("solid skin — X", True, c.solid_spacing, c.layer_rise, c.print_speed),
        ("solid finish — Y/Z", False, c.solid_spacing, 2 * c.layer_rise, c.print_speed * math.cos(math.radians(c.angle_deg))),
    )
    number = layers[-1].number
    for name, along_x, spacing, offset, speed in schedules:
        number += 1
        points = _inherit_previous_endpoint(_nearest_candidate(
            _raster_candidates(-h, h, -h, h, spacing, along_x,
                               lambda _x, y, offset=offset: c.roof_z(y, offset)),
            previous,
        ), previous)
        layers.append(ContinuousLayer(number, name, tuple(points), speed))
        previous = points[-1]
    return layers


def transition_distances(layers: list[ContinuousLayer]) -> list[float]:
    return [math.dist(a.points[-1], b.points[0]) for a, b in zip(layers, layers[1:])]


def validate_continuous_coupon(c: ContinuousCoupon, layers: list[ContinuousLayer]) -> None:
    if layers[0].name != "solid base — X":
        raise ValueError("Layer 1 must be the solid perimeterless base")
    if layers[2].number != 3 or "mesh" not in layers[2].name:
        raise ValueError("The angled mesh must begin on layer 3")
    for layer in layers:
        for x, y, z in layer.points:
            if not (-c.half - 1e-8 <= x <= c.half + 1e-8):
                raise ValueError("X leaves coupon")
            if not (-c.half - 1e-8 <= y <= c.half + 1e-8):
                raise ValueError("Y leaves coupon")
            if z < -1e-8:
                raise ValueError("Z leaves coupon")
    # Every layer inherits the exact prior endpoint. Its Z rise and small
    # wedge-edge retreat occur during the first structural stroke, not as a
    # separate command that can dwell.
    if max(transition_distances(layers)) > 1e-8:
        raise ValueError("A layer does not inherit the preceding endpoint")
