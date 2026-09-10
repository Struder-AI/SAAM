"""Canonical 60 mm circular walled-truss toolpath for preview and Lua."""

from __future__ import annotations

from dataclasses import dataclass
import math

from bounded_triangular_toolpath import (
    Calibration,
    Move,
    PathBuilder,
    Point,
    polar,
    validate_controller_path,
)


@dataclass(frozen=True)
class WalledTrussGeometry:
    guide_radius: float = 30.0
    envelope: float = 8.0
    spacing: float = 0.78
    bead_width: float = 0.83
    inner_walls: int = 1
    outer_walls: int = 1
    turn_radius: float = 2.0
    # Robot-requested allowance: overlap half of the measured 0.83 mm bead so
    # cooling contraction cannot pull the truss turnarounds clear of the skins.
    tie_overlap: float = 0.415
    # Re-evaluated from the complete available core after applying wall overlap.
    repeat_count: int = 8
    total_height: float = 10.0
    patterned_layers: int = 14

    @property
    def inner_wall(self) -> float:
        return self.guide_radius - self.envelope / 2.0

    @property
    def outer_wall(self) -> float:
        return self.guide_radius + self.envelope / 2.0

    @property
    def inner_apex(self) -> float:
        return self.inner_wall + self.bead_width - self.tie_overlap

    @property
    def outer_apex(self) -> float:
        return self.outer_wall - self.bead_width + self.tie_overlap

    @property
    def inner_turn_center(self) -> float:
        return self.inner_apex + self.turn_radius

    @property
    def outer_turn_center(self) -> float:
        return self.outer_apex - self.turn_radius

    @property
    def step(self) -> float:
        return 2.0 * math.pi / self.repeat_count

    @property
    def repeat_interval(self) -> float:
        return 2.0 * math.pi * self.guide_radius / self.repeat_count

    @property
    def layer_rise(self) -> float:
        return self.total_height / self.patterned_layers


def _unit(a: Point, b: Point) -> tuple[float, float]:
    dx, dy = b.x - a.x, b.y - a.y
    length = math.hypot(dx, dy)
    return dx / length, dy / length


def _dot(a: tuple[float, float], b: tuple[float, float]) -> float:
    return a[0] * b[0] + a[1] * b[1]


def _internal_tangent(
    start_center: Point,
    end_center: Point,
    radius: float,
    *,
    start_is_outer: bool,
) -> tuple[Point, Point]:
    ux, uy = _unit(start_center, end_center)
    center_distance = math.hypot(
        end_center.x - start_center.x,
        end_center.y - start_center.y,
    )
    ratio = 2.0 * radius / center_distance
    if ratio >= 1.0:
        raise ValueError("Two 2 mm turnaround circles leave no straight tangent span")
    perpendicular = (-uy, ux)
    lateral = math.sqrt(1.0 - ratio * ratio)
    normals = (
        (ratio * ux + lateral * perpendicular[0], ratio * uy + lateral * perpendicular[1]),
        (ratio * ux - lateral * perpendicular[0], ratio * uy - lateral * perpendicular[1]),
    )
    rs = _unit(Point(0.0, 0.0), start_center)
    def score(normal: tuple[float, float]) -> float:
        value = _dot(normal, rs)
        return value if start_is_outer else -value

    nx, ny = max(normals, key=score)
    return (
        Point(start_center.x + radius * nx, start_center.y + radius * ny),
        Point(end_center.x - radius * nx, end_center.y - radius * ny),
    )


def _line_intersection(a: Point, b: Point, c: Point, d: Point) -> Point:
    denominator = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x)
    if abs(denominator) < 1.0e-9:
        raise ValueError("Truss legs do not define a virtual apex")
    ab = a.x * b.y - a.y * b.x
    cd = c.x * d.y - c.y * d.x
    return Point(
        (ab * (c.x - d.x) - (a.x - b.x) * cd) / denominator,
        (ab * (c.y - d.y) - (a.y - b.y) * cd) / denominator,
    )


