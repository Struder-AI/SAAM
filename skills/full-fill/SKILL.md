---
name: full-fill
description: Solid planar layers for any closed shell of untrimmed spline patches. Sections the real geometry at each layer height, prints perimeters and solid fill, and reserves material where a draped skin will follow. Reviewed in SAAM Studio through the three approvals; no part from it has been printed.
---

# full-fill

Read the applicable root context: developer agents read both
[DEVELOP.md](../../DEVELOP.md) and [MAKERS.md](../../MAKERS.md).

This skill prints the solid body of a part in flat layers. It is the general
form of the first pattern in the [wedge demo](../wedge-demo/SKILL.md): instead of
a clipped rectangle computed from wedge parameters, each layer is the part's own
cross section, so the pattern follows whatever shape it is given.

**Nothing here has been printed.** No physical validation has been performed,
and no maker has yet used this skill end to end. What is implemented is the
software workflow: a print bundle with native 3DM geometry, SAAM Studio review,
the three human approvals, and delivery of the exact reviewed bytes. Generation
without those approvals is a development preview and says so; do not present a
preview as an approved program.

Shapes come from the plan's `geometry` block - `box`, `wedge`, `spline-top`,
`spline-shell`, `vertical-spline-shell`, or an `assembly` of those components. A vertical spline shell has a
control-point-grid roof and four untrimmed ruled spline side patches whose
footprint is identical at the base and roof: its walls stay vertical while X
bulges outward and Y bulges inward. Importing an arbitrary part from CAD is not
implemented, so a request this package's shapes cannot express is out of scope
rather than approximated.

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

From the repository root, install with `npm ci` (Node.js 22+). Both skills share
one plan, one program and one command line; select them with the `enabled` flag
in the plan's `skills` block.

Making a part a person will review:

- `node core/print/cli.mjs init Prints/<name> [plan.json]` creates the print:
  native 3DM geometry, the plan, and an empty review record. With no plan it
  starts from the defaults and any remembered S5 setup.
- `npm run studio -- Prints/<name>` opens it in SAAM Studio, where the person
  reviews geometry, then the locked settings, then the toolpath. Studio
  generates and delivers; the three approvals are theirs to give.
- `node core/print/cli.mjs adjust Prints/<name> patch.json` applies a requested
  change from chat. A settings change keeps geometry approval; a geometry change
  invalidates all three. Studio picks the change up on its own.
- `node core/print/cli.mjs check Prints/<name>` reopens the print, regenerates
  from the locked plan, and reports what is approved.
- `node core/print/cli.mjs remember-setup Prints/<name>` saves the machine setup
  locally for the next print. Remembered setup approves nothing.
- `node core/print/cli.mjs deliver Prints/<name>` copies the reviewed bytes to
  `delivery/`. It refuses unless the current export is the approved one.

Trying something out without a person in the loop:

- `node core/print/cli.mjs demo Prints/<name>` generates a development preview
  in a print bundle, creating no approvals.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `parts` | `[]` | Assembly component IDs to fill; empty selects all components. |
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

The wedge uses its own bounded travel rule: nearby starts stay down and longer
moves lift to the part maximum. Export and review are shared.

## Composition

`fullFillResult({shell, plan, reserve, id})` returns an in-memory result with
wall and fill operations per layer. The shared composer owns ordering, connecting
travel, retraction and layer completion. Each instance requires a unique ID.
`generateFullFill(builder, options)` is a compatibility callable that uses that
same result and composer. It is not another generation implementation.

Multiple instances may alternate by layer or use locked small batches. For an
assembly, name its component geometry and select `skills.full-fill.parts` in
the plan; `composition.batchLayers`, `order`, and `dependencies` control the
shared schedule. Supporting fills always finish before draped-skin. See the
[shared contract](../../DEVELOP.md#skill-result-composition). Intermediate tests
are scratch; Studio's exact-export viewer is the preview.

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
alternating fill direction, and the travel and lift rules above. The shared
review workflow - native geometry round trip, approvals, stale views and
byte-identical delivery - is tested in
[core/tests/workflow.test.mjs](../../core/tests/workflow.test.mjs).
