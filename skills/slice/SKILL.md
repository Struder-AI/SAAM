---
name: slice
description: Deposit loops and fill in owned regions over slice stacks.
---

# Slice

Slice deposits loops and fill on slice surfaces through an owned material region.
[Trace](../trace/SKILL.md) deposits curves; [Inject](../inject/SKILL.md) deposits at points.
Use the shared [print tools](../../core/print/USAGE.md) and [maker workflow](../../MAKERS.md).

`plan.slices` is `{version:1,assignments:[...]}`. `slice` and bulk `adjust_recipe`
edit this same list. Ordinary `body` uses two loops, 20% fill and three solid
slices at the top and bottom. Dependencies name prepared material work; construction waits for those prerequisites.
`regionUv` optionally clips owned material in its native chart, globally or in `sliceOverrides`; it cannot add material or claim another owner. Geometry masks precede layout and readiness.

Slice publishes immediate-predecessor completion and internal access validity, independent of world Z. `substrate:{assignment,index?,part?}` selects a manufactured base. Stack spacing supplies local gaps; Slice reads prepared material, while completed-deposition adaptation remains experimental Trace work.

## Settings

Assignments carry the normal fields; optional fields below may be omitted.

| Field | Default | Meaning |
|---|---|---|
| `id`, `part` | Required name, `null` part | Unique lowercase name; selected component/material part, or every component. |
| `filament`, `process` | `null` | Logical filament; height, width, speed, fan, `liftMm`, `retractMm` (zero disables hop/retraction) and `minimumBridgeRatio` (default 0.8; straight gap / original curve length). |
| `preset` | `null` | `brim` settings and auxiliary region. |
| `loops` | `2` | Nonnegative loop count; an array varies the count by slice. |
| `fillDensity`, `fillPattern` | `0.2`, `rectilinear` | Zero leaves loops; one fills solid; otherwise sparse fill. |
| `fillAnglesDeg`, `rotateFill` | `[45,135]`, `true` | Alternate row directions, or retain the first. |
| `connectNearby` | Automatic | Deposit safe nearby connections; `false` retains separate strokes (including parallel support rows). May vary by slice. |
| `solidTop`, `solidBottom` | `3`, `3` | Dense slices where the source solid ends, independent of owner boundaries. |
| `geometry` | Optional | Independent source solid in the selected part frame; omission uses that part's geometry. |
| `fillOverlap`, `spacingFactor` | `0.15`, `1` | Fill overlap as a bead fraction; physical loop/row pitch multiplier. |
| `sampleStepMm` | `0.2` | Physical sampling target. |
| `surface`, `stack` | Horizontal, `null` | Reference geometry and first/regular normal gaps; optional translation direction. |
| `within` | `[]` | Intersected material claims; empty retains unclaimed part material. |
| `sliceOverrides`, `operationAfter` | Optional | Per-slice settings; `operationAfter:{walls:[refs],infill:[refs],fill:[refs]}` scopes hard edges, also in overrides; refs are IDs or `{assignment}` completion. |
| `loopInsetMm`, `roles` | Optional | Signed physical first-loop inset and stroke-role names. |
| `fillOrder` | `null` | Ordinary patterns or physical chart cells; independent of stack choice. |
| `contact`, `toolPose` | `null` | Prepared-material source and optional derived poses, below. |
| `substrate`, `dependencies`, `description` | Null, empty lists/text | Manufactured base, explicit requirements and intent. |

## Regions and references

`within` intersects its volumes:

- `slab:{fromMm,toMm}` uses heights above the part bottom; `toMm:null` reaches its top.
- `geometry:{geometry}` uses a closed authored solid placed with the selected part.
- `surface-domain:{loopsUv,fromLayer,toLayer}` bounds a translated surface prism.
  Supply bounded native UV loops; the selected surface supplies its local frame.
- `normal-band:{fromMm,toMm}` bounds normal depth on a selected surface.
- `outline` supplies the brim's auxiliary region.

