#!/usr/bin/env python3
import argparse
import json
import math


def physical_width(count, bead, spacing):
    return bead + (count - 1) * spacing


def centered_offsets(count, maximum_count, spacing):
    midline = -(maximum_count - 1) * spacing / 2.0
    start = midline + (count - 1) * spacing / 2.0
    return [round(start - i * spacing, 6) for i in range(count)]


def nearest_count(width, bead, spacing, minimum, maximum):
    count = round((width - bead) / spacing) + 1
    return max(minimum, min(maximum, count))


def plan_lip(width, bead, spacing, layer_height, minimum_top):
    maximum_count = max(
        2,
        round((width - bead) / spacing) + 1,
    )
    achieved = physical_width(maximum_count, bead, spacing)
    cutback = 2.0 * spacing / math.cos(math.radians(30.0))

    layers = []
    z_index = 0

    layers.append(
        {
            "index": z_index,
            "phase": "foundation",
            "paths": 1,
            "offsets_mm": [0.0],
            "innermost_clipped": False,
        }
    )
    z_index += 1

    for count in range(1, maximum_count):
        layers.append(
            {
                "index": z_index,
                "phase": "support_ramp",
                "paths": count,
                "offsets_mm": [
                    round(-i * spacing, 6)
                    for i in range(count)
                ],
                "innermost_clipped": True,
            }
        )
        z_index += 1

    maximum_offsets = [
        round(-i * spacing, 6)
        for i in range(maximum_count)
    ]
    for phase in ("maximum", "maximum_repeat"):
        layers.append(
            {
                "index": z_index,
                "phase": phase,
                "paths": maximum_count,
                "offsets_mm": maximum_offsets,
                "innermost_clipped": False,
            }
        )
        z_index += 1

    radius = achieved / 2.0
    previous = maximum_count
    sample = 1

    while previous > minimum_top:
        y = sample * layer_height
        if y < radius:
            chord = 2.0 * math.sqrt(radius * radius - y * y)
        else:
            chord = 0.0

        ideal = nearest_count(
            chord,
            bead,
            spacing,
            minimum_top,
            maximum_count,
        )
        count = min(previous, ideal)

        layers.append(
            {
                "index": z_index,
                "phase": "rounded_crown",
                "paths": count,
                "offsets_mm": centered_offsets(
                    count,
                    maximum_count,
                    spacing,
                ),
                "circle_sample_height_mm": round(y, 6),
                "ideal_chord_width_mm": round(chord, 6),
                "innermost_clipped": False,
            }
        )
        z_index += 1
        previous = count
        sample += 1

    return {
        "requested_width_mm": width,
        "bead_width_mm": bead,
        "path_spacing_mm": spacing,
        "layer_height_mm": layer_height,
        "maximum_paths": maximum_count,
        "achieved_width_mm": round(achieved, 6),
        "corner_cutback_mm": round(cutback, 6),
        "minimum_top_paths": minimum_top,
        "layers": layers,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Plan a supported rounded lip for a Dobot spiral wall."
    )
    parser.add_argument("width_mm", type=float)
    parser.add_argument("--bead-width", type=float, default=0.83)
    parser.add_argument("--spacing", type=float, default=0.679779)
    parser.add_argument("--layer-height", type=float, default=0.70)
    parser.add_argument("--minimum-top-paths", type=int, default=2)
    args = parser.parse_args()

    if args.width_mm <= 0:
        parser.error("width_mm must be positive")
    if args.bead_width <= 0 or args.spacing <= 0:
        parser.error("bead width and spacing must be positive")
    if args.layer_height <= 0:
        parser.error("layer height must be positive")
    if args.minimum_top_paths < 1:
        parser.error("minimum top paths must be at least 1")

    print(
        json.dumps(
            plan_lip(
                args.width_mm,
                args.bead_width,
                args.spacing,
                args.layer_height,
                args.minimum_top_paths,
            ),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
