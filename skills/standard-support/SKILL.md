---
name: standard-support
description: Experimental selected underside patches closed to the bed, with an adhesion base and parallel infill-only Slice; support choices remain authored.
metadata:
  saam-kind: extension
---

# Standard support

Use [shared print tools](../../core/print/USAGE.md). Copy selected underside mesh patches, lower their curved roof, close walls and bottom to the bed, then use ordinary [Slice](../slice/SKILL.md) with zero loops and fixed-direction sparse infill. Supports have zero extra hop and retraction. The brain's 0.1 mm geometric gap and 20% infill looked acceptable; printing/removal remain physically unqualified.

## Choose the patches

Support only areas that need it, considering span, material, finish, printing direction and removal access; record a reason. Often no support is necessary. Owner experience: 45° overhangs usually print well, they generally omit supports even at 60°, and small areas of larger overhang often need none. Here overhang is **from vertical** (0° vertical wall, 90° horizontal underside). These observations guide judgment, never an automatic selection threshold.

Small patches and short parallel lines may perform poorly; roughly 8 mm is an observation to explore, not a minimum or rejection rule. Choose direction and patches together. Provide a bed adhesion base or brim; the starter uses two dense bottom courses in the same support volume. `baseLayers:0` deliberately omits the base, so review adhesion or author a brim. Guidance will be refined by physical testing.

## Operation

`apply_extension` with `extensionId:"standard-support"` adds an authored support contribution. Supply `bundleId`, `expectedEditRevision` from current `editRevision`, and a request, for example:

```json
{"id":"underside-support","part":null,"roof":{"vertices":[[4,0,4],[16,0,4],[16,12,4],[4,12,4]],"triangles":[[0,2,1],[0,3,2]]},"gapMm":0.15,"fillDensity":0.2,"angleDeg":0,"baseLayers":2,"reason":"Broad accessible underside needs support."}
```

The example's coordinates are illustrative. Supply either `roof` (a copied open triangle patch in component coordinates) or `triangleIndices` (distinct zero-based face ids in the current component's manufacturing mesh, including saved blob fields). Boolean/native components need an explicit copied roof. For assemblies name `part`, otherwise use `null`. No areas are inferred and no Studio face picker is provided. Existing geometry/assignments survive; use a new unique `id`.

| Request | Meaning |
|---|---|
| `id`, `roof` or `triangleIndices`, `reason` | Assignment name, selected patch and its purpose (default “Authored underside support.”). |
| `part` | Component id or `null`; original placement survives. |
| `gapMm` | Nonnegative vertical roof separation, initially 0.15 mm; actual sliced gap can be larger. |
| `fillDensity`, `angleDeg` | Density 0–1, initially 0.2; fixed XY row direction initially 0°. Full fill is allowed. |
| `baseLayers` | Dense bottom courses initially 2, zero loops throughout; zero explicitly omits the base. |

The saved Boolean union retains original geometry and support as editable operands; `displayOperand:0` shows only the original in the geometry viewer. Support toolpaths remain visible. Slice claims support explicitly; the unbounded body retains the remainder. `connectNearby:false` prevents cross-row deposition connectors. Edit/remove geometry and assignments together; saved geometry and Slice settings suffice for regeneration without this extension.
## Review and limits

Roofs must project without folds or point-only joins; holes and disconnected patches work when they form valid closed solids. Vertical/degenerate faces, overlapping projections or a roof lowered through the bed reject. A support crossing existing material below the roof rejects: reselect accessible patches or explicitly author a cutout. Nothing is trimmed silently. Native spline face selection and automatic rerouting are absent.

Inspect actual sliced roof gaps, occlusions, adhesion, row lengths/direction and removal access. Dense base courses share the support owner, avoiding a competing base claim. A separate brim uses existing Slice ownership rules. Software checks establish neither adhesion nor clean removal; the person confirms current settings and exact toolpath in Studio before export.
