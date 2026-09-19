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

Standard mode follows changing-height geometry sections. On a mesh it fits one
periodic NURBS sleeve to the wall interval and follows its loose offset, which
avoids rebuilding a section, offset and contour at every rising sample and is
dramatically faster on curved walls. `sleeveToleranceMm` (default 0.08 mm) is the
target deviation from the true section: the fit scales its resolution toward it
and reports the residual achieved. A wall thinner than the bead, or a section
that is not a single sleeve, returns to the exact per-section wall. Set
`sleeveToleranceMm: 0` to force the exact wall — for example when a corner or
feature must be held to `boundaryToleranceMm` rather than the sleeve tolerance.
Spline geometry always uses the exact section path. Choose `zEndMm` explicitly if
the upper geometry is unsuitable; generation never silently shortens the wall.

## Settings

| Setting | Meaning |
|---|---|
| `zStartMm`, `zEndMm` | Wall interval above the component base; `zEndMm: null` uses the geometry top. |
| `endTransition` | `level` finishes with a level rim; `spiral` retains the rising ending. New recipes default to `level`. |
| `pattern`, `pathMode`, `meshSleeve` | Use `null`, `continuous`, `null` for standard vase mode. |
| `sampleStepMm`, `toleranceMm` | Emitted segment length and contour subdivision limits. |
| `boundaryToleranceMm`, `minFeatureMm` | Centerline standoff/section allowance and smallest sampled feature. |
| `sleeveToleranceMm` | Target deviation for the fitted-sleeve fast path on meshes (default 0.08 mm); `0` forces the exact per-section wall. |

A wall takes as many points as its geometry, pitch and tolerances require;
there is no construction cap to exhaust. An ordinary 100 mm × 250 mm vase at
0.2 mm pitch needs about 640k points. Memory scales with the emitted program
(about 0.2 KB per point through generation and export), bounded only by the
Node heap; raise `--max-old-space-size` for extreme programs.

The process layer height controls rise per turn; line width controls the nominal
wall bead. Cooling can slow the continuous stroke rather than parking between
turns. The machine must support XYZ extrusion and the required nonplanar motion;
the spiral's slope is checked against its declared angle limit.

Review geometry, process settings and the actual toolpath in Studio before
delivery. Software generation does not establish physical clearance, support,
watertightness or a successful print. [MAKERS](../../MAKERS.md) owns review and
approval; the shared print lifecycle owns generation and
delivery of the checked machine bytes.
