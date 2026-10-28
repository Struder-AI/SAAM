---
name: standard-support
description: Experimental authored supports from a selected underside, flat footprint or tree skeleton, closed to the bed and sliced infill-only.
metadata:
  saam-kind: extension
---

# Standard support

Use [shared print tools](../../core/print/USAGE.md). A support is ordinary geometry and an ordinary [Slice](../slice/SKILL.md): the [owner's method](../../intent/toolpath.md#how-standard-supports-are-made) copies the chosen underside, lowers it by a small gap and closes it to the bed. Its Slice owns that independent solid, with no loops, one row direction, dense base slices and no hop or retraction. The part owns its underside. Finite contact surfaces automatically attach only the touching part slices to their supporting slices, recalculated after spacing changes. Saved geometry and Slice settings regenerate without this extension.

## Choose the patches

Use [support guidance](../../skills/supports/SKILL.md) to choose edge, patch or tree supports and lateral pillar clearance. This tool builds the selected bed-reaching patch or tree, not two-loop edge supports.

## Request

Call `apply_extension` with `extensionId:"standard-support"`, `bundleId`, `expectedEditRevision` and one source:

```json
{"id":"underside-support","part":null,"roof":{"vertices":[[4,0,4],[16,0,4],[16,12,4],[4,12,4]],"triangles":[[0,2,1],[0,3,2]]},"description":"Broad accessible underside."}
```

| Field | Meaning (default) |
|---|---|
| `id`, `description` | Lowercase hyphenated assignment id; why ("Authored underside support."). |
| `part` | Assembly component id, or `null` for a single part; coordinates are the component's. |
| `roof` | A copied open triangle patch of the underside. |
| `triangleIndices` | Face ids of the component's indexed mesh, saved blob fields included; boolean and native components need `roof`. |
| `footprint` | `{loops, zMm}`: flat `[x,y]` loops at contact height `zMm`; nested loops are holes. |
| `tree` | Nodes `{id, parent, point, radiusMm}`, `parent:null` at bed roots, tips at their contacts; each branch is a solid of horizontal circles. |
| `gapMm` | Roof or tips lowered by this (0.15); the sliced gap rounds to layers. |
| `fillDensity`, `angleDeg` | Row density 0–1 (0.2) and row direction (0°). |
| `baseLayers` | Dense support base slices (2); 0 omits them. |
| `chordMm` | Tree circle chord error (0.02). |

Vertical or degenerate faces, faces reaching the bed once lowered and horizontal branches are skipped; they and roots off the bed are listed in the report's `notes`. Folded or nonmanifold roofs, crossing footprint loops, broken tree parents and nonpositive radii are refused. A support crossing part material prints its whole volume. The agent selects the patch; the tool derives manufacturing prerequisites. Inspect gaps, rows, base and removal access in Studio; software establishes neither adhesion nor clean removal.
