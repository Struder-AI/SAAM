# Core architecture

SAAM combines skill operations through shared geometry, region, motion and machine
interfaces. This page identifies their responsibilities and the supported exceptions.
Use the relevant component reference for contracts and implementation details.

The [agent CLI toolkit](agent/README.md) composes context reads, print preparation,
Studio opening and request coordination around these existing owners.

## Current organization

The shell workflow follows geometry queries → material regions → skill operations
→ composition and travel → machine emission and interpretation → Studio review
→ delivery. The bundle lifecycle owns revision identity around this work.

| Stage | Owning reference | Source entry points |
|---|---|---|
| Geometry representations and queries | [Geometry](geom/README.md) | [query.mjs](geom/query.mjs), [mesh.mjs](geom/mesh.mjs) |
| Offsets, intersections and material regions | [Regions](region/README.md) | [offset.mjs](region/offset.mjs), [intersection.mjs](region/intersection.mjs) |
| Skill operations, ordering and travel | [Composition](path/README.md) | [compose.mjs](path/compose.mjs), [builder.mjs](path/builder.mjs) |
| Plans, generation, persistence and approvals | [Print lifecycle](print/README.md) | [plan.mjs](print/plan.mjs), [generate.mjs](print/generate.mjs), [workflow.mjs](print/workflow.mjs) |
| Machine emission and interpretation | [Output contracts](export/README.md) | [registry.mjs](export/registry.mjs), [profiles](../machines/README.md) |
| Review UI, geometry and program display | [Studio](../studio/README.md) | [server.mjs](../studio/server.mjs), [app.mjs](../studio/app.mjs) |

[Skill manuals](../skills/README.md) own pattern-specific tools and limits. Client
adapters use the same lifecycle; see [MCP implementation](../adapters/mcp/DEVELOP.md).
The bounded wedge uses its own geometry and generator within that lifecycle,
as described below.

The [machine presentation boundary](../studio/KINEMATICS.md) lets the
kinematic-model and Studio tasks work independently. Models supply resolved
component poses and simple geometry; Studio owns their presentation alongside
the existing source-driven toolpath. This contract does not replace machine
output or prescribe a solver architecture.
The [model reference](machine/README.md) owns implemented mechanisms, source-time
evaluation and nominal installation limits.

## Interoperability and one workflow

Shared geometry queries feed material regions and skill operations. Composition
orders those operations and plans their transitions; machine adapters emit and
interpret the program used by review and delivery. A change to one of these
interfaces needs to account for its current callers, result semantics and
affected consumers. [Geometry interfaces](geom/README.md#geometry-interoperability-for-skill-authors),
[skill results](path/README.md#skill-result-composition) and [machine output](export/README.md#machine-interoperability-design)
describe those contracts.

Machine profiles and output adapters own machine behavior. Skills consume the
shared geometry and result interfaces, with explicit capabilities and limits.
Upstream numerical-library features become SAAM capabilities only through its
supported interface. Exercise affected combinations through the public
CLI/MCP/Studio workflow as well as their component tests.

Composing skills on one part requires explicit material ownership, operation
order and transitions without duplicate deposition. Report the unsupported
transition, support need or geometry constraint. A vase-to-cap transition, for
example, needs a level interface and support/bridging assessment. The user's
acceptance example is a flat base and vase wall, flat cap, normal walls/infill
under a wavy roof, draped roof, and horizontal full fill above that roof with a
wavy bottom. Region interfaces therefore include nonflat surfaces as well as
height bands; see [material regions](region/README.md#material-regions-and-shared-interfaces).

Mesh and NURBS backends share geometry queries, downstream regions, composition,
motion, export and review. The [bounded wedge](geom/README.md#rhino-geometry) retains its own
geometry and generator while using the common exporter and print lifecycle.

Developer experiments use these same components; [historical inspection](../studio/README.md#historical-toolpath-inspection)
is a scoped example. A proposed parallel pipeline needs a reason the shared
extension cannot serve the task and normally a discussion before building it;
existing authorization applies. New product commands, artifact formats and
approval routes require an explicit scope decision. Document a necessary
exception's reason, limits and boundary tests where a caller encounters it.
