---
name: bridge-supports
description: Experimental. Interpolate matched base and landing curve controls into ordinary Trace courses for removable bridge supports, open or closed.
metadata:
  saam-kind: hybrid
---

# Breakaway bridge supports

Use **two adjacent loops per course** for every breakaway, around holes or open
edges. Prefer a gently bowed or kinked bed base when space permits: its bend stiffens
the support. Taper that bend toward the actual landing; preserve contact and removal access.
The helper offsets selected part edges outward by half a bead; unattached bed bases stay selected.
Curves use `{closed,points:[XYZ,...]}` or `{closed,nurbs:{degree,knots,controlPoints,weights?}}`.
Geometry matches their control nets without changing their shapes. `correspondence` sets
`baseDirection`/`landingDirection` (`forward` or `reverse`, default forward) and
`baseSeam`/`landingSeam` (normalized curve parameters, default 0; open curves use 0).

Call `apply_extension` with `extensionId:"bridge-supports"`, current revision and
`request:{supports:[{id,base,landing,layerHeightMm:0.22,baseFrom,landingTo}]}`. Curves are
component-local; supply `part`; height defaults to process.layerMm. The ribbon
reference direction follows mean paired-control travel. Rounded average travel /
height chooses divisions; only the compatible controls are interpolated.
Trace deposits both loops through the offset landing; the second lies one bead
farther from the host. Bead height uses average spacing; width/speed inherit process values.
`beadWidthMm`, `speedMmS` override them; `sampleStepMm` controls Trace sampling.

`baseFrom` selects printed base material; omit it for an unattached bed base. Boundaries accept a selector or array.
`landingTo` selects the later bridge: `{assignment,index,group:"fill"}` for a native
Slice operation, or `{assignment,repetition}` for explicit Trace (name or ordinal).
The helper wires brim/base → successive two-loop courses → landing; loop entry
and unrelated work stay free. `after` accepts existing base operation IDs.
`lastOperationId` remains in the report; an omitted landing is reported unbound.

Always add a few brim loops where they fit. Bed bases receive three contour passes,
clipped clear of first-layer part material and other authored supports; the report
names clipping or omission. On printed bases, author supported adhesion contours.
Review actual bead and nozzle clearance; brims must not collide with other work.
The [hole singleton](examples/removable.json) uses this same standard. Rebuild after
process changes; review chronology, contact and removal. [Hole guidance](../hole-supports/SKILL.md)
owns membrane alternatives. Software generation does not establish physical qualification.
