#!/usr/bin/env python3
"""Derive bounded circular triangular-wall geometry in dependency order."""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class TriangularWallGeometry:
    guide_radius_mm: float
    total_envelope_mm: float
    line_spacing_mm: float
    inner_perimeter_count: int
    outer_perimeter_count: int
    inner_envelope_radius_mm: float
    outer_envelope_radius_mm: float
    inner_core_radius_mm: float
    outer_core_radius_mm: float
    core_width_mm: float
    repeat_count: int
    apex_angle_deg: float
    apex_error_deg: float
    fillet_radius_mm: float


def apex_angle_deg(
    inner_radius_mm: float,
    outer_radius_mm: float,
    repeat_count: int,
) -> float:
    delta = math.pi / repeat_count
    a = inner_radius_mm * math.cos(delta) - outer_radius_mm
    b = inner_radius_mm * math.sin(delta)
    cosine = (a * a - b * b) / (a * a + b * b)
    return math.degrees(math.acos(max(-1.0, min(1.0, cosine))))


def derive_geometry(
    *,
    guide_radius_mm: float,
    total_envelope_mm: float,
    line_spacing_mm: float,
    inner_perimeter_count: int,
    outer_perimeter_count: int,
    target_apex_deg: float = 90.0,
    fillet_fraction: float = 0.10,
    minimum_repeats: int = 3,
    maximum_repeats: int = 200,
) -> TriangularWallGeometry:
    if guide_radius_mm <= 0.0:
        raise ValueError("guide radius must be positive")
    if total_envelope_mm <= 0.0 or line_spacing_mm <= 0.0:
        raise ValueError("envelope and line spacing must be positive")
    if inner_perimeter_count < 0 or outer_perimeter_count < 0:
        raise ValueError("perimeter counts cannot be negative")
    if not 0.0 < fillet_fraction < 0.5:
        raise ValueError("fillet fraction must be between zero and 0.5")

    inner_envelope_radius = guide_radius_mm - total_envelope_mm / 2.0
    outer_envelope_radius = guide_radius_mm + total_envelope_mm / 2.0
    inner_core_radius = (
        inner_envelope_radius + inner_perimeter_count * line_spacing_mm
    )
    outer_core_radius = (
        outer_envelope_radius - outer_perimeter_count * line_spacing_mm
    )
    core_width = outer_core_radius - inner_core_radius

    if inner_envelope_radius <= 0.0:
        raise ValueError("envelope reaches or crosses the guide center")
    if core_width <= 0.0:
        raise ValueError("bounding perimeters consume the complete envelope")

    candidates = []
    for repeats in range(minimum_repeats, maximum_repeats + 1):
        angle = apex_angle_deg(inner_core_radius, outer_core_radius, repeats)
        candidates.append((abs(angle - target_apex_deg), repeats, angle))

    error, repeat_count, angle = min(candidates)

    return TriangularWallGeometry(
        guide_radius_mm=guide_radius_mm,
        total_envelope_mm=total_envelope_mm,
        line_spacing_mm=line_spacing_mm,
        inner_perimeter_count=inner_perimeter_count,
        outer_perimeter_count=outer_perimeter_count,
        inner_envelope_radius_mm=inner_envelope_radius,
        outer_envelope_radius_mm=outer_envelope_radius,
        inner_core_radius_mm=inner_core_radius,
        outer_core_radius_mm=outer_core_radius,
        core_width_mm=core_width,
        repeat_count=repeat_count,
        apex_angle_deg=angle,
        apex_error_deg=error,
        fillet_radius_mm=fillet_fraction * core_width,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--guide-radius", type=float, required=True)
    parser.add_argument("--envelope", type=float, required=True)
    parser.add_argument("--line-spacing", type=float, required=True)
    parser.add_argument("--inner-perimeters", type=int, required=True)
    parser.add_argument("--outer-perimeters", type=int, required=True)
    parser.add_argument("--target-apex", type=float, default=90.0)
    parser.add_argument("--fillet-fraction", type=float, default=0.10)
    args = parser.parse_args()

    geometry = derive_geometry(
        guide_radius_mm=args.guide_radius,
        total_envelope_mm=args.envelope,
        line_spacing_mm=args.line_spacing,
        inner_perimeter_count=args.inner_perimeters,
        outer_perimeter_count=args.outer_perimeters,
        target_apex_deg=args.target_apex,
        fillet_fraction=args.fillet_fraction,
    )
    print(json.dumps(asdict(geometry), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
