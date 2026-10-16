---
name: bridge-supports
description: Experimental. Interpolate matched base and landing curve controls into ordinary Trace courses for removable bridge supports, open or closed.
metadata:
  saam-kind: hybrid
---

# Breakaway bridge supports

Select the actual base and landing edges on the host part; a base may be on the
bed or printed material. The extension moves part edges outward by half the bead
width, using Geometry's curve ribbon and adjacent material to choose the side.
The factor is code-tunable, not an agent setting; unattached bed bases stay selected.
Curves use `{closed,points:[XYZ,...]}` or `{closed,nurbs:{degree,knots,controlPoints,weights?}}`.
Geometry matches their control nets without changing their shapes. `correspondence` sets
`baseDirection`/`landingDirection` (`forward` or `reverse`, default forward) and
`baseSeam`/`landingSeam` (normalized curve parameters, default 0; open curves use 0).

Call `apply_extension` with `extensionId:"bridge-supports"`, current revision and
`request:{supports:[{id,base,landing,layerHeightMm:0.22,baseFrom,landingTo}]}`. Curves are
component-local; supply `part`; height defaults to process.layerMm. The ribbon
reference direction follows mean paired-control travel. Rounded average travel /
height chooses divisions; only the compatible controls are interpolated.
Rational controls include weights. Trace samples and deposits the resulting curves,
from the first division through the exact offset landing curve.
Bead height uses that average spacing; width/speed inherit process values.
`beadWidthMm`, `speedMmS` override them; `sampleStepMm` controls Trace sampling.

`baseFrom` selects printed base material; omit it for an unattached bed base.
`landingTo` selects the later bridge: `{assignment,index,group:"fill"}` for a native
Slice operation, or `{assignment,repetition}` for explicit Trace (name or ordinal).
The helper wires base → sequential support courses → landing; unrelated work stays
free. `after` accepts existing base operation IDs. `lastOperationId` remains in the
report; an omitted landing is reported unbound. Review chronology and bead contact.

The [singleton example](examples/removable.json) has 20 circular Trace courses sampled within 0.001 mm, ending at Z4 before its landing bridge at Z4.2. Rebuild after process changes; review contact, removal and clearance. Membranes use ordinary Slice; see [hole guidance](../hole-supports/SKILL.md). Software generation does not establish physical print qualification.
