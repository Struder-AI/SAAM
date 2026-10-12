---
name: heat-set-inserts
description: Bores for SPIROL Series 19/29 heat-set inserts, metric and imperial, with local wall loops and fins, on any face and axis.
metadata:
  saam-kind: extension
---

# Heat-set inserts

Prepare blind holes for heat or ultrasonic inserts in a closed part. The
[catalog](CATALOG.md) covers 60 unheaded SPIROL Series 19/29 short and long
selections, M2–M8 and 2-56–5/16-18 where offered. These are receiving-hole
dimensions, not thread diameters or copies of the knurl.

Use the [standard parameter policy](../../MAKERS.md#standard-parameter-policy).
Feature edits keep omitted settings; a new named hole inherits the previous
hole's insert and fin choices in that component. Placement is explicit or the
stated example default, never an invented remembered position.

## Tools

Choose the exact size and profile from [the manual table](CATALOG.md#size-and-profile-choices),
then use an existing bundle. `apply_heat_set` takes `bundleId`, the current `expectedRevision` and `request`:

```json
{
  "feature": {
    "id": "mount", "insertId": "spirol-29-m3-long", "positionMm": [15, 15, 12],
    "finCount": 6, "finLengthMm": 4, "finWidthMm": 0.8
  }
}
```

`positionMm` is the mouth centre in component coordinates; the bore points along
`axis` from there. For an assembly add `part` with the component id.
Edit with the same feature id and only changed fields; remove with
`{"remove":"mount"}` (plus `part`). Changes follow the normal revision and
confirmation workflow.

| Field | Default and meaning |
|---|---|
| `id` | `insert`; unique within its feature group |
| `insertId` | Required for the first feature; exact manual-listed size/profile |
| `positionMm` | `[15,15,12]`; propose a suitable position for the actual part |
| `axis` | `[0,0,-1]`; direction the bore points into the part; never inherited |
| `depthMm` | `null`: insert length plus two thread pitches; an explicit depth must fit the insert |
| `diameterAdjustmentMm` | `0`; signed printer/material hole calibration; resulting bore diameter must stay positive |
| `finCount` | `6`; nonnegative count of radial ribs |
| `finLengthMm` | `4`; maximum extension beyond the bore wall, at the insertion face |
| `finWidthMm` | `0.8` at the outer tip, twice that at the bore wall; at least one bead |
| `finAngleDeg` | `0`; rotates the fin pattern around the bore |

The request can also set `toleranceMm` (default 0.01, positive) for the hole
geometry. Regeneration makes no physical fit claim.

## Deposition and composition

The reinforcement is [slice](../slice/SKILL.md) data: `apply_heat_set` writes,
ahead of the other assignments, an annulus owner whose **six contiguous loops**
follow the bore on every layer, and one solid owner per fin. The fins are triangular gussets in vertical section: no reach at
the bore floor, growing to `finLengthMm` at the insertion face, tapering from
twice `finWidthMm` at the bore wall to `finWidthMm` at the tip. Layers with less
than one bead of reach keep the bore wall alone, and the part's solid top layers
supply the face. The part's other owners wall and fill around the
reinforcement.

It works with meshes, supported spline hosts, named assembly parts and planar
material regions, and lettering over the result keeps the holes. A vase or
nonplanar-only region does not acquire the loops. Each bore is cut as placed;
the report notes material over the mouth within the insert length, a face below
the mouth, or a bore breaking out beyond its floor. Intersecting holes and fins are not merged.
Manufacturer dimensions are a starting point: printed fit and strength need
physical evidence.
