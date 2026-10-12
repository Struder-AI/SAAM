---
name: hole-supports
description: Experimental support options for a detected bed-facing circular counterbore under a smaller through bore.
metadata:
  saam-kind: extension
---

# Hole supports

[Call `hole-supports`](../../core/print/USAGE.md#command-line) with
`{"mode":"discover"}` first: it reports candidate centres, large/small radii,
shoulder height and notes in component millimetres, and changes nothing.
Detection does not establish that support is needed; choose the hole,
orientation, removal or drilling access and bore finish with the person. It
needs one component (not an assembly) and finds only circular, concentric
counterbores open at the part's bottom.

| Mode | Construction | Removal/review |
|---|---|---|
| `membrane` | Trace: parallel spans on the last open cavity layer, attached to the rim | Drill through; check access, drill size and wall damage. |
| `tangent-bridge` | Trace: last three cavity layers, two tangents, two perpendicular tangents, four bore-rim arcs | Inspect contact and clear the hole afterward. |
| `sleeve` | An annulus from the bed to below the shoulder, joined to the part as a hidden operand and sliced as loops only | Confirm clearance and a grip for removal. |

Requests accept `id` (lowercase hyphenated, default `hole-<mode>`), `centerMm`
(needed when several candidates exist), `after` (operation ids) and
`toleranceMm` (detection tolerance, 0.08). Dimensions are millimetres:

| Mode | Settings |
|---|---|
| `membrane` | `pitchMm`: one bead width; `anchorMm`: 1.5 widths |
| `tangent-bridge` | `tangentOffsetMm`: small radius plus half a bead; `anchorMm`: 1.5 widths |
| `sleeve` | `xyGapMm`: 0.3; `topGapMm`: 0.2; `sleeveInnerRadiusMm`: small radius minus one bead |

A cavity that narrows or holds material, an attachment beyond the rim, a span
crossing material, a part off the bed or Slice assignments that are not
whole-component planar are built anyway and listed in the report's `notes`.
Each mode adds one assignment with a fresh `id`; saved curves, geometry and
Slice settings regenerate without the extension. Inspect the whole SAAMpath in
Studio; sag, adhesion, head clearance and strength are not validated. General
supports are [standard support](../standard-support/SKILL.md).
