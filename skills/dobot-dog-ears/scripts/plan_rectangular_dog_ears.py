#!/usr/bin/env python3
"""Plan dog-ear ownership and breakaway-skirt spans for a rectangle."""

from __future__ import annotations

import argparse
import json
import math


def rounded_point(x: float, y: float) -> list[float]:
    return [round(x, 4), round(y, 4)]


def plan_rectangular_dog_ears(
    xmin: float,
    xmax: float,
    ymin: float,
    ymax: float,
    diameter: float = 15.0,
    bead_width: float = 0.83,
    breakaway_gap: float = 0.20,
    tie_overlap_ratio: float = 0.50,
) -> dict:
    if not (xmin < xmax and ymin < ymax):
        raise ValueError("invalid finished-part bounds")
    if diameter <= 0 or bead_width <= 0 or breakaway_gap < 0:
        raise ValueError("diameter and bead width must be positive; gap cannot be negative")
    if not 0 <= tie_overlap_ratio <= 1:
        raise ValueError("tie overlap ratio must be between zero and one")

    radius = diameter / 2.0
    width = xmax - xmin
    height = ymax - ymin
    if width <= diameter or height <= diameter:
        raise ValueError(
            "adjacent dog ears overlap; merge the adhesion regions with the full geometry planner"
        )

    offset = breakaway_gap + bead_width / 2.0
    if offset >= radius:
        raise ValueError("skirt offset does not intersect the dog ears")
    intersection = math.sqrt(radius * radius - offset * offset)
    tie = tie_overlap_ratio * bead_width

    spans = [
        {
            "side": "bottom",
            "start": rounded_point(xmin + intersection - tie, ymin - offset),
            "end": rounded_point(xmax - intersection + tie, ymin - offset),
        },
        {
            "side": "right",
            "start": rounded_point(xmax + offset, ymin + intersection - tie),
            "end": rounded_point(xmax + offset, ymax - intersection + tie),
        },
        {
            "side": "top",
            "start": rounded_point(xmax - intersection + tie, ymax + offset),
            "end": rounded_point(xmin + intersection - tie, ymax + offset),
        },
        {
            "side": "left",
            "start": rounded_point(xmin - offset, ymax - intersection + tie),
            "end": rounded_point(xmin - offset, ymin + intersection - tie),
        },
    ]

    for span in spans:
        dx = span["end"][0] - span["start"][0]
        dy = span["end"][1] - span["start"][1]
        span["length_mm"] = round(math.hypot(dx, dy), 4)
        if span["length_mm"] <= 0:
            raise ValueError(
                f"dog ears consume the complete {span['side']} side; merge regions"
            )

    ears = [
        {"corner": "bottom_left", "center": rounded_point(xmin, ymin)},
        {"corner": "bottom_right", "center": rounded_point(xmax, ymin)},
        {"corner": "top_right", "center": rounded_point(xmax, ymax)},
        {"corner": "top_left", "center": rounded_point(xmin, ymax)},
    ]
    sequence = []
    for ear, span in zip(ears, spans):
        sequence.append({"type": "ear", "corner": ear["corner"]})
        sequence.append({"type": "skirt_span", "side": span["side"]})
    sequence.append({"type": "enter_part", "at_corner": "bottom_left"})

    return {
        "finished_part_bounds": [xmin, xmax, ymin, ymax],
        "ear_diameter_mm": diameter,
        "ear_radius_mm": radius,
        "ear_centers": ears,
        "ear_region_rule": "circle minus finished_part_footprint",
        "breakaway_clear_gap_mm": breakaway_gap,
        "skirt_centerline_offset_from_finished_edge_mm": round(offset, 4),
        "part_perimeter_to_skirt_centerline_mm": round(
            bead_width + breakaway_gap, 4
        ),
        "skirt_circle_intersection_from_corner_mm": round(intersection, 4),
        "skirt_to_ear_tie_overlap_mm": round(tie, 4),
        "skirt_spans": spans,
        "continuous_support_first_sequence": sequence,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--xmin", type=float, required=True)
    parser.add_argument("--xmax", type=float, required=True)
    parser.add_argument("--ymin", type=float, required=True)
    parser.add_argument("--ymax", type=float, required=True)
    parser.add_argument("--diameter", type=float, default=15.0)
    parser.add_argument("--bead-width", type=float, default=0.83)
    parser.add_argument("--breakaway-gap", type=float, default=0.20)
    parser.add_argument("--tie-overlap-ratio", type=float, default=0.50)
    args = parser.parse_args()
    try:
        result = plan_rectangular_dog_ears(
            args.xmin,
            args.xmax,
            args.ymin,
            args.ymax,
            args.diameter,
            args.bead_width,
            args.breakaway_gap,
            args.tie_overlap_ratio,
        )
    except ValueError as error:
        raise SystemExit(str(error)) from error
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
