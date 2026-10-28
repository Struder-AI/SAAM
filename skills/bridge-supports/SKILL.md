---
name: bridge-supports
description: Experimental. Two adjacent edge-following Trace paths between selected base and landing edges; a plate base is optional.
metadata:
  saam-kind: hybrid
---

# Breakaway bridge supports

Use [support guidance](../supports/SKILL.md) to decide whether a ribbon/ledge edge or hole/recess landing edge needs support. Two adjacent paths support the selected edge from a printed base toward its landing. Choose a plate base only when the support should start on the bed.

Call `apply_extension` with `extensionId:"bridge-supports"` and `request:{supports:[{id,base,landing}]}`. Select a real model edge or portion with the [shared selectors](../../GEOMETRY.md#selecting-edges); `intersect_geometry.edges` previews the curve and derives crossed native Slice targets without deposition. Supply those source selectors directly. A copied XYZ curve needs a separately supplied normal and owning native Slice readiness.

Every crossed part slice depends on the local supporting landing-curve pieces. Each piece of the support requires its corresponding piece in the preceding course. These are curve-level requirements, preserving interleaving with the part; a whole sloping-course or wall barrier can force unrelated high work before a low body slice.

Adjacent material determines the outside automatically. The first support path lies half a support bead width outside the selected part edge; the second lies one bead width farther out. Supply original edges without a manual clearance offset or left/right sign. Changing outside directions split the support into reported source intervals. Intermediate paths follow matched base/landing curves through ordinary Trace.

A bed base is `{kind:"plate"}`: its first-layer footprint projects the offset landing to the bed. An optional `curve:{closed,points:[XYZ,...]}` (or NURBS curve) supplies a different bed footprint. A printed base uses an edge selector. Bed bases receive three clipped adhesion passes.

Inspect the whole support height against the part, feet and other supports. Projection through existing material needs a printed base or a clear route. The constructor rejects sampled centreline intersections with the part; this does not establish bead or nozzle clearance. Preserve the selected attachment geometry while resolving ordering.

`layerHeightMm`, `beadWidthMm` and `speedMmS` override process values; `sampleStepMm` bounds sampling. Course spacing determines local normal-height profiles. `correspondence` sets base/landing direction (`forward`/`reverse`) and normalized seam. Compatible control nets preserve curves. Scheduling owns traversal and transfers; Export checks the selected machine.

Review [hole](examples/removable.json) and [nonplanar ledge](examples/nonplanar.json) Trace examples, attachment, removal and cooling. Physical printing remains unqualified. [Hole guidance](../hole-supports/SKILL.md) owns bore/recess alternatives.

For a ribbon, select each requested width rim separately and cover the requested region up to neighbouring pillars. Measure endpoint gaps against actual pillar surfaces, then inspect full-height clearance. Show selected edges and resulting paths from useful angles. Program checks do not establish correct coverage, attachment or offset.

For example, a mesh edge chain on the first Boolean operand uses:
```json
{"supports":[{"id":"rim-support","base":{"kind":"plate"},"landing":{"model":{"path":[0],"vertices":[12,16,20,24]},"range":[0.1,0.9],"slice":{"assignment":"body"}}}]}
```
Vertex IDs come from the manufacturing mesh; consecutive IDs must share actual edges. Selection resolves at the current edit revision and saves ordinary Trace curves/settings. Reapply after changing source geometry; the report retains selectors, intervals, crossed slices and local prerequisites.
