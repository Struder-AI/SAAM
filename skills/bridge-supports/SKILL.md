---
name: bridge-supports
description: Experimental. Two-loop removable supports between matched base and landing curves, open or closed.
metadata:
  saam-kind: hybrid
---

# Breakaway bridge supports

Use **two adjacent loops per course** for holes and open edges. Prefer a gently
bowed or kinked bed base where space permits; the bend stiffens the support.
Taper it toward the actual landing, preserving contact and removal access.
The helper offsets part edges outward by half a bead; unattached bed bases stay selected.

Call `apply_extension` with `extensionId:"bridge-supports"`, current revision and
`request:{supports:[{id,part,base,landing,layerHeightMm:0.22,baseFrom,landingTo}]}`.
Curves are component-local `{closed,points:[XYZ,...]}` or `{closed,nurbs:{degree,knots,controlPoints,weights?}}`.
`correspondence` sets `baseDirection`/`landingDirection` (`forward`/`reverse`) and
`baseSeam`/`landingSeam` (normalized, default 0; open curves use 0). Control matching preserves shapes.
Height defaults to process.layerMm; rounded mean control travel sets divisions and bead height.
Width/speed inherit process; `beadWidthMm`, `speedMmS`, `sampleStepMm` override them.
The second loop lies one bead farther from the host; landing contact stays on the first.

`baseFrom` selects printed base operations; omit for bed bases. `landingTo` selects
later bridges: `{assignment,index,group:"fill"}` for Slice or `{assignment,repetition}`
for Trace. Either accepts an array. The helper wires brim/base → courses → landing;
loop entry and unrelated work stay free. `after` adds base IDs; the report retains
`lastOperationId` and flags unbound landings. Review chronology and bead/nozzle clearance.

Always add a few brim loops where they fit. Bed bases get three contour passes,
clipped clear of first-layer part material and other authored supports; clipping/omission is reported.
On printed bases, author supported adhesion contours. Do not let brims collide with other work.
The [hole singleton](examples/removable.json) and [nonplanar ledge](examples/nonplanar.json) use this standard; [hole guidance](../hole-supports/SKILL.md)
owns alternatives. Rebuild after process changes; review removal. Physical printing remains unqualified.
