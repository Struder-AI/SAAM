"""Canonical bounded triangular-wall path and Dobot Arc3 reconstruction.

The same move list is intended to drive previews, validation, and Lua export.
All predicted paths are reconstructed from the calibrated controller points
that Dobot's Arc3/MovL commands actually receive.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Callable, Iterable


@dataclass(frozen=True)
class Point:
    x: float
    y: float
    z: float = 0.0


@dataclass(frozen=True)
class Calibration:
    x_scale: float = 1.0
    y_scale_at_x0: float = 0.8265
    y_scale_per_x_mm: float = 0.000478

    def forward(self, p: Point) -> Point:
        return Point(
            p.x * self.x_scale,
            p.y * (self.y_scale_at_x0 + self.y_scale_per_x_mm * p.x),
            p.z,
        )

    def inverse(self, p: Point) -> Point:
        x = p.x / self.x_scale
        scale = self.y_scale_at_x0 + self.y_scale_per_x_mm * x
        return Point(x, p.y / scale, p.z)


@dataclass(frozen=True)
class Move:
    kind: str
    start: Point
    end: Point
    midpoint: Point | None
    group: str
    layer: int
    speed: float


@dataclass(frozen=True)
class Geometry:
    guide_radius: float = 30.0
    envelope: float = 8.0
    spacing: float = 0.78
    bead_width: float = 0.83
    inner_perimeters: int = 1
    outer_perimeters: int = 2
    repeat_count: int = 28
    fillet_fraction: float = 0.10
    couching_overlap: float = 0.05
    layer_rise: float = 10.0 / 14.0

    @property
    def inner_perimeter(self) -> float:
        return self.guide_radius - self.envelope / 2.0

    @property
    def outer_perimeter_1(self) -> float:
        return self.guide_radius + self.envelope / 2.0

    @property
    def outer_perimeter_2(self) -> float:
        return self.outer_perimeter_1 - self.spacing

    @property
    def inner_core(self) -> float:
        return self.inner_perimeter + self.inner_perimeters * self.spacing

    @property
    def outer_core(self) -> float:
        return self.outer_perimeter_1 - self.outer_perimeters * self.spacing

    @property
    def core_width(self) -> float:
        return self.outer_core - self.inner_core

    @property
    def fillet_radius(self) -> float:
        return self.core_width * self.fillet_fraction


def polar(radius: float, angle: float, z: float = 0.0) -> Point:
    return Point(radius * math.cos(angle), radius * math.sin(angle), z)


def unit_between(a: Point, b: Point) -> tuple[float, float]:
    dx, dy = b.x - a.x, b.y - a.y
    length = math.hypot(dx, dy)
    return dx / length, dy / length


def offset(p: Point, direction: tuple[float, float], distance: float) -> Point:
    return Point(p.x + direction[0] * distance, p.y + direction[1] * distance, p.z)


def circle_through(a: Point, b: Point, c: Point) -> tuple[Point, float]:
    d = 2.0 * (
        a.x * (b.y - c.y)
        + b.x * (c.y - a.y)
        + c.x * (a.y - b.y)
    )
    if abs(d) < 1.0e-9:
        raise ValueError("Arc3 points are collinear")
    aa, bb, cc = a.x * a.x + a.y * a.y, b.x * b.x + b.y * b.y, c.x * c.x + c.y * c.y
    ux = (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d
    uy = (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d
    center = Point(ux, uy, a.z)
    return center, math.hypot(a.x - ux, a.y - uy)


def _ccw_delta(a: float, b: float) -> float:
    return (b - a) % (2.0 * math.pi)


def arc_angles(start: Point, midpoint: Point, end: Point) -> tuple[Point, float, float, float]:
    center, radius = circle_through(start, midpoint, end)
    a0 = math.atan2(start.y - center.y, start.x - center.x)
    am = math.atan2(midpoint.y - center.y, midpoint.x - center.x)
    a1 = math.atan2(end.y - center.y, end.x - center.x)
    ccw_total = _ccw_delta(a0, a1)
    ccw_mid = _ccw_delta(a0, am)
    sweep = ccw_total if ccw_mid <= ccw_total + 1.0e-9 else -(2.0 * math.pi - ccw_total)
    return center, radius, a0, sweep


def sample_move(move: Move, calibration: Calibration, samples: int = 25) -> list[Point]:
    if move.kind == "line":
        a, b = calibration.forward(move.start), calibration.forward(move.end)
        return [
            calibration.inverse(Point(
                a.x + (b.x - a.x) * t,
                a.y + (b.y - a.y) * t,
                a.z + (b.z - a.z) * t,
            ))
            for t in (i / samples for i in range(samples + 1))
        ]
    if move.midpoint is None:
        raise ValueError("Arc3 move is missing a midpoint")
    a = calibration.forward(move.start)
    m = calibration.forward(move.midpoint)
    b = calibration.forward(move.end)
    center, radius, angle, sweep = arc_angles(a, m, b)
    points = []
    for i in range(samples + 1):
        t = i / samples
        q = Point(
            center.x + radius * math.cos(angle + sweep * t),
            center.y + radius * math.sin(angle + sweep * t),
            a.z + (b.z - a.z) * t,
        )
        points.append(calibration.inverse(q))
    return points


def validate_controller_arc(move: Move, calibration: Calibration) -> None:
    """Reject Arc3 triples that are valid mathematically but risky for MG400.

    The limits deliberately catch the three near-degenerate seam arcs that
    produced the 2026-08-04 controller alarm, while leaving the robot-tested
    foundation, pattern, perimeter, and rising-transition arcs unchanged.
    """
    if move.kind != "arc3":
        return
    if move.midpoint is None:
        raise ValueError("Arc3 move is missing a midpoint")

    start = calibration.forward(move.start)
    midpoint = calibration.forward(move.midpoint)
    end = calibration.forward(move.end)
    twice_area = abs(
        (midpoint.x - start.x) * (end.y - start.y)
        - (midpoint.y - start.y) * (end.x - start.x)
    )
    _, radius, _, sweep = arc_angles(start, midpoint, end)
    chord = math.hypot(end.x - start.x, end.y - start.y)

    if twice_area < 0.05:
        raise ValueError(
            f"Controller-risk Arc3: calibrated area {twice_area:.6f} < 0.05"
        )
    if chord < 0.15:
        raise ValueError(
            f"Controller-risk Arc3: calibrated chord {chord:.6f} < 0.15 mm"
        )
    if radius < 0.25 or radius > 75.0:
        raise ValueError(
            f"Controller-risk Arc3: reconstructed radius {radius:.6f} mm"
        )
    if abs(sweep) < math.radians(0.5) or abs(sweep) > math.radians(200.0):
        raise ValueError(
            f"Controller-risk Arc3: reconstructed sweep {math.degrees(sweep):.6f} deg"
        )


def validate_controller_path(moves: Iterable[Move], calibration: Calibration) -> None:
    previous: Move | None = None
    for index, move in enumerate(moves, start=1):
        if previous is not None:
            gap = math.hypot(
                previous.end.x - move.start.x,
                previous.end.y - move.start.y,
            )
            if gap > 1.0e-5:
                raise ValueError(
                    f"Discontinuous move {index}: start gap {gap:.6f} mm"
                )
        validate_controller_arc(move, calibration)
        previous = move


def _circle_centers(a: Point, b: Point, radius: float) -> list[Point]:
    dx, dy = b.x - a.x, b.y - a.y
    chord = math.hypot(dx, dy)
    if chord > 2.0 * radius + 1.0e-9:
        raise ValueError("Chord is longer than the requested arc diameter")
    mx, my = (a.x + b.x) / 2.0, (a.y + b.y) / 2.0
    height = math.sqrt(max(0.0, radius * radius - chord * chord / 4.0))
    nx, ny = -dy / chord, dx / chord
    return [Point(mx + height * nx, my + height * ny), Point(mx - height * nx, my - height * ny)]


def _signed_angle(value: float) -> float:
    return (value + math.pi) % (2.0 * math.pi) - math.pi


def tangent_fillet_points(
    boundary_radius: float,
    vertex_angle: float,
    diagonal_target: Point,
    fillet_radius: float,
    *,
    outer_boundary: bool,
    departure: bool,
) -> tuple[Point, Point, Point, float]:
    """Construct a true minor fillet tangent to a circle and diagonal.

    Departures return boundary -> arc midpoint -> diagonal. Arrivals return
    diagonal -> arc midpoint -> boundary. The boundary endpoint remains on its
    exact concentric circle; no arc is forced through the sharp vertex.
    """
    vertex = polar(boundary_radius, vertex_angle)
    direction = unit_between(vertex, diagonal_target)
    normal = (-direction[1], direction[0])
    center_radius = boundary_radius - fillet_radius if outer_boundary else boundary_radius + fillet_radius
    wanted_delta_sign = -1.0 if departure else 1.0
    candidates: list[tuple[float, Point, Point, Point, float]] = []

    for side in (-1.0, 1.0):
        qx = vertex.x + normal[0] * side * fillet_radius
        qy = vertex.y + normal[1] * side * fillet_radius
        qb = 2.0 * (qx * direction[0] + qy * direction[1])
        qc = qx * qx + qy * qy - center_radius * center_radius
        discriminant = qb * qb - 4.0 * qc
        if discriminant < 0.0:
            continue
        for distance in (
            (-qb + math.sqrt(discriminant)) / 2.0,
            (-qb - math.sqrt(discriminant)) / 2.0,
        ):
            if distance <= 1.0e-5:
                continue
            center = Point(qx + direction[0] * distance, qy + direction[1] * distance)
            boundary = Point(
                center.x * boundary_radius / center_radius,
                center.y * boundary_radius / center_radius,
            )
            diagonal = offset(vertex, direction, distance)
            delta = _signed_angle(math.atan2(boundary.y, boundary.x) - vertex_angle)
            if delta * wanted_delta_sign <= 0.0 or abs(delta) > 0.25:
                continue
            candidates.append((distance, center, boundary, diagonal, delta))

    if not candidates:
        raise ValueError("No local tangent circle/diagonal fillet exists")
    _, center, boundary, diagonal, delta = min(candidates, key=lambda item: item[0])
    start, end = (boundary, diagonal) if departure else (diagonal, boundary)
    a0 = math.atan2(start.y - center.y, start.x - center.x)
    a1 = math.atan2(end.y - center.y, end.x - center.x)
    sweep = _signed_angle(a1 - a0)
    midpoint = Point(
        center.x + fillet_radius * math.cos(a0 + sweep / 2.0),
        center.y + fillet_radius * math.sin(a0 + sweep / 2.0),
    )
    fitted_center, fitted_radius = circle_through(start, midpoint, end)
    if abs(fitted_radius - fillet_radius) > 1.0e-6:
        raise ValueError("Tangent fillet reconstruction failed")
    return start, midpoint, end, delta


def solve_couching_shifts(g: Geometry) -> tuple[float, float]:
    """Solve virtual endpoint overlap for mutually tangent rounded apexes.

    The two sharp endpoints at each nominal apex are moved past one another.
    After tangent trimming, their boundary-tangent endpoints overlap by the
    requested physical couching amount. Outer and inner shifts are coupled
    because every diagonal joins one shifted endpoint on each boundary.
    """
    half = math.pi / g.repeat_count

    def residual(outer_shift: float, inner_shift: float) -> tuple[float, float]:
        outer_depart = tangent_fillet_points(
            g.outer_core,
            outer_shift,
            polar(g.inner_core, -half - inner_shift),
            g.fillet_radius,
            outer_boundary=True,
            departure=True,
        )
        outer_arrive = tangent_fillet_points(
            g.outer_core,
            -outer_shift,
            polar(g.inner_core, half + inner_shift),
            g.fillet_radius,
            outer_boundary=True,
            departure=False,
        )
        inner_arrive = tangent_fillet_points(
            g.inner_core,
            -inner_shift,
            polar(g.outer_core, half + outer_shift),
            g.fillet_radius,
            outer_boundary=False,
            departure=False,
        )
        inner_depart = tangent_fillet_points(
            g.inner_core,
            inner_shift,
            polar(g.outer_core, -half - outer_shift),
            g.fillet_radius,
            outer_boundary=False,
            departure=True,
        )
        angle = lambda p: math.atan2(p.y, p.x)
        return (
            angle(outer_arrive[2])
            - angle(outer_depart[0])
            + g.couching_overlap / g.outer_core,
            angle(inner_arrive[2])
            - angle(inner_depart[0])
            + g.couching_overlap / g.inner_core,
        )

    outer_shift = inner_shift = math.radians(3.0)
    epsilon = 1.0e-5
    for _ in range(30):
        f0, f1 = residual(outer_shift, inner_shift)
        if max(abs(f0), abs(f1)) < 1.0e-12:
            break
        fo0, fo1 = residual(outer_shift + epsilon, inner_shift)
        fi0, fi1 = residual(outer_shift, inner_shift + epsilon)
        j00, j10 = (fo0 - f0) / epsilon, (fo1 - f1) / epsilon
        j01, j11 = (fi0 - f0) / epsilon, (fi1 - f1) / epsilon
        determinant = j00 * j11 - j01 * j10
        if abs(determinant) < 1.0e-12:
            raise ValueError("Couching-shift solve became singular")
        outer_shift += (-f0 * j11 + f1 * j01) / determinant
        inner_shift += (-f1 * j00 + f0 * j10) / determinant
    else:
        raise ValueError("Couching-shift solve did not converge")

    if not (0.0 < outer_shift < half and 0.0 < inner_shift < half):
        raise ValueError("Couching overlap consumes the available repeat pitch")
    return outer_shift, inner_shift


class PathBuilder:
    def __init__(self, calibration: Calibration, tolerance: float = 0.04):
        self.calibration = calibration
        self.tolerance = tolerance
        self.moves: list[Move] = []
        self.current: Point | None = None

    def line_to(self, end: Point, group: str, layer: int, speed: float) -> None:
        if self.current is None:
            self.current = end
            return
        self.moves.append(Move("line", self.current, end, None, group, layer, speed))
        self.current = end

    def arc3(self, midpoint: Point, end: Point, group: str, layer: int, speed: float) -> None:
        if self.current is None:
            raise ValueError("Arc3 requires a current start point")
        self.moves.append(Move("arc3", self.current, end, midpoint, group, layer, speed))
        self.current = end

    def circular_arc(
        self,
        center: Point,
        radius: float,
        start_angle: float,
        sweep: float,
        group: str,
        layer: int,
        speed: float,
    ) -> None:
        def add(a0: float, sw: float) -> None:
            if abs(sw) >= 2.0 * math.pi - 1.0e-9:
                add(a0, sw / 2.0)
                add(a0 + sw / 2.0, sw / 2.0)
                return
            start = Point(center.x + radius * math.cos(a0), center.y + radius * math.sin(a0), center.z)
            middle = Point(center.x + radius * math.cos(a0 + sw / 2.0), center.y + radius * math.sin(a0 + sw / 2.0), center.z)
            end = Point(center.x + radius * math.cos(a0 + sw), center.y + radius * math.sin(a0 + sw), center.z)
            candidate = Move("arc3", start, end, middle, group, layer, speed)
            predicted = sample_move(candidate, self.calibration, 16)
            error = max(abs(math.hypot(p.x - center.x, p.y - center.y) - radius) for p in predicted)
            if error > self.tolerance and abs(sw) > math.radians(2.0):
                add(a0, sw / 2.0)
                add(a0 + sw / 2.0, sw / 2.0)
                return
            if self.current is None:
                self.current = start
            elif math.hypot(self.current.x - start.x, self.current.y - start.y) > 1.0e-5:
                self.line_to(start, "transition", layer, speed)
            self.arc3(middle, end, group, layer, speed)
        add(start_angle, sweep)

    def exact_vertex_arc(
        self,
        start: Point,
        vertex: Point,
        end: Point,
        group: str,
        layer: int,
        speed: float,
    ) -> None:
        center, radius, angle, sweep = arc_angles(start, vertex, end)
        self.circular_arc(center, radius, angle, sweep, group, layer, speed)


def build_preview_paths() -> tuple[Geometry, Calibration, dict[str, list[Move]]]:
    g, calibration = Geometry(), Calibration()
    step = 2.0 * math.pi / g.repeat_count
    half = step / 2.0
    outer_shift, inner_shift = solve_couching_shifts(g)
    def fillet(radius: float, angle: float, target: Point, outer: bool, departure: bool):
        return tangent_fillet_points(
            radius,
            angle,
            target,
            g.fillet_radius,
            outer_boundary=outer,
            departure=departure,
        )

    def add_fillet(builder: PathBuilder, data, layer: int, speed: float) -> None:
        start, midpoint, end, _ = data
        if builder.current is None:
            builder.current = start
        elif math.hypot(builder.current.x - start.x, builder.current.y - start.y) > 1.0e-5:
            builder.line_to(start, "diagonal", layer, speed)
        builder.arc3(midpoint, end, "turnback", layer, speed)

    def outer_arrival(phase: float):
        return fillet(
            g.outer_core,
            phase - outer_shift,
            polar(g.inner_core, phase + half + inner_shift),
            True,
            False,
        )

    def outer_departure(phase: float):
        return fillet(
            g.outer_core,
            phase + outer_shift,
            polar(g.inner_core, phase - half - inner_shift),
            True,
            True,
        )

    def inner_arrival(phase: float):
        return fillet(
            g.inner_core,
            phase - inner_shift,
            polar(g.outer_core, phase + half + outer_shift),
            False,
            False,
        )

    def inner_departure(phase: float):
        return fillet(
            g.inner_core,
            phase + inner_shift,
            polar(g.outer_core, phase - half - outer_shift),
            False,
            True,
        )

    def add_core(builder: PathBuilder, phase: float, layer: int) -> None:
        for index in range(g.repeat_count):
            oa, ob = phase + index * step, phase + (index + 1) * step
            ia, ib = phase + (index + 0.5) * step, phase + (index + 1.5) * step
            outer_arrive = outer_arrival(oa)
            outer_depart = outer_departure(ob)
            inner_arrive = inner_arrival(ia)
            inner_depart = inner_departure(ib)
            outer_arrive_next = outer_arrival(ob)

            start_angle = math.atan2(outer_arrive[2].y, outer_arrive[2].x)
            end_angle = math.atan2(outer_depart[0].y, outer_depart[0].x)
            builder.circular_arc(Point(0, 0), g.outer_core, start_angle, _ccw_delta(start_angle, end_angle), "core-boundary", layer, 3.0)
            add_fillet(builder, outer_depart, layer, 3.0)
            builder.line_to(inner_arrive[0], "diagonal", layer, 3.0)
            add_fillet(builder, inner_arrive, layer, 3.0)

            inner_start_angle = math.atan2(inner_arrive[2].y, inner_arrive[2].x)
            inner_end_angle = math.atan2(inner_depart[0].y, inner_depart[0].x)
            builder.circular_arc(Point(0, 0), g.inner_core, inner_start_angle, _ccw_delta(inner_start_angle, inner_end_angle), "core-boundary", layer, 3.0)
            add_fillet(builder, inner_depart, layer, 3.0)
            builder.line_to(outer_arrive_next[0], "diagonal", layer, 3.0)
            add_fillet(builder, outer_arrive_next, layer, 3.0)

    paths: dict[str, list[Move]] = {}

    foundation = PathBuilder(calibration)
    turns, segments = 11, 11 * 16
    curve = lambda t: polar(g.inner_perimeter + (g.outer_perimeter_1 - g.inner_perimeter) * t, 2.0 * math.pi * turns * t)
    foundation.current = curve(0.0)
    for i in range(segments):
        a, b = i / segments, (i + 1) / segments
        foundation.arc3(curve((a + b) / 2.0), curve(b), "foundation", 0, 3.0)
    paths["foundation"] = foundation.moves

    for name, phase, layer in (("layer-a", 0.0, 1), ("layer-b", half, 2)):
        builder = PathBuilder(calibration)
        if name == "layer-a":
            builder.current = polar(g.outer_perimeter_1, phase)
            builder.circular_arc(Point(0, 0), g.outer_perimeter_1, phase, 2 * math.pi, "perimeter", layer, 3.0)
            builder.line_to(polar(g.outer_perimeter_2, phase), "transition", layer, 3.0)
            builder.circular_arc(Point(0, 0), g.outer_perimeter_2, phase, 2 * math.pi, "perimeter", layer, 3.0)
            first_outer = outer_arrival(phase)[2]
            builder.line_to(first_outer, "tie-in", layer, 3.0)
            add_core(builder, phase, layer)

            # Reuse the phase seam to cross from the completed outer side
            # of the core to the inner skin without an arbitrary cross-core
            # travel. Replay the same forward boundary/turnback/diagonal
            # sequence used by every ordinary repeat. Do not synthesize a
            # short reverse cap at the seam: that produced three calibrated
            # near-degenerate Arc3 triples and a physical controller alarm.
            # Replay the next complete ordinary half-cell. The paired cap
            # endpoints at the phase vertex intentionally overlap by only
            # 0.05 mm; attempting to bridge that couching contact with its own
            # Arc3 creates a controller-hostile micro-arc. Advancing one full
            # repeat preserves the normal boundary arc and reaches the inner
            # side through an already validated turnback and diagonal.
            seam_outer = phase + step
            inner_seam = seam_outer - half
            outer_depart = outer_departure(seam_outer)
            inner_arrive = inner_arrival(inner_seam)
            cap_start = math.atan2(builder.current.y, builder.current.x)
            cap_end = math.atan2(outer_depart[0].y, outer_depart[0].x)
            builder.circular_arc(
                Point(0, 0),
                g.outer_core,
                cap_start,
                _ccw_delta(cap_start, cap_end),
                "core-boundary",
                layer,
                3.0,
            )
            add_fillet(builder, outer_depart, layer, 3.0)
            builder.line_to(inner_arrive[0], "diagonal", layer, 3.0)
            add_fillet(builder, inner_arrive, layer, 3.0)
            inner_tie_angle = math.atan2(inner_arrive[2].y, inner_arrive[2].x)
            builder.line_to(
                polar(g.inner_perimeter, inner_tie_angle),
                "tie-in",
                layer,
                3.0,
            )
            builder.circular_arc(
                Point(0, 0),
                g.inner_perimeter,
                inner_tie_angle,
                2.0 * math.pi,
                "perimeter",
                layer,
                3.0,
            )
        else:
            seam = phase + half
            builder.current = polar(g.inner_perimeter, seam)
            builder.circular_arc(Point(0, 0), g.inner_perimeter, seam, 2 * math.pi, "perimeter", layer, 3.0)
            builder.line_to(polar(g.inner_core, seam), "tie-in", layer, 3.0)
            outer_vertex = polar(g.outer_core, phase)
            start = polar(g.inner_core, seam)
            enter = outer_arrival(phase)
            builder.line_to(enter[0], "diagonal", layer, 1.5)
            add_fillet(builder, enter, layer, 3.0)
            add_core(builder, phase, layer)
            builder.line_to(polar(g.outer_perimeter_2, phase), "tie-in", layer, 3.0)
            builder.circular_arc(Point(0, 0), g.outer_perimeter_2, phase, 2 * math.pi, "perimeter", layer, 3.0)
            builder.line_to(polar(g.outer_perimeter_1, phase), "tie-in", layer, 3.0)
            builder.circular_arc(Point(0, 0), g.outer_perimeter_1, phase, 2 * math.pi, "perimeter", layer, 3.0)
        paths[name] = builder.moves

    for moves in paths.values():
        validate_controller_path(moves, calibration)
    return g, calibration, paths


def predicted_polyline(moves: Iterable[Move], calibration: Calibration) -> list[list[Point]]:
    return [sample_move(move, calibration) for move in moves]
