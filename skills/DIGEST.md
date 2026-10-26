# Skills

Read each chosen skill's manual (`read_skill`) before using it. "Experimental"
marks a technique whose physical behaviour is unknown; a keyword-only description
marks a skill to use only when the person names it. Read an advanced section
(`title: gate; name`) by name when the print's machine meets its gate or the
person asks: `read_skill ID#heading`, otherwise `read_guidance`.

<!-- BEGIN GENERATED SKILL DIGEST -->

## Core toolpath skills

| Skill | Use |
|---|---|
| [slice](slice/SKILL.md) | Deposit loops and fill in owned regions over slice stacks. |
| [trace](trace/SKILL.md) | Deposit along explicit XYZ, NURBS or surface UV curves with varying bead and process. |
| [inject](inject/SKILL.md) | Deposit at points, authored directly or supplied by skills, with explicit volume, flow and hold. |

## Guidance manuals

Recipes and techniques using Slice, Trace and Inject; no additional deposition families.

| Skill | Use |
|---|---|
| [line-network](line-network/SKILL.md) | Guidance for sparse frames and trusses made from Trace centerlines. |
| [hole-supports](hole-supports/SKILL.md) | Experimental. Downward-hole printing with removable supports, a drill-through membrane, stepped reduction or wave fronts. |
| [pipe-cladding](pipe-cladding/SKILL.md) | Guidance for axial or helical coatings using ordinary Slice over a selected surface. |
| [thick-lip](thick-lip/SKILL.md) | Guidance for thickened or rolled edges made with ordinary Slice or Trace. |
| [wave-overhangs](wave-overhangs/SKILL.md) | Guidance for lateral overhangs using the shared printed-base/final-edge wave construction. |

## Extensions

| Skill | Use |
|---|---|
| [advanced-vase-wall](advanced-vase-wall/SKILL.md) | Extension that fits a sleeve, repeats authored patterns and calls Trace. |
| [vase-wall](vase-wall/SKILL.md) | Extension for a continuous Trace spiral wall and optional solid base. |
| [bridging](bridging/SKILL.md) | Extension for Trace spans between supporting rims, using the shared geometric-edge construction. |
| [plastic-weld](plastic-weld/SKILL.md) | Experimental. Rivets of molten plastic injected into blind shafts across layers, placed individually or staggered through a solid body. |
| [heat-set-inserts](heat-set-inserts/SKILL.md) | Catalog heat-set bores with reinforcement following actual Slice layers. |
| [text](text/SKILL.md) | Raised or recessed lettering on a part, or standalone text, from an outline font; flat, along a spline, or bent onto a surface. |
| [line-text](line-text/SKILL.md) | Make printable single-line lettering as explicit Trace centerlines. |
| [thingi10k](thingi10k/SKILL.md) | Find meshes by keyword or Thingiverse link and download STLs from the Thingi10K mirror. Always link the file's license. |
| [gridfinity](gridfinity/SKILL.md) | gridfinity |
| [standard-support](standard-support/SKILL.md) | Experimental authored supports from a selected underside, flat footprint or tree skeleton, closed to the bed and sliced infill-only. |
| [hole-transitions](hole-transitions/SKILL.md) | Experimental. Edge-based membranes and advancing shoulders, with stepped reduction. |

## Workspace extensions

| Skill | Use |
|---|---|
| [wing](wing/SKILL.md) | Experimental interactive wing design workspace with source-backed airfoils and self-contained print bundles. |
| [gridfinity-planner](gridfinity-planner/SKILL.md) | Experimental workspace that fits a gridfinity grid to a drawer, paints bins into it by filament colour and packs them onto build plates as ordinary print bundles. |

## Advanced sections

- Surface regions: nonplanar machines; GEOMETRY.md#surface-regions
- Cladding a vase body: coordinated-rotary machines; gridfinity#cladding-a-vase-body

<!-- END GENERATED SKILL DIGEST -->
