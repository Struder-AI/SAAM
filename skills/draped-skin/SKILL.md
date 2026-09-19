---
name: draped-skin
description: Follow a sloping or curved roof with top-skin strokes instead of approximating it with flat-layer steps. Works on continuous accessible mesh or supported spline roofs within the machine's nonplanar angle limit; excluded steep areas are reported.
---

# Draped skin

Use for top layers that follow a surface rather than stepping across it in flat
layers. For maker work, read [MAKERS.md](../../MAKERS.md). For development, start
with the [builder orientation](../../BUILDERS.md) and follow its task-specific
references. Use the [shared tools](../../core/print/USAGE.md).

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
Closed footprint/reservation booleans use the
[shared Clipper2 region tool](../../core/region/README.md#shared-planar-intersections);
surface sampling and level-set extraction retain their existing limits.

S5 declares a 15° software limit; H2D uses an **experimental 15° limit**.
Neither is a manufacturer-certified clearance rating. The
machine must declare XYZ extrusion, non-planar capability and an angle limit.
Steep percentage and the effective limit are reported by the survey/generator.
A sampled stroke crossing a height discontinuity, missing roof or excessive
angle is rejected; choose a continuous roof or refine the survey.

For an assembly, set `part` to the roof component's ID; the template's `null`
selection is only for a single part, and the skin stack must fit the selected roof.

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
component's translated layer grid. Across voids, the assigned components' layer
grid supplies the approximate initial gap; bridging is a recipe judgment for
the maker and agent, with no bridge permission flag. After deposition the skinned
footprint publishes its native material top as a shared surface interface;
another region may consume it through `lowerSurfaceFrom`. For example full-fill
can deposit horizontal layers above this wavy bottom, with variable initial
gaps and the same shared composer. That consumer must have complete footprint
coverage; excluded steep or absent roof areas are not invented as support.
See [full-fill composition](../full-fill/SKILL.md#composition-and-limits) and the
[synthetic full-stack example](../../core/tests/fixtures/regional-stack.mjs).
Bead coverage and bridging remain numerical approximations without physical
validation; the fixture's robot setup is explicitly synthetic.

A region containing only draped-skin can also consume `lowerSurfaceFrom`, such
as a curved lettering material selection on a finished draped roof. Its skins still follow
the selected component's top; the lower surface supplies the first bead's actual
support height and operation dependencies. The consumer's bounding-box minimum
need not reach valleys elsewhere on the producer. Unlike planar fill, it does
not start on a global horizontal layer grid. A support above the nominal reserve
can yield a thinner first bead, but support at or above the first deposited skin
is rejected. Missing support at a stroke is also rejected. See the
[text composition](../text/SKILL.md#curved-lettering-above-a-draped-roof) for the
recipe and reproducible example.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Select the skin. |
| `part` | `null` | Roof component for an assembly; otherwise the part roof. |
| `layers` | `2` | Number of skins. Any whole count from one up is accepted; more than about eight is rarely useful. |
| `normalMm` | `0.2` | Skin thickness measured along the surface normal. |
| `strokeAngleDeg` | `0` | Bed-plane stroke direction. |
| `sampleStepMm` | `0.5` | Stroke sampling step. |
| `surveyStepMm` | `0.5` | Surface survey step. |
| `maxAngleDegOverride` | `null` | Explicit per-print experimental override; leaves the profile unchanged. |

## Travel

Within each skin layer, complete uninterrupted scanline groups in closest-entry
order from the nozzle, choosing either endpoint of either end row. Row order and
stroke direction can reverse independently; reversing strokes also reverses
their segment volumes and metadata. Skin-layer dependencies
remain ordered; heat balancing and lookahead are deferred.

Verified short direct moves may stay down on the current skin. Lifted travel and
cooling clear the **highest material deposited so far** across all skills plus
the locked `liftMm` (default 1 mm; zero allowed). Shared comb routing uses the
allowed footprint, including holes, and samples each skin's local height for
detours within `maxCombMm`. The local surface query controls straight-chord
clearance; completed operations constrain every direct or routed segment.
Follow the [shared travel contract](../../core/path/README.md#whole-plan-travel-requirement).

## Validation status

Software tests exercise mesh and spline inputs against both S5 and H2D profiles.
S5 supports checked Griffin export, Studio's final toolpath/settings confirmation and exact-byte
delivery. H2D uses the same workflow with experimental sliced-3MF output and
strict interpretation of the print body. Its firmware service routines are not
simulated; read the [machine contract](../../core/export/bambu.md#h2d-output-contract).

No physical print, head-clearance or surface-finish validation has been performed.
Beads, skin offsets and first-skin bridging are approximate. Curvature convergence,
automatic supports, pressure/adhesion and second-nozzle collision are not modeled.
A direct turnaround permits up to a quarter-skin thickness of surface sag (capped
at 0.05 mm). Sampling can miss features between samples; refine deliberately.

## Shared example

The [surface-drape workspace](../../examples/prints/surface-drape/README.md) packages a
reproducible recipe using this skill. Its guide describes dimensions, setup and
current limits; generated workspaces begin without manufacturing approvals.
