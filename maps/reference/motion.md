# Skill composition and travel

## Implementation responsibilities

`5b_policy` builds planar/surface travel queries and the local nominal material
occupied by completed operations. `materialRegion` is a footprint with a height
field or maximum height; it is not swept-head collision detection or measured
deposited material. Segment checks use bounded sampling for variable height and
retain explicit predicate slack at boundaries.

`5c_process` owns stroke volume integration, line spacing, startup priming,
nozzle-temperature capability checks and pose/frame conversion. These operations
belong to core; skill-specific choices remain in skill authoring references.
Planar tool pose, rotating-bed coordinates and machine installation frames must
remain distinct. Follow the contracts below when changing their representation.
The [test registry](testing.md#test-registry) locates composition, travel, material,
pose, process-action and prime coverage.

Operation contracts, scheduling, shared motion state and travel over deposited
material. [Material regions](regions.md#material-regions-and-shared-interfaces)
define ownership and interfaces; [print lifecycle](lifecycle.md) owns plan
locking, generation and review.

The separate [collision-planning proposal](collision-proposal.md) records
an unimplemented design for evaluation.

## Skill-result composition

Skills return an in-memory result `{id, operations, report}`. An operation has
a unique `id`, a `layerId` identifying its deposition layer/surface, a numeric
`rank` for ordering within a height batch, and `after` dependencies. Rank is a scheduling
coordinate, not universally Z: planar fill uses layer height. Operations also
provide strokes (3D points, speed, role, and either uniform bead area or per-segment
volume/metadata) and travel-policy queries. Local `material` queries constrain
combing against completed operations; policies without them retain their
conservative `clearanceFor` comparison. An operation is atomic; expose smaller
operations when within-layer interleaving is permitted.
These runtime results are not separate machine files or a persisted preview
format. Travel policies may contain geometry-query callbacks.

[Wave overhangs](../../skills/wave-overhangs/SKILL.md) publish one atomic operation
and one continuous stroke per accepted spline slice. A slice is the cooling unit;
there is no interleaving, retraction or travel between its fronts. Whole-component
seed and successor dependencies bind through the same composer, with slices in
array order. The producer rejects geometry requiring disconnected passes.
Material ownership is explicit; it does not publish `lowerSurfaceFrom` coverage.

`core/path/compose.mjs` is skill-independent. It topologically orders operations,
rejects duplicate IDs, missing dependencies and cycles, and uses stable result
order to break ties. Plan `composition` contains `batchLayers` (1–20), `order`
(an optional ordered subsequence of operation IDs), and `dependencies` (additional
`{before, after}` edges), plus optional material `regions` described below. Ready
operations are grouped by maximum actual deposition Z to keep skill heights
similar. Batch size 1 alternates compatible results at each height; size 2 gives
AA–BB for two results with matching layers. Rank breaks ties within a result's
height batch. This preference never splits atomic continuous operations. Explicit ordering
and dependencies can interleave operations within a layer. They cannot remove a
skill's prerequisites. The agent proposes these choices before toolpath generation;
generation executes the locked rules without a new planning or approval stage.

One PathBuilder owns the resulting travel/retraction state, and the composer
finishes cooling once after all operations assigned to a shared layer. Hops
clear all material deposited so far, including travel from a taller batched
column toward a lower one. This is not a full
collision or swept-head model. Results must describe compatible regions and
material ownership; the composer does not infer arbitrary geometric overlap, support,
bridge printability or a safe order from arbitrary strokes alone.

Full-fill produces separate wall and interior-fill operations for each layer.
Scanline-based interiors and draped skins label uninterrupted zigzags with
`scanlineCell` and request `order: 'nearest-cells'`. The shared composer chooses
the closest endpoint of either end row of each remaining cell by XYZ distance
from the actual nozzle position. It completes that cell before selecting another.
Row order and stroke direction can reverse independently, providing up to four
entry choices. Reversing strokes also reverses per-segment volumes/metadata.
Equal distances retain producer order. This mode requires open strokes without
tool poses and does not reorder operations or split continuous operations.
Concentric/gyroid paths keep their existing ordering.
No lookahead, travel-time scoring or heat balancing is included; see
[D-026](../../DECISIONS.md#d-026--closest-region-entry-first-defer-heat-considerations).
An assembly's `geometry.parts` holds named components with `geometry` and
`xMm/yMm/zMm` translations; native geometry preserves each component's representation.
`skills.full-fill.parts` selects the components to fill (empty means all),
producing one skill instance per component. `skills.draped-skin.part` selects
the roof component for an assembly. Assemblies accept supported spline builders
and validated meshes; they are not automatic boolean solids. Assign regions
and geometry deliberately; component selection is part of the reviewed recipe.

Full-fill and draped-skin do **not** weave through each other. All supporting fill
operations precede the first skin, and skin layers remain ordered. Two supporting
columns may alternate or batch before a spanning roof. The current skin bead
model is approximate and does not prove that an unsupported span will print.
Future skills use the same operation/dependency boundary; do not add a new
composer for each skill pair.

[Vase-wall](../../skills/vase-wall/SKILL.md) is one atomic continuous operation with
actual changing-Z section queries; a standard mesh wall may instead follow a
fitted NURBS sleeve within its sampled `sleeveToleranceMm`, returning to exact
sections when the fit or wall thickness does not qualify. It accepts one outer section, including
concavity, while its inset remains one loop without holes or islands. Arc-length
traversal uses a fixed projected seam rather than a common interior point; mesh and restricted spline
backends remain behind the shared queries. Its locked `endTransition` can leave
a spiral rim or complete a level rim with a final turn whose material thickness
tapers to zero. A planar successor needs that level boundary. The continuous
stroke cannot weave turn by turn with infill occupying the same height band;
different regions of the same part can use the other skills. The manual owns
standoff, sampling and sleeve-tolerance limits; there is no point budget, so a
wall takes the points its geometry requires. Turn-to-turn bead overlap is a
geometry/process judgment for the agent and maker, not a generation gate.

The same package also implements [advanced vase mode](../../skills/advanced-vase-wall/SKILL.md#sleeve-patterns).
The ordinary recipe keeps one cell curve plus cells per turn, course rise,
course count and tilt. Its regular reference-strip tiler joins identical cell
endpoints, adds rise, and feeds the existing mapper one connected stroke per
course. The skill manual owns cell coordinates, placement and tilt semantics.
Advanced ordered [perimeter turns, height] paths also repeat around a required solid or closed
sleeve through the same actual-Z contour query. Optional signed contour offsets
give a motif depth relative to the wall; inward tilted loops can retain the
host's exterior. The host is only a mapping reference: no guide wall, foundation
ring or lead-in is deposited in patterned mode. Pattern tilt and overlap remain recipe judgments. Continuous mode joins mapped
endpoints, including the periodic seam and repetition boundaries; explicit
segmented mode permits shared travel. Motifs contain deposition only and are
never independent XYZ shapes. [deposition.mjs](../../core/path/deposition.mjs) constructs volumes
for plain spirals and motifs; [contour-path.mjs](../../core/geom/contour-path.mjs) owns
arc-length traversal. Motifs publish no assumed area, rim or finished side surface.

## Finished surfaces

### Stationary deposition and operation temperature

An operation can supply a one-point stroke with
`stationaryExtrusion: {volumeMm3, flowMm3S, holdSeconds}`. Composition approaches
through the same travel/retraction state, meters volume with a shared `extrude`
action, holds, and accounts for it in layer cooling. It never encodes injection
as a tiny XYZ move or as retraction recovery.

Optional `nozzleC` and required paired `restoreNozzleC` scope a nozzle temperature
to an operation. The composer parks before changing temperature and before
restoring it. [Process controls](../../core/path/process-controls.mjs) own recipe temperature
discovery and validation; machine adapters own command semantics. Current
filament-axis G-code outputs support these actions; relay outputs reject them.
[Plastic weld](../../skills/plastic-weld/SKILL.md) is their first producer.

Its cavity reservations remain open until all enclosing layers are complete.
Injection prerequisites and cover-layer dependencies use the ordinary scheduler;
explicit orders cannot bypass them. An atomic path that conflicts with that
sequence needs a different region assignment or injection height.

[finished-surface.mjs](../../core/path/finished-surface.mjs) connects surface consumers to
material producers without a skill-name allowlist in the consumer. A result's
`finishedSurfaces` entries carry its native shell identity, material height
extent, coverage description, a boundary-membership query and source operation
IDs. `publishFinishedBoundary` provides shell, side and top boundary adapters,
or accepts a producer's own membership query. These are nominal design
boundaries, not reconstructed bead textures or measured physical surfaces.

The shared whole-component and regional adapters publish ordinary fill/infill,
automatic vase walls and draped roofs. Vase side queries exclude the hollow
center and cap; an unfinished spiral rim reduces the fully supplied side height.
Mapped motifs retain their no-implicit-surface contract. Top queries
respect the producing roof's slope limit. Sparse material retains its coverage
classification and does not become a verified continuous support surface.

`consumeFinishedSurface` binds a selected native spline or mesh chart to the
matching component's published boundaries. Chart samples must lie within a
published extent and boundary, and the consumer inherits source operation
dependencies. Current cladding needs a rectangular periodic chart and adds
outward normal shells; it accepts a finished boundary regardless of which
producer supplies it. This interface does not add chart unwrapping, arbitrary
multi-patch routing, physical contact verification or a second scheduler.

## Line spacing

[spacing.mjs](../../core/path/spacing.mjs) derives nominal centerline pitch from bead width and
one optional per-skill `spacingFactor`: a finite number at least `0.5`, defaulting
to `1`. Values below 1 intentionally overlap adjacent beads; values above 1
leave space between them. Producers use that pitch for course placement and the actual bead width
for cross section and segment volume. Agents never need to match independent
pitch and extrusion settings. Plan validation checks regional overrides through
the same contract.

Full-fill, planar-infill, draped-skin, supports, both rimming modes and
pipe-cladding implement it. Existing infill and support density divides the
derived pitch as before. Full-fill walls retain the exterior contacting bead
and space successive walls inward; rimming retains its contacting bead and
separates the paired bead. Planar infill's complementary solid masks use the
full-fill factor. Cladding uses its own factor for axial cells and helix pitch,
while its substrate retains the settings of its producing patterns. Normal shell/layer separation is
unchanged. Vase-wall's vertical spiral progression is outside this interface.

Circular track counts and native surface metrics still fit local bead widths;
course-cell width is divided by the factor before computing extrusion. Edge
tapers use bead width, not widened pitch. Surface spacing remains sampled, with
the cladding producer's existing metric and fixed-relay flow limitations.
The setting does not add a material profile or establish physical printability.

Planar interiors with factors above 1 publish sparse coverage; spaced walls
publish their individual bands. A spaced draped skin publishes only its final bead strips,
so a successor cannot consume its gaps as a continuous material surface.
Ordinary factor-1 recipes retain their existing deposition behavior.

## Whole-plan travel requirement

Travel minimization is a design responsibility for every skill and shared
component. The explicitly authorized [short-travel advisory](output.md#short-travel-advisory)
flags complete travel endpoints within 2 mm for later skill/shared-function
improvement. It does not reject or repair a path. Think about where the nozzle
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

`PathBuilder.travelTo` is the shared travel method for full-fill, planar-infill,
draped-skin and vase-wall. The builder updates the highest
deposited Z from both endpoints of every emitted positive-volume segment,
including prime lines, sloping strokes and previous components. Travel without
deposition never raises this material height. The initial material height is
bed Z=0; pre-existing objects or fixtures are not modeled.

Lifted traverses use `max(depositedMaxZ + process.liftMm, fromZ, toZ)`.
`liftMm` is clearance in millimeters: **1 mm by default, with zero allowed**.
Future strokes and unselected geometry do not raise current travel. The endpoint
floor avoids descending before traversing from a higher startup/park position or
toward a higher destination. Cooling and final SAAMpath parking use the same
height calculation. Required clearance above the selected tool's Z bounds is
rejected. Existing recipes retain their explicit locked clearance value.
Compose all results together so one builder carries chronology across skills.
Machine firmware service routines (including H2D shutdown) retain their separate
export contracts; they are not ordinary SAAMpath travel.

Nearest wall starts, alternating infill and verified combing reduce travel.
The shared scanline fill completes disconnected components and splits each
connected component into uninterrupted runs of rows at interval splits/merges.
This also orders the sides of holes and concavities, rather than crossing each
hole on every row. Full-fill, planar-infill and draped-skin
use the same scanline implementation. Ordering changes neither row endpoints
nor deposition coverage; connections still use the shared travel checks.

Stroke starts within 1 mm use direct non-extruding repositioning without a new
retraction, lift or detour when the material/surface policy permits it, even
when the longer combing budget is lower. A short distance does not permit
crossing an opening or bypassing an earlier operation's clearance restriction.
No plastic is added to these gaps. Vase-wall's continuous stroke has no internal
stroke-start travels; its transitions still pass through the shared builder.

The shared PathBuilder merges consecutive forward collinear moves with the same
speed, volume per length and semantic metadata. A fixed line anchors each run
within the numerical plane tolerance (0.0000001 mm), so successive small turns
cannot accumulate into curve flattening. It sums deposited volume and retains
the endpoint. Corners, reversals, process/flow changes, operation/layer/role
boundaries and intervening retraction/fan/dwell actions remain explicit. All
skills use this writer; variable-gap/surface samples remain separate when their
flow or metadata changes. This compacts SAAMpath before any machine export,
not just the displayed path.

Mesh sections remove numerical triangle seams with `cleanPlanarLoop` before
offsetting. The distance bound is the existing 0.0000001 mm plane tolerance,
tested against every original point in the replacement span; it does not use
an angle cutoff or accumulate successive local simplifications. Closed contours
retain winding, corners and reversals. Full-fill/planar-infill also clean offset
deposition contours at that tolerance, while retaining the offset kernel's region
output for booleans. No curve-resolution or Clipper precision setting is relaxed.

`createSectionQuery` in `core/geom/query.mjs` prepares repeated sections of one
fixed geometry. Vase-wall uses it for its changing-Z samples. Mesh queries build
a Z-bound hierarchy and sorted vertex heights once, preserving triangle order,
vertex nudges and contour construction while skipping irrelevant triangles.
Each triangle is stored once, so tall triangles do not multiply index storage.
The query belongs to one generation; recreate it after any geometry edit or
placement change. Direct one-off cuts and spline sectioning remain available
through the same shared boundary. The index changes no sampling tolerance.

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

`materialRegion` in [material.mjs](../../core/path/material.mjs) clips candidate travel to each
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

`core/path/builder.mjs` classifies each move as joined, combed or hopped.
The shared PathBuilder tracks deposited height; local callbacks decide direct/combed
eligibility. See [travel requirements](#whole-plan-travel-requirement). Fill
strokes alternate their direction to keep neighbouring endpoints close. Longer
moves lift above material deposited so far, using the shared export and checks.


## Changing operation composition

Sources: [compose.mjs](../../core/path/compose.mjs).

**Contract.** Composition owns sequencing skill-result operations into one machine path. Skills publish declared operations and constraints; the composer handles their ordered motion, material/process state and inter-operation transitions through shared builders. Cross-skill consistency is established here, not by concatenating independent final machine programs.

**Failures.** Reject unsupported or inconsistent operation metadata and unsatisfied ordering/process constraints. Empty results must not leave fabricated material or stale machine state; reordering cannot violate surface/source dependencies.

**Change together.** Coordinate the skill-result contract, generation producer order, PathBuilder, process controls, finished surfaces and exporter action handling. Preserve operation/phase/layer identity through interpreted output.

**Verification.** Exercise mixed skills/materials, empty operations, dependency order, transitions and exact interpreted endpoints/volume. Checks: [composition.test.mjs](../../core/tests/composition.test.mjs), [interoperability.test.mjs](../../core/tests/interoperability.test.mjs), [regional-workflow.test.mjs](../../core/tests/regional-workflow.test.mjs).


## Changing path state and travel

Sources: [builder.mjs](../../core/path/builder.mjs), [comb.mjs](../../core/path/comb.mjs), [material.mjs](../../core/path/material.mjs).

**Contract.** PathBuilder owns sequential position, extrusion/retraction and action state for emitted motion. Combing computes permitted travel against known material regions; material tracking supplies the deposited-region model used by later travel. Geometry queries and previous deposition guide routing, without claiming a full machine collision simulation.

**Failures.** Invalid motion/state and impossible constrained travel must fail or use only the documented fallback. A missing material region is not proof of clear travel. Do not silently omit retract/recover, stationary actions or short material-bearing segments.

**Change together.** Review composition, stroke footprints, machine clearances/capabilities and source interpreters together. Preserve command order and operation metadata when coalescing moves.

**Verification.** Use hole crossings, disconnected islands, already deposited material, short/straight segments and retract/recover transitions; inspect actual resulting route and volume. Checks: [travel.test.mjs](../../core/tests/travel.test.mjs), [material-travel.test.mjs](../../core/tests/material-travel.test.mjs), [straight-moves.test.mjs](../../core/tests/straight-moves.test.mjs).


## Changing deposition spacing and process controls

Sources: [deposition.mjs](../../core/path/deposition.mjs), [spacing.mjs](../../core/path/spacing.mjs), [prime.mjs](../../core/path/prime.mjs), [process-controls.mjs](../../core/path/process-controls.mjs).

**Contract.** Deposition converts each segment length, width and nonnegative height into commanded volume; optional per-segment heights match the segment count. Spacing applies the shared line-placement policy. Process controls carry operation temperature and stationary deposition as explicit ordered actions. Priming is a whole-plan machine policy: it considers produced footprints, selects a supported bed-edge route and retains retracted/startup state before ordinary operations.

**Failures.** Reject malformed segment-height arrays, invalid spacing/process settings and a requested prime route that cannot fit. No extrusion means no prime requirement. Stationary deposition must not disappear as a zero-length travel; commanded volume is not measured flow.

**Change together.** Coordinate machine startup/capabilities, composition, builder state, exporter temperature/retraction support and Studio event interpretation. Changing footprint/width policy affects prime clearance and material travel.

**Verification.** Check spacing bounds, variable heights, no-extrusion and crowded-bed plans, temperature transitions and stationary deposition through emitted/interpreted output. Checks: [spacing.test.mjs](../../core/tests/spacing.test.mjs), [prime.test.mjs](../../core/tests/prime.test.mjs), [modal-export.test.mjs](../../core/tests/modal-export.test.mjs), [pipeline.test.mjs](../../core/tests/pipeline.test.mjs).


## Changing motion pose conventions

Sources: [pose.mjs](../../core/path/pose.mjs).

**Contract.** Pose helpers carry explicit tool directions and rotary/controller frame data alongside model-space positions. Orientation is part of supported motion semantics, not a display decoration; only exporters declaring the capability may consume it.

**Failures.** Reject invalid/degenerate pose data and unsupported output capabilities. Do not flatten oriented moves into XYZ-only commands or interpolate through mismatched frames.

**Change together.** Keep machine rigid transforms, DENSO emission/interpretation, source-time interpolation and presentation sampling aligned on axis/order/unit conventions.

**Verification.** Test rotated/translated frames, pose continuity, oriented round trips and rejection by unsupported dialects. Checks: [denso.test.mjs](../../core/tests/denso.test.mjs), [robot-playback.test.mjs](../../core/tests/robot-playback.test.mjs), [machine-presentation.test.mjs](../../core/tests/machine-presentation.test.mjs).


## Changing finished surface publication

Sources: [finished-surface.mjs](../../core/path/finished-surface.mjs).

**Contract.** Finished surfaces describe what producing operations actually make available to later consumers. Publication requires strokes and compatible shell identity; nominal/sparse coverage, side exterior and produced height constrain queries. Consumers receive a chart plus source identities and coverage checks, not an unconditional copy of the design surface.

**Failures.** Missing source, uncovered points, unavailable height or incompatible geometry must fail rather than invent support. Cached sections and nominal layer heights are software models, not measured deposited geometry.

**Change together.** Coordinate regional masks/dependencies, producer operation metadata, reservations, reference charts and cladding consumers. Any change to producer coverage must invalidate or revise its published surface.

**Verification.** Exercise partial/sparse regions, holes, translated geometry, empty producers and consumers requesting above or outside deposited coverage. Checks: [finished-cladding.test.mjs](../../core/tests/finished-cladding.test.mjs), [reservation-surface.test.mjs](../../core/tests/reservation-surface.test.mjs).
