# Skill composition and travel

Operation contracts, scheduling, shared motion state and travel over deposited
material. [Material regions](../region/README.md#material-ownership-and-surface-contact)
define ownership and interfaces; [print lifecycle](../print/README.md) owns plan
locking, generation and review.

## Skill-result composition

Material regions resolves claims upstream; Application prepares work dependencies.
Extensions read prepared geometry/material intent and name work prerequisites.
Toolpath constructs Slice, Trace and Inject, applies Modulation, and freezes
stroke order, poses and connections; core lowers work prerequisites to emitted IDs.
Bundle saves this completed SAAMpath operation graph; Scheduling reads it to
choose execution order and add travel, retraction, cooling and finishing.
Exporters add machine startup and service motions.

`planOperationEntry` applies context, selection and the operation's resolved `process`;
`planPreparedOperation` emits strokes/ending/cooling and restores material defaults.
Retraction debt retains its amount and speed across process changes. Travel
follows the nozzle-clear route. Zero `retractMm`
prevents new withdrawal. `planningPath` assembles deltas; `contextualActions` streams
labels including `layerId` (reset first, null clears), moves, speeds and gap samples.

Slice can emit derived poses: `toolPose:{}` stays upright along print Z;
`{alignToSliceNormal:true}` follows its normal. The `tilt` field channel modulates
either baseline. Omitted pose output keeps ordinary three-axis motion. A pose is
`{toolAxis, toolUp}` in the part frame, an internal result, not a recipe input
(an older path's `rotaryDeg` is ignored); machine axes come from the machine's
kinematics. Entry, reorientation, cooling, parking and finishing use the deposited
scene and tool axis. The path's `planning` may supply `start` and
`motion:{initialPose,retreatMm}`; default entry retreats from its first stroke.
Axis speed limits belong downstream; turns in place use the machine's rate.

Toolpath's private results contain operations and reports. Each saved operation
has a unique `id`, `layerId`, numeric `rank`, exact `after` prerequisites,
resolved process/material selection, and finalized strokes. Rank is a scheduling
coordinate, not universally Z. Strokes hold XYZ points, speed, role, poses and
uniform bead area or per-segment volume/metadata. Closed loops have an explicit
closing edge. Independent strokes can interleave; declared continuous courses
remain atomic. Toolpath emits no travel callbacks. Scheduling prepares its own
indexes and travel queries from finalized beads and poses. Construction-local
`connectNearby` requests are resolved into depositing strokes before publication.

[Wave overhangs](../../skills/wave-overhangs/SKILL.md) publish one atomic operation
and one continuous stroke per accepted spline slice. A slice is the cooling unit;
there is no interleaving, retraction or travel between its fronts. Whole-component
seed and successor dependencies bind through the same composer, with slices in
array order. The producer rejects geometry requiring disconnected passes.
Material ownership is explicit; fronts do not publish a finished surface chart.

`core/path/compose.mjs` schedules the saved deposition through one geometric
ordering operation. Independent strokes can interleave; continuous courses stay
atomic. Connector chains retain order but split at stroke boundaries when grouping
causes a conflict. Original IDs own motion context and process prerequisites;
course IDs identify execution. Construction references remain separate.

[physical-order.mjs](./physical-order.mjs) derives local substrate contacts and swept-nozzle
prerequisites. [precedence.mjs](./precedence.mjs) omits checks already implied by
substrate or explicit process order; reported edges are sufficient constraints,
not every contact. Its bounded dense cache falls back to exact per-source search.
Geometry's [convex-clearance.mjs](../geom/convex-clearance.mjs) owns convex queries,
slice-partitioned spatial indexing and continuous sweeps. Proven order filters whole slices;
one confirmed witness proves each relationship. Rotating hull candidates refine
until exact cones intersect or smaller hulls separate, without extra forgiveness.
Bead normals and tool poses supply directions, with no world-Z ordering. Ready
work favors nearby entries and small pose changes. Explicit `composition.order`,
`composition.dependencies` and operation `after` remain prerequisites. Conflicts
name affected courses and relationships; indivisible self-obstruction needs a path
change or interruptible boundary. Known cycles are reported before nozzle scans.

The temporary nozzle is an effectively infinite sharp cone: 15-degree included
angle (7.5-degree half-angle), with numerical length beyond the scene. A 0.1 mm
surface forgiveness permits small contact; deposited lines may overlap.
Carriage, fixtures, joints, gravity, fusion and unsupported-span printability are
outside this model; no supports are added. Moving beads supply occupancy; stationary injection needs authored occupied
geometry to supply substrate or obstacle volume.

Execution retains material selection, retraction and per-layer cooling debt across
interleaving. Actual beads, including connectors and modulation, supply occupancy;
sparse strands remain separate, with no saved travel-height snapshots.

An assembly's `geometry.parts` holds named components with `geometry` and
`xMm/yMm/zMm` translations; native geometry preserves each component's representation.
A slice assignment's `part` selects its component (`null` means all), producing
one owner per component. A roof surface-domain assignment selects its assembly component through the same part field. Assemblies accept supported spline builders
and validated meshes; they are not automatic boolean solids. Assign regions
and geometry deliberately; component selection is part of the reviewed recipe.

[Standard vase](../../skills/vase-wall/SKILL.md) generates a sleeve curve for Trace; [advanced vase](../../skills/advanced-vase-wall/SKILL.md) supplies sleeve-
mapped Trace batches. Both use shared bead construction and composition. Their
manuals own fitting, sampling, explicit path and placement controls. A continuous operation
cannot interleave with infill in the same height band; a planar successor needs
a level terminal boundary. The sleeve is reference geometry, never an implicit
wall, foundation or filled support sheet. Dependent contact uses finalized beads
and explicit prerequisites, preserving the gaps in patterned material.

## Finished surfaces

### Stationary deposition and operation temperature

An operation can supply a one-point stroke with
`stationaryExtrusion: {volumeMm3, flowMm3S, holdSeconds}`. Composition approaches
through the same travel/retraction state, meters volume with a shared `extrude`
action, holds, and accounts for it in layer cooling. It never encodes injection
as a tiny XYZ move or as retraction recovery.

Optional `nozzleC` and required paired `restoreNozzleC` scope a nozzle temperature
to an operation. The composer parks before changing temperature and before
restoring it. [Process controls](./process-controls.mjs) own export temperature
validation; machine adapters own command semantics. Current
filament-axis G-code outputs support these actions; relay outputs reject them.
[Plastic weld](../../skills/plastic-weld/SKILL.md) is their first producer.

Its cavity reservations remain open until all enclosing layers are complete.
Injection prerequisites and cover-layer dependencies use the ordinary scheduler;
explicit orders cannot bypass them. An atomic path that conflicts with that
sequence needs a different region assignment or injection height.

[finished-surface.mjs](./finished-surface.mjs) connects surface consumers to
material producers without a skill-name allowlist in the consumer. A result's
`finishedSurfaces` entries carry its native shell identity, material height
extent, coverage description, a boundary-membership query and source operation
IDs. `publishFinishedBoundary` returns a new result with shell, side and top
boundary adapters, or accepts a producer's own membership query. Callers use
that returned result; the incoming result and its operations are preserved. These are nominal design
boundaries, not reconstructed bead textures or measured physical surfaces.

The shared whole-component and regional adapters publish ordinary fill/infill,
automatic vase walls and draped roofs. Vase side queries exclude the hollow
center and cap; an unfinished spiral rim reduces the fully supplied side height.
Mapped patterns retain their no-implicit-surface contract. Top queries
respect the producing roof's slope limit. Sparse material retains its coverage
classification and does not become a verified continuous support surface.

`consumeFinishedSurface` binds a selected native spline or mesh chart to the
matching component's published boundaries. Chart samples must lie within a
published extent and boundary, and the consumer inherits source operation
dependencies. Slice stacks use normal-depth bands; physical cell fill supports
open rows or periodic helices and it accepts a finished boundary regardless of which
producer supplies it. This interface does not add chart unwrapping, arbitrary
multi-patch routing, physical contact verification or a second scheduler.

## Line spacing

[spacing.mjs](./spacing.mjs) derives nominal centerline pitch from bead width and
one optional per-skill `spacingFactor`: a finite positive number, defaulting
to `1`. Values below 1 intentionally overlap adjacent beads; values above 1
leave space between them. Producers use that pitch for course placement and the actual bead width
for cross section and segment volume. Agents never need to match independent
pitch and extrusion settings. Plan validation checks regional overrides through
the same contract.

Ordinary and surface-stack Slice assignments implement it. Fill density divides the
derived pitch. Slice loops retain the exterior contacting bead
and space successive loops inward. Cladding uses its own factor for axial cells and helix pitch,
while its substrate retains the settings of its producing patterns. Normal shell/layer separation is
unchanged. Vase-wall's vertical spiral progression is outside this interface.

Circular track counts and native surface metrics still fit local bead widths;
cell width is divided by the factor before computing extrusion. Edge
tapers use bead width, not widened pitch. Surface spacing remains sampled, with
the periodic-cell field's sampled metric. Exporters own fixed-relay flow representation.
The setting does not add a material profile or establish physical printability.

Planar interiors with factors above 1 publish sparse coverage; spaced walls
publish their individual bands. A spaced draped skin publishes only its final bead strips,
so a successor cannot consume its gaps as a continuous material surface.
Ordinary factor-1 recipes retain their existing deposition behavior.

## Whole-plan travel requirement

The same nozzle sweep governs printing precedence and transfers through material
already deposited. Direct motion is used when clear. A blocked fixed-pose transfer
retreats along the nozzle axis, crosses an exterior plane and approaches along
that axis. Changing poses route around an enclosing sphere, with every segment
checked over its continuously interpolated orientation. Exterior clearance grows
when needed; no fixed search budget truncates a route. The current effectively
infinite cone cannot pass beneath existing material.

[planning.mjs](./planning.mjs) emits that solved route through ordinary travel,
retraction and recovery actions. Upright moves retain ordinary three-axis output;
posed moves retain orientation for multi-axis exporters. The scheduler owns the
occupied-bead ledger and adds material after each course. Park, cooling and
finishing withdraw along the current tool axis. The obsolete planar/height-field
travel policies, footprint obstacle ledger and world-Z hop route are removed.
