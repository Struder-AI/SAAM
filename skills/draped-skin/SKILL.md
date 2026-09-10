---
name: draped-skin
description: Generate surface-following top skins on supported spline shells and closed meshes, using the selected machine's non-planar angle limit and the shared print workflow. Requires a continuous accessible roof; steep area is excluded and reported.
---

# Draped skin

Use for top layers that follow a surface rather than stepping across it in flat
layers. Read [MAKERS.md](../../MAKERS.md); developers also read
[DEVELOP.md](../../DEVELOP.md). Use the [shared tools](../full-fill/SKILL.md#setup-and-tools).

The skill queries surface height and normals through the shared geometry
interface. Supported inputs are the existing untrimmed spline shapes, validated
triangle meshes including STL, and a selected roof component in an assembly.
It does not require a mesh conversion for spline inputs. Mesh normals remain
faceted, with the steeper normal chosen at a shared crease; they are not smoothed.

## Behavior and limits

Survey the roof, exclude area steeper than the selected limit, reserve thickness
under skinnable surface, and generate surface-following strokes. The reserve is
subtracted from full-fill and planar-infill. All supporting body operations must
finish before the skins; skins remain ordered. Surface height means the highest
exposed surface at XY, not the underside of an overhang or a general wrapped skin.

S5 declares a 15° software limit. The user also selected **experimental 15° for
H2D** on 2026-09-09. Neither is a manufacturer-certified clearance rating. The
machine must declare XYZ extrusion, non-planar capability and an angle limit.
Steep percentage and the effective limit are reported by the survey/generator.
A sampled stroke crossing a height discontinuity, missing roof or excessive
angle is rejected; choose a continuous roof or refine the survey.

`drapedSkinResult({shell, plan, machine, survey, id, after})` returns operations
for the shared composer. `generateDrapedSkin(builder, options)` uses the same
implementation for a single instance. Use all results together when composing a
plan, so whole-plan travel accounts for every component and operation.

Shared `composition.regions` assigns skins to the actual roof of a selected
component alongside or after its body regions. Its emitted stack must fit the
assigned bounds; a region is not permission to replace that roof with a clipped
flat plane. Same-region sparse walls and solid masks reserve the roof's actual
thickness. Spatial reservation affects only its footprint, including supporting
components under a spanning roof, and preserves unrelated taller components.

First-skin volumes use the emitted supporting layer heights, with each
component's translated layer grid. Missing support requires an explicit
experimental bridge policy in regional recipes. After deposition the skinned
footprint publishes its native material top as a shared surface interface;
another region may consume it through `lowerSurfaceFrom`. For example full-fill
can deposit horizontal layers above this wavy bottom, with variable initial
gaps and the same shared composer. That consumer must have complete footprint
coverage; excluded steep or absent roof areas are not invented as support.
See [full-fill composition](../full-fill/SKILL.md#composition-and-limits) and the
[synthetic full-stack example](../../core/tests/fixtures/regional-stack.mjs).
Bead coverage and bridging remain numerical approximations without physical
validation; the fixture's robot setup is explicitly synthetic.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Select the skin. |
| `part` | `null` | Roof component for an assembly; otherwise the part roof. |
| `layers` | `2` | Number of skins. |
| `normalMm` | `0.2` | Skin thickness measured along the surface normal. |
| `strokeAngleDeg` | `0` | Bed-plane stroke direction. |
| `sampleStepMm` | `0.5` | Stroke sampling step. |
| `surveyStepMm` | `0.5` | Surface survey step. |
| `maxAngleDegOverride` | `null` | Explicit per-print experimental override; leaves the profile unchanged. |

## Travel

Verified short direct moves may stay down on the current skin. Lifted travel and
cooling clear the **entire placed process plan** plus its locked lift, not just
this roof or the crossed surface. The local surface query still controls whether
a short direct move is permitted. Other operations can disallow that move.
Follow the [shared travel contract](../../DEVELOP.md#whole-plan-travel-requirement).

## Validation status

Software tests exercise mesh and spline inputs against both S5 and H2D profiles.
S5 supports checked Griffin export, Studio's three approvals and exact-byte
delivery. H2D uses the same workflow with experimental sliced-3MF output and
strict interpretation of the print body. Its firmware service routines are not
simulated; read the [machine contract](../../DEVELOP.md#h2d-output-contract).

No physical print, head-clearance or surface-finish validation has been performed.
Beads, skin offsets and first-skin bridging are approximate. Curvature convergence,
automatic supports, pressure/adhesion and second-nozzle collision are not modeled.
A direct turnaround permits up to a quarter-skin thickness of surface sag (capped
at 0.05 mm). Sampling can miss features between samples; refine deliberately.
Run `npm test` after changes.
