---
name: slice
description: Derive loops, fill, brim, skin, fronts, sleeves, rims and cladding from owned surface slices, with shared process and modulation.
---

# Slice

Slice derives deposition from owned surface slices. [Trace](../trace/SKILL.md)
authors curves and [inject](../inject/SKILL.md) meters stationary extrusion;
they share lower-level records and processing. Ordinary `body` defaults to two loops, 20% fill
and three top/bottom solid layers; geometry is authored separately. Construction
records share process settings, dependencies and finalization. For maker work,
read [MAKERS.md](../../MAKERS.md); `slice` and bulk `adjust_recipe` edit the same
assignments through the [shared tools](../../core/print/USAGE.md).

User-reported fill-pattern prints (2026-09-24) do not validate the new ownership pipeline.
Experimental `plan.experimental.substrateAdaptation` defaults false: ON measures
final-material gaps and requires declared contact; OFF keeps nominal reference gaps.

## Assignments

`plan.slices` is `{ version: 1, assignments: [...] }`; each assignment carries every field.

| Field | Default | Meaning |
|---|---|---|
| `id` | | Lowercase name, unique. |
| `part` | `null` | A component or prepared material part (`base`, `text/label`, `cup/base`); `null` is every component. |
| `preset` | `null` | `brim` or `support`, below. |
| `filament` | `null` | A Bambu logical filament; the owner then uses that filament's layer heights and bead width. |
| `process` | `null` | Every construction accepts overrides for `firstLayerMm`, `layerMm`, `lineWidthMm`, `planarSpeedMmS`, `firstLayerSpeedMmS`, `fanPercent`, applied after filament defaults; `stack` still chooses explicit geometric pitch. |
| `loops` | `2` | Loops inward from the part's boundary on every layer. |
| `fillDensity` | `0.2` | `1` is solid, `0` a shell of loops; otherwise 0.01–1, row spacing = bead width / density. |
| `fillPattern` | `rectilinear` | Sparse pattern, below. Solid rows are always straight. |
| `fillAnglesDeg` | `[45, 135]` | Row directions; `rotateFill` alternates them by layer, otherwise the first is kept. |
| `rotateFill` | `true` | |
| `solidTop` / `solidBottom` | `3` / `3` | Solid layers where the part's material ends above or below (0–20). |
| `fillOverlap` | `0.15` | How far fill reaches over a loop, as a bead fraction. |
| `spacingFactor` | `1` | Loop and row spacing multiplier; bead width is unchanged. |
| `sampleStepMm` | `0.2` | Gyroid sampling step. |
| `within` | `[]` | The owned volume, below; empty owns the rest of the part. |
| `surface` | `{ kind: 'horizontal' }` | Horizontal; `{kind:'plane',origin,normal,xAxis?}`; `{kind:'roof',offsetMm}`; or `{kind:'spline',patch,offsetMm}` using a named spline control net. Coordinates precede selected geometry placement. |
| `stack` | `null` | `{firstLayerMm,layerMm,direction?}`: whole-reference mean normal gaps and optional translation direction; `null` uses process gaps. |

## Owners and volumes

A `within` list intersects its volumes:

- `{ kind: 'slab', fromMm, toMm }`: heights above the part's bottom (`toMm`
  `null` for the top), open at the bottom and closed at the top on the layer grid.
- `{ kind: 'geometry', geometry }`: any closed geometry the plan accepts,
  placed like the part.

Assignments are owners in definition order. An owner without `within` takes
whatever no other owner of its part claims; a part has at most one. Where two
owners with `within` overlap, the first claimant supplies shared slice references;
claimants alternate there in definition order. Connected owners use compatible
principal pitch while retaining their authored families outside overlap. These
ownership decisions constrain scheduling. Reports identify shared `leader` and pitch.

**Each owner lays its loops along every boundary of its region**, those it shares
with another owner included (an owner with `loops: 0` lays none), so a boundary
between two owners carries both owners' loops. **Solid layers come from the
part's material**, not an owner's share: an owner's layer is solid
where the part (less material another skill deposits) ends within `solidTop` or
`solidBottom` layers, so an owner boundary or alternation never makes solid.

A solid base uses a slab owner with `fillDensity: 1`; a hollow vessel uses
`fillDensity: 0, solidTop: 0`. Local reinforcements and [heat-set inserts](../heat-set-inserts/SKILL.md)
use geometry owners with more loops or solid fill.

## Presets

**Brim** (`preset: 'brim'`): five loops on the first layer, growing outward from
the part's first-layer outline, fused to it and removed after printing. Use it
when the first layer gives the bed too little to hold: a single-bead vase ring,
a narrow foot, a tall part on a small footprint. Set `loops` for its width;
define it first so it prints before the part's first layer.

