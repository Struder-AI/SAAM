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
| [slice](slice/SKILL.md) | Construct deposition over 3D regions using slices and slice families: loops, fill, brim, skin, fronts, sleeves, rims and cladding. |
| [trace](trace/SKILL.md) | Deposit along curves, authored directly or supplied by skills: XYZ, NURBS, surface UV paths and line text, with varying bead, process and tool pose. |
| [inject](inject/SKILL.md) | Deposit at points, authored directly or supplied by skills, with explicit volume, flow, vertical approach and hold. |
| [supports](supports/SKILL.md) | Tree branches at placed contacts; placement trades support against surface contact and removal access. Area supports under a footprint are slices with the support preset. |

## Geometry skills

| Skill | Use |
|---|---|
| [text](text/SKILL.md) | Raised or recessed lettering on a part, or standalone text, from an outline font; flat, along a spline, or bent onto a surface. |
| [mesh-tools](mesh-tools/SKILL.md) | Diagnose failed mesh imports, clean duplicate or collapsed facets, repair self-intersections and fill explicitly bounded holes. |
| [thingi10k](thingi10k/SKILL.md) | Find meshes by keyword or Thingiverse link and download STLs from the Thingi10K mirror. Always link the file's license. |
| [gridfinity](gridfinity/SKILL.md) | gridfinity |

## Hybrid skills

| Skill | Use |
|---|---|
| [plastic-weld](plastic-weld/SKILL.md) | Experimental. Rivets of molten plastic injected into blind shafts across layers, placed individually or staggered through a solid body. |
| [heat-set-inserts](heat-set-inserts/SKILL.md) | Bores for SPIROL Series 19/29 heat-set inserts, metric and imperial, with local wall loops and fins; insertion faces must be flat and face up. |

## Advanced sections

- Surface regions: nonplanar machines; GEOMETRY.md#surface-regions
- Cladding a vase body: coordinated-rotary machines; gridfinity#cladding-a-vase-body

<!-- END GENERATED SKILL DIGEST -->
