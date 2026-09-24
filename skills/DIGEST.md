# Skills

Choose skills here, then read each chosen manual (`read-skill ID`; MCP
`read_skill`) before using it. The manual owns tools, settings and limits.
Experimental skills are new printing techniques whose physical behaviour is
still unknown. A description that is only a keyword marks a
[keyword skill](../GLOSSARY.md): use it only when the person names it.

<!-- BEGIN GENERATED SKILL DIGEST -->

## Toolpath skills

| Skill | Use |
|---|---|
| [planar-infill](planar-infill/SKILL.md) | Conventional flat layers, with walls around a patterned sparse interior and density down to a hollow body. Meshes and supported splines; pair with full-fill for solid tops and bases. |
| [full-fill](full-fill/SKILL.md) | Solid planar layers for a whole body, or solid bases, caps and surface regions around sparse infill. Meshes and supported spline shells. |
| [line-network](line-network/SKILL.md) | Sparse planar frames and trusses from explicit centerline polylines, with per-layer reinforcement strokes; fills no enclosed area. |
| [bridging](bridging/SKILL.md) | Straight XYZ spans between two supporting rims, with separately controlled attachment motions. Makes no walls; compose with a wall producer. |
| [plastic-weld](plastic-weld/SKILL.md) | Experimental. Rivets of molten plastic injected into blind shafts across layers, placed individually or staggered through a solid body. |
| [supports](supports/SKILL.md) | Conventional supports under selected areas, or tree branches at placed contacts; placement trades support against surface contact and removal access. |
| [bed-adhesion](bed-adhesion/SKILL.md) | A single-layer brim around the outline, for a first layer too small or thin to grip the bed, such as an open-bottom vase. |
| [rimming-planar](rimming-planar/SKILL.md) | Experimental. Thin walls that hold up selected edges so a planned bridge can span between them; paired beads offset horizontally from a maker-assigned spline surface. |
| [rimming-normal](rimming-normal/SKILL.md) | Experimental. Rimming with beads offset along 3D surface normals, for nonplanar paths on a curved reference surface. |
| [draped-skin](draped-skin/SKILL.md) | Top-skin strokes that follow a sloping or curved roof instead of flat-layer steps, within the machine's nonplanar angle limit; steep areas are reported. |
| [wave-overhangs](wave-overhangs/SKILL.md) | Experimental. Continuous wave passes grown from assigned supported seeds on curved or flat spline slices. |
| [vase-wall](vase-wall/SKILL.md) | A hollow vase or tube as one continuous rising spiral wall, with an optional solid base. |
| [advanced-vase-wall](advanced-vase-wall/SKILL.md) | Vase walls patterned with repeated tiles or authored paths on a sleeve, with optional smooth mesh fitting. |
| [thick-lip](thick-lip/SKILL.md) | A vase wall's top edge thickened into a rigid, optionally rolled rim. |
| [pipe-cladding](pipe-cladding/SKILL.md) | Lengthwise, helical or crossed-helix cladding around a pipe, a spline or mesh sleeve, or a finished vase wall. Development only; needs a configured DENSO RC8A robot with external rotary. |

## Geometry skills

| Skill | Use |
|---|---|
| [thingi10k](thingi10k/SKILL.md) | Find meshes by keyword or Thingiverse link and download STLs from the Thingi10K mirror. Always link the file's license. |
| [mesh-tools](mesh-tools/SKILL.md) | Diagnose failed mesh imports, clean duplicate or collapsed facets, repair self-intersections and fill explicitly bounded holes. |
| [text](text/SKILL.md) | Raised or recessed lettering on a part, or standalone text, from an outline font; flat, along a spline, or bent onto a surface. |
| [gridfinity](gridfinity/SKILL.md) | gridfinity |
| [heat-set-inserts](heat-set-inserts/SKILL.md) | Bores for SPIROL Series 19/29 heat-set inserts, metric and imperial, with local wall loops and fins; insertion faces must be flat and face up. |

<!-- END GENERATED SKILL DIGEST -->
