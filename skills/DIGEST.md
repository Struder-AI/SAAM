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
| [slice](slice/SKILL.md) | Deposit loops and fill in owned regions over reference surface families. |
| [trace](trace/SKILL.md) | Deposit along explicit XYZ, NURBS or surface UV curves with varying bead and process. |
| [inject](inject/SKILL.md) | Deposit at points, authored directly or supplied by skills, with explicit volume, flow, vertical approach and hold. |

## Guidance manuals

Recipes and techniques using Slice, Trace and Inject; no additional deposition families.

| Skill | Use |
|---|---|
| [line-network](line-network/SKILL.md) | Guidance for sparse frames and trusses made from Trace centerlines. |

## Extensions

| Skill | Use |
|---|---|
| [advanced-vase-wall](advanced-vase-wall/SKILL.md) | Extension that fits a sleeve, repeats authored patterns and calls Trace. |
| [vase-wall](vase-wall/SKILL.md) | Extension for a continuous Trace spiral wall and optional solid base. |
| [bridging](bridging/SKILL.md) | Extension for Trace spans between supporting rims, including attachment motions. |
| [draped-skin](draped-skin/SKILL.md) | Extension for roof-following Slice courses and their contact with prior material. |
| [wave-overhangs](wave-overhangs/SKILL.md) | Extension for experimental seeded-front fill on ordinary Slice families. |
| [thick-lip](thick-lip/SKILL.md) | Extension for making a thickened or rolled edge with Slice or Trace. |
| [pipe-cladding](pipe-cladding/SKILL.md) | Extension for experimental axial or helical Slice coatings on periodic surface references. |
| [plastic-weld](plastic-weld/SKILL.md) | Experimental. Rivets of molten plastic injected into blind shafts across layers, placed individually or staggered through a solid body. |
| [heat-set-inserts](heat-set-inserts/SKILL.md) | Bores for SPIROL Series 19/29 heat-set inserts, metric and imperial, with local wall loops and fins; insertion faces must be flat and face up. |
| [text](text/SKILL.md) | Raised or recessed lettering on a part, or standalone text, from an outline font; flat, along a spline, or bent onto a surface. |
| [line-text](line-text/SKILL.md) | Make printable single-line lettering as explicit Trace centerlines. |
| [thingi10k](thingi10k/SKILL.md) | Find meshes by keyword or Thingiverse link and download STLs from the Thingi10K mirror. Always link the file's license. |
| [gridfinity](gridfinity/SKILL.md) | gridfinity |
| [standard-support](standard-support/SKILL.md) | Experimental selected underside patches closed to the bed, with an adhesion base and parallel infill-only Slice; support choices remain authored. |
| [supports](supports/SKILL.md) | Experimental tree branches at authored contacts; selected curved underside support uses standard-support. |
| [hole-supports](hole-supports/SKILL.md) | Experimental support options for a detected bed-facing circular counterbore under a smaller through bore. |

## Workspace extensions

| Skill | Use |
|---|---|
| [wing](wing/SKILL.md) | Experimental interactive wing design workspace with source-backed airfoils and self-contained print bundles. |

## Advanced sections

- Surface regions: nonplanar machines; GEOMETRY.md#surface-regions
- Cladding a vase body: coordinated-rotary machines; gridfinity#cladding-a-vase-body

<!-- END GENERATED SKILL DIGEST -->
