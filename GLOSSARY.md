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
| Tool | A callable script or function supplied by a skill. |
| Process plan | The recipe for making a part: geometry reference, selected skills, their settings, and machine/setup choices. |
| Locked process plan | The complete version of the recipe submitted for approval; generation introduces no further process choices. |
| Toolpath | The route and associated printing actions the machine will follow. |
| SAAMpath | SAAM's internal toolpath representation, generated directly from the approved process plan. The wedge demo uses versioned JSON with XYZ motion, deposited volume and printing actions. |
| Machine file | The definition of a machine, including its supported output options. |
| Export | The machine-ready file or file bundle produced from SAAMpath, using an output option declared by the machine file. Studio runs the same export the machine receives. |
| Print | A local bundle containing a process plan, SAAMpath and its export. Specific curated examples may be shared. |
| Approval | A human's agreement to one specific version of the geometry, locked process plan, or toolpath. |

Project decision statuses live in [DECISIONS.md](DECISIONS.md); they are separate
from the three approvals within a print.

## Proposed terms and open meanings

| Term | Proposed meaning | Open choice |
|---|---|---|
| Design file | The saved geometry, and editable design information where available. | Rhino/3DM is selected; this user-facing name and the editing workflow remain proposed. |
| Shell | A closed surface made of untrimmed spline patches, describing one solid. | The current geometry input for the full-fill and draped-skin skills; the general geometry contract is still open. |
| Full fill | Filling a layer solid: an outline, then material across the whole inside. | Named after the skill; the wider fill vocabulary (sparse infill, densities) is not settled. |
| Draped skin | Top layers that follow the shape of the surface instead of stepping across it in flat slices. | Proposed user-facing name for non-planar surface layers. |
| Non-planar angle limit | How steep a surface the machine can lay material along, given a nozzle that always points straight down. | Declared per machine (15 degrees for the S5). A software limit, not a measured or validated clearance rating. |
| Layer | A surface on which a portion of the print is laid down; it may be flat, tilted or curved. | Surface representation and boundaries remain to be specified. |

Proposed names do not commit us to an extra processing stage or file format.
