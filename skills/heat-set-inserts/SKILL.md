---
name: heat-set-inserts
description: Catalog heat-set bores with reinforcement following actual Slice layers.
metadata:
  saam-kind: extension
---

# Heat-set inserts

Prepare blind/through seats for heat or ultrasonic inserts. The [catalog](CATALOG.md)
covers 86 manufacturer profiles: 60 SPIROL Series 19/29, 25 CNC Kitchen and McMaster
94459A743 (1/2-13). Printed fit and strength need physical evidence.

Follow the [parameter policy](../../MAKERS.md#standard-parameter-policy): edits
keep omitted settings; new holes inherit insert, bore and fin choices in their
component, with explicit placement or the stated example default.

Choose a [catalog size/profile](CATALOG.md#size-and-profile-choices). Call
`apply_heat_set` with `bundleId`, current `expectedRevision` and `request`:

```json
{"feature":{"id":"mount","insertId":"spirol-29-m3-long","positionMm":[15,15,12],"axis":[0,0,-1],"chamferDepthMm":0.5}}
```

`positionMm` is the mouth centre; `axis` points inward, including side/angled
faces. Assembly requests add `part`. Edit by id with changed fields; remove with
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

Request `toleranceMm` defaults to 0.01 mm and must be positive. CNC Kitchen normally
needs no mouth chamfer; the catalog keeps its 1 mm blind clearance and wall advice.

## Deposition and composition

The bore remains part of the main geometry; the main Slice keeps its walls and
infill. A generated [Trace](../trace/SKILL.md) follows each actual source layer.
For N main loops it adds max(4,N+1)-N walls: one main loop becomes four total;
eight become nine. The final added wall travels out and back along the fins.
Added walls and fins intentionally overlap the unchanged main infill.

Fixed zero-thickness fin sheets intersect the inherited layer surface; Geometry
computes physical bead offsets there. Fin tips stay fixed; large main wall counts
can leave little fin beyond the added wall. Settings, reference surface, width,
pitch, gaps and tool pose inherit the actual Slice, including nonplanar layers.

The pattern clears main wall bands at every boundary, including neighboring holes
and exterior edges. Clipped curves stay open; gaps are travel, with fragments
reported. The nominal loop target cannot promise loops the host cannot contain.

Name all main owners in request `sourceAssignments`, for example
`["foundation","curved-body"]`; `sourceAssignment` names one. Edits retain
omitted source selection, and an explicit override affects only the named hole.
Vase-only deposition has no source Slice. Coincident fin/layer sheets have no
unique intersection curve; skipped fins and singular charts are reported.

Meshes, supported spline hosts and assemblies retain editable holes alongside
text/curves. Reports note obstructed mouths, uneven rims, blind-floor breakout and
short through seats. Blind-floor pad depth is max(solidTop,solidBottom) × layer
gap, excluding existing dense coverage; oblique pads may cross more layers. Fit,
adhesion, strength, AMS behavior and unsupported orientations need print evidence.