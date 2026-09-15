# SAAM glossary

Shared language for people, maker agents, and development agents. Keep definitions
short and useful without requiring CAD or programming knowledge. This is the
starting vocabulary for the ontology we develop together.

## Established terms

| Term | Meaning |
|---|---|
| Maker agent | An AI agent using SAAM to help a person make something. |
| Development agent | An AI agent building SAAM; it also acts as a maker agent when testing. |
| SAAM Studio | The interface for inspecting the part and reviewing the generated toolpath. |
| Geometry | The shape and dimensions of the part. |
| Feature | A meaningful part of a shape, such as a hole, rim, face or edge, that people and agents can refer to. |
| Skill | A packaged capability with its own text instruction manual and tools. |
| Skill result | Operations returned by a skill for shared composition into one toolpath. |
| Interoperability | Components work together across geometry, printing skills, machines and the shared workflow wherever their actual requirements allow. |
| Skill composition | Combining skills in one part, assigning material regions, connecting their boundaries and preserving printing order. |
| Weaving | Interleaving compatible skill operations across layers or within a layer while preserving their dependencies. |
| Tool | A callable script or function supplied by a skill. |
| Motif | One reusable curve, such as a looping stroke or zigzag. Vase tiling joins its cell endpoints, repeats it along a regular reference strip and upward, then maps the strip onto actual sleeve sections; see [single-motif tiling](skills/vase-wall/SKILL.md#one-motif-a-regular-tiler-then-sleeve-mapping). |
| Motif tiler | The regular parameter layout that repeats a motif with connected cell/course endpoints before sleeve mapping. It does not create an additional printed wall or require registration with the course below. |
| Process plan | The recipe for making a part: geometry reference, selected skills, their settings, and machine/setup choices. |
| Locked process plan | The complete version of the recipe submitted for approval; generation introduces no further process choices. |
| Toolpath | The route and associated printing actions the machine will follow. |
| SAAMpath | SAAM's internal motion and printing actions, used transiently during generation and export. Print persistence follows [D-027](DECISIONS.md#d-027--export-only-print-persistence). |
| Machine file | The definition of a machine, including its supported output options. |
| Export | The machine-ready file or file bundle produced from SAAMpath, using an output option declared by the machine file. Studio runs the same export the machine receives. |
| Print | A local bundle containing geometry, a process plan and review records, plus the checked machine export once generated. Specific curated examples may be shared. |
| Approval | A human's confirmation of one specific geometry version, or of the complete settings and exact toolpath together. |

Project decision statuses live in [DECISIONS.md](DECISIONS.md); they are separate
from the two confirmations within a print.

## Proposed terms and open meanings

These names remain open vocabulary. Their use below does not imply that the
corresponding implemented capability is awaiting approval or implementation;
linked manuals own its current limits.

| Term | Proposed meaning | Open choice |
|---|---|---|
| Design file | The saved geometry, and editable design information where available. | [Geometry storage](core/geom/README.md#geometry-query-boundary) supports native meshes and direct spline inputs; a universal editable design format is not defined. |
| Shell | A closed surface describing a solid's boundary. | Shared geometry queries accept supported spline shells and validated meshes; see [geometry inputs](core/geom/README.md#geometry-query-boundary). This does not mean a hollow print or a perimeter. |
| Spline shell | In current recipe names, a domed spline roof with tapered spline sides over a rectangular base. | The `spline-shell` builder is a bounded shape, not arbitrary spline-side editing; see [full-fill geometry](skills/full-fill/SKILL.md). |
| Vertical spline shell | A domed spline roof over a bulged footprint whose walls remain vertical. | The `vertical-spline-shell` builder exposes symmetric bulges; see [full-fill geometry](skills/full-fill/SKILL.md). |
| Full fill | Filling a selected region solid with outlines and interior material. | The [full-fill skill](skills/full-fill/SKILL.md) also supplies selected solid top/bottom regions alongside infill. |
| Planar infill | Flat layers with walls and an interior pattern, or no interior fill when selected. | The [planar-infill skill](skills/planar-infill/SKILL.md) owns supported patterns and densities; solid regions reuse full-fill. |
| Draped skin | Top layers that follow the surface instead of stepping across it in flat slices. | The [draped-skin skill](skills/draped-skin/SKILL.md) owns surface and process limits. |
| Non-planar angle limit | A declared limit on surface steepness for deposition with a downward-pointing nozzle. | It is a software setting, not measured machine clearance or a validated printing capability; see [draped-skin](skills/draped-skin/SKILL.md). |
| Layer | A flat, tilted or curved surface on which a portion of a print is laid down. | Current operation layers and dependencies are described in [skill composition](core/path/README.md#skill-result-composition); this is not a universal surface format. |

Proposed names do not commit us to an extra processing stage or file format.
