---
name: draped-skin
description: Guidance for roof-following Slice courses and their contact with prior material.
metadata:
  saam-kind: guidance
---

# Roof-following Slice courses

Use [Slice](../slice/SKILL.md), with a roof reference, a translated stack and
an owned surface-domain volume. Choose loops, fill angle and density normally;
there is no separate skin producer. The roof query selects the highest exposed
surface at each XY position, not arbitrary overhanging or disconnected surfaces.

For a thin finish, use zero loops and solid rows. Assign the body below that
volume separately. `surface:{kind:'roof',offsetMm:0}` follows the selected part;
`stack:{firstLayerMm:0.2,layerMm:0.2}` requests mean normal gaps. A
`within` surface-domain volume selects the footprint and course interval.
Use ordinary part/material selection and operation dependencies.

The existing `construction:'skin'` authoring preset surveys a roof footprint
and lowers to those ordinary Slice fields. Its controls are `layers` (2),
`pitchMm` (0.2), `spacingFactor` (1), `strokeAngleDeg` (0), `sampleStepMm` (0.5),
`surveyStepMm` (0.5), and optional `supportFrom`. Common `part`, `filament`,
`process` and `after` settings apply. This convenience record still exists;
it is not another toolpath skill. Legacy `normalMm` needs explicit migration.

Whole-reference normals calibrate translation to the target mean normal gap.
Local gaps vary and directly set volume: segment length × width × normal gap.
This compensation does not depend on modulation or experimental deposition.
XY spacing is projected; these are not constant-normal offset surfaces.

`experimental.substrateAdaptation` defaults off. When enabled, finalized source
beads supply measured contact; explicit `supportFrom` requires contact. Gaps
change volume while preserving authored XYZ. Excessive gaps or missing required
contact reject; no transition courses or sacrificial supports are inserted.

Sampling can miss small features. Machine angle, bead-height, flow and bounds
limits apply. Pressure, adhesion, full-head clearance and physical bead shape
are not modeled; earlier prints do not qualify the revised pipeline.