def _vertex_angle(a: Point, vertex: Point, b: Point) -> float:
    va = (a.x - vertex.x, a.y - vertex.y)
    vb = (b.x - vertex.x, b.y - vertex.y)
    cosine = _dot(va, vb) / (math.hypot(*va) * math.hypot(*vb))
    return math.degrees(math.acos(max(-1.0, min(1.0, cosine))))


def _minor_midpoint(center: Point, start: Point, end: Point, radius: float) -> Point:
    sx, sy = (start.x - center.x) / radius, (start.y - center.y) / radius
    ex, ey = (end.x - center.x) / radius, (end.y - center.y) / radius
    mx, my = sx + ex, sy + ey
    length = math.hypot(mx, my)
    if length < 1.0e-8:
        raise ValueError("Turnaround half-arc is ambiguous")
    return Point(center.x + radius * mx / length, center.y + radius * my / length)


def _append_turn(
    builder: PathBuilder,
    center: Point,
    apex: Point,
    end: Point,
    layer: int,
    speed: float,
    radius: float,
) -> None:
    if builder.current is None:
        raise ValueError("Turnaround requires a current point")
    # With the correct internal tangent branch the requested wall-contact apex
    # lies on the minor cap between the two straight legs, so one Arc3 carries
    # the entire smooth turnaround without tiny half-arc commands.
    builder.arc3(apex, end, "turnback", layer, speed)


def _zigzag_moves(
    g: WalledTrussGeometry,
    calibration: Calibration,
    phase: float,
    layer: int,
    speed: float,
) -> tuple[list[Move], float]:
    step, half = g.step, g.step / 2.0

    def outer_center(angle: float) -> Point:
        return polar(g.outer_turn_center, angle)

    def inner_center(angle: float) -> Point:
        return polar(g.inner_turn_center, angle)

    def connection(outer_angle: float, inner_angle: float) -> tuple[Point, Point]:
        return _internal_tangent(
            outer_center(outer_angle),
            inner_center(inner_angle),
            g.turn_radius,
            start_is_outer=True,
        )

    incoming_inner, first_outer = _internal_tangent(
        inner_center(phase - half),
        outer_center(phase),
        g.turn_radius,
        start_is_outer=False,
    )
    builder = PathBuilder(calibration)
    builder.current = first_outer

    for index in range(g.repeat_count):
        outer_angle = phase + index * step
        inner_angle = outer_angle + half
        next_outer_angle = outer_angle + step

        _, outer_in = _internal_tangent(
            inner_center(outer_angle - half),
            outer_center(outer_angle),
            g.turn_radius,
            start_is_outer=False,
        )
        outer_out, inner_in = connection(outer_angle, inner_angle)
        _append_turn(
            builder,
            outer_center(outer_angle),
            polar(g.outer_apex, outer_angle),
            outer_out,
            layer,
            speed,
            g.turn_radius,
        )
        builder.line_to(inner_in, "diagonal", layer, speed)

        inner_out, outer_next = _internal_tangent(
            inner_center(inner_angle),
            outer_center(next_outer_angle),
            g.turn_radius,
            start_is_outer=False,
        )
        _append_turn(
            builder,
            inner_center(inner_angle),
            polar(g.inner_apex, inner_angle),
            inner_out,
            layer,
            speed,
            g.turn_radius,
        )
        builder.line_to(outer_next, "diagonal", layer, speed)

    previous_inner, previous_outer = _internal_tangent(
        inner_center(phase - half),
        outer_center(phase),
        g.turn_radius,
        start_is_outer=False,
    )
    outgoing_outer, outgoing_inner = connection(phase, phase + half)
    virtual = _line_intersection(previous_inner, previous_outer, outgoing_outer, outgoing_inner)
    angle = _vertex_angle(previous_inner, virtual, outgoing_inner)
    validate_controller_path(builder.moves, calibration)
    return builder.moves, angle


