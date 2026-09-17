# Regions

```saam-components
offset | @core/region/offset.mjs::offsetRegion | closed 2D loops; signed delta; precision and join options | remaining or expanded material loops | Coordinate units match delta and precision; positive expands; nonzero winding; rejects invalid precision/range.
clipperContext | @core/region/clipper.mjs::clipperContext | region sets; precision; margin; optional origin | encode/decode functions sharing one grid | Both operands share origin and scale; reject nonfinite/out-of-range coordinates; no native handles escape.
booleanPaths | @core/region/clipper2.mjs::booleanPaths | integer subject and clip paths; operation; open flag | integer result paths | NonZero winding; preserveCollinear false; releases owned WASM objects on success/failure.
```

```saam-page 4_regions
title 4 — Shape regions
sub Level 1 · material loops and deposition contours are distinct
parent 0_system region
in region query
out regions
port query | region query
box offset | 4.1 | offset material | >4a_offset
box boolean | 4.2 | combine regions | >4b_boolean
box wall | 4.3 | recover wall tracks | >4d_perimeters
box surface | 4.4 | offset on surface | >4c_surface
box reserve | 4.5 | clip reservation | @core/region/reservation.mjs::clipReservedRegion
port result | regions
query > offset | planar offset | gate
query > boolean | boolean / open clip | gate
query > wall | perimeter contours | gate
query > surface | geodesic offset | gate
query > reserve | reserved roof | gate
offset > result | offset loops | data
boolean > result | clipped loops | data
wall > result | tracks | data
surface > result | UV regions | data
reserve > result | printable region | data
```

```saam-page 4a_offset
title 4.1 — Offset material
sub Level 2 · normalize and inflate in native memory
parent 4_regions offset
in planar offset
out offset loops
port in | planar offset
box offset | 4.1.1 | offset region | $offset
box context | 4.1.2 | choose shared grid | $clipperContext
box wrapper | 4.1.3 | normalize and inflate | @core/region/clipper.mjs::normalizedOffsetPaths
box kernel | 4.1.4 | run native offset | @core/region/clipper2.mjs::normalizeAndInflatePaths
port out | offset loops
in > offset | loops; delta; options | data
offset > context | bounds and precision | data
context > offset | coordinate conversion | data | norank
offset > wrapper | encoded paths | data
wrapper > kernel | native grid options | data
kernel > offset | integer contours | data | norank
offset > out | decoded material | data
```

```saam-page 4b_boolean
title 4.2 — Combine regions
sub Level 2 · operands use one grid and one kernel
parent 4_regions boolean
in boolean / open clip
out clipped loops
port in | boolean / open clip
box combine | 4.2.1 | combine | @core/region/intersection.mjs::combine
box grid | 4.2.2 | choose shared grid | $clipperContext
box kernel | 4.2.3 | execute boolean | $booleanPaths
box encode | 4.2.4 | allocate native paths | @core/region/clipper2.mjs::encode
box decode | 4.2.5 | copy result paths | @core/region/clipper2.mjs::decode
port out | clipped loops
in > combine | operation and operands | data
combine > grid | both operands | data
grid > combine | coordinate conversion | data | norank
combine > kernel | integer paths | data
kernel > encode | subject and clip | data
encode > kernel | owned paths | data | norank
kernel > decode | native result | data
decode > combine | integer paths | data | norank
combine > out | closed / open coordinates | data
```

```saam-page 4c_surface
title 4.4 — Offset on surface
sub Level 2 · native derivatives drive adaptive geodesics
parent 4_regions surface
in geodesic offset
out UV regions
port in | geodesic offset
box offset | 4.4.1 | sweep boundary | @core/region/surface-offset.mjs::offsetSurfaceRegion
box derivatives | 4.4.2 | evaluate local metric | @core/geom/surface-derivatives.mjs::surfaceDerivatives
box shoot | 4.4.3 | integrate geodesic | @core/region/surface-offset.mjs::offsetSurfaceRegion::shoot
box grid | 4.4.4 | choose UV grid | $clipperContext
box clip | 4.4.5 | combine swept bands | @core/region/clipper.mjs::clipPaths
port out | UV regions
in > offset | patch; loops; mm distance | data
offset > grid | UV precision | data
grid > offset | UV conversion | data | norank
offset > shoot | boundary position / normal | data
shoot > derivatives | UV evaluation | data
derivatives > shoot | first / second derivatives | data | norank
shoot > offset | adaptive rays | data | norank
offset > clip | swept bands; signed operation | data
clip > offset | resolved topology | data | norank
offset > out | UV loops and diagnostics | data
```

```saam-page 4d_perimeters
title 4.3 — Recover wall tracks
sub Level 2 · coincident fronts can retain one closed track
parent 4_regions wall
in perimeter contours
out tracks
port in | perimeter contours
box recover | 4.3.1 | recover central track | @core/region/perimeters.mjs::perimeterLoops
box material | 4.3.2 | erode material | $offset
box holes | 4.3.3 | grow hole fronts | $offset
box candidate | 4.3.4 | inset outer fronts | $offset
box compare | 4.3.5 | compare boundary bands | @core/region/intersection.mjs::difference
box overlap | 4.3.6 | reject other holes | @core/region/intersection.mjs::intersect
port out | tracks
in > recover | region; inset mm | data
recover > material | whole material | data
material > recover | surviving loops / holes | data | norank
recover > holes | lost hole | gate
recover > candidate | outer component | gate
holes > compare | grown hole | data
candidate > compare | tolerance band | data
compare > recover | coincident / remaining band | data | norank
recover > overlap | candidate and other holes | data
overlap > recover | conflicting material | data | norank
recover > out | loops plus center tracks | data
```

## Planar kernel

Caller contracts: [regions](../core/region/README.md). The shared kernel is
`clipper2-wasm@0.4.0`, C++ Clipper2 2.0.1. One initialized WASM instance serves
synchronous offsets and booleans through bulk integer-coordinate transfer.
It uses `Clipper64`, `NonZero`, `PreserveCollinear=false`; packaged Z is unused.
Native objects are freed on both success and failure. Inflation already unions
its output; an additional normalization union is unnecessary. Closed offsets
return material, not a stroke band. There is no Clipper 6 runtime fallback.
Kernel topology handles touching components, holes and collapse. Installation
needs no native compiler; operations require no runtime network.

## Perimeter recovery

`perimeterLoops` supplies full-fill and planar-infill with a closed central track
when opposed outer/hole fronts coincide. A surviving hole must contain the
original hole; merely matching the hole count can mistake quantization remnants
for survival. Compare fronts within the sum of their two 0.001 mm chord targets.
Replace only the boundary band, preserving other holes and disconnected/nested
islands. Rounded polygon fronts may leave small remnants in `offsetRegion`;
recovery changes deposition contours, not material erosion or fill masks.
General medial-axis, open-centerline and variable-width gap filling are absent.

## Surface construction

Geodesic construction is SAAM code on regular injective C2 patches, not Rhino
modelling code. It uses first/second derivatives, adaptive Runge–Kutta rays,
boundary strips and round sectors; Clipper2 resolves their topology. No Rhino
output fixture establishes equivalence. RhinoCommon's public wrapper delegates
to a native routine whose implementation is not public. Test limits, kernel
provenance and reference regeneration live in
[region verification](../scripts/bench/region-reference.md).
