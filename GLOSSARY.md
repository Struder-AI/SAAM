# SAAM glossary

Target terminology; the [technical overview](TECHNICAL-OVERVIEW.md) explains the
layers and [0.2.0 plan](plans/0.2.0.md) distinguishes intended and implemented scope.

| Term | Meaning |
|---|---|
| Bundle | Saved geometry, recipe, review records and checked machine program for a fabrication task, possibly containing several parts. A print bundle is a bundle used for printing. |
| Recipe | Authored geometry, skill assignments, process settings, machine and setup, stored as `plan.json`. Defaults do not supply a shape. |
| Confirmation | The person's single approval of current settings and the exact toolpath in Studio before delivery. Geometry review is advisory. |
| SAAMpath | SAAM's one machine-independent toolpath: moves with deposition volume, speed and context, plus process actions. The composer builds it from skill results; each machine's exporter translates it into that machine's program. It is not saved in the print bundle. |
| Machine program | Machine-specific commands/package exported from SAAMpath, checked and delivered unchanged after confirmation. |
| Toolpath skill | Constructs deposition/process operations through shared core capabilities; named techniques may be configurations of the same skill. |
| Geometry skill | A skill that makes, fetches or changes the part's geometry before any toolpath exists. Each change is a new geometry revision. |
| Hybrid skill | Constructs part or temporary process geometry together with deposition, such as insert reinforcement or plastic rivets. |
| Keyword skill | A skill whose digest description is only its keyword, such as `gridfinity`. The agent uses it only when the person names that keyword, and reads its manual only then. |
| Slice | Intersection of a cutting surface with geometry for a toolpath reference, retaining its supporting surface. To slice is to make that intersection. |
| Slice surface / family | The cutting geometry / a related sequence of slices; neither means complete program generation. |
| Surface region | A bounded portion of a surface, possibly with holes or disconnected components. |
| Material ownership | Spatial responsibility resolved before execution order; overlap policy and compatible slicing constrain scheduling. |
| Compound geometry | Component solids with an optional boolean operation. Assembly preserves components; boolean modes combine their material. |
| Sleeve | A surface closed around one direction and open along the other, or a mesh with equivalent tube-side topology. Smooth periodicity is stronger than coincident seam edges. |
| Tile | One continuous curve drawn in one cell of a sleeve's unwrapped strip, repeated to make a pattern. |
| Course | One full circuit of tiles around a sleeve. |
| Pattern | An arrangement of deposition strokes, such as an infill pattern or repeated sleeve tiles. |
| Modulation | A field changing selected stroke positions or process channels before final deposited-boundary publication. |
