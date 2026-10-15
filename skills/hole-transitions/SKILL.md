---
name: hole-transitions
description: Experimental. Add stepped-reduction bridge courses or a seeded wave shoulder around a retained bore using ordinary Slice.
metadata:
  saam-kind: extension
---

# Hole transitions

The [four-option guidance](../hole-supports/SKILL.md) owns the choice and finishing.
Call `apply_extension` with `extensionId:"hole-transitions"`, the current Bundle
revision and one request below. `sourceAssignment` selects the ordinary Slice
owner supplying part, material and process. Other assignments remain present.
IDs must be new; undo the application with a Bundle revision before rebuilding
for changed geometry, layers, width or strategy. There is no separate feature runtime.

## Stepped reduction

```json
{"strategy":"stepped-reduction","id":"screw-hole","sourceAssignment":"body",
 "centerMm":[0,0,4],"boreRadiusMm":2,"counterboreRadiusMm":5,
 "angleDeg":0,"speedMmS":20}
```

Measure `centerMm` at the shoulder in part-local XYZ. The source must be an
unbounded planar Slice owner: horizontal or an authored plane, with a positive
translation direction. Its normal and chart axes define the bore axis and bridge
angles. The shoulder must match its grid within `toleranceMm` (default 0.01mm);
four continuing circular bore layers must exist above it. Layer height, first gap,
bead width, material and pose inherit the source. Assembly sources select one part.

The extension cuts the exemplar's slot, tangent square and tangent octagon into
the first three overhang courses, retaining the original host as a Boolean operand.
Three local zero-loop dense Slice owners bridge at `angleDeg`, +90° and +45°;
each reaches two bead widths beyond the counterbore for anchoring. Their geometry
claims remove that material from the unbounded body's ordinary fill. The body keeps
its existing walls/fill elsewhere and resumes the round bore on the fourth course.
The report names actual source layer indices. `speedMmS` defaults to source speed;
`angleDeg` defaults to 0. Inspect first-course span, anchoring and the enlarged opening.
This supports tilted planar references and oblique stack directions, not curved slices.

## Experimental wave shoulder

Supply `strategy:"wave"`, `id`, `sourceAssignment`, `surface`, `domainUv`, and
`seedUv`. The surface is an ordinary Slice spline reference (authored control net)
or named native patch, placed at the **top of the last wave course**. The domain
contains a CCW outer loop and CW bore hole; the seed is the already supported
outer rim in the same chart and is not printed again. Include the anchoring rim
in the domain. Wrong seed placement can request unsupported deposition.

`layers` defaults to 1; `layerHeightMm` inherits the source stack/process.
The extension adds an ordinary `surface-domain` Slice with `fillOrder:"fronts"`
and leaves host geometry unchanged. Defaults are spacing 0.3mm, propagation step
0.1mm, tolerance 0.01mm, sample step 0.5mm, speed 5mm/s and fan 100%; the corresponding
fields are `lineSpacingMm`, `propagationStepMm`, `toleranceMm`, `sampleStepMm`,
`speedMmS` and `fanPercent`. They are experimental values, not machine calibration.
`direction` accepts an XYZ translation direction; omission uses the reference's
mean normal. `toolPose` inherits the source or accepts `{alignToSliceNormal:true}`.
Spline charts may be curved: physical spacing and calibrated mean-normal gaps stay
with the existing [wave fill](../wave-overhangs/SKILL.md), including its residual reports,
chart/sampling limits and lack of an implicit final perimeter. Normal-offset stacks,
singular/folded charts and multi-chart stitching are unsupported.

For either strategy `after` may name exact operations printing the supporting
base; never make a transition wait for the entire body above it. Review chronological
deposition, ownership and the next bore wall in Studio. Software success establishes
no adhesion, cooling, removal or physical result. [Example inputs](examples/README.md)
include planar, tilted-plane and curved wave constructions and the original exemplar.
