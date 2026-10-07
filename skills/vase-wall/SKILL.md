---
name: vase-wall
description: Extension for a continuous Trace spiral wall and optional solid base.
metadata:
  saam-kind: extension
---

# Standard vase mode

[This extension](scripts/runtime.mjs) generates a continuous spiral curve on
reference sleeve geometry and deposits it with Trace with an open top, hollow interior and optional solid base. It needs
no advanced-vase package, including when `meshSleeve` supplies a fit.
[Advanced vase](../advanced-vase-wall/SKILL.md) adds repeated patterns through Trace.

## Workflow

Use the [shared print tools](../../core/print/USAGE.md) to create/import a print,
adjust its recipe, generate and review it in Studio. Add a sleeve assignment with
`pattern: null`, `pathMode: "continuous"` and `meshSleeve: null`.
A fitted wall may retain `meshSleeve`; a non-null `pattern` selects advanced vase.
Disable other wall/interior producers on the same material region.

For a solid base, keep a [slice](../slice/SKILL.md) assignment (`fillDensity: 1`)
and set a positive `zStartMm` on the process layer grid; the wall claims the part
above it. Without a base, remove the slice assignments and use `zStartMm: 0`.

A [rim](../thick-lip/SKILL.md) can follow a level end.
Experimental [substrate adaptation](../../GLOSSARY.md) defaults off. When enabled,
a raised first wall course retains XYZ but recalculates local bead gaps from
final deposited material, rejecting missing/out-of-range contact. It creates no Supports.

## Input geometry: normally a solid

Use a validated closed mesh or a supported untrimmed closed spline shell with
one outer section throughout the selected interval. A modeled bore is unnecessary;
one bore is allowed. Concave sections work while the requested inset remains one
closed loop. Multiple islands, split/collapsed contours, arbitrary trimmed CAD
faces and open uncapped meshes are unsupported.

Mesh sections are fitted to a periodic NURBS **sleeve**: a reference surface open
along its height, never itself deposited. Horizontal sections are offset inward
by half a bead, with crossings resolved before spiral mapping. The fit adapts to
`sleeveToleranceMm` and reports its residual. A wall thinner than the bead, or a
section unsuitable for a single sleeve, falls back to exact per-section tracing.
Set `sleeveToleranceMm: 0` to require exact tracing within `boundaryToleranceMm`.
Fitted offsets use controlled sampling; source-mesh sections use polygon offsets.
Choose `zEndMm` if the upper geometry is unsuitable.

## Settings

| Setting | Meaning |
|---|---|
| `zStartMm`, `zEndMm` | Wall interval above the component base; `zEndMm: null` uses the geometry top. |
| `endTransition` | `level` finishes with a level rim; `spiral` retains the rising ending. New recipes default to `level`. |
| `pattern`, `pathMode`, `meshSleeve` | Use `null`, `continuous`, and `null` or an explicit mesh fit for standard vase mode. |
| `sampleStepMm`, `toleranceMm` | Emitted segment length and contour subdivision limits. |
| `boundaryToleranceMm`, `minFeatureMm` | Centerline standoff/section allowance and smallest sampled feature. |
| `sleeveToleranceMm` | Target deviation for the fitted-sleeve fast path on meshes (default 0.08 mm); `0` forces the exact per-section wall. |

Sampling follows geometry and tolerances without a construction cap; memory
scales with emitted points, within a generation heap sized to the machine.

The process layer height controls rise per turn; line width controls the nominal
wall bead. Cooling can slow the continuous stroke rather than parking between
turns. SAAMpath retains the spatial spiral; the selected exporter checks its
representation and declared machine envelope.

Follow [MAKERS](../../MAKERS.md) for Studio review and confirmation before
[delivery](../../core/print/README.md). Generation does not establish physical
clearance, support, watertightness or print success.
