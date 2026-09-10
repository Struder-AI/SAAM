---
name: planar-infill
description: Generate planar walls and rectilinear, grid, triangles, concentric or gyroid infill on closed mesh or supported spline geometry. Combine with solid surfaces, assigned supports and draped skin through the shared workflow.
---

# Planar infill

Use for conventional flat-layer printing with walls and a sparse interior.
Read [MAKERS.md](../../MAKERS.md) for making a part; developers also read
[DEVELOP.md](../../DEVELOP.md). Software tests cover the S5 and H2D profiles,
mesh and restricted spline inputs. No physical print is validated. Both machines
use the shared export/review/delivery workflow. H2D output is experimental; read
its [machine contract](../../DEVELOP.md#h2d-output-contract) before use.

## Tools

Use the [shared bundle commands](../full-fill/SKILL.md#setup-and-tools).
Enable `skills.planar-infill.enabled` in the proposed plan. Set full-fill to
`mode: solid-surfaces` for solid top/bottom regions, or disable full-fill for an
open sparse body. Complete solid fill and sparse fill cannot own the same
material region; assign them separate regions or use complementary solid masks.
All settings and component selections are locked before generation.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Select the pattern. |
| `parts` | `[]` | Assembly components; empty selects all. |
| `perimeters` | `2` | Wall loops per layer. |
| `density` | `0.2` | Approximate interior volume fraction; spacing is line width / density. |
| `pattern` | `rectilinear` | Sparse interior pattern, described below. |
| `sampleStepMm` | `0.2` | Gyroid maximum sampling grid step, also limited to 1/32 of its period. |
| `maxPatternCells` | `1000000` | Gyroid sampling cells per layer; raise explicitly for larger/finer slices. |
| `fillAnglesDeg` | `[45, 135]` | Rectilinear and solid-skin directions alternate by layer. Grid/triangles use the first angle as their stable orientation; concentric/gyroid ignore angles for sparse fill. |
| `fillOverlap` | `0.15` | Overlap with the inner wall as a fraction of bead width. |
| `minFeatureMm` | `0.4` | Smallest sampled spline section feature. |

Full-fill owns `bottomLayers` and `topLayers` (three each by default).
Local solid masks compare neighboring sections, including shelves and sloping
roofs. One skill owns walls; sparse and solid interiors use complementary masks.
Drape's material reservation applies to both. The first solid layer over sparse
infill is a bridge with an approximate bead model; bridge optimization and
physical bridge validation are not implemented. External sacrificial supports
can be explicitly assigned with [supports](../supports/SKILL.md).

## Choosing an infill pattern

All five patterns keep the same wall owner and complementary solid-surface
masks. Pattern settings can be overridden per material region through the same
plan. They do not change full-fill's solid top/bottom strokes or drape reservations.

| Pattern | Why choose it | Tradeoff |
|---|---|---|
| `rectilinear` | Simple straight strokes, one direction per layer; retains existing recipes. | Direction changes between layers rather than within one layer. |
| `grid` | Two crossing directions per layer; simple support lattice for a roof. | Crossings accumulate material locally; direction-dependent behavior remains. |
| `triangles` | Three directions per layer form triangular cells. | More crossings; strength depends on material, orientation and bonding, not just the name. |
| `concentric` | Nested contours follow the local outline, including holes. | Narrow regions collapse under offsets; no automatic short-gap or thin-feature fill. |
| `gyroid` | Curved, connected strokes vary with Z without grid-style crossings within a layer. | More calculation/segments; boundary clipping can split strokes and small regions can have uneven density. |

For grid/triangles, the line-length budget is split over two/three directions;
adding directions does not multiply the requested material fraction. Density
does not compensate for intersections or finite boundary effects. Concentric
spacing is line width / density; each remaining contour is explicitly closed.
Thin strips and their roof support deserve judgment and Studio inspection.

Gyroid samples the nodal field `sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) = 0`
in scaled millimeter coordinates, with period `2.4 * lineWidthMm / density`.
This approximate density calibration measured 20.52% deposited line-volume
fraction for requested 20% on a 48 mm square averaged over 16 phases, at 0.2 mm
sampling and 0.4 mm width. It is not a certified surface or exact-volume model.
The existing level-set constructor extracts contours; the shared Clipper2 open
path tool clips them at walls, holes, islands and solid masks without adding
extrusion connections across gaps. The pattern is anchored to the shared world
coordinate grid, including Z, so placement can change its phase within a part.
Sample refinement tests measure field residual and contour-length convergence.
No upstream slicer code or documentation text was copied.

`scripts/patterns.mjs` exposes `infillStrokes(region, settings)` for the owning
generator and developer tests. Makers use the shared plan tools, not a separate
pattern export. Closed interiors remain fill operations, so they cannot acquire
wall material ownership or duplicate the part's perimeters. New settings in old
plans resolve to the existing rectilinear behavior before locking.

## Shared interfaces and boundaries

`planarInfillResults({shell, plan, reserve, id, solid})` returns composable
operations, including full-fill operations when solid regions are selected.
It reuses the planar stroke generator and region operations. Walls precede
interiors; supporting layers precede later layers and draped skins.
Closed solid/sparse mask intersections, unions and differences use the
[shared Clipper2 region tool](../../DEVELOP.md#shared-planar-intersections).

Shared `composition.regions` can place sparse walls above a solid cap on a vase,
below a draped roof, or between other assigned material regions on the same
part. Region-local settings merge the global defaults; full-fill can use `body`
in the base/cap regions and `solid-surfaces` beside sparse infill elsewhere.
Solid top/bottom masks use the assigned interval's actual neighboring sections.
All regions retain the component's global layer grid and unique material owners.

Published support distinguishes emitted solid top masks from sparse interiors.
A completed solid top mask can support a following area region; a sparse top
still needs experimental bridging where required. A vase foundation ring needs
actual covering wall/solid material, so sparse infill with zero perimeters is
not automatically accepted as a complete rim. Optional `lowerSurfaceFrom`
consumes the same surface interface as full-fill, clipping initial horizontal
layers above the supplied surface and assigning variable local bead volumes.
See [full-fill's interface limits](../full-fill/SKILL.md#composition-and-limits).
Continuous wall deposition cannot be interleaved turn by turn with interior
strokes; use compatible sequential regions until that transition is supported.

Both geometry backends provide bounds and sections through `core/geom/query.mjs`.
Machines must declare XYZ extrusion and planar capabilities; machine profiles
own tool/material limits and export behavior. Follow the
[shared interoperability guidance](../../DEVELOP.md#geometry-interoperability-for-skill-authors).

Travel uses nearest wall starts, alternating fill direction and verified combing,
including bounded routes around holes. Fill completes disconnected regions and
uninterrupted row groups on each side of holes/concavities before changing sides.
Shared motion compacts straight runs and directly repositions across permitted
gaps of at most 1 mm without retraction or lift. Other moves clear
the highest deposited material plus `liftMm` (default 1 mm; zero allowed). See [travel](../../DEVELOP.md#whole-plan-travel-requirement).
Thin features may collapse under offsets; density is approximate near
boundaries. No collision or automatic support model is implied by these checks.
