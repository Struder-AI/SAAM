---
name: vase-wall
description: A hollow vase or tube as one continuous rising spiral wall, with an optional solid base.
---

# Standard vase mode

Use for conventional vase printing: one continuous spiral wall, an open top,
and an optional solid base. The input describes the vessel's exterior; the
recipe leaves the interior hollow. No pattern or `meshSleeve` preparation is needed.
For repeated loops, authored patterns or adjustable mesh conformance, choose
[advanced vase mode](../advanced-vase-wall/SKILL.md).

Both techniques use `construction: "sleeve"` in `plan.slices.assignments`.

## Workflow

Use the [shared print tools](../../core/print/USAGE.md) to create/import a print,
adjust its recipe, generate and review it in Studio. Add a sleeve assignment with
`pattern: null`, `pathMode: "continuous"` and `meshSleeve: null`.
When converting an advanced recipe, reset all three explicitly.
Disable other wall/interior producers on the same material region.

For a solid base, keep a [slice](../slice/SKILL.md) assignment (`fillDensity: 1`)
and set a positive `zStartMm` on the process layer grid; the wall claims the part
above it. Without a base, remove the slice assignments and use `zStartMm: 0`.
Remove unwanted overlapping assignments. A closed top is not part of this mode.

Sleeve `zStartMm`/`zEndMm` select its band; ordinary assignments own material
outside it. A [rim assignment](../thick-lip/SKILL.md) can follow a level ending.

## Input geometry: normally a solid

Use a validated closed mesh or a supported untrimmed closed spline shell with
one outer section throughout the selected interval. A modeled bore is unnecessary;
one bore is allowed. Concave sections work while the requested inset remains one
closed loop. Multiple islands, split/collapsed contours, arbitrary trimmed CAD
faces and open uncapped meshes are unsupported.

Standard mode follows changing-height geometry sections. On a mesh it fits one
periodic NURBS **sleeve** (a surface periodic around the part and open along its
height, the side of a tube; never itself deposited). Native horizontal NURBS
sections are offset inward by half a bead and crossings resolved before contour
correspondence and spiral mapping. `sleeveToleranceMm` (default 0.08 mm) is the
target deviation from the true section: the fit scales its resolution toward it
and reports the residual achieved. A wall thinner than the bead, or a section
that is not a single sleeve, returns to the exact per-section wall. Set
`sleeveToleranceMm: 0` to force the exact wall — for example when a corner or
feature must be held to `boundaryToleranceMm` rather than the sleeve tolerance.
Fitted offsets are loose, with controlled sampling; source-mesh sections use
polygon offsets. Choose `zEndMm` if the upper geometry is unsuitable.

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
approval; the [shared lifecycle](../../core/print/README.md) owns generation and
delivery of the checked machine bytes.
