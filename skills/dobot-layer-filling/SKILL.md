---
name: dobot-layer-filling
description: Plan and calibrate solid or sparse extrusion layers for StruderBot/Dobot MG400, including line spacing, wall overlap, alternating raster directions, perimeters, holes, openings, connected fill regions, and transition ordering. Use with dobot-programmer when creating filled surfaces, top or bottom layers, flange-like parts, infill, or diagnosing overfill, underfill, gaps, repeated feature detours, blobs, pauses, and cross-part repositioning.
---

# Dobot Layer Filling

> **Imported legacy StruderBot manual.** Preserve the measured Dobot evidence,
> but use SAAM's implemented `full-fill` and `planar-infill` operations for
> current jobs. Any remaining behavior must be ported through shared geometry,
> composition, export, Studio review, and tests before it is callable in SAAM.

Create a coverage plan that can be combined with the geometry, motion, and
safety workflow in `dobot-programmer`.

## Load the baseline

Read `references/interim-baseline.md` before changing spacing, overlap, region
ordering, or filled-layer transitions. Preserve its evidence labels.

## Plan the layer

1. Offset outer, inner, and feature walls using the measured bead width.
2. Apply the approved infill-to-wall overlap.
3. Subtract holes and openings from the fillable material.
4. Split the remaining material into connected regions for the chosen raster
   direction.
5. Complete a region before transitioning to the next.
6. Start the next region from the current side when practical. Avoid rapid
   cross-part returns that force exact stops.
7. Route unavoidable transitions along an existing wall or intentional feature
   boundary.
8. Alternate the complete raster plan between X and Y on successive layers.

Do not detour around the same feature once per scanline. Do not assume a failed
large solid print is a fill-calibration failure when bed adhesion has already
become the limiting condition.

## Preserve coverage

- Give outer perimeters priority.
- Print inner and feature perimeters before adjacent fill.
- Convert requested wall overlap from bead geometry; do not extend infill
  centerlines to the perimeter centerline. For equal bead widths `b` and
  requested physical overlap `o`, stop the infill centerline at
  `perimeter_centerline - b + o` on the material side.
- Move from a completed perimeter to the first raster endpoint with an
  explicit fast linear travel move. Do not draw that cross-region transition
  at print speed, and do not use joint motion while extrusion may remain on.
- When raster must be parallel to polygon sides, derive its direction from
  the actual edge vectors. Do not confuse edge-normal angles with side angles.
- Use continuous spirals for multiple concentric circular contours when closed
  rings would require repeated stop-and-reposition moves.
- Extend solid fill into its wall overlap zone without crossing the intended
  clear opening.
- Keep print strokes and intentional non-print transitions as explicit speed
  classes.
- Continue from a short-stroke region into the following full band from the
  current edge when possible.

## Validate

- Check that every requested material region is covered.
- Check that holes and openings retain clearance.
- Count transitions per feature and reject repeated row-wise detours.
- Inspect each region junction for redundant or cross-part repositioning.
- Confirm the rotated-layer mapping preserves the same physical boundaries.
- Separate software/path validation from bed-adhesion readiness.

Use a smaller-footprint or low-contact-area test when adhesion prevents a
meaningful large-solid-layer result.

## Portable dependencies

Install this as part of the complete suite in `../STRUDERBOT_SUITE.json`.
It requires `dobot-programmer`; current SAAM execution also requires the
repository's `full-fill` and `planar-infill` skills. This manual has no direct
runtime or package dependency of its own.
