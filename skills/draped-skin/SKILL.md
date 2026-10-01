---
name: draped-skin
description: Extension for roof-following Slice courses and their contact with prior material.
metadata:
  saam-kind: extension
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

To survey the selected roof automatically, use
`within:[{kind:'surface-domain',loopsUv:null,fromLayer:-2,toLayer:0,maxSlopeDeg:90,sampleStepMm:0.5}]`.
The footprint follows geometry edits. An explicit `loopsUv` instead selects a
known chart domain. Use `contact:{source:null}` for available supporting material
or name a required producer. There is no serialized skin record; explicit
migration converts old skin settings to these ordinary Slice fields.

Whole-reference normals calibrate translation to the target mean normal gap.
Local gaps vary and directly set volume: segment length × width × normal gap.
This compensation does not depend on modulation or experimental deposition.
XY spacing is projected; these are not constant-normal offset surfaces.

`experimental.substrateAdaptation` defaults off. When enabled, finalized source
beads supply measured contact; an explicit contact source requires contact. Gaps
change volume while preserving authored XYZ. Excessive gaps or missing required
contact reject; no transition courses or sacrificial supports are inserted.

Sampling can miss small features. Machine compatibility is checked by the exporter. Pressure, adhesion, full-head clearance and physical bead shape
are not modeled; earlier prints do not qualify the revised pipeline.