Volumes use the schemas' `kind`; unbounded owners keep explicit claims' remainder.
Use disjoint or explicitly partitioned claims under the [role boundary](../../MAKERS.md#toolpaths). Each owner walls its boundaries; solid masks follow the part's material.

References select horizontal/plane geometry, translated patches, native charts, or `{kind:"slice",assignment,index?}`.
Omitting `index` selects the last prepared surface in declared sequence, independent of orientation, position or numeric labels; [lips](../thick-lip/SKILL.md) use the same reference.

- Spline chart: `{kind:"spline",patch,periodicU,normalSide,uvBounds,extend?}`. Supply a named or authored patch, explicit boolean `periodicU`, `normalSide:1|-1`, and two increasing finite native UV intervals; bounds need not be [0,1]. Optional boolean `extend` continues untrimmed patches tangentially to bounds containing their native domain.
- Mesh chart: `{kind:"mesh-strip",rows,periodicU,normalSide}` uses a rectangular grid of native vertex indices along V, successive rows along U, and two native triangles per cell; no `uvBounds`. Supply explicit boolean periodicity and signed normal. Periodic U seams must match position/normal, with a duplicate final mesh row; revise rows after vertex changes.
- Translated references use `{kind:"patch",patch:name,offsetMm}` or `{kind:"spline",patch:authored,offsetMm}`, with finite height offset; these are distinct from normal-stack charts.

`stack.direction:"normal"` uses a complete spline/mesh chart and one `normal-band`; optional `geometry` volumes clip its slices to solids. Offsets derive finite tangent neighborhoods, preserving native interiors; regularity failures name the required extent and periodic U stays joined.
`stack.offsetTightness` blends tangent-extended fitted offsets with exact normal offsets of the extended reference ([cladding](../pipe-cladding/SKILL.md)).

Ordinary rectilinear/grid/triangle rows use [physical surface offsets](../../core/region/README.md#shared-offset-functions),
including wavy references; proven affine charts use exact line translations.
`fillOrder:{kind:"surface-cells",directions:[...],toleranceMm:...}` explicitly
chooses axial/circumferential cells or periodic-U helices. [Wave guidance](../wave-overhangs/SKILL.md)
owns seed/front propagation. All use the same deposition producer and scheduler.

## Presets

Brim supplies the region outside the first-layer outline and five outward loops.
Define it before the body; `loops` sets its width. It is sacrificial bed adhesion.
Supports use ordinary geometry claims and Slice settings; [standard support](../standard-support/SKILL.md) authors roofs, footprints or tree solids with zero loops and fixed-direction infill.

| Pattern | Shape / tradeoff |
|---|---|
| `rectilinear` | One straight infill direction per slice. |
| `grid`, `triangles` | Two/three crossing directions; split the line budget, crossings accumulate material. |
| `concentric` | Nested contours; narrow regions collapse. |
| `gyroid` | Sampled periodic XYZ field; approximate density, more segments. |

Offsets and fill retain the chart's physical metric: planar kernels for planes,
native sections for patches, numerical kernels for evaluated charts. Folds,
singular metrics, chart edges and sampling limit coverage; sub-bead features can
vanish. There is no general gap fill or collision model; first solid fill over
sparse material is unoptimised. See [shared path limits](../../core/path/README.md).

## Contact, poses and extensions

`contact:{source:null}` uses available prepared material. `source:{assignment,part?}` selects a manufactured surface; current slice prerequisites derive from its actual contact, with optional XYZ `offsetMm`. Generated `surfaces` save finite triangle footprints and their source, target part and offset. No layer indices or deposition paths are saved. Front seeds are derived from prepared regions or authored directly. `toolPose:{}` derives upright poses; `alignToSliceNormal:true` aligns them to reference normals. Modulation changes completed deposition without changing later Slice geometry.

[Standard vase](../vase-wall/SKILL.md) generates a spiral curve over reference
sleeve geometry and calls Trace, as does advanced vase. Saved `join:{mode:"spiral",levelEnd:true}` requests
use that extension too. Slice has no spiral producer. A raised sleeve needs a
printed base; a successor needs an appropriate finished boundary. Rivet reservations
remain extension inputs to shared engine operations.

## Script interfaces

The [Slice implementation](../../core/print/slices.mjs) consumes prepared region/boundary geometry and constructs deposition;
[composition](../../core/path/README.md) owns finalization and scheduling with Trace/Inject.
