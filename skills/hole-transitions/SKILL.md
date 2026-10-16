---
name: hole-transitions
description: Experimental. Add a drill-through membrane, stepped reduction or seeded wave shoulder using ordinary Slice.
metadata:
  saam-kind: extension
---

# Hole transitions

The [four-option guidance](../hole-supports/SKILL.md) owns choice and finishing. Call
`apply_extension` with `extensionId:"hole-transitions"`, the current Bundle revision
and a request below. `sourceAssignment` supplies part, material and process; other
assignments remain. Use new IDs; undo with a Bundle revision before rebuilding.

## Membrane or stepped reduction

```json
{"strategy":"stepped-reduction","id":"screw-hole","sourceAssignment":"body",
 "centerMm":[0,0,4],"boreRadiusMm":2,"counterboreRadiusMm":5,
 "angleDeg":0,"speedMmS":20}
```

`centerMm` is the shoulder in part-local XYZ. Use an unbounded planar Slice owner,
horizontal or tilted, including oblique stack translations; no curved membranes or
steps. Its normal/chart axes define the bore axis/angles. Match the shoulder grid
within `toleranceMm` (default 0.01mm), retaining one bore layer for membrane or four
for stepped reduction. Layer gaps, width, material and pose inherit the source.

Stepped reduction cuts the exemplar's slot, tangent square and tangent octagon into
three overhang courses, bridging at `angleDeg`, +90° and +45°, then resumes the bore.
Both strategies' guides reach the source's last supporting wall using its count,
inset and spacing; local dense zero-loop owners replace the body's fill there.
The report names native indices. Angle defaults to 0; speed inherits the source.

Use the same request with `strategy:"membrane"` for one straight dense fill at the
shoulder, anchored on the preceding rim. A thin wafer closes the bore for later
piercing or drilling. The helper wires rim walls → membrane → first bore walls;
stepped reduction wires rim walls → stages → first round-bore walls. Both require
source wall loops at their boundaries. `after` adds prerequisites. Fill traversal
is a soft preference; the scheduler owns entry and travel.

## Experimental wave shoulder

Supply `strategy:"wave"`, `id`, `sourceAssignment`, `surface`, `domainUv` and `seedUv`.
Place an ordinary Slice spline reference or native patch at the **top of the last
wave course**. The domain has a CCW outer loop, CW bore hole and anchoring rim.
The seed denotes already printed material in the same chart, not new deposition.

`layers` defaults to 1; height inherits the source stack/process. Geometry stays unchanged. Defaults: spacing 0.3mm, propagation step 0.1mm, tolerance 0.01mm,
sample step 0.5mm, speed 5mm/s and fan 100%; fields are `lineSpacingMm`, `propagationStepMm`, `toleranceMm`, `sampleStepMm`,
`speedMmS` and `fanPercent` (experimental values).
`direction` accepts an XYZ translation direction; omission uses the reference's
mean normal. `toolPose` inherits the source or accepts `{alignToSliceNormal:true}`.
Curved charts use existing [wave fill](../wave-overhangs/SKILL.md) spacing, calibrated
gaps, residuals and limits; no implicit final perimeter, normal-offset stacks,
singular/folded charts or multi-chart stitching.

`seedFrom` selects printed seed material and `boreTo` continuing walls; either accepts a selector or array:
`{assignment,index,group:"walls"}` for native Slice, or `{assignment,repetition}`
for explicit Trace. Both boundaries are required (`after` can replace seedFrom).
The helper wires seed → wave completion → selected walls, independently of world Z.
Review contact and residuals; [examples](examples/README.md) establish no physical result.
