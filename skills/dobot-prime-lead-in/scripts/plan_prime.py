#!/usr/bin/env python3
"""Plan a compact tangent-arc purge serpentine beside a rectangular part."""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Box:
    xmin: float
    xmax: float
    ymin: float
    ymax: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    for name in (
        "part-xmin", "part-xmax", "part-ymin", "part-ymax",
        "bed-xmin", "bed-xmax", "bed-ymin", "bed-ymax",
        "entry-x", "entry-y",
    ):
        parser.add_argument(f"--{name}", type=float, required=True)
    parser.add_argument(
        "--preferred-side", choices=("left", "right", "bottom", "top")
    )
    parser.add_argument("--min-length", type=float, default=100.0)
    parser.add_argument("--clearance", type=float, default=5.0)
    parser.add_argument("--bead-width", type=float, default=0.83)
    parser.add_argument("--lane-pitch", type=float, default=4.0)
    parser.add_argument("--turn-radius", type=float, default=2.0)
    parser.add_argument("--bed-margin", type=float, default=3.0)
    parser.add_argument("--max-lanes", type=int, default=15)
    return parser.parse_args()


def point(x: float, y: float) -> list[float]:
    return [round(x, 4), round(y, 4)]


def plan_for_side(args: argparse.Namespace, part: Box, bed: Box, side: str):
    bead_r = args.bead_width / 2.0
    offset = args.clearance + bead_r
    usable = Box(
        bed.xmin + args.bed_margin + bead_r,
        bed.xmax - args.bed_margin - bead_r,
        bed.ymin + args.bed_margin + bead_r,
        bed.ymax - args.bed_margin - bead_r,
    )

    vertical = side in ("left", "right")
    entry_long = args.entry_y if vertical else args.entry_x
    part_lo = part.ymin if vertical else part.xmin
    part_hi = part.ymax if vertical else part.xmax
    usable_lo = usable.ymin if vertical else usable.xmin
    usable_hi = usable.ymax if vertical else usable.xmax
    finish_high = abs(entry_long - part_hi) <= abs(entry_long - part_lo)

    near = {
        "left": part.xmin - offset,
        "right": part.xmax + offset,
        "bottom": part.ymin - offset,
        "top": part.ymax + offset,
    }[side]
    outward_sign = -1.0 if side in ("left", "bottom") else 1.0

    for lanes in range(3, args.max_lanes + 1, 2):
        depth = (lanes - 1) * args.lane_pitch
        far = near + outward_sign * depth
        cross_values = [
            near + outward_sign * i * args.lane_pitch for i in range(lanes)
        ]
        if vertical:
            if min(cross_values) < usable.xmin or max(cross_values) > usable.xmax:
                continue
        elif min(cross_values) < usable.ymin or max(cross_values) > usable.ymax:
            continue

        connector = math.hypot(
            args.entry_x - (near if vertical else entry_long),
            args.entry_y - (entry_long if vertical else near),
        )
        turn_total = (lanes - 1) * math.pi * args.turn_radius
        required = max(
            0.0, (args.min_length - turn_total - connector) / lanes
        )
        stroke = max(required, 1.0)

        if finish_high:
            lo, hi = entry_long - stroke, entry_long
        else:
            lo, hi = entry_long, entry_long + stroke
        if lo - args.turn_radius < usable_lo or hi + args.turn_radius > usable_hi:
            continue

        moves = []
        current_high = not finish_high
        start_long = hi if current_high else lo
        start = (far, start_long) if vertical else (start_long, far)
        for index in range(lanes):
            cross = far - outward_sign * index * args.lane_pitch
            target_long = lo if current_high else hi
            target = (
                (cross, target_long) if vertical else (target_long, cross)
            )
            moves.append({"type": "line", "end": point(*target)})
            if index < lanes - 1:
                next_cross = far - outward_sign * (index + 1) * args.lane_pitch
                mid_cross = (cross + next_cross) / 2.0
                bulge = -args.turn_radius if current_high else args.turn_radius
                if vertical:
                    mid = (mid_cross, target_long + bulge)
                    end = (next_cross, target_long)
                else:
                    mid = (target_long + bulge, mid_cross)
                    end = (target_long, next_cross)
                moves.append(
                    {"type": "arc3", "mid": point(*mid), "end": point(*end)}
                )
            current_high = not current_high

        finish = (near, entry_long) if vertical else (entry_long, near)
        entry = (args.entry_x, args.entry_y)
        moves.append({"type": "line_to_model", "end": point(*entry)})
        total = lanes * stroke + turn_total + connector
        return {
            "side": side,
            "lanes": lanes,
            "stroke_mm": round(stroke, 4),
            "start": point(*start),
            "purge_finish": point(*finish),
            "model_entry": point(*entry),
            "connector_length_mm": round(connector, 4),
            "path_length_mm": round(total, 4),
            "centerline_clearance_mm": round(offset, 4),
            "serpentine_edge_clearance_mm": round(args.clearance, 4),
            "moves": moves,
        }
    return None


def main() -> None:
    args = parse_args()
    part = Box(args.part_xmin, args.part_xmax, args.part_ymin, args.part_ymax)
    bed = Box(args.bed_xmin, args.bed_xmax, args.bed_ymin, args.bed_ymax)
    if not (
        part.xmin < part.xmax
        and part.ymin < part.ymax
        and bed.xmin < bed.xmax
        and bed.ymin < bed.ymax
    ):
        raise SystemExit("invalid box bounds")
    if abs(args.lane_pitch - 2.0 * args.turn_radius) > 1e-9:
        raise SystemExit("lane pitch must equal twice turn radius")

    sides = ["left", "right", "bottom", "top"]
    if args.preferred_side:
        sides.remove(args.preferred_side)
        sides.insert(0, args.preferred_side)
    plans = [
        plan
        for side in sides
        if (plan := plan_for_side(args, part, bed, side)) is not None
    ]
    if not plans:
        raise SystemExit("no valid prime path fits the supplied envelopes")

    if args.preferred_side:
        plans.sort(
            key=lambda plan: (
                plan["side"] != args.preferred_side,
                plan["connector_length_mm"],
                plan["lanes"],
            )
        )
    else:
        plans.sort(
            key=lambda plan: (
                plan["connector_length_mm"], plan["lanes"], plan["side"]
            )
        )
    print(json.dumps(plans[0], indent=2))


if __name__ == "__main__":
    main()
