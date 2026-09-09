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
open sparse body. Enabling whole-body full-fill on the same component is rejected.
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

Both geometry backends provide bounds and sections through `core/geom/query.mjs`.
Machines must declare XYZ extrusion and planar capabilities; machine profiles
own tool/material limits and export behavior. Follow the
[shared interoperability guidance](../../DEVELOP.md#geometry-interoperability-for-skill-authors).

Travel uses nearest wall starts, alternating fill direction and verified combing,
including bounded routes around holes. Other moves clear the whole process plan.
See [travel](../../DEVELOP.md#whole-plan-travel-requirement). Thin features may
collapse under offsets; density is approximate near boundaries. No collision or
automatic support model is implied by these checks.
