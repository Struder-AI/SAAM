---
name: slice
description: Deposit loops and fill in owned regions over reference surface families.
---

# Slice

Slice deposits loops and fill on courses through an owned material region.
[Trace](../trace/SKILL.md) deposits curves; [Inject](../inject/SKILL.md) deposits at points.
Use the shared [print tools](../../core/print/USAGE.md) and [maker workflow](../../MAKERS.md).

`plan.slices` is `{version:1,assignments:[...]}`. `slice` and bulk `adjust_recipe`
edit this same list. Ordinary `body` uses two loops, 20% fill and three solid
courses at the top and bottom. Source dependencies wait for finalized material.
Experimental `substrateAdaptation` defaults off: nominal references retain their
specified gaps. When on, declared contact uses final beads and missing support rejects.

## Settings

Assignments carry the normal fields; optional fields below may be omitted.

| Field | Default | Meaning |
|---|---|---|
| `id`, `part` | Required name, `null` part | Unique lowercase name; selected component/material part, or every component. |
| `filament`, `process` | `null` | Logical filament; overrides for height, width, speed, fan, `liftMm` and `retractMm` (zero disables extra hop/retraction for this assignment). |
| `preset` | `null` | `brim` or `support` settings and auxiliary region. |
| `loops` | `2` | Nonnegative loop count; an array varies the count by course. |
| `fillDensity`, `fillPattern` | `0.2`, `rectilinear` | Zero leaves loops; one fills solid; otherwise sparse fill. |
| `fillAnglesDeg`, `rotateFill` | `[45,135]`, `true` | Alternate row directions, or retain the first. |
| `connectNearby` | Automatic | Deposit safe nearby connections; `false` retains separate strokes (including parallel support rows). May vary by course. |
| `solidTop`, `solidBottom` | `3`, `3` | Dense courses where material ends, independent of owner boundaries. |
| `fillOverlap`, `spacingFactor` | `0.15`, `1` | Fill overlap as a bead fraction; physical loop/row pitch multiplier. |
| `sampleStepMm` | `0.2` | Physical sampling target. |
| `surface`, `stack` | Horizontal, `null` | Reference geometry and first/regular normal gaps; optional translation direction. |
| `within` | `[]` | Intersected material claims; empty retains unclaimed part material. |
| `courses` | Optional | Per-course overrides of loop/fill/solid/sampling settings. Unspecified courses retain defaults. |
| `loopInsetMm`, `roles` | Optional | Signed physical first-loop inset and stroke-role names. |
| `fillOrder` | `null` | Ordinary patterns, physical chart cells or seeded fronts; independent of stack choice. |
| `contact`, `toolPose` | `null` | Final-material source and optional derived poses, below. |
| `dependencies`, `description` | Empty lists/text | Explicit `after`, `afterParts`, `beforeParts` and intent. |

## Regions and references

`within` intersects its volumes:

- `slab:{fromMm,toMm}` uses heights above the part bottom; `toMm:null` reaches its top.
- `geometry:{geometry}` uses a closed authored solid placed with the selected part.
- `surface-domain:{loopsUv,fromLayer,toLayer}` bounds a translated surface prism.
  On a roof, `loopsUv:null` surveys it dynamically; optional slope and sample limits
  control that survey. See [skin](../draped-skin/SKILL.md).
- `normal-band:{fromMm,toMm}` bounds normal depth on a selected surface.
- `outline` and `support` supply the auxiliary regions described below.

Volumes include their `kind` as shown by the tool schemas. An unbounded owner
retains explicit owners' remainder. Competing positive claims reject; touching
within geometry tolerance is allowed. Shared ownership/interlock remains in 0.4.0.
Each owner walls its own boundaries; solid masks follow the part's material.

References may be horizontal, an authored plane, a roof height chart or a native
spline patch. Translated families calibrate pitch against the whole-reference
mean normal. A `terminal` reference names a source assignment's closed level
boundary; loop arrays or `courses` vary its subsequent regions and deposition.
The source can be Slice or Trace, including a geometry-free Trace recipe.
See [lip authoring](../thick-lip/SKILL.md).

A selected spline/mesh-strip chart with `stack.direction:"normal"` and a
`normal-band` supplies offset references. Fill, loops and course variation remain
Slice settings. `stack.offsetTightness` chooses fitted/exact native normal offsets;
the older cell-fill spelling remains readable. See [cladding](../pipe-cladding/SKILL.md).

`fillOrder:{kind:"surface-cells",directions:[...],toleranceMm:...}` lays physical
cells on any resolved chart: axial or circumferential rows on open charts;
forward/reverse helices need periodic U. Seeds/front propagation are another
fill algorithm; [wave guidance](../wave-overhangs/SKILL.md) owns its inputs and limits.
These choices do not select different deposition producers or schedulers.

## Presets and patterns

Brim supplies the region outside the first-layer outline and five outward loops.
Define it before the body; `loops` sets its width. It is sacrificial bed adhesion.
Flat footprint support uses the [tree/footprint settings](../supports/SKILL.md); curved selected roofs use [standard support](../standard-support/SKILL.md), with zero loops and fixed-direction infill.

| Pattern | Shape / tradeoff |
|---|---|
| `rectilinear` | One straight direction per course. |
| `grid`, `triangles` | Two/three crossing directions; split the line budget, crossings accumulate material. |
| `concentric` | Nested contours; narrow regions collapse. |
| `gyroid` | Sampled periodic XYZ field; approximate density, more segments. |

Boundary offsets and fill retain their chart's physical metric. Planes use planar
polygon kernels; native patches use physical offsets/sections; evaluated charts
use numerical surface kernels. None certifies global geodesic coverage. Folds,
singular metrics, chart edges and insufficient sampling remain geometric limits.
Projected roof XY spacing is not geodesic. Features thinner than a bead can vanish;
there is no general gap fill or collision model. First solid fill over sparse
material is an unoptimised bridge. See [shared path limits](../../core/path/README.md).

## Contact, poses and extensions

`contact:{source:null}` uses available final material; name an assignment for
required contact. `toolPose:{}` derives upright poses; `alignToSliceNormal:true`
aligns them to the reference normal. Exporters represent these poses; agents do
not author axes or rotary samples. [Modulation](../../core/path/modulation.mjs)
finalizes affected deposition before dependent contact queries.

[Standard vase](../vase-wall/SKILL.md) generates a spiral curve over reference
sleeve geometry and calls Trace, as does advanced vase. Saved `join:{mode:"spiral",levelEnd:true}` requests
use that extension too. Slice has no spiral producer. A raised sleeve needs a
printed base; a successor needs an appropriate finished boundary. Rivet reservations
and explicit tree support remain extension inputs to shared engine operations.

## Script interfaces

The [Slice implementation](../../core/print/slices.mjs) owns region/boundary construction;
[composition](../../core/path/README.md) owns finalization and scheduling with Trace/Inject.
