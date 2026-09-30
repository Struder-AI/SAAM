---
name: bed-adhesion
description: A single-layer brim around the outline, for a first layer too small or thin to grip the bed, such as an open-bottom vase.
---

# Bed adhesion

Use when the part's own first layer gives the bed too little to hold: a
single-bead vase-mode ring, a narrow foot, a tall part on a small footprint.
Bed adhesion deposits auxiliary material that is removed after printing; it does
not change the part.

This package currently has one entry, [brims](#brim). It is a first draft.

## Brim

A brim is one layer of concentric loops printed around the part's outline, in
the same plane as the part's first layer and fused to it. It adds bed contact
area without adding height, and it is cut or snapped off after printing.

The innermost loop is placed on the part's own first-layer centerline, so the
part's second layer starts on deposited material rather than beside it.

### How a brim is built

There is no dedicated brim producer. A brim is assembled from two existing
pieces, and both are required:

1. **Geometry.** The part carries a flange over the first layer height: a flat
   skirt extending from the part's footprint outward by the brim width. Below
   the first layer the section is the flange; above it the part resumes.
2. **Recipe.** A region covering the first layer assigns
   [planar-infill](../planar-infill/SKILL.md) with `density: 0` and a
   `perimeters` count, so the region prints loops and no interior. A region
   `process` override carries the brim's own bead width and speed.

```json
{"id":"brim","part":null,"zStartMm":0,"zEndMm":0.2,"lowerSurfaceFrom":null,
 "skills":{"planar-infill":{"perimeters":9,"density":0}},
 "process":{"lineWidthMm":0.6,"firstLayerSpeedMmS":18}}
```

The part's own region starts where the brim region ends, so its first bead lands
on the innermost brim loop.

### Choosing the loops

`perimeters` counts every loop, including the one on the part's centerline, so
for `N` loops outside the part use `perimeters: N + 1`. Loops are inset from the
region's own boundary, so the flange size follows from the count rather than the
other way round. For a circular footprint, with brim bead width `w`:

- part first-layer centerline radius `Rc` — for a vase wall this is the modeled
  surface radius less half the *part's* bead width, not the brim's
- flange outer radius `R0 = Rc + w/2 + N*w`
- loop `k` (from the outside, `k` from 0) prints at `R0 - w/2 - k*w`, so loop
  `N` lands exactly on `Rc`

A non-circular footprint uses the same offsets applied to its own section; the
flange is that section offset outward by `N*w`.

`density: 0` leaves the enclosed area empty, so an open-bottom part stays open.

### Settings

| Choice | Effect |
|---|---|
| Loops outside the part | Bed contact area and how much there is to cut away. Eight is a reasonable starting point for a tall part on a narrow foot. |
| `process.lineWidthMm` | A wider bead than the part's lays more material per unit length and widens the contact patch. Around 1.2x the part's width keeps the loops fused without a visible ridge. |
| `process.firstLayerSpeedMmS` | Slower than the part's first layer, so the wider bead has time to wet the plate. |
| `process.firstLayerMm` | Brim layer height. Leave it equal to the part's, or the brim and the part's first region disagree about where the layer ends. |

### Limits

- No producer of its own. The flange lives in the geometry, so changing the loop
  count or bead width means rebuilding the geometry, not just the recipe.
  A brim for an imported STL requires editing that mesh.
- The brim is fused to the part with no separation gap and no removal aid. It is
  cut or snapped off, and it marks the part's first layer where it was attached.
- One layer. A raft, a skirt printed clear of the part, and a separation gap are
  not implemented.
- The loop derivation above is written for a single closed outer section.
  Multiple islands each need their own flange.
- No brim from this package has been printed. Loop placement and deposited
  volume are software measurements; adhesion is a print-validation result.

### Recorded evidence

On 2026-09-19 a maker reported that an open-bottom vase-mode print did not
adhere to the bed on a Bambu X1 Carbon in PLA. That part's only bed contact was
one 0.5 mm vase-wall bead around an 80 mm circle, roughly 125 mm² of contact
carrying a 124 mm tall part. That failure is physical evidence; nothing here
establishes that a brim corrects it.

Adding eight loops at 0.6 mm and 18 mm/s to the same part produced a checked
first layer of 3,111 mm of path at a measured 0.652 x 0.2 mm bead, about
2,030 mm² of contact. Those figures are read from the generated program.

## Workflow and review

Use the [shared print tools](../../core/print/USAGE.md) to apply the region and
generate, and review the first layer in Studio with the rest of the toolpath
before export. [MAKERS](../../MAKERS.md) owns review and approval.
