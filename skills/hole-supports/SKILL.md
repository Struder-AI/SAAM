---
name: hole-supports
description: Experimental support options for a detected bed-facing circular counterbore under a smaller through bore.
metadata:
  saam-kind: extension
---

# Hole supports

[Call `hole-supports`](../../core/print/USAGE.md#calling-an-extension) with
`{"mode":"discover"}` first. The report gives candidate centres, large/small
radii and shoulder height in component millimetres; discovery changes nothing.
Choose the hole, orientation, removal/drilling access and required bore finish
with the person before requesting a support mode. Supply `centerMm` when several
candidates exist. Detection does not establish that support is needed.

Only circular, concentric, bed-facing counterbores in one upright component at
Z=0 with whole-component planar slices are supported. Existing Trace assignments
are retained. Rotate the geometry first when needed; this is a section query,
not general overhang analysis.

| Mode | Construction | Removal/review |
|---|---|---|
| `membrane` | Parallel spans on the last lower-cavity layer, attached to the rim | Drill through; check access, drill size and wall damage risk. |
| `tangent-bridge` | Last three cavity layers: two tangents, two perpendicular tangents, four bore-perimeter arcs | Experimental interpretation; inspect contact and clear the hole afterward. |
| `sleeve` | Annular Trace walls from bed to below shoulder | Confirm clearance and a reachable grip for removal. |

Membrane/tangent free spans stay in the measured cavity; only short endpoint
attachments intentionally overlap model material. Tangent arcs are separate:
continuous support is not proved and physical contact remains unqualified.
Inspect the whole SAAMpath in Studio, including model slices, span lengths, gaps,
bead placement and removal. Sag, adhesion, head clearance and strength are not
validated. General support design remains with [supports](../supports/SKILL.md).

Requests accept `id` (lowercase hyphenated), `centerMm`, `after` (operation ids),
and `toleranceMm` (default 0.08, maximum 0.25). Dimensions are millimetres:

| Mode | Settings |
|---|---|
| `membrane` | `pitchMm`: default one bead width, allowed 0.75–1.5 widths; `anchorMm`: default 1.5 widths |
| `tangent-bridge` | `tangentOffsetMm`: default small radius plus half a bead; `anchorMm`: default 1.5 widths |
| `sleeve` | `xyGapMm`: 0.3; `topGapMm`: 0.2; `sleeveInnerRadiusMm`: small radius minus one bead |

Choose settings for the actual machine/material. A mode appends one ordinary
Trace assignment; use a fresh `id` or remove its prior assignment first.
Saved curves regenerate without the extension. Calling it again requires the
installed code; modifying that code is builder work.
