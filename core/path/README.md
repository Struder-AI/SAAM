# Skill composition and travel

Operation contracts, scheduling, shared motion state and travel over deposited
material. [Material regions](../region/README.md#material-regions-and-shared-interfaces)
define ownership and interfaces; [print lifecycle](../print/README.md) owns plan
locking, generation and review.

The separate [collision-planning proposal](collision-proposal.md) records
an unimplemented design for evaluation.

## Skill-result composition

Skills return an in-memory result `{id, operations, report}`. An operation has
a unique `id`, a `layerId` identifying its deposition layer/surface, a numeric
`rank` for ordering within a height batch, and `after` dependencies. Rank is a scheduling
coordinate, not universally Z: planar fill uses layer height. Operations also
provide strokes (3D points, speed, role, and either uniform bead area or per-segment
volume/metadata) and travel-policy queries. Existing `clearanceFor` queries
constrain combing against previous operations; legacy operation `clearanceZ`
metadata does not set lifted travel or cooling height. An operation is
atomic; expose smaller operations when within-layer interleaving is permitted.
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
Concentric/gyroid paths and the bounded wedge keep their existing ordering.
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
actual changing-Z section queries. It accepts one outer section, including
concavity, while its inset remains one loop without holes or islands. Arc-length
traversal uses a fixed projected seam rather than a common interior point; mesh and restricted spline
backends remain behind the shared queries. Its locked `endTransition` can leave
a spiral rim or complete a level rim with a final turn whose material thickness
tapers to zero. A planar successor needs that level boundary. The continuous
stroke cannot weave turn by turn with infill occupying the same height band;
different regions of the same part can use the other skills. The manual owns
standoff, sampling and point-budget limits. Turn-to-turn bead overlap is a
geometry/process judgment for the agent and maker, not a generation gate.

The same package also accepts [sleeve motifs](../../skills/vase-wall/SKILL.md#sleeve-patterns).
Ordered [perimeter turns, height] paths repeat around a required solid or closed
sleeve through the same actual-Z contour query. Optional signed contour offsets
give a motif depth relative to the wall; inward tilted loops can retain the
host's exterior. The host is only a mapping reference: no guide wall, foundation
ring or lead-in is deposited in patterned mode. Pattern tilt and overlap remain recipe judgments. Continuous mode joins mapped
endpoints, including the periodic seam and repetition boundaries; explicit
segmented mode permits shared travel. Motifs contain deposition only and are
never independent XYZ shapes. [deposition.mjs](deposition.mjs) constructs volumes
for plain spirals and motifs; [contour-path.mjs](../geom/contour-path.mjs) owns
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
restoring it. [Process controls](process-controls.mjs) own recipe temperature
discovery and validation; machine adapters own command semantics. Current
filament-axis G-code outputs support these actions; relay outputs reject them.
[Plastic weld](../../skills/plastic-weld/SKILL.md) is their first producer.

Its cavity reservations remain open until all enclosing layers are complete.
Injection prerequisites and cover-layer dependencies use the ordinary scheduler;
explicit orders cannot bypass them. An atomic path that conflicts with that
sequence needs a different region assignment or injection height.

[finished-surface.mjs](finished-surface.mjs) connects surface consumers to
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

[spacing.mjs](spacing.mjs) derives nominal centerline pitch from bead width and
one optional per-skill `spacingFactor`: a finite number at least `1`, defaulting
to `1`. Producers use that pitch for course placement and the actual bead width
for cross section and segment volume. Agents never need to match independent
pitch and extrusion settings. Plan validation normalizes older recipes and
validates regional overrides through the same contract.

Full-fill, planar-infill, draped-skin, supports, both rimming modes and
pipe-cladding implement it. Existing infill and support density divides the
derived pitch as before. Full-fill walls retain the exterior contacting bead
and space successive walls inward; rimming retains its contacting bead and
separates the paired bead. Planar infill's complementary solid masks use the
full-fill factor. Cladding uses its own factor for axial cells and helix pitch,
while its substrate retains the settings of its producing patterns. Normal shell/layer separation is
unchanged. Vase-wall's vertical spiral progression and the bounded wedge's
separate recipe are outside this interface.

Circular track counts and native surface metrics still fit local bead widths;
course-cell width is divided by the factor before computing extrusion. Edge
tapers use bead width, not widened pitch. Surface spacing remains sampled, with
the cladding producer's existing metric and fixed-relay flow limitations.
The setting does not add a material profile or establish physical printability.

Spaced planar interiors publish sparse coverage; spaced walls publish their
individual bands. A spaced draped skin publishes only its final bead strips,
so a successor cannot consume its gaps as a continuous material surface.
Ordinary factor-1 recipes retain their existing deposition behavior.

## Whole-plan travel requirement

Travel minimization is a design responsibility for every skill and shared
component, not another check or rejection gate. Think about where the nozzle
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
draped-skin, vase-wall and the bounded wedge. The builder updates the highest
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
Compose all results together so one builder carries chronology across skills;
the wedge retains its bounded eight-point generator and delegates motion to it.
Machine firmware service routines (including H2D shutdown) retain their separate
export contracts; they are not ordinary SAAMpath travel.

Nearest wall starts, alternating infill and verified combing reduce travel.
The shared scanline fill completes disconnected components and splits each
connected component into uninterrupted runs of rows at interval splits/merges.
This also orders the sides of holes and concavities, rather than crossing each
hole on every row. Full-fill, planar-infill, draped-skin and the bounded wedge
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

Planar combing checks boundary crossings and standoff, then can route around
holes via a bounded visibility graph (256 offset corners, `maxCombMm` route
length); otherwise it hops. Earlier operation queries can forbid combing.
Drape retains its own local surface query for direct moves. These conservative
policies are not a full swept-head collision or support model. The wedge retains
its bounded nearby/direct policy; its lifts use the shared deposited height.

### Travel planning

`core/path/builder.mjs` classifies each move as joined, combed or hopped.
The shared PathBuilder tracks deposited height; local callbacks decide direct/combed
eligibility. See [travel requirements](#whole-plan-travel-requirement). Fill
strokes alternate their direction to keep neighbouring endpoints close. The wedge
retains its bounded nearby-start policy through the same PathBuilder; longer
moves lift above material deposited so far. Both use the shared export and checks.
