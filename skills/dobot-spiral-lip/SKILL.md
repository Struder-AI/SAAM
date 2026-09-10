---
name: dobot-spiral-lip
description: Design and generate width-driven rounded lips for Dobot StruderBot single-wall spiral or vase-mode objects. Use when the operator asks for a rim, brim, bead, rolled edge, round-over, full-fillet lip, or a transition from one spiral wall into multiple supported perimeters.
---

# Dobot Spiral Lip

> **Imported legacy StruderBot manual.** This preserves the physically informed
> rounded-lip construction, but it is not yet a callable SAAM successor to
> `vase-wall`. Implement it through shared section geometry, composition,
> export, Studio review, and tests before use in a delivered job.

Create a supported, rounded lip from a phase-aligned single-wall spiral.

## Load required context

Use this skill with `dobot-programmer`. Read
`references/geometry.md` before calculating a lip. If the part also contains
filled layers, use `dobot-layer-filling`.

## Plan from requested width

1. Interpret lip width as the physical transverse width, including the bead
   width.
2. Run:

   ```text
   python scripts/plan_lip.py WIDTH_MM
   ```

   Override bead width, spacing, or layer height only from current
   robot-confirmed calibration.
3. Report requested width, selected maximum path count, achieved width,
   cutback, and layer schedule.
4. Derive preview and Lua from the returned offsets. Obtain normal geometry
   approval before final Lua unless the operator explicitly skips preview.

## Generate the transition

- Finish the spiral at a complete, phase-aligned circuit and freeze rotation
  through the lip.
- Preserve the established outside wall. Grow new paths inward.
- Add at most one new perimeter per layer.
- Before adding path `n+1`, clip both sides of every vertex on innermost path
  `n` by the calculated cutback.
- Place every new path vertex at the midpoint of the clipped chord below it.
- Print paths from outside to inside and connect adjacent paths locally at the
  same indexed vertex. Never cross the open vessel.
- Repeat the maximum-width layer once by default.

## Form the rounded crown

- Treat the maximum physical lip width as a circular diameter.
- Sample the upper semicircle at the calibrated layer height.
- Convert each sampled chord width to the nearest supported path count.
- Permit the count to drop by more than one when the circular chord calls for
  it; a centered narrower layer is supported by the wider layer below.
- Center every crown layer on the maximum lip midline; do not retain the paths
  against the outside wall.
- End with two centered paths by default. Use one only when the operator asks
  for a pointed or fully closed apex and hardware support is credible.

## Finish

- Use the global early-shutoff helper on the final side.
- Respect the current operator-tuned `END_RETRACT_LEAD_MM`.
- Complete the stroke, then lift immediately with no endpoint or pen-off
  dwell.
- Keep manual cooling as an operator-controlled condition and record it with
  physical results.

## Validate

- Confirm path spacing, support-chord midpoint alignment, centered cap offsets,
  maximum width, final height, and phase continuity.
- Reject any fixed-corner reposition from a partial spiral side.
- Reject spacing calculated directly from edge cutback; use the regular-hex
  conversion in the reference.
- Treat physical print results as authoritative.
