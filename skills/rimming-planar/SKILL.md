---
name: rimming-planar
description: Experiment with thin walls that support selected edges so a planned bridge can span the area between them. A maker-assigned spline surface connects the bed or another edge to the supported edge; paired beads use horizontal offsets.
---

# Rimming with horizontal offsets

Use when selected edges can anchor bridging across an otherwise unsupported
area. The reference is an open bivariate spline surface whose top edge matches
the supported edge or edge portion, and whose base rests on the bed or another
selected edge. Its sides complete the surface. Either boundary may curve.
Prefer a slightly curved base when convenient for strength; it can lean away
from the part to avoid other geometry. Staying within roughly 45 degrees of
vertical is guidance only, not a check or rejection rule.

The maker and agent assign the edges and reference surface through judgment,
following [D-025](../../DECISIONS.md#d-025--support-areas-assigned-through-judgment).
No overhang-angle scan assigns support. For maker work, read
[MAKERS.md](../../MAKERS.md). For development, start with the
[builder orientation](../../BUILDERS.md) and follow its task-specific references.

## Process and tools

Enable `skills.rimming-planar` in the [shared shell plan tools](../../core/print/USAGE.md).
MCP exposes the same plan template, adjustment, manual and review tools. Supply
`surfaces` before toolpath generation. Generate through the same
composer and machine exporter; Studio reviews that export, which is delivered
unchanged. Intermediate motion is transient. No additional approval is added.

Each horizontal section of the reference surface produces two curves offset
outward **within that slice**, at 0.5 and 1.5 line widths. At 0.4 mm width their
centers are 0.2 and 0.6 mm away, giving an approximately 0.8 mm solid wall with
its inner bead boundary at the reference surface. There is no conventional
support top gap or dense interface. Standard top-gap settings do not apply.
Open stroke ends are left open; there is no extra side-cap extrusion.

The [normal-offset sibling](../rimming-normal/SKILL.md) uses the same reference
surface with 3D normal offsets. Compare them in separate print bundles with
identical geometry, reference surfaces, width and process settings. Do not print
both on the same surface and double the material.

## Surface assignment

Each entry in `surfaces` has exactly these fields:

| Field | Meaning |
|---|---|
| `id` | Unique lowercase name. |
| `reason` | Why this selected edge needs rimming support. |
| `baseEdge` | `bed`, or a description of the exact base edge/portion. |
| `supportedEdge` | Description of the exact edge/portion to support. |
| `basePart`, `supportedPart` | Assembly component IDs, or null for a single part. Bed bases use null. |
| `outwardSide` | `1` along the reference surface's U×V normal, or `-1` opposite; choose the side away from the part. |
| `degreeU`, `degreeV` | B-spline degrees 1–3, each smaller than its control-point count. |
| `controlPoints` | Rectangular XYZ control net: U runs along the edge, V runs from base to top. |

Coordinates are in millimeters: XY relative to the whole print placement, Z
above the bed. Each U row's first point belongs to the base control edge and
last point to the supported control edge. Interior V points shape the surface.
The tool constructs a nonrational tensor-product B-spline with uniform clamped
knots; it preserves its exact boundary curves, not a straight chord between
their endpoints. This initial authoring format does not import arbitrary trimmed
CAD faces, custom knot vectors or rational edge curves. The agent must construct
the control edges to match the selected geometry; descriptive edge names alone
are not an automatic geometric binding or proof of a match to an imported mesh.

Example: a straight selected edge from X=0 to X=12, based on the bed 2 mm
outward of the part, rising to Y=0/Z=8. U runs in +X, so U×V points outward in -Y.

```json
{
  "id":"front-rim",
  "reason":"Anchor this edge so the planned bridge can span to the opposite edge.",
  "baseEdge":"bed", "basePart":null,
  "supportedEdge":"front lower edge", "supportedPart":null,
  "outwardSide":1, "degreeU":1, "degreeV":1,
  "controlPoints":[[[0,-2,0],[0,0,8]],[[12,-2,0],[12,0,8]]]
}
```

For an edge-based barbell rim, supply the lower end's upper edge as the base
boundary and the upper end's lower edge as the supported boundary, with matching
component references. For example, replace the base Z values with 2 and describe
the lower edge at Z=2; the selected top edge can remain at Z=8. Both boundaries
can be curved with additional U controls. Reason about actual contact and the
bridge direction/anchorage with the maker; the software does not establish that
the barbell prints successfully.

## Sampling and boundaries

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Select this skill. |
| `surfaces` | `[]` | Explicit reference surfaces described above. |
| `sampleStepMm` | `0.5` | Maximum offset-curve segment length. |
| `toleranceMm` | `0.01` | Offset-curve midpoint chord target. |
| `minFeatureMm` | `0.2` | Native section sampling feature scale. |
| `offsetTightness` | `1` | Blend a fixed-size loose NURBS offset field (`0`) toward the exact section offset (`1`). Exact is the default; use loose values only for exploratory spline support geometry. |

This implementation requires each control row to rise strictly in Z along V,
which makes section-offset refinement well-defined; it does not impose an angle
limit. Regular surfaces with a usable normal and nonfolding offsets are the
intended input. General offset self-intersection cleanup and full head collision
checking are not implemented. A surface's tight curvature may produce overlapping
beads; inspect the export. Shared machine checks still apply to emitted motions.

Slices use the global bed grid. Curved bases begin in partial sections; their
initial bead volumes use the local reference-base gap. Top edges falling between
slice heights retain a stair-step residual, less than one reference layer; this
skill does not silently add a nonplanar finishing pass to force exact top contact.
The reference boundary matches the assigned edge, while sampled deposition and
rectangular bead modeling are approximations. That distinction matters when
judging whether the next operation can bridge.

The shared plan boundary validates assigned settings once. The internal
`rimmingResults` producer consumes that validated plan; standalone developer
callers first use `validatePlan` or `validateRimming`. Generation checks newly
constructed sections and operation dependencies at their point of use.

The producer returns `{results, dependencyChanges}` and does not modify
`modelResults`. Each change is `{operationId, after, mode: 'append'}`. Callers
apply these ordered prerequisites with `applyResultDependencies` from
`core/print/generate.mjs`, then combine the returned rim results with the updated
model results before scheduling. Existing prerequisites and append order remain
intact; the producer does not edit an earlier stage's operations.

Both rimming skills obey the same ordering rules:

1. Every part of the assigned base edge must have printed before any rim starts.
2. The entire rim must finish before anything it supports starts printing.
3. Among operations whose dependencies are satisfied, try to keep printing
   heights similar across all skills. This is a scheduling preference, not a gate.

For horizontal boundaries these dependencies reduce to ordinary completion at
the base and supported-edge heights. Nonhorizontal boundaries still require
completion across the whole edge, not release of its lower portions first.
The current component binding conservatively waits for every base-component
operation starting at or below the base control edge's maximum Z, including
atomic operations crossing that height. Every operation on a named supported
component waits for the last rim operation. For a single part (null reference),
operations reaching the top control edge's minimum Z wait. Use component/region
boundaries to distinguish the base from the supported feature if an atomic
operation covers both; contradictory dependencies are reported as a cycle.

The shared composer prefers ready operations with lower maximum deposition Z,
respecting the selected batch size and all dependencies. Within a rim, paired
strokes still follow increasing original horizontal section height. It does not
split a continuous operation to match another skill's height.

Supports are external sacrificial operations, not
`composition.regions` of the part. Regional part recipes, mesh and spline inputs
use the same composer. Travel clears deposited material through the shared builder.
Automatic splitting inside an atomic continuous operation is not implemented.

Software tests cover analytic offsets, curved boundaries, sampling refinement,
edge-based barbell ordering, and S5/H2D/synthetic configured Dobot export round
trips. H2D/Dobot retain their experimental machine limitations. No physical print
or removal-strength validation has been performed.
