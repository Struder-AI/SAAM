---
name: full-fill
description: Solid planar layers for any closed shell of untrimmed spline patches. Sections the real geometry at each layer height, prints perimeters and solid fill, and reserves material where a draped skin will follow. Development preview only; not wired to Studio's approval workflow.
---

# full-fill

Read the applicable root context: developer agents read both
[DEVELOP.md](../../DEVELOP.md) and [MAKERS.md](../../MAKERS.md).

This skill prints the solid body of a part in flat layers. It is the general
form of the first pattern in the [wedge demo](../wedge-demo/SKILL.md): instead of
a clipped rectangle computed from wedge parameters, each layer is the part's own
cross section, so the pattern follows whatever shape it is given.

**Nothing here has been printed.** No physical validation has been performed,
and this skill is not connected to SAAM Studio or the three-approval workflow.
It produces a development preview only. Do not present its output as an
approved program. For a job a person will actually run, use the wedge demo,
which owns the reviewed workflow.

## What it does

For each layer height, from the first layer up:

1. Section the shell at that height. The section comes from the geometry itself
   (see [the sectioning notes](../../DEVELOP.md#sectioning-untrimmed-spline-shells)), not from a parametric
   outline, so holes, curved walls and changing cross sections all follow.
2. Offset inward by half a bead for the outline, and by a further bead for each
   additional perimeter.
3. Fill the interior solid at the bead spacing, alternating the fill direction
   between layers.
4. Where a draped skin is also selected, stop the body under the reserved
   surface: the layer is intersected with the region where the reserved height
   is still above it.

## Setup and tools

From the repository root, install with `npm ci` (Node.js 22+).

- `node core/print/cli.mjs preview Prints/<name>` writes a development preview:
  plan, SAAMpath, Griffin export and software checks.
- `node core/print/cli.mjs preview Prints/<name> plan.json` uses a supplied plan.
- `node core/print/cli.mjs check Prints/<name>` reopens the print, regenerates
  from the locked plan, and requires the export to match byte for byte.

Both skills share one plan and one program; select them with the `enabled` flag
in the plan's `skills` block.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Print the solid body at all. |
| `perimeters` | `2` | Outline loops before the fill starts. |
| `fillAnglesDeg` | `[45, 135]` | Fill direction per layer, cycled. |
| `fillOverlap` | `0.15` | Fraction of a bead the fill overlaps the last perimeter. |
| `minFeatureMm` | `0.4` | Smallest section feature the slicer samples for. |

Shared process settings (layer height, bead width, speeds, retraction, lift,
`maxCombMm`) live in the plan's `process` block and apply to both skills.

## Travel

Travel is planned rather than fixed. Consecutive fill strokes are generated so
that each ends where the next begins, and the move between them stays at print
height with no retraction when the straight line remains inside the layer's own
material with half a bead to spare. Anything else retracts and lifts, and a lift
clears **the layer it is on** plus the locked `liftMm`, not the whole part's
maximum height. On a solid box this leaves roughly one lift per layer against
several thousand direct moves.

This differs deliberately from the wedge demo, which retracts and lifts to the
full part height for every horizontal move. That demo is not being changed.

## Implemented boundaries

- Input geometry is a **closed shell of untrimmed bivariate spline patches**.
  A trimmed face fails the closure check rather than slicing into open contours,
  because `rhino3dm` exposes no parameter-space trim curves.
- Sections are found by sampling a grid that is refined until a gradient bound
  rules out a hidden contour, then refined again to chord tolerance. A closed
  contour smaller than `minFeatureMm` can still be missed. That is a sampling
  basis, not a proof.
- A cut through a critical point of the surface, or flush with a whole face, is
  displaced by less than a micron and re-cut. A section that still will not close
  raises rather than printing an open contour.
- Coincident collinear boundaries between two solids in the same layer are not
  supported by the region booleans.
- Bead geometry is a rectangular approximation. Perimeter/fill overlap, bead
  rounding and stroke ends are not modelled as exact solids.
- No collision model, no clearance checking. Physical clearance is the
  operator's responsibility.

Run `npm test` after changes. Tests live in [tests/](tests/full-fill.test.mjs)
and cover pattern behaviour per shape, layer volume against the section area,
alternating fill direction, and the travel and lift rules above.
