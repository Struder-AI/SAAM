---
name: bridge-supports
description: Experimental. Two-loop breakaway supports between selected base and landing edges.
metadata:
  saam-kind: hybrid
---

# Breakaway bridge supports

Call `apply_extension` with `extensionId:"bridge-supports"` and
`request:{supports:[{id,base,landing}]}`. Select printed edges using
`{assignment,index,edge:{loop,ring:0}}` for a native Slice perimeter, or
`{assignment,repetition,edge:{curve}}` for an authored Trace curve. Optional
`part` disambiguates a producer's component. Edge discovery is available through
`intersect_geometry`'s `edges` request. The tool resolves geometry and dependencies.

A bed base is explicitly `{kind:"plate",curve:{closed,points:[XYZ,...]}}`, or a
NURBS curve in place of points. Its curve lies on the canonical build plate.
A printed base uses the edge selector above. The landing selects its future
printed edge; that edge automatically requires the final support course.
The first course requires its printed base, and each later course requires only
its predecessor. No operation IDs or height-based ordering are authored.

Two adjacent loops follow each interpolated course. The first lies beside the
host's bead; the second lies one bead farther out. `baseSide` and `landingSide`
choose right (`1`, default) or left (`-1`) of the selected curve. Native Slice
perimeters keep material left, so their exterior is right. Plate bases get three
clipped adhesion passes. Prefer bowed/kinked bases where space permits.

`layerHeightMm`, `beadWidthMm`, `speedMmS` and `sampleStepMm` override process
values. `correspondence` sets base/landing direction (`forward`/`reverse`) and
normalized seam. Compatible control nets preserve the selected curves; rounded
mean control travel determines the number of courses. Material frames derive
from each course ribbon, including tilted constructions. Scheduling owns entry,
interleaving and transfers; Export checks the selected machine.

Saved [hole](examples/removable.json) and [nonplanar ledge](examples/nonplanar.json)
examples retain ordinary Trace data. Review attachment, removal and cooling;
physical printing remains unqualified. [Hole guidance](../hole-supports/SKILL.md)
owns alternatives.
