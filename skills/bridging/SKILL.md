---
name: bridging
description: Extension for Trace spans between supporting rims, using the shared geometric-edge construction.
metadata:
  saam-kind: extension
---

# Bridging

Call `apply_extension` with `extensionId:"bridging"` and
`request:{id,base,target?}`. Select geometric Slice boundaries with
`{slice:{assignment,index,part?},loop}`, or saved XYZ curves with
`{geometry:id,normal?,readiness}`. Readiness is a separate manufacturing
prerequisite; discovery uses `intersect_geometry.edges`. One closed boundary
fills its interior; two bounds form a loft. Endpoints remain in 3D.
This uses exactly the same geometry and prerequisites as a
[hole membrane](../hole-transitions/SKILL.md#membrane-and-wave). Supporting edges
become prerequisites automatically. Process inherits the base; optional
`spacingMm`, `layerHeightMm`, `beadWidthMm`, `speedMmS`, `sampleStepMm`,
`angleDeg`, `normalSide` and paired-curve `correspondence` control construction.

Ordinary Slice walls around a solid use Slice directly. For a wave growing
from a ready geometric boundary toward a target edge, use
[hole transitions](../hole-transitions/SKILL.md#membrane-and-wave).

Former rail/press/jog and bridge-record generators are deprecated.
Saved toolpaths remain inspectable.
Review attachment, span, cooling and removal in Studio before Export.
