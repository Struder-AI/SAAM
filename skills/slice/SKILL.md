---
name: slice
description: Plane layers of loops and fill for a whole part or assigned volumes of it, from solid to hollow, with brim and support presets. Meshes and supported splines.
---

# Slice

General slice deposition: every recipe has one list of slice assignments,
`plan.slices`, and each assignment cuts an owned volume of a part into plane
layers of loops and fill. The default recipe holds one assignment, `body`, that
owns the whole part with the normal settings: two loops, 20% fill and three
solid layers at the top and bottom. For maker work, read [MAKERS.md](../../MAKERS.md);
edit assignments with the [shared print tools](../../core/print/USAGE.md)
(`adjust_recipe` replaces the `slices` assignment list).

The user reports physical fill-pattern checks (2026-09-24). Tilted ownership,
presets and alternation have software evidence only.

## Assignments

`plan.slices` is `{ version: 1, assignments: [...] }`; each assignment carries every field.

| Field | Default | Meaning |
|---|---|---|
| `id` | | Lowercase name, unique. |
| `part` | `null` | A component or prepared material part (`base`, `text/label`, `cup/base`); `null` is every component. |
| `preset` | `null` | `brim` or `support`, below. |
| `filament` | `null` | A Bambu logical filament; the owner then uses that filament's layer heights and bead width. |
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
| `stack` | `null` | `{ firstLayerMm, layerMm }` for the owner's own layer grid; `null` uses the process. |

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

## With other skills

- [vase-wall](../vase-wall/SKILL.md) and [thick-lip](../thick-lip/SKILL.md)
  claim their band of the part; slices own what is below and above it. A raised
  vase wall needs a slice owner of its part for its base.
- [draped-skin](../draped-skin/SKILL.md) reserves its thickness under the roof;
  slices stop below it, with solid top layers under the skin.
- [plastic-weld](../plastic-weld/SKILL.md) rivets reserve their shafts and keep
  the envelope around them solid.
- Layers are ordered by height across owners and parts; assemblies can batch
  layers (`composition.batchLayers`). A region consuming another's published
  lower surface (`lowerSurfaceFrom`) retains its regional producer contract.

## Limits

Tilted planes stack along their upward normal; `layerMm` is normal spacing.
The base precedes material; fixed-axis deposition obeys the machine angle limit.
Roof/spline stacks translate in Z; pitch is vertical and bead gaps project onto
the local normal. XY offsets/spacing are projected, not geodesic. Sampled cuts,
slabs and reservations can miss between-grid features. Curves refine to chord
tolerance; folds/discontinuities reject. First contact tapers to the horizontal
part base. Walls close per layer. Opposing fronts of a thin wall share their last loop (a 2 mm ring at 0.4 mm with
three loops prints five loops and no fill); there is no general gap fill, and
features thinner than a bead can vanish. Mesh normals are faceted; spline
sections may miss features below about 0.4 mm. The first solid layer over sparse
fill is an unoptimised bridge. Offsets are Clipper2 polygon offsets. Travel,
combing and lifts follow [shared travel](../../core/path/README.md#whole-plan-travel-requirement).

<!-- layer: script -->
## Script interfaces

`sliceResults({ plan, machine, shells, volumes, bands, reserves, envelopes })`
returns `{ results, supports, summary }`: results per owner/family with operations
`<owner>:<layer>:walls|infill|fill`, support results apart. `ownedLayers`
exposes each owner's regions and shares; shared IDs include `:shared:<principal>`; `layerStrokes(region, settings)`
fills a chart region; `mapSliceStrokes` maps XYZ before shared `depositCurves`. The
[nudge-cup](../../examples/prints/nudge-cup/README.md) recipe combines a slab
owner, a vase wall and a solid foot under a draped skin.
