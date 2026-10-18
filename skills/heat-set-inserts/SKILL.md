---
name: heat-set-inserts
description: Catalog heat-set bores with reinforcement following actual Slice layers.
metadata:
  saam-kind: extension
---

# Heat-set inserts

Prepare blind/through seats for heat or ultrasonic inserts. The [catalog](CATALOG.md)
covers 86 profiles: 60 SPIROL Series 19/29, 25 CNC Kitchen and McMaster 94459A743 (1/2-13).

Follow the [parameter policy](../../MAKERS.md#standard-parameter-policy): edits retain settings;
new holes inherit component insert, bore and fin choices, with explicit or example placement.

Choose a [catalog size/profile](CATALOG.md#size-and-profile-choices). Call
`apply_heat_set` with `bundleId`, current `expectedRevision` and `request`:

```json
{"feature":{"id":"mount","insertId":"spirol-29-m3-long","positionMm":[15,15,12],"axis":[0,0,-1],"chamferDepthMm":0.5}}
```

`positionMm` is the mouth centre; `axis` points inward, including side/angled
faces. The cut clears material outward beyond the host at the mouth diameter
(including a chamfer); inward seat depth stays fixed. Reapply to update old holes.
Assembly requests add `part`. Edit by id with changed fields; remove with
`{"remove":"mount"}` (plus `part`). Review the saved revision in Studio; Export
is the normal confirmation. Fit, tool access and printable support need review.

| Field | Default and meaning |
|---|---|
| `id` | `insert`; unique within its feature group |
| `insertId` | Required for the first feature; exact manual-listed size/profile |
| `positionMm` | `[15,15,12]`; propose a suitable position for the actual part |
| `axis` | `[0,0,-1]`; direction into the part; never inherited |
| `depthMm` | `null`: length plus catalog blind clearance; through seat length alone. Explicit depth must fit the insert |
| `throughHole` | `false`; `true` cuts along `axis` through the host, independently of seat depth |
| `chamferDepthMm` | `0`; axial depth of a mouth lead-in, less than seat depth |
| `chamferAngleDeg` | `45`; angle from the bore axis, greater than 0 and less than 90 |
| `diameterAdjustmentMm` | `0`; signed hole calibration; resulting diameter must be positive |
| `finCount` | `null`: automatic count `ceil(π × bore diameter / 2)`; nonnegative integer overrides it |
| `finLengthMm` | `4`; fixed radial sheet reach beyond the bore edge, throughout the seat |
| `finWidthMm` | `null`; legacy positive values remain readable; star fins use two touching beads at the source layer width |
| `finAngleDeg` | `0`; rotates the pattern around the bore |

`toleranceMm` is positive placement/probe clearance (default 0.01 mm); [Boolean accuracy](../../core/geom/README.md#native-boolean-construction) belongs to Geometry. CNC Kitchen normally needs no chamfer; retain catalog clearance/wall advice.

## Deposition and composition

The main Slice keeps its bore, walls and infill; a generated [Trace](../trace/SKILL.md)
uses each prepared source layer and joins its native completion. The successor
waits for both; there is no main-layer-to-reinforcement barrier.
For N main loops it adds max(4,N+1)-N walls: one becomes four, eight become nine.
The last wall follows fins; added walls/fins overlap unchanged main infill.

Geometry constructs the finite seat/pad with the bore’s shared radial profile and
intersects fixed fin sheets with the inherited layer surface. Seat depth excludes
outward/through clearance. Large wall counts can consume fin reach; offsets and
process settings inherit the prepared main layer, including nonplanar layers.

The pattern clears main wall bands at every boundary, including neighboring holes
and exterior edges. Clipped gaps are travel; reports retain open fragments.
The loop target is limited by available host material.

Use `sourceAssignments:["foundation","curved-body"]` for multiple main owners, or `sourceAssignment` for one. Edits retain
omitted source selection, and an explicit override affects only the named hole.
Vase-only deposition has no source Slice. Coincident fin/layer sheets contribute
finite-area fill; skipped fins and singular charts are reported.

Mesh/spline hosts and assemblies retain editable holes alongside text/curves.
Reports note mouth clearance, uneven rims, floor breakout and short seats. Blind pads
use max(solidTop,solidBottom) × layer gap, excluding existing dense coverage; oblique pads may span
more layers. Fit, adhesion, strength, AMS behavior and unsupported orientations need print evidence.