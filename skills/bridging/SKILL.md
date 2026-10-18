---
name: bridging
description: Extension for Trace spans between supporting rims, using the shared printed-edge construction.
metadata:
  saam-kind: extension
---

# Bridging

Call `apply_extension` with `extensionId:"bridging"` and
`request:{id,base,target?}` using printed-edge selectors
`{assignment,index,edge:{loop,ring:0}}` or
`{assignment,repetition,edge:{curve}}`. One closed boundary fills its interior
with straight spans; two bounds form a loft. Nonplanar endpoints remain in 3D.
This uses exactly the same geometry and prerequisites as a
[hole membrane](../hole-transitions/SKILL.md#membrane-and-wave). Supporting edges
become prerequisites automatically. Process inherits the base; optional
`spacingMm`, `layerHeightMm`, `beadWidthMm`, `speedMmS`, `sampleStepMm`,
`angleDeg`, `normalSide` and paired-curve `correspondence` control construction.

Ordinary Slice walls around a solid use Slice directly. For a wave growing
from one printed edge toward a future geometric edge, use
[hole transitions](../hole-transitions/SKILL.md#membrane-and-wave).

The former rail/press/jog helper and bridge-record generator are retired.
Old recipes need explicit edge selection and review; they are not silently
translated into a second span algorithm. Saved toolpaths remain inspectable.
Review attachment, span, cooling and removal in Studio before Export.
