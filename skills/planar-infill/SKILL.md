---
name: planar-infill
description: Generate planar walls and sparse rectilinear infill on closed mesh or supported spline geometry for compatible XYZ extrusion machines. Combine with full-fill for solid regions and draped-skin for surface-following roofs through the shared print workflow.
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
| `fillAnglesDeg` | `[45, 135]` | Rectilinear direction, alternated by layer. |
| `fillOverlap` | `0.15` | Overlap with the inner wall as a fraction of bead width. |
| `minFeatureMm` | `0.4` | Smallest sampled spline section feature. |

Full-fill owns `bottomLayers` and `topLayers` (three each by default).
Local solid masks compare neighboring sections, including shelves and sloping
roofs. One skill owns walls; sparse and solid interiors use complementary masks.
Drape's material reservation applies to both. The first solid layer over sparse
infill is a bridge with an approximate bead model; support generation, bridge
optimization and physical bridge validation are not implemented.

## Shared interfaces and boundaries

`planarInfillResults({shell, plan, reserve, id, solid})` returns composable
operations, including full-fill operations when solid regions are selected.
It reuses the planar stroke generator and region operations. Walls precede
interiors; supporting layers precede later layers and draped skins.

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
including bounded routes around holes. Disconnected material regions on one
layer are completed as separate groups, so sparse rows do not alternate across
an open gap; one side finishes before the next side begins. Other moves clear
the whole process plan. See [travel](../../DEVELOP.md#whole-plan-travel-requirement).
Thin features may collapse under offsets; density is approximate near
boundaries. No collision or automatic support model is implied by these checks.
