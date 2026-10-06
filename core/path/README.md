# Skill composition and travel

Operation contracts, scheduling, shared motion state and travel over deposited
material. [Material regions](../region/README.md#material-ownership-and-surface-contact)
define ownership and interfaces; [print lifecycle](../print/README.md) owns plan
locking, generation and review.

The separate [collision-planning proposal](./collision-proposal.md) records
an unimplemented design for evaluation.

## Skill-result composition

Generation owns one machine-independent execution state through finalized
deposition and finishing. Exporters add machine startup and service motions. The ready-work graph caches geometry after its material sources
are finalized; exact operation dependencies remain separate from geometry edges.
Eligible unmodified Slice strokes use their actual scheduled entry for ordering
and connectors before publication. Trace, Inject and modified paths stay constrained.
No later composer changes published material or independently reschedules it.

`planOperationEntry` applies context, selection and the operation's resolved `process`;
`planPreparedOperation` emits strokes/ending/cooling and restores material defaults.
Retraction debt retains its amount and speed across process changes. Zero `liftMm`
removes extra lift; travel still reaches deposited/target height. Zero `retractMm`
prevents new withdrawal. `planningPath` assembles deltas; `contextualActions` streams
labels (reset first, null clears), physical moves, effective speeds and gap samples.

Slice can emit derived poses: `toolPose:{}` stays upright along print Z;
`{alignToSliceNormal:true}` follows its normal. The `tilt` field channel modulates
either baseline. Omitted pose output keeps ordinary three-axis motion. Pose
samples, tool axes and rotary angles are internal results, not recipe inputs;
exporters represent these results using their machine's kinematics.

Skills return an in-memory result `{id, operations, report}`. An operation has
a unique `id`, a `layerId` identifying its deposition layer/surface, a numeric
`rank` for ordering within a height batch, and `after` dependencies. Rank is a scheduling
coordinate, not universally Z: planar fill uses layer height. Operations also
provide strokes (3D points, speed, role, and either uniform bead area or per-segment
volume/metadata) and travel-policy queries. Local `material` queries constrain
combing against completed operations; policies without them retain their
conservative `clearanceFor` comparison. An operation is atomic; expose smaller
operations when within-layer interleaving is permitted. `connectNearby: true`
declares that gaps of at most 2 mm between this operation's stroke starts and the
preceding deposition lie inside its own material, permitting
[deposited connectors](#whole-plan-travel-requirement).
These runtime results are not separate machine files or a persisted preview
format. Travel policies may contain geometry-query callbacks.

[Wave overhangs](../../skills/wave-overhangs/SKILL.md) publish one atomic operation
and one continuous stroke per accepted spline slice. A slice is the cooling unit;
there is no interleaving, retraction or travel between its fronts. Whole-component
seed and successor dependencies bind through the same composer, with slices in
array order. The producer rejects geometry requiring disconnected passes.
Material ownership is explicit; fronts do not publish a finished surface chart.

`core/path/compose.mjs` is skill-independent. It topologically orders operations,
rejects duplicate IDs, missing dependencies and cycles, and uses stable result
order to break ties. Plan `composition` contains `order`
(an optional ordered subsequence of operation IDs), and `dependencies` (additional
`{before, after}` edges). Material claims live in common slice assignments. Ready
operations use ascending maximum actual deposition Z. Rank breaks ties within a result's
height group. This preference never splits atomic continuous operations. Explicit ordering
and dependencies can interleave operations within a layer. They cannot remove a
skill's prerequisites. Old batchLayers recipes require explicit migration and regeneration;
generation executes the locked rules without a new planning stage.

`scheduleOperations` exposes validation, priority preparation, dependency
preparation and topological ordering as separate stages. Their returned records
carry the operation batch, priority lookup and prerequisite sets. The ordering
stage builds its own mutable heap and dependency counters; it does not consume
or change those inputs.

Execution retains travel/retraction state. On leaving a layer it parks and pays
remaining minimum-layer cooling debt. Consecutive same-layer work accrues together;
elapsed work and paid debt survive revisits. This intentionally cools
noncontiguous dependency-driven layers earlier than the former last-occurrence rule.
Hops clear previously deposited material; this is not a swept-head collision model. Results must describe compatible regions and
material ownership; the composer does not infer arbitrary geometric overlap, support,
bridge printability or a safe order from arbitrary strokes alone.

Each slice owner produces separate wall, sparse-fill and solid-fill operations
for each layer.
Scanline-based interiors and draped skins label uninterrupted zigzags with
`scanlineCell` and request `order: 'nearest-cells'`. The shared composer chooses
the closest endpoint of either end row of each remaining cell by XYZ distance
from the actual nozzle position. It completes that cell before selecting another.
Row order and direction can reverse independently; equal distances retain producer
order. `strokeRange` keeps vertex channels and edge material aligned through
cropping, reversal and closed-loop rotation. Closed inputs retain their closing
edge, including explicitly repeated endpoints. Ordering does not split continuous
strokes or reorder operations; generation selects eligible operations separately.
No lookahead, travel-time scoring or heat balancing is included; see
[D-026](../../DECISIONS.md#d-026--closest-region-entry-first-defer-heat-considerations).
An assembly's `geometry.parts` holds named components with `geometry` and
`xMm/yMm/zMm` translations; native geometry preserves each component's representation.
A slice assignment's `part` selects its component (`null` means all), producing
one owner per component. A roof surface-domain assignment selects its assembly component through the same part field. Assemblies accept supported spline builders
and validated meshes; they are not automatic boolean solids. Assign regions
and geometry deliberately; component selection is part of the reviewed recipe.

Dependent surface courses wait for their declared finalized material sources.
All skills use the same operation/dependency boundary; no skill pair has a
separate composer. A nominal bead model does not prove physical support.

[Standard vase](../../skills/vase-wall/SKILL.md) generates a sleeve curve for Trace; [advanced vase](../../skills/advanced-vase-wall/SKILL.md) supplies sleeve-
mapped Trace courses. Both use shared bead construction and composition. Their
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
dependencies. Slice reference families use normal-depth bands; physical cell fill supports
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

Ordinary and surface-family Slice assignments implement it. Fill density divides the
derived pitch. Slice loops retain the exterior contacting bead
and space successive loops inward. Cladding uses its own factor for axial cells and helix pitch,
while its substrate retains the settings of its producing patterns. Normal shell/layer separation is
unchanged. Vase-wall's vertical spiral progression is outside this interface.

Circular track counts and native surface metrics still fit local bead widths;
course-cell width is divided by the factor before computing extrusion. Edge
tapers use bead width, not widened pitch. Surface spacing remains sampled, with
the periodic-cell field's sampled metric. Exporters own fixed-relay flow representation.
The setting does not add a material profile or establish physical printability.

Planar interiors with factors above 1 publish sparse coverage; spaced walls
publish their individual bands. A spaced draped skin publishes only its final bead strips,
so a successor cannot consume its gaps as a continuous material surface.
Ordinary factor-1 recipes retain their existing deposition behavior.

## Whole-plan travel requirement

Travel minimization is a design responsibility for every skill and shared
component. The explicitly authorized [short-travel advisory](../export/README.md#short-travel-advisory)
flags complete same-layer travels whose endpoints are within 2 mm. It does not
reject or repair a path; producers are expected to leave it nothing to report. Think about where the nozzle
finishes each stroke and where the next useful deposition can start. Choose
nearby open endpoints and nearby entry points on closed contours; consider the
next wall, neighboring component and following layer when deciding seams and
operation order. A simple continuous wall should not acquire long repositioning
moves just because contour arrays begin at unrelated vertices. Aim for short
direct transitions, continuous deposition where the intended material allows
it, and fewer avoidable retractions and lifts. Preserve the deposited shape,
segment volumes and required dependencies when changing entry or direction.

Inspect representative toolpaths and compare empty travel, retractions and
motion time during development. These observations guide construction and
routing choices; do not turn them into travel quotas, new pass/fail validators,
automatic print rejection or another maker approval. Shared travel handling
still routes the transitions that remain. Nearest-entry guidance does not
claim a globally optimal route or implement lookahead by itself.

`planning.mjs::planTravel` is the shared travel stage for slices,
draped-skin and vase-wall. `planMove` returns updated planning state with the highest
deposited Z from both endpoints of every emitted positive-volume segment,
including prime lines, sloping strokes and previous components. Travel without
deposition never raises this material height. The initial material height is
bed Z=0; pre-existing objects or fixtures are not modeled.

Lifted traverses use `max(depositedMaxZ + process.liftMm, fromZ, toZ)`.
`liftMm` is clearance in millimeters: **1 mm by default, with zero allowed**.
Future strokes and unselected geometry do not raise current travel. The endpoint
floor avoids descending before traversing from a higher startup/park position or
toward a higher destination. Cooling and final SAAMpath parking use the same
height calculation. Exporters check selected tool bounds. Existing recipes
retain their explicit locked clearance value.
Compose all results together so planning state carries chronology across skills.
Machine firmware service routines (including H2D shutdown) retain their separate
export contracts; they are not ordinary SAAMpath travel.

Nearest wall starts, alternating infill and verified combing reduce travel.
The shared scanline fill completes disconnected components and splits each
connected component into uninterrupted runs of rows at interval splits/merges.
This also orders the sides of holes and concavities, rather than crossing each
hole on every row. Slices and draped-skin
use the same scanline implementation. Ordering changes neither row endpoints
nor deposition coverage; connections still use the shared travel checks.

A stroke of a `connectNearby` operation that starts within 2 mm of the end of
the preceding deposition can become an explicit finalized connector carrying
the next stroke's bead (its uniform area, or its
first segment's volume per length and metadata). This joins fill rows into a
zigzag, steps between wall loops and concentric rings, and enters fill from the
last wall without a travel. The connector must pass the same direct-move checks
as a travel: inside the operation's region, on its surface, clear of completed
operations, not retracted and directly after deposition. Planar regions check it
with `connectClearanceMm`, the half-line-width standoff less 0.05 mm, because
wall centerlines lie on that standoff less the offset kernel's arc chords.
Oriented strokes have no footprint query; they connect only across the
producer's declared `poseJoinMm` index within one operation. General Slice
fields opt in only where they can prove deposited connectivity. Explicit Trace
gaps remain authored, and stationary Inject has no stroke connectors. A short distance never permits
crossing an opening or bypassing an earlier operation's clearance restriction.

Where no connector applies, stroke starts within 1 mm use direct non-extruding
repositioning without a new retraction, lift or detour when the policy permits
it, even when the longer combing budget is lower. A planar stroke starting
within 2 mm on the next layer up is one rising `layer-step` move without
retraction when the nozzle is already at the top of everything deposited and
the step lies inside the new layer's region. Vase-wall's continuous stroke has
no internal stroke-start travels; a level rim ends where its vanishing taper
holds less than 0.001 mm3, which a machine program could only write as travel.
`trimVanishingEnd` returns the shortened stroke with aligned point, volume and
segment-metadata arrays; callers use it for both deposition and rim reporting.

`planMove` coalesces forward moves with equal speed, flow density, pose and
semantic metadata. A fixed original axis prevents accumulated curve flattening:
ordinary collinear runs use 0.0000001 mm tolerance; merging a movement below
0.0001 mm bounds original-point deviation from the final chord by 0.0001 mm.
Volume, elapsed time and final endpoints survive. Reversals, changed poses,
process/flow and operation/layer/role boundaries, and intervening controls stay
explicit. All producers use this shared SAAMpath writer after field evaluation
and before export; tiny meaningful movements are retained when merging would
lose those semantics.

Mesh sections remove numerical triangle seams with `cleanPlanarLoop` before
offsetting. The distance bound is the existing 0.0000001 mm plane tolerance,
tested against every original point in the replacement span; it does not use
an angle cutoff or accumulate successive local simplifications. Closed contours
retain winding, corners and reversals. Slice loops also clean offset
deposition contours at that tolerance, while retaining the offset kernel's region
output for booleans. No curve-resolution or Clipper precision setting is relaxed.

`prepareSection` in `core/geom/slice.mjs` prepares repeated sections of one
fixed geometry by slices of one orientation: each mesh gets sorted vertex
heights and a height-interval tree in the slice's frame, storing each triangle
once and keeping triangle order, vertex nudges and contour construction. It
belongs to one generation; prepare again after any geometry edit or placement
change. The index changes no sampling tolerance.

The shared S5/H2D motion emitter establishes XYZ/feed state on first use, then
omits unchanged fields. Retractions update the same modal feed state. E remains
explicit with the selected absolute/relative convention. The interpreter checks
the final commands; regression tests compare their coordinates and volume with
the generator's transient motion objects.

Planar and height-field surface combing check boundary crossings,
then can route around holes via a visibility graph over the offset corners of the
endpoints' connected component. The route budget is the only bound: a corner
joins the graph when going through it stays within the `maxCombMm` XYZ route
length, so a layer with a detailed outline routes instead of degrading into a hop
because it has many corners. The search is shortest-first on the route so far plus
the straight-line distance still to run, which is never longer than any route from
there, so it settles on the same shortest route while expanding only the corners a
route of that length can pass. Boundary segments come from the corridor along the
travel rather than its bounding box, which costs the travel's length instead of its
area. Where no route fits the budget the move
hops. Disconnected components cannot be joined by combing. Every candidate
edge checks both the destination policy and completed material, including edges
of a detour. Lifted moves retain the global deposited-height clearance above.

`planarPolicy` publishes the layer's actual region and height, preserving holes
and disconnected footprints. `surfacePolicy` accepts an XY footprint, a local
`surfaceZ(x,y)` query, a conservative `maxZ`, `sampleStepMm`, and permitted
`sagMm`. Producers must return a nonfinite height for an absent or invalid
surface. Drape supplies its surveyed allowed footprint and each skin's own
height, sampling step and sag limit. Routing lifts intermediate samples to that
surface while preserving the exact requested endpoints. Direct moves remain
straight chords checked against the same surface limits. Surface direct
connections retain their centerline edge allowance (`directClearanceMm: 0`),
with exact footprint-crossing checks even between surface samples. Planar direct
moves and all detours retain the half-line-width boundary standoff.
Chord sag applies only to the destination surface; it does not permit travel
below another operation's deposited material.

`materialRegion` in [material.mjs](./material.mjs) clips candidate travel to each
completed operation's footprint through the shared Clipper2 open-path tool.
Planar heights are compared at clipped endpoints, so a descending move cannot
hide a low collision behind its high endpoint. Surface heights are sampled
within each clipped interval. A numerical plane-tolerance expansion includes
boundary contact; it is not nozzle-width expansion. A missing height inside
declared material blocks travel. Bounds and maximum height skip irrelevant
queries; the shared boundary index resolves segments with constant footprint
membership without clipping. Route-length lower bounds prune unreachable
corners before surface evaluation. Material remains local rather than being collapsed into a global
planar obstacle. The composer installs `isTravelClear` for both direct and
routed segments; legacy policies without material geometry remain conservative.

These are nominal operation regions, not reconstructed individual beads, full
swept-head collision checks or proof of support. Sparse regions retain a
conservative occupied envelope. Surface sampling can miss between-sample
features; arbitrary overhangs, fixtures and oriented robot routing require
their existing separate policies. The Studio advisory remains a nonblocking
way to report additional travel cases.

### Travel planning

`core/path/planning.mjs` classifies each stroke start as joined, connected, combed
or hopped, and reports the counts in `summary.travel`.
The returned planning state tracks deposited height; local callbacks decide direct/combed
eligibility. See [travel requirements](#whole-plan-travel-requirement). Fill
strokes alternate their direction to keep neighbouring endpoints close. Longer
moves lift above material deposited so far, using the shared export and checks.