**Support** (`preset: 'support'`): sacrificial material under an assigned
footprint, one loop around 15% straight rows at 0° and 90°, its top two layers
(`solidTop`) an interface of rows at 0.8 density. Its single volume is
`{ kind: 'support', footprint, contactZMm, topGapMm: 0.2, xyGapMm: 0.3 }`:
counterclockwise outer loops and clockwise holes in millimetres relative to the
print's placement, standing on the bed up to `contactZMm - topGapMm`, the last
layer rounded down on the grid (the report gives the actual gap). `part` stays
`null`. Generation rejects a footprint that comes within `xyGapMm` of any part
section. Choose footprints with the maker by judgment and record why
([D-025](../../DECISIONS.md#d-025--support-areas-assigned-through-judgment));
no overhang is detected for you. Supports print before every part operation
above them. Explicit tree branches stay in [supports](../supports/SKILL.md).

## Choosing a fill pattern

| Pattern | Why choose it | Tradeoff |
|---|---|---|
| `rectilinear` | Straight rows, one direction per layer. | Direction changes between layers, not within one. |
| `grid` | Two crossing directions per layer; a simple roof lattice. | Crossings accumulate material. |
| `triangles` | Three directions form triangular cells. | More crossings. |
| `concentric` | Nested contours follow the outline and holes. | Narrow regions collapse under offsets. |
| `gyroid` | Curved connected strokes that vary with Z. | More segments; clipping splits strokes near walls. |

Grid and triangles split the line budget over their directions; density does not
compensate for crossings or boundaries. Gyroid samples
`sin x cos y + sin y cos z + sin z cos x = 0` with period `2.4 × bead width / density`,
anchored to the world grid (placement shifts its phase); its density is
approximate ([measurement](../../DEVLOG.md#2026-09-10--gyroid-contour-construction-measurement)).

## Construction guides and other skills

- Construction guides: [centerlines](../line-network/SKILL.md),
  [bridges](../bridging/SKILL.md), [skin](../draped-skin/SKILL.md),
  [fronts](../wave-overhangs/SKILL.md), [sleeves](../vase-wall/SKILL.md),
  [tiles](../advanced-vase-wall/SKILL.md), [rims](../thick-lip/SKILL.md) and
  [cladding](../pipe-cladding/SKILL.md). These apply the same core operations.
- Sleeves reserve their part band; raised walls need a printed base. Skin
  claims translated roof material. Explicit sources carry contact prerequisites.
- [plastic-weld](../plastic-weld/SKILL.md) rivets reserve their shafts and keep
  the envelope around them solid.
- Ownership determines compatible slicing before sequence; assemblies can batch
  compatible slices (`composition.batchLayers`). Consumers use finalized sources.

## Limits

Tilted planes stack along their upward normal; `layerMm` is normal spacing.
The base precedes material; fixed-axis deposition obeys the machine angle limit.
Whole-reference area-weighted normals choose the default family direction and
calibrate translation to target mean normal gap. Roofs translate in Z; native
spline references retain their chart. Local gaps vary and set volume. XY roof
offsets/spacing are projected, not geodesic. Sampled cuts,
slabs and reservations can miss between-grid features. Curves refine to chord
tolerance; folds/discontinuities reject. First contact tapers to the horizontal
part base. Walls close per layer. Opposing fronts of a thin wall share their last loop (a 2 mm ring at 0.4 mm with
three loops prints five loops and no fill); there is no general gap fill, and
features thinner than a bead can vanish. Mesh normals are faceted; spline
sections may miss features below about 0.4 mm. The first solid layer over sparse
fill is an unoptimised bridge. Offsets are Clipper2 polygon offsets. Travel,
combing and lifts follow [shared travel](../../core/path/README.md#whole-plan-travel-requirement).

## Modulation

Optional effects on an otherwise valid toolpath, primarily visual and surface effects: fuzzy walls, wavy relief and localized bumps. Other useful applications remain open. Fields can shape, place or fade effects. Required gap compensation, contact adaptation, nozzle orientation and brick layering belong to construction or process logic independently. See the [scope decision](../../plans/0.2.0.md#settled-intent).

`modulate` and bulk `adjust_recipe` write `plan.modulations` version1. Add needs `id,channel,amplitude,field`; displacement also needs `direction`. Assignment, role, layer-range and `topN` selectors locate effects. Periodic waves, smooth seeded noise, bumps, ramps and geometry masks can shape them. Tool schemas give exact fields.
World, slice and curve frames locate patterns; native spline UV is not millimetres. Physical displacement transitions are intrinsically smooth; flow/width multiply by a strictly positive factor. Applicable machine and crossing checks still apply. Valid input edits report immediate diagnostics.

Finalize affected deposition before dependent contact queries, preserving sparse holes and bead dimensions. No replacement distorted CAD surface is required. Broader speed/tilt/injection channels are not a release requirement.

<!-- layer: script -->
## Script interfaces

`finalizedSliceResults` resolves common prepared contexts and construction
prerequisites, returning `{results,supports,summary}` per owner/family with operations
`<owner>:<layer>:walls|infill|fill`, support results apart. `ownedLayers` exposes
regions and shares; shared IDs include `:shared:<principal>`. `layerStrokes`
fills a chart; `mapSliceStrokes` maps XYZ before shared `depositCurves`.
