# Skills

Read each chosen skill's manual (`read_skill`) before using it. "Experimental"
marks a technique whose physical behaviour is unknown; a keyword-only description
marks a skill to use only when the person names it. Read an advanced section
(`title: gate; name`) by name when the print's machine meets its gate or the
person asks: `read_skill ID#heading`, otherwise `read_guidance`.

<!-- BEGIN GENERATED SKILL DIGEST -->

## Toolpath skills

| Skill | Use |
|---|---|
| [planar-infill](planar-infill/SKILL.md) | Conventional flat layers, with walls around a patterned sparse interior and density down to a hollow body. Meshes and supported splines; pair with full-fill for solid tops and bases. |
| [full-fill](full-fill/SKILL.md) | Solid planar layers for a whole body, or solid bases, caps and surface regions around sparse infill. Meshes and supported spline shells. |
| [line-network](line-network/SKILL.md) | Experimental. Sparse planar frames and trusses from explicit centerline polylines, with per-layer reinforcement strokes; fills no enclosed area. |
| [bridging](bridging/SKILL.md) | Straight XYZ spans between two supporting rims, with separately controlled attachment motions. Makes no walls; compose with a wall producer. |
| [plastic-weld](plastic-weld/SKILL.md) | Experimental. Rivets of molten plastic injected into blind shafts across layers, placed individually or staggered through a solid body. |
| [supports](supports/SKILL.md) | Conventional supports under selected areas, or tree branches at placed contacts; placement trades support against surface contact and removal access. |
| [bed-adhesion](bed-adhesion/SKILL.md) | A single-layer brim around the outline, for a first layer too small or thin to grip the bed, such as an open-bottom vase. |
| [draped-skin](draped-skin/SKILL.md) | Top-skin strokes that follow a sloping or curved roof instead of flat-layer steps, within the machine's nonplanar angle limit; steep areas are reported. |
| [wave-overhangs](wave-overhangs/SKILL.md) | Experimental. Continuous wave passes grown from assigned supported seeds on curved or flat spline slices. |
| [vase-wall](vase-wall/SKILL.md) | A hollow vase or tube as one continuous rising spiral wall, with an optional solid base. |
| [advanced-vase-wall](advanced-vase-wall/SKILL.md) | Vase walls patterned with repeated tiles or authored paths on a sleeve, with optional smooth mesh fitting. |
| [thick-lip](thick-lip/SKILL.md) | A vase wall's top edge thickened into a rigid, optionally rolled rim. |
| [pipe-cladding](pipe-cladding/SKILL.md) | Experimental. Lengthwise, helical or crossed-helix cladding around a spline or mesh sleeve, or a finished vase wall. Development only; needs a configured DENSO RC8A robot with external rotary. |

## Geometry skills

| Skill | Use |
|---|---|
| [thingi10k](thingi10k/SKILL.md) | Find meshes by keyword or Thingiverse link and download STLs from the Thingi10K mirror. Always link the file's license. |
| [mesh-tools](mesh-tools/SKILL.md) | Diagnose failed mesh imports, clean duplicate or collapsed facets, repair self-intersections and fill explicitly bounded holes. |
| [text](text/SKILL.md) | Raised or recessed lettering on a part, or standalone text, from an outline font; flat, along a spline, or bent onto a surface. |
| [gridfinity](gridfinity/SKILL.md) | gridfinity |

## Hybrid skills

| Skill | Use |
|---|---|
| [heat-set-inserts](heat-set-inserts/SKILL.md) | Bores for SPIROL Series 19/29 heat-set inserts, metric and imperial, with local wall loops and fins; insertion faces must be flat and face up. |

## Advanced sections

- Surface regions: nonplanar machines; GEOMETRY.md#surface-regions
- Curved lettering above a draped roof: nonplanar machines; text#curved-lettering-above-a-draped-roof
- Cladding a vase body: coordinated-rotary machines; gridfinity#cladding-a-vase-body

<!-- END GENERATED SKILL DIGEST -->
