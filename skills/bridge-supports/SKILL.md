---
name: bridge-supports
description: Experimental. Two-loop breakaway supports between selected base and landing edges.
metadata:
  saam-kind: hybrid
---

# Breakaway bridge supports

Call `apply_extension` with `extensionId:"bridge-supports"` and
`request:{supports:[{id,base,landing}]}`. Use
[geometric selectors](../bridging/SKILL.md): native Slice boundaries or saved
XYZ edges with explicit normal/readiness. Discovery uses `intersect_geometry.edges`;
no deposition is generated to retrieve geometry.

A bed base is explicitly `{kind:"plate",curve:{closed,points:[XYZ,...]}}`, or a
NURBS curve in place of points. Its curve lies on the canonical build plate.
The landing's readiness target requires the final support course. The first
course requires its base's readiness; later courses require their predecessor.
A Slice landing waits as a whole slice. Use part-specific Slice assignments.

Two adjacent loops follow each interpolated course. The first lies beside the
geometric boundary; the second lies one bead farther out. `baseSide` and `landingSide`
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
