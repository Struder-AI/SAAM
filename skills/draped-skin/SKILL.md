---
name: draped-skin
description: Roof-following courses through common slice families, ownership and deposition.
---

# Draped skin

Use the [slice skill](../slice/SKILL.md) and normal geometry/toolpath review.
`skinAssignment({id,...settings})` in
[shared constructions](../../core/print/surface-constructions.mjs) writes a
`construction:'skin'` preset; generation lowers it to an ordinary roof family
and a finite chart-region volume. There is no separate skin producer.

Native spline and mesh roof queries retain their geometry. Select an assembly
component with `part`; `null` selects a single solid. The reference is the highest
exposed surface at XY. Mesh normals remain faceted; discontinuities and absent
reference domains cannot be silently flattened.

| Field | Default | Meaning |
|---|---|---|
| `part` | `null` | Selected roof component. |
| `filament`, `process` | `null` | Material selection and local process overrides. |
| `after` | `[]` | Operation prerequisites. |
| `supportFrom` | `null` | Finalized source assignment for first-course contact; not a support requirement. |
| `layers` | `2` | Number of translated roof courses before ownership allocation. |
| `pitchMm` | `0.2` | Target area-weighted mean normal gap over the entire reference. |
| `spacingFactor` | `1` | XY row pitch divided by bead width. |
| `strokeAngleDeg` | `0` | Row direction in the XY chart. |
| `sampleStepMm` | `0.5` | Physical mapping step, with chord-error refinement. |
| `surveyStepMm` | `0.5` | Roof-domain sampling step. |
| `maxAngleDegOverride` | `null` | Explicit experimental survey angle override. |

Whole-reference normals calibrate the vertical translation; local normal gaps
vary. Constant-normal offset stacks are not implied. The surveyed skin volume
participates in ordinary ownership; unclaimed steep regions retain body
material. Multiple overlapping claims use shared precedence and alternation.
Dependencies schedule body, sleeve, rim and skin courses through one graph.

At an interface, finalized beads supply actual contact distance where present.
Missing material uses the nominal predecessor reference and is reported without
rejecting or moving the authored path. `supportFrom` selects a source and its
prerequisites; it does not certify support. Local volume is segment length ×
width × projected normal gap. No overhang percentage, automatic support, adhesion
or sag model is applied. Support assignment remains a separate judgment.

Machine angle, bead-height, flow and bounds constraints still apply. A .2 mm
skin over a .2 mm horizontal lattice can have a first local gap near .4 mm;
that exceeds a tool limited to .3 mm. Revise the authored process when needed;
generation does not insert transition courses. Finalization publishes sparse
beads after connections and modulation, retaining the selected geometry identity.

Sampling can miss between-grid features; XY spacing is projected, not geodesic.
See [shared travel](../../core/path/README.md#whole-plan-travel-requirement).
Pressure, full-head clearance and physical bead shape are not modeled. Earlier
user-reported prints do not validate this revised pipeline physically.
Legacy `normalMm` requires explicit migration to target-gap `pitchMm`.
