---
name: vase-wall
description: Print a conventional hollow vase or tube with one continuous rising spiral wall and an optional solid base. Use advanced vase mode for motifs, authored patterns and fitted mesh sleeves.
---

# Standard vase mode

Use for conventional vase printing: one continuous spiral wall, an open top,
and an optional solid base. The input describes the vessel's exterior; the
recipe leaves the interior hollow. No motif or fitted reference sleeve is needed.
For repeated loops, authored patterns or adjustable mesh conformance, choose
[advanced vase mode](../advanced-vase-wall/SKILL.md).

Both manuals use the existing `skills.vase-wall` recipe and slicer. Their separate
skill-digest entries guide selection; they do not introduce another recipe key.

## Workflow

Use the [shared print tools](../../core/print/USAGE.md) to create/import a print,
adjust its recipe, generate and review it in Studio. Enable `skills.vase-wall`,
set `pattern: null`, `pathMode: "continuous"` and `meshSleeve: null`.
When converting an advanced recipe, reset all three explicitly.
Disable other wall/interior producers on the same material region.

For a solid base, enable [full-fill](../full-fill/SKILL.md) and set a positive
`zStartMm` on the process layer grid. The vase wall begins above that base.
Without a base, disable full-fill and use `zStartMm: 0`.
Disable unwanted default skills, including draped-skin, through ordinary recipe
adjustment. A closed top is not part of standard vase mode.

For a same-part stack, use `composition.regions` to assign full-fill to the base
and vase-wall to the wall above it. An optional [thick lip](../thick-lip/SKILL.md)
can follow a level-ended wall through that regional workflow.

## Input geometry: normally a solid

Use a validated closed mesh or a supported untrimmed closed spline shell with
one outer section throughout the selected interval. A modeled bore is unnecessary;
one bore is allowed. Concave sections work while the requested inset remains one
closed loop. Multiple islands, split/collapsed contours, arbitrary trimmed CAD
faces and open uncapped meshes are unsupported.

Standard mode follows changing-height geometry sections directly. It does not
use the advanced mesh-fitting helper. Choose `zEndMm` explicitly if the upper
geometry is unsuitable; generation never silently shortens the wall.

## Settings

| Setting | Meaning |
|---|---|
| `zStartMm`, `zEndMm` | Wall interval above the component base; `zEndMm: null` uses the geometry top. |
| `endTransition` | `level` finishes with a level rim; `spiral` retains the rising ending. New recipes default to `level`. |
| `pattern`, `pathMode`, `meshSleeve` | Use `null`, `continuous`, `null` for standard vase mode. |
| `sampleStepMm`, `toleranceMm` | Emitted segment length and contour subdivision limits. |
| `boundaryToleranceMm`, `minFeatureMm` | Centerline standoff/section allowance and smallest sampled feature. |
| `maxPoints` | Construction allowance; exhaustion fails without a partial wall. |

The process layer height controls rise per turn; line width controls the nominal
wall bead. Cooling can slow the continuous stroke rather than parking between
turns. The machine must support XYZ extrusion and the required nonplanar motion;
the spiral's slope is checked against its declared angle limit.

Review geometry, process settings and the actual toolpath in Studio before
delivery. Software generation does not establish physical clearance, support,
watertightness or a successful print. [MAKERS](../../MAKERS.md) owns review and
approval; the [shared lifecycle](../../core/print/README.md) owns generation and
delivery of the checked machine bytes.
