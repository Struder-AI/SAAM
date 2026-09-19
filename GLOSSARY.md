# SAAM glossary

Shared language for people and for agents in all three roles. Keep definitions
short and useful without requiring CAD or programming knowledge. This is the
starting vocabulary for the ontology we develop together.

## Established terms

| Term | Meaning |
|---|---|
| Maker agent | An AI agent using SAAM to help a person make a part. It uses skills, gives printing advice and operates Studio, and changes no shared code. |
| Builder agent | An AI agent changing a skill, extending Studio, or making an isolated local change to core, and making parts to test that work. It inherits maker responsibilities. |
| Developer agent | An AI agent working on core and across components, owning cross-cutting design. It is maps-native and inherits maker and builder responsibilities. |
| Development agent | Builder and developer agents together, where a distinction between them is not needed. Earlier material uses this name for both. |
| SAAM Studio | The interface for inspecting the part and reviewing the generated toolpath. |
| Studio event queue | The agent-owned record of what the person did and what workers produced in that agent's Studio instances. Held events wait for a read; delivered events push at once and carry the held remainder. |
| Geometry | The shape and dimensions of the part. |
| Feature | A meaningful part of a shape, such as a hole, rim, face or edge, that people and agents can refer to. |
| Skill | A packaged capability with its own text instruction manual and tools. |
| Skill result | Operations returned by a skill for shared composition into one toolpath. |
| Interoperability | Components work together across geometry, printing skills, machines and the shared workflow wherever their actual requirements allow. |
| Skill composition | Combining skills in one part, assigning material regions, connecting their boundaries and preserving printing order. |
| Weaving | Interleaving compatible skill operations across layers or within a layer while preserving their dependencies. |
| Tool | A callable script or function supplied by a skill. |
| Standard vase mode | Conventional continuous spiral-wall printing, with an optional solid base; see the [standard vase manual](skills/vase-wall/SKILL.md). |
| Advanced vase mode | Motifs and authored patterns mapped onto reference sleeves, including smooth mesh fitting and adjustable mesh conformance; see the [advanced vase manual](skills/advanced-vase-wall/SKILL.md). |
| Stress mesh | The local `sotvl_Spiral-Vase.stl` mesh used for demanding geometry and slicing trials. Current trials use its CGAL-repaired derivative. The source and recipe provenance are recorded in [DEVLOG.md](DEVLOG.md#2026-09-16--vase-contact-speed-and-local-loose-offset-curvature-limiting); this is a local asset, not a bundled example. |
| Motif | One reusable curve, such as a looping stroke or zigzag. Vase tiling joins its cell endpoints, repeats it along a regular reference strip and upward, then maps the strip onto actual sleeve sections; see [single-motif tiling](skills/advanced-vase-wall/SKILL.md#one-motif-a-regular-tiler-then-sleeve-mapping). |
| Motif tiler | The regular parameter layout that repeats a motif with connected cell/course endpoints before sleeve mapping. It does not create an additional printed wall or require registration with the course below. |
| Motif course | One complete circuit around the sleeve containing a row of motif cells. A fixed cell count per turn makes physical cell widths shrink with the sleeve circumference; motif depth is a separate setting. Body courses rise, while flat boundary courses stay at one height. |
| Reference sleeve | The open side surface around a vase-like shape, excluding its bottom and top caps. It may be reduced from a solid envelope or detected as the outer side of a closed hollow vessel. It guides motif placement; it is not itself deposited material or proof that the print has a continuous wall. |
| Sleeve fitting | Estimating a smooth periodic spline reference sleeve from mesh sections while retaining the source mesh for separate contact/conformance queries. Fit detail and mesh contact fidelity are separate choices. |
| Process plan | The recipe for making a part: geometry reference, selected skills, their settings, and machine/setup choices. |
| Locked process plan | The complete version of the recipe submitted for approval; generation introduces no further process choices. |
| Toolpath | The route and associated printing actions the machine will follow. |
| SAAMpath | SAAM's internal motion and printing actions, used transiently during generation and export. Print persistence follows [D-027](DECISIONS.md#d-027--export-only-print-persistence). |
| Machine file | The definition of a machine, including its supported output options. |
| Export | The machine-ready file or file bundle produced from SAAMpath, using an output option declared by the machine file. Studio runs the same export the machine receives. |
| Print | A local bundle containing geometry, a process plan and review records, plus the checked machine export once generated. Specific curated examples may be shared. |
| Approval | A human's confirmation of one specific geometry version, or of the complete settings and exact toolpath together. |
| Dev map | The structural account of core and Studio: one Markdown region source per scope that owns both the agent-readable map and the human rendering generated from it. Skill implementations and client adapters are callers outside its boundary. |
| Region | One mapped scope of the system, such as geometry or output, held in a single source file with its own map pages and supporting prose. |
| Map page | One abstraction level of a region, whose boxes resolve to a child page, a named code declaration, or a shared component. |
| Operation address | A page node's stable dot-separated number, such as `4.1.2`. Addresses stay stable across edits so references to them keep resolving. |
| Shared component | One identity for a declaration used more than once, valid only where every use carries the same input/output contract, including units, frames, preconditions, errors, mutation and ordering. |
| Shared-use reference | The calculated link from one occurrence of a shared component to every other mapped occurrence, drawn as a red vertical arrow with the other node's index. It means shared implementation, not execution order or data flow, and is never authored by hand. |
| Context map | A human reference drawing which documents each role reads and in what order. It is documentation navigation, not a code-anchored dev map, and no agent command returns it. |

Project decision statuses live in [DECISIONS.md](DECISIONS.md); they are separate
from the final settings/toolpath confirmation within a print.

## Proposed terms and open meanings

These names remain open vocabulary. Their use below does not imply that the
corresponding implemented capability is awaiting approval or implementation;
linked manuals own its current limits.

| Term | Proposed meaning | Open choice |
|---|---|---|
| Design file | The saved geometry, and editable design information where available. | Geometry storage supports native meshes and direct spline inputs; a universal editable design format is not defined. |
| Shell | A closed surface describing a solid's boundary. | Shared geometry queries accept supported spline shells and validated meshes. This does not mean a hollow print or a perimeter. |
| Spline shell | In current recipe names, a domed spline roof with tapered spline sides over a rectangular base. | The `spline-shell` builder is a bounded shape, not arbitrary spline-side editing; see [full-fill geometry](skills/full-fill/SKILL.md). |
| Vertical spline shell | A domed spline roof over a bulged footprint whose walls remain vertical. | The `vertical-spline-shell` builder exposes symmetric bulges; see [full-fill geometry](skills/full-fill/SKILL.md). |
| Full fill | Filling a selected region solid with outlines and interior material. | The [full-fill skill](skills/full-fill/SKILL.md) also supplies selected solid top/bottom regions alongside infill. |
| Planar infill | Flat layers with walls and an interior pattern, or no interior fill when selected. | The [planar-infill skill](skills/planar-infill/SKILL.md) owns supported patterns and densities; solid regions reuse full-fill. |
| Draped skin | Top layers that follow the surface instead of stepping across it in flat slices. | The [draped-skin skill](skills/draped-skin/SKILL.md) owns surface and process limits. |
| Non-planar angle limit | A declared limit on surface steepness for deposition with a downward-pointing nozzle. | It is a software setting, not measured machine clearance or a validated printing capability; see [draped-skin](skills/draped-skin/SKILL.md). |
| Layer | A flat, tilted or curved surface on which a portion of a print is laid down. | Current operation layers and dependencies follow the shared skill-result composition; this is not a universal surface format. |

Proposed names do not commit us to an extra processing stage or file format.
