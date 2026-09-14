# Assigned-support implementation

Explicit assignments and their integration with the shared layer grid and composer.
The [manual](SKILL.md) owns use and limits. The distinct
[rimming design](../rimming-planar/DEVELOP.md) owns edge-based support surfaces.

## Assigned support design

[Supports](SKILL.md) owns explicit sacrificial footprints and tree
skeletons. [D-025](../../DECISIONS.md#d-025--support-areas-assigned-through-judgment)
prohibits whole-part angle-based support assignment. The maker/agent records
selected contacts and reasons in `skills.supports.assignments`; generation
constructs only those assignments. Local section queries test the assigned
geometry against the chosen part clearance; they do not select support areas.
Overlaps between assignments are unioned; walls, sparse interiors and interface
interiors have distinct owners. An optional `sectionAt` callback lets this
producer reuse full-fill without pretending sacrificial geometry is native CAD.

These bed-rooted, same-tool supports use the shared layer grid, planar machine
capability, travel, cooling, composer, export-only bundles, Studio and three
approvals. They are independent of part `composition.regions` and may coexist
with regional recipes. Required support layers precede atomic part operations
using their highest deposition Z, including nonplanar operations, rather than
assuming scheduling rank is physical height. This does not prove head clearance,
branch printability or physical contact. The current tree geometry is explicitly
authored circular branches, not Bambu's automatic routing algorithm. Supports
on the model and curved contact surfaces remain unimplemented for these two styles.
