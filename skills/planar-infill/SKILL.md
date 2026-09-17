---
name: planar-infill
description: Print conventional flat-layer walls with a patterned interior, varying infill density to control material use or leave a hollow body. Supports closed meshes and supported spline geometry; combine with full-fill for solid tops and bases.
---

# Planar infill

Use for conventional flat-layer printing with walls and a sparse interior.
For maker work, read [MAKERS.md](../../MAKERS.md). For development, start with the
[builder orientation](../../BUILDERS.md) and follow its task-specific references.
Software tests cover the S5 and H2D profiles,
mesh and restricted spline inputs. No physical print is validated. Both machines
use the shared export/review/delivery workflow. H2D output is experimental; read
its [machine contract](../../core/export/bambu.md#h2d-output-contract) before use.

## Tools

Use the [shared bundle commands](../../core/print/USAGE.md).
Enable `skills.planar-infill.enabled` in the proposed plan. Set full-fill to
`mode: solid-surfaces` for solid top/bottom regions, or disable full-fill for an
open sparse body. Complete solid fill and sparse fill cannot own the same
material region; assign them separate regions or use complementary solid masks.
All settings and component selections are locked before generation.

For conventional flat-layer printing, also disable draped-skin; it is enabled
in the shell template and otherwise reserves roof material for a separate skin.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Select the pattern. |
| `parts` | `[]` | Assembly components; empty selects all. |
| `perimeters` | `2` | Maximum inward loops from each boundary per layer. |
| `density` | `0.2` | Zero leaves the interior empty; otherwise 0.01–1 sets approximate interior volume fraction, with spacing = line width / density. |
| `pattern` | `rectilinear` | Sparse interior pattern, described below. |
| `sampleStepMm` | `0.2` | Gyroid maximum sampling grid step, also limited to 1/32 of its period. |
| `maxPatternCells` | `1000000` | Gyroid sampling cells per layer; raise explicitly for larger/finer slices. |
| `fillAnglesDeg` | `[45, 135]` | Rectilinear and solid-skin directions alternate by layer. Grid/triangles use the first angle as their stable orientation; concentric/gyroid ignore angles for sparse fill. |
| `fillOverlap` | `0.15` | Overlap with the inner wall as a fraction of bead width. |
| `minFeatureMm` | `0.4` | Smallest sampled spline section feature. |

Full-fill owns `bottomLayers` and `topLayers` (three each by default).
For a hollow vessel printed in ordinary flat layers, use zero density, positive
perimeters and full-fill `solid-surfaces` with bottom layers and zero top layers.
This follows supported concave sections too; it does not require vase-wall or
its convex-section restriction. Walls close separately on each layer, so a seam
and layer transitions remain. Local solid-surface masks still apply to shelves
and changing sections; inspect the generated path before printing.
Walls use full-fill's shared perimeter generator, including its
[central-loop recovery](../full-fill/SKILL.md#settings): a 2 mm circular wall
at 0.4 mm line width and three or more perimeters has five loops and no sparse
or solid interior strokes. Wider regions retain their selected interior pattern.
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
This is an approximate density calibration, not a certified surface or
exact-volume model; the [development measurement](../../DEVLOG.md#2026-09-10--gyroid-contour-construction-measurement)
records its sampled line-volume fraction.
The existing level-set constructor extracts contours; the shared Clipper2 open
path tool clips them at walls, holes, islands and solid masks without adding
extrusion connections across gaps. The pattern is anchored to the shared world
coordinate grid, including Z, so placement can change its phase within a part.
Sample refinement tests measure field residual and contour-length convergence.
The pattern implementation is original SAAM code.

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
[shared Clipper2 region tool](../../core/region/README.md#shared-planar-intersections).

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
[shared interoperability guidance](../../core/geom/README.md#geometry-interoperability-for-skill-authors).

Travel uses nearest wall starts, alternating fill direction and verified combing,
including bounded routes around holes. Fill completes disconnected regions and
uninterrupted row groups on each side of holes/concavities before changing sides.
Rectilinear, grid and triangle row groups choose the closest endpoint of either
end row, with row order and stroke direction chosen independently. Concentric
and gyroid keep their existing ordering. Heat balancing and lookahead are deferred.
Shared motion compacts straight runs and directly repositions across permitted
gaps of at most 1 mm without retraction or lift. Other moves clear
the highest deposited material plus `liftMm` (default 1 mm; zero allowed). See [travel](../../core/path/README.md#whole-plan-travel-requirement).
Thin features may collapse under offsets; density is approximate near
boundaries. No collision or automatic support model is implied by these checks.

## Shared example

The [nudge-cup workspace](../../examples/prints/nudge-cup/README.md) packages a
reproducible recipe using this skill. Its guide describes dimensions, setup and
current limits; generated workspaces begin without manufacturing approvals.
