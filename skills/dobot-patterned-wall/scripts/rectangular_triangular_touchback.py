#!/usr/bin/env python3
"""Shared geometry for a perimeterless rounded-rectangle touchback wall."""

from __future__ import annotations

from dataclasses import dataclass
import math


@dataclass(frozen=True)
class Point:
    x: float
    y: float


@dataclass(frozen=True)
class PatternGeometry:
    finished_x: float
    finished_y: float
    envelope: float
    bead: float
    outer_finished_radius: float
    guide_x: float
    guide_y: float
    guide_radius: float
    outer_offset: float
    repeat_count: int
    nominal_repeat: float
    executed_cell_advance: float
    phase_advance_per_turn: float
    straight_apex_deg: float


class RoundedRectangleGuide:
    """Clockwise rounded rectangle parameterized by desired guide arc length."""

    def __init__(self, width: float, height: float, radius: float) -> None:
        if min(width, height) <= 2.0 * radius:
            raise ValueError("corner radius consumes the guide")
        self.width = width
        self.height = height
        self.radius = radius
        self.horizontal = width - 2.0 * radius
        self.vertical = height - 2.0 * radius
        self.quarter = 0.5 * math.pi * radius
        self.perimeter = (
            2.0 * self.horizontal
            + 2.0 * self.vertical
            + 4.0 * self.quarter
        )
        self._lengths = (
            self.horizontal,
            self.quarter,
            self.vertical,
            self.quarter,
            self.horizontal,
            self.quarter,
            self.vertical,
            self.quarter,
        )

    def frame(self, s: float) -> tuple[Point, Point, Point]:
        """Return guide point, unit tangent, and outward normal."""
        s %= self.perimeter
        hw = self.width / 2.0
        hh = self.height / 2.0
        r = self.radius

        for index, length in enumerate(self._lengths):
            if s <= length or index == len(self._lengths) - 1:
                u = max(0.0, min(length, s))
                if index == 0:  # bottom, right to left
                    p = Point(hw - r - u, -hh)
                    t = Point(-1.0, 0.0)
                elif index == 1:  # bottom-left
                    theta = -math.pi / 2.0 - u / r
                    p = Point(-hw + r + r * math.cos(theta), -hh + r + r * math.sin(theta))
                    t = Point(math.sin(theta), -math.cos(theta))
                elif index == 2:  # left, bottom to top
                    p = Point(-hw, -hh + r + u)
                    t = Point(0.0, 1.0)
                elif index == 3:  # top-left
                    theta = math.pi - u / r
                    p = Point(-hw + r + r * math.cos(theta), hh - r + r * math.sin(theta))
                    t = Point(math.sin(theta), -math.cos(theta))
                elif index == 4:  # top, left to right
                    p = Point(-hw + r + u, hh)
                    t = Point(1.0, 0.0)
                elif index == 5:  # top-right
                    theta = math.pi / 2.0 - u / r
                    p = Point(hw - r + r * math.cos(theta), hh - r + r * math.sin(theta))
                    t = Point(math.sin(theta), -math.cos(theta))
                elif index == 6:  # right, top to bottom
                    p = Point(hw, hh - r - u)
                    t = Point(0.0, -1.0)
                else:  # bottom-right
                    theta = -u / r
                    p = Point(hw - r + r * math.cos(theta), -hh + r + r * math.sin(theta))
                    t = Point(math.sin(theta), -math.cos(theta))
                n = Point(-t.y, t.x)
                return p, t, n
            s -= length
        raise AssertionError("unreachable")

    def offset_point(self, s: float, offset: float) -> Point:
        p, _, n = self.frame(s)
        return Point(p.x + offset * n.x, p.y + offset * n.y)

    def sample_offset(self, s0: float, s1: float, offset: float, step: float = 0.7) -> list[Point]:
        distance = s1 - s0
        count = max(1, math.ceil(abs(distance) / step))
        return [
            self.offset_point(s0 + distance * i / count, offset)
            for i in range(count + 1)
        ]


def derive_geometry(
    *,
    finished_x: float = 100.0,
    finished_y: float = 150.0,
    envelope: float = 10.0,
    bead: float = 0.83,
    outer_finished_radius: float = 12.0,
) -> tuple[PatternGeometry, RoundedRectangleGuide]:
    guide_x = finished_x - envelope
    guide_y = finished_y - envelope
    guide_radius = outer_finished_radius - envelope / 2.0
    outer_offset = (envelope - bead) / 2.0
    guide = RoundedRectangleGuide(guide_x, guide_y, guide_radius)

    candidates = []
    separation = 2.0 * outer_offset
    for repeats in range(4, 100):
        nominal = guide.perimeter / repeats
        phase_advance = nominal / 2.0
        executed = (guide.perimeter + phase_advance) / repeats
        angle = math.degrees(2.0 * math.atan((executed / 2.0) / separation))
        candidates.append((abs(angle - 90.0), repeats, nominal, executed, phase_advance, angle))
    _, repeats, nominal, executed, phase_advance, angle = min(candidates)

    geometry = PatternGeometry(
        finished_x=finished_x,
        finished_y=finished_y,
        envelope=envelope,
        bead=bead,
        outer_finished_radius=outer_finished_radius,
        guide_x=guide_x,
        guide_y=guide_y,
        guide_radius=guide_radius,
        outer_offset=outer_offset,
        repeat_count=repeats,
        nominal_repeat=nominal,
        executed_cell_advance=executed,
        phase_advance_per_turn=phase_advance,
        straight_apex_deg=angle,
    )
    return geometry, guide


def pattern_polyline(
    guide: RoundedRectangleGuide,
    geometry: PatternGeometry,
    *,
    phase: float,
) -> tuple[list[list[Point]], Point, Point]:
    """Return exact topology as sampled boundary portions and straight diagonals."""
    segments: list[list[Point]] = []
    q = geometry.executed_cell_advance
    a = geometry.outer_offset
    start = guide.offset_point(phase, a)
    for i in range(geometry.repeat_count):
        s0 = phase + i * q
        s1 = s0 + q
        segments.append(guide.sample_offset(s0, s1, a))
        segments.append([guide.offset_point(s1, a), guide.offset_point(s1 - q / 2.0, -a)])
        segments.append(guide.sample_offset(s1 - q / 2.0, s1 + q / 2.0, -a))
        segments.append([guide.offset_point(s1 + q / 2.0, -a), guide.offset_point(s1, a)])
    end = guide.offset_point(phase + geometry.repeat_count * q, a)
    return segments, start, end


def validate(geometry: PatternGeometry, guide: RoundedRectangleGuide) -> None:
    assert geometry.repeat_count == 25
    assert 88.0 <= geometry.straight_apex_deg <= 92.0
    assert abs(guide.perimeter / geometry.repeat_count - geometry.nominal_repeat) < 1e-9
    assert geometry.outer_finished_radius - geometry.envelope == 2.0
    for offset in (geometry.outer_offset, -geometry.outer_offset):
        for i in range(1000):
            p = guide.offset_point(guide.perimeter * i / 1000.0, offset)
            assert abs(p.x) <= geometry.finished_x / 2.0 - geometry.bead / 2.0 + 1e-6
            assert abs(p.y) <= geometry.finished_y / 2.0 - geometry.bead / 2.0 + 1e-6


if __name__ == "__main__":
    g, c = derive_geometry()
    validate(g, c)
    print(g)
