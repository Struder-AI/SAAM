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

Native spline/mesh queries retain the highest exposed surface at XY and faceted
mesh normals. Select an assembly component with `part`; `null` selects a single
solid. Discontinuities and absent reference domains are not flattened.

| Field | Default | Meaning |
|---|---|---|
| `part` | `null` | Selected roof component. |
| `filament`, `process` | `null` | Material selection and local process overrides. |
| `after` | `[]` | Operation prerequisites. |
| `supportFrom` | `null` | Finalized source for first-course substrate adaptation and prerequisites. |
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

Substrate adaptation is experimental and defaults OFF:
`plan.experimental.substrateAdaptation`. OFF uses nominal reference-derived
normal gaps without final-material queries. ON measures finalized source beads
at interfaces; an explicit `supportFrom` requires contact and missing substrate
rejects. Measured gaps change bead volume while preserving authored skin XYZ.
This is distinct from independently assigned 3D-printing supports; no overhang
percentage, automatic support, adhesion or sag model is applied.

Local volume is segment length × width × projected normal gap. Machine angle,
bead-height, flow and bounds limits apply in both modes. With adaptation ON,
a .2 mm skin over a .2 mm horizontal lattice can measure nearly .4 mm locally,
exceeding a tool limited to .3 mm. No transition courses are inserted.
Finalization preserves selected geometry identity and sparse bead coverage.

Sampling can miss small features; XY spacing is projected. See [shared travel](../../core/path/README.md#whole-plan-travel-requirement).
Pressure, full-head clearance and physical bead shape are not modeled. Earlier
user-reported prints do not validate this revised pipeline physically.
Legacy `normalMm` requires explicit migration to target-gap `pitchMm`.
