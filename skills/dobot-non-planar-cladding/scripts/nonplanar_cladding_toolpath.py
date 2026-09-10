"""Canonical geometry for the first 20 mm, 10-degree cladding coupon."""

from __future__ import annotations

from dataclasses import dataclass
import math


@dataclass(frozen=True)
class Segment3:
    start: tuple[float, float, float]
    end: tuple[float, float, float]
    group: str
    layer: int
    speed: float


@dataclass(frozen=True)
class CladdingCouponGeometry:
    size: float = 20.0
    layer_rise: float = 0.70
    flat_roof_z: float = 4.20
    roof_angle_deg: float = 10.0
    solid_spacing: float = 0.78
    sparse_density: float = 0.25
    first_cladding_density: float = 0.50
    print_speed: float = 3.0

    @property
    def half(self) -> float:
        return self.size / 2.0

    @property
    def slope(self) -> float:
        return math.tan(math.radians(self.roof_angle_deg))

    @property
    def roof_rise(self) -> float:
        return self.size * self.slope

    @property
    def roof_high_z(self) -> float:
        return self.flat_roof_z + self.roof_rise

    @property
    def sparse_spacing(self) -> float:
        return self.solid_spacing / self.sparse_density

    @property
    def first_cladding_spacing(self) -> float:
        return self.solid_spacing / self.first_cladding_density

    @property
    def slope_speed(self) -> float:
        return self.print_speed * math.cos(math.radians(self.roof_angle_deg))

    def roof_z(self, x: float, offset: float = 0.0) -> float:
        return self.flat_roof_z + (x + self.half) * self.slope + offset


def even_positions(low: float, high: float, maximum_spacing: float) -> list[float]:
    intervals = max(1, math.ceil((high - low) / maximum_spacing))
    spacing = (high - low) / intervals
    return [low + index * spacing for index in range(intervals + 1)]


def _rectangle(x0: float, x1: float, y0: float, y1: float, z: float, layer: int) -> list[Segment3]:
    pts = [(x0,y0,z), (x1,y0,z), (x1,y1,z), (x0,y1,z), (x0,y0,z)]
    return [Segment3(a, b, "scaffold-perimeter", layer, 3.0) for a, b in zip(pts, pts[1:])]


def _raster(x0: float, x1: float, y0: float, y1: float, z: float, layer: int, along_x: bool, spacing: float, group: str) -> list[Segment3]:
    result: list[Segment3] = []
    positions = even_positions(y0, y1, spacing) if along_x else even_positions(x0, x1, spacing)
    for index, value in enumerate(positions):
        if along_x:
            a, b = (x0, value, z), (x1, value, z)
        else:
            a, b = (value, y0, z), (value, y1, z)
        if index % 2:
            a, b = b, a
        result.append(Segment3(a, b, group, layer, 3.0))
    return result


