---
name: standard-support
description: Experimental authored supports from a selected underside, flat footprint or tree skeleton, closed to the bed and sliced infill-only.
metadata:
  saam-kind: extension
---

# Standard support

Use [shared print tools](../../core/print/USAGE.md). A support is ordinary geometry and an ordinary [Slice](../slice/SKILL.md): the [owner's method](../../intent/toolpath.md#how-standard-supports-are-made) copies the chosen underside, lowers it by a small gap and closes it to the bed. The solid joins its part as a hidden union operand (`displayOperand:0`); its Slice has no loops, one row direction, dense base slices and no hop or retraction. Over a roof or footprint a second claim, `<id>-skin`, prints the part's underside solid across the support rows. Saved geometry and Slice settings regenerate without this extension; edit or remove them together.

## Choose the patches

Support only what needs it, judging span, material, finish, direction and removal access; often nothing does. Owner experience: overhangs of 45° from vertical usually print, supports are often omitted even at 60°, and small areas of steeper overhang often need none. This guides judgment and is never a threshold. Small patches and rows under roughly 8 mm may print poorly, so choose patches and row direction together. Supports need a base or brim on the bed.

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
| `baseLayers`, `skinLayers` | Dense base slices (2) and solid part layers over a roof or footprint (3); 0 omits either. |
| `chordMm` | Tree circle chord error (0.02). |

Vertical or degenerate faces, faces reaching the bed once lowered and horizontal branches are skipped; they and roots off the bed are listed in the report's `notes`. Folded or nonmanifold roofs, crossing footprint loops, broken tree parents and nonpositive radii are refused. A support crossing part material prints its whole volume. Nothing is inferred and there is no face picker.

Inspect the sliced gap, rows, base, skin and removal access in Studio; software establishes neither adhesion nor clean removal.