def _append(builder: PathBuilder, moves: list[Move]) -> None:
    for move in moves:
        if builder.current is None:
            builder.current = move.start
        elif math.hypot(builder.current.x - move.start.x, builder.current.y - move.start.y) > 1.0e-5:
            builder.line_to(move.start, "tie-in", move.layer, move.speed)
        if move.kind == "line":
            builder.line_to(move.end, move.group, move.layer, move.speed)
        else:
            builder.arc3(move.midpoint, move.end, move.group, move.layer, move.speed)


def build_pattern_layer(
    g: WalledTrussGeometry,
    calibration: Calibration,
    phase: float,
    layer: int,
    speed: float,
    *,
    outer_first: bool,
) -> tuple[list[Move], float]:
    """Build one complete skin/truss/skin layer at an unwrapped forward phase."""
    zigzag, apex_angle = _zigzag_moves(g, calibration, phase, layer, speed)
    builder = PathBuilder(calibration)
    if outer_first:
        builder.current = polar(g.outer_wall, phase)
        builder.circular_arc(Point(0, 0), g.outer_wall, phase, 2 * math.pi, "perimeter", layer, 3.0)
        builder.line_to(zigzag[0].start, "tie-in", layer, speed)
        _append(builder, zigzag)
        angle = math.atan2(builder.current.y, builder.current.x)
        builder.line_to(polar(g.inner_wall, angle), "tie-in", layer, speed)
        builder.circular_arc(Point(0, 0), g.inner_wall, angle, 2 * math.pi, "perimeter", layer, 3.0)
    else:
        reverse = [
            Move(move.kind, move.end, move.start, move.midpoint, move.group, layer, speed)
            for move in reversed(zigzag)
        ]
        builder.current = polar(g.inner_wall, phase)
        builder.circular_arc(Point(0, 0), g.inner_wall, phase, 2 * math.pi, "perimeter", layer, 3.0)
        builder.line_to(reverse[0].start, "tie-in", layer, speed)
        _append(builder, reverse)
        angle = math.atan2(builder.current.y, builder.current.x)
        builder.line_to(polar(g.outer_wall, angle), "tie-in", layer, speed)
        builder.circular_arc(Point(0, 0), g.outer_wall, angle, 2 * math.pi, "perimeter", layer, 3.0)
    validate_controller_path(builder.moves, calibration)
    return builder.moves, apex_angle


def build_walled_truss_preview():
    g, calibration = WalledTrussGeometry(), Calibration()
    paths: dict[str, list[Move]] = {}

    foundation = PathBuilder(calibration)
    foundation_intervals = math.ceil(g.envelope / g.spacing)
    foundation_spacing = g.envelope / foundation_intervals
    radii = list(reversed([
        g.inner_wall + index * foundation_spacing
        for index in range(foundation_intervals + 1)
    ]))
    foundation.current = polar(radii[0], 0.0)
    for index, radius in enumerate(radii):
        if index:
            foundation.line_to(polar(radius, 0.0), "foundation-link", 0, 3.0)
        foundation.circular_arc(Point(0, 0), radius, 0.0, 2.0 * math.pi, "foundation", 0, 3.0)
    foundation.line_to(polar(g.outer_wall, 0.0), "foundation-link", 0, 3.0)
    validate_controller_path(foundation.moves, calibration)
    paths["foundation"] = foundation.moves

    angles = []
    for name, phase, layer, speed in (
        ("pattern-a", 0.0, 1, 3.0),
        ("pattern-b", g.step / 2.0, 2, 1.5),
        ("pattern-a-later", 0.0, 3, 1.5),
    ):
        moves, apex_angle = build_pattern_layer(
            g, calibration, phase, layer, speed, outer_first=name.startswith("pattern-a")
        )
        angles.append(apex_angle)
        paths[name] = moves

    return g, calibration, paths, sum(angles) / len(angles)