def build_coupon_paths(g: CladdingCouponGeometry | None = None) -> dict[str, list[Segment3]]:
    g = g or CladdingCouponGeometry()
    h = g.half
    paths: dict[str, list[Segment3]] = {}

    # Solid first layer: two boundary circuits plus calibrated dense raster.
    first = _rectangle(-h, h, -h, h, 0.0, 1)
    first += _rectangle(-h + g.solid_spacing, h - g.solid_spacing,
                        -h + g.solid_spacing, h - g.solid_spacing, 0.0, 1)
    first += _raster(-h + 1.40, h - 1.40, -h + 1.40, h - 1.40,
                     0.0, 1, True, g.solid_spacing, "solid-base")
    paths["solid-base"] = first

    # Open planar mesh body and the stepped support wedge below the exact roof.
    scaffold: list[Segment3] = []
    top_index = math.floor(g.roof_high_z / g.layer_rise + 1e-9)
    for index in range(1, top_index + 1):
        z = index * g.layer_rise
        x0 = -h if z <= g.flat_roof_z + 1e-9 else -h + (z - g.flat_roof_z) / g.slope
        x0 = max(-h, min(h, x0))
        layer = index + 1
        scaffold += _rectangle(x0, h, -h, h, z, layer)
        scaffold += _raster(x0, h, -h, h, z, layer, index % 2 == 1,
                            g.sparse_spacing, "open-mesh")
    paths["scaffold"] = scaffold

    # Layer A: 50% uphill/downhill X/Z strokes.
    layer_a: list[Segment3] = []
    for index, y in enumerate(reversed(even_positions(-h, h, g.first_cladding_spacing))):
        a = (-h, y, g.roof_z(-h))
        b = ( h, y, g.roof_z( h))
        # Begin at the high edge, adjacent to the final stepped-support layer.
        if index % 2 == 0:
            a, b = b, a
        layer_a.append(Segment3(a, b, "cladding-updown-50", 12, g.slope_speed))
    paths["cladding-a"] = layer_a

    # Layer B: full cross-slope Y strokes at constant Z for each X position.
    layer_b: list[Segment3] = []
    for index, x in enumerate(reversed(even_positions(-h, h, g.solid_spacing))):
        z = g.roof_z(x, g.layer_rise)
        a, b = (x, -h, z), (x, h, z)
        if index % 2:
            a, b = b, a
        layer_b.append(Segment3(a, b, "cladding-cross-solid", 13, g.print_speed))
    paths["cladding-b"] = layer_b

    # Layer C: full uphill/downhill X/Z strokes.
    layer_c: list[Segment3] = []
    for index, y in enumerate(reversed(even_positions(-h, h, g.solid_spacing))):
        a = (-h, y, g.roof_z(-h, 2*g.layer_rise))
        b = ( h, y, g.roof_z( h, 2*g.layer_rise))
        if index % 2:
            a, b = b, a
        layer_c.append(Segment3(a, b, "cladding-updown-solid", 14, g.slope_speed))
    paths["cladding-c"] = layer_c
    return paths


def rotate_paths_to_y_slope(paths: dict[str, list[Segment3]]) -> dict[str, list[Segment3]]:
    """Rotate canonical X-slope paths +90 degrees so slope runs along Y."""
    def rotate_point(point: tuple[float, float, float]) -> tuple[float, float, float]:
        x, y, z = point
        return -y, x, z
    return {
        name: [Segment3(rotate_point(s.start), rotate_point(s.end), s.group, s.layer, s.speed) for s in segments]
        for name, segments in paths.items()
    }


def build_y_slope_coupon_paths(g: CladdingCouponGeometry) -> dict[str, list[Segment3]]:
    paths = rotate_paths_to_y_slope(build_coupon_paths(g))

    # Preserve forward continuity after rotation: support finishes at the high
    # +X corner, then A runs high-to-low, B returns low-to-high, and C starts
    # at that same high corner. Reversing a segment swaps only traversal, not
    # deposited geometry.
    def reverse_segment(s: Segment3) -> Segment3:
        return Segment3(s.end, s.start, s.group, s.layer, s.speed)

    paths["cladding-a"] = list(reversed(paths["cladding-a"]))
    paths["cladding-b"] = [reverse_segment(s) for s in reversed(paths["cladding-b"])]
    paths["cladding-c"] = [reverse_segment(s) for s in reversed(paths["cladding-c"])]

    # Start the first scaffold perimeter at the corner nearest the final base
    # raster endpoint, avoiding a diagonal traversal across the entire coupon.
    first_perimeter = paths["scaffold"][:4]
    paths["scaffold"][:4] = first_perimeter[2:] + first_perimeter[:2]
    return paths


def validate_coupon(g: CladdingCouponGeometry, paths: dict[str, list[Segment3]]) -> None:
    tol = 1e-8
    for segment in (s for group in paths.values() for s in group):
        for x, y, z in (segment.start, segment.end):
            if not (-g.half - tol <= x <= g.half + tol and -g.half - tol <= y <= g.half + tol):
                raise ValueError("Coupon path escapes the 20 mm XY footprint")
            if z < -tol:
                raise ValueError("Coupon path moves below the bed")
    for key, offset in (("cladding-a", 0.0), ("cladding-b", g.layer_rise), ("cladding-c", 2*g.layer_rise)):
        for segment in paths[key]:
            for x, _, z in (segment.start, segment.end):
                if abs(z - g.roof_z(x, offset)) > tol:
                    raise ValueError(f"{key} leaves its intended heightfield")
    if any(abs(math.hypot(s.end[0]-s.start[0], s.end[2]-s.start[2]) - g.size/math.cos(math.radians(g.roof_angle_deg))) > 1e-6
           for s in paths["cladding-a"]):
        raise ValueError("Uphill/downhill stroke length is inconsistent")
