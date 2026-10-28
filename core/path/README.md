# SAAMpath and scheduling

Contract **Paath /3, updated 2026-10-20** owns canonical moving anchors and stationary instructions; SP2 remains the saved-output compatibility contract.

## Paath through the pipeline

Paath is the full manufacturing-path format throughout the pipeline. Its
attribute set does not grow as it moves between stages: conditioning sets or
changes values such as aspect, tool direction and speed within that same format.
Other attributes can remain unset or at defaults defined by the applicable
stage contract. Unset values and defined defaults are distinct; neither implies
that every condition required by a later consumer has been established.
Geometry and assigned attribute values obey their numerical laws.

Wall loops and infill are already Paath when their producers deliver them.
Their geometry lies on the supplied surface in the shared spatial frame;
chart coordinates may describe correspondence without becoming another path
authority. Composing them produces the slice's combined Paath, not a conversion
from a separate curve format. Material regions remain geometric regions.

Slice establishes local fill traversal in the Paath course sequences. Their
existing continuity and traversal constraints distinguish required order from
choices still available to scheduling. Conditioning and composition preserve
those sequences; Scheduler places the work globally and resolves permitted
entry, direction and seam choices. Closed courses are seam-free unless their
producer sets `seamRequired:true`. Finalization still orders closed wall loops
nearest-first and joins nearby courses with short connectors (pending move). Local fill order needs neither a separate
ordering index nor a cursor passed between slice-generation calls. A pattern
phase that changes geometry remains an explicit construction input.

Each operation states the conditions it requires, establishes, preserves and
invalidates. Slice establishes single-slice wall/infill geometry, material roles
and source correspondence from the supplied body, surface and recipe, preserving
the supplied slice identity; it does not promise every property needed downstream.
Geometry/parameter changes must transport or invalidate
dependent profiles and evidence. Immutable versions may have different value
identities while preserving meaningful entity/source identities.

This is a contract change, not a completed implementation migration. The current
reader and complete-source admission still require tool direction, speed and
correlated deposition channels. The stored-output requirements below continue to
describe completed `saampath/3` output. Consumer-specific admission and partial
attribute queries need implementation work; Scheduler conditioning is outside
the Slice example.

## Ownership and pipeline

Geometry owns numerical shapes, evaluation and conservative bounds. Material regions prepares claims; interlock cadence is developer-only research.
Construction finalizes deposition and minimal manufacturing prerequisites. Its **3.6** handoff commands **13** with the exact completed work. Scheduler chooses ready work and routes each transfer; Runtime receives the immutable work and qualified schedule for guarded Bundle publication. Export realizes the routes on the selected machine (retraction, parking, axes). Studio and exporters share the numerical reader. Numerical construction queries remain independent of command activation.

Scheduler numerical range/proof caches are disposable work. Eviction and
recomputation preserve witnesses, source identities and global deposited-prefix
constraints; bookkeeping must not retain an unbounded history of deleted entries.
Numerical query chunks do not partition the scheduling graph or relax travel and
cooling preferences.

A declared manufacturing prerequisite guarantees that dependent deposition is
clear of that prerequisite, including its transitive ancestors. Scheduler trusts
this independently of nozzle-envelope certificates. Foundation trust is scoped,
not unit-wide: a course's `founded` intervals are what its producer declares
rests on declared work (a native member on its predecessor's overlap, a spiral
on its own earlier turn, an operation on its named prerequisites). Construction
infers no producer beneath any material (newly entering
members, reference stacks on part surfaces, contact layers); Scheduler finds it.
A recipe declares what it rests on by naming the producer (`after`,
`dependencies.after` or a contact source, each a whole assignment). A linear dependency chain
needs no pairwise deposition-clearance checks; incomparable work retains uncovered
interaction checks. Composition preferences and discovered ordering edges do not
create producer guarantees. Travel still considers all actually deposited
obstacles, including ancestors: each transfer is routed directly when clear, otherwise
over deposited work at the process lift. Export realizes those routes without
re-routing or repeating clearance checks. Existing minimal-effort travel/cooling preferences
remain.
Native layers are producer records; no stage reconstructs them or treats their surfaces as solid. Regular native curves survive process edits. Native witnesses and certified mappings retain NURBS. Sampled fits bound position and local length, preserve edge direction and retain a constant material plane, within five print-resolution units and 1/80 of each deposited dimension. Unproved fits retain samples; finalization retains its storage decision through publication. Serialized size selects storage; `summary.compaction` records bounds.

## Stored deposition: `saampath/3`

Records contain finite serializable values in the part frame. Source tables
remain `curves`, `layers`, `surfaces`, `processes`, `operations` and `completions`.
Geometry/profile identity and immutable `[0,1]` source parameters survive exact
scheduler cuts; execution indexes are separate from stable source identities.

A curve is `{geometry, profiles}`. Geometry retains exact explicit `polyline`
points, natural-degree `nurbs` (1–3, full knots and optional positive weights),
or a `point`. Closing edges are explicit; disconnected spans remain separate.
Polyline parameters use cumulative chord length; NURBS use the normalized active
knot domain. No degree elevation, mandatory fit or source-parameter renormalization
is introduced by scheduling.

`profiles` contains required `toolAxis` and requested `speedMmS`. Deposition adds
`rateMm3PerMm`, `aspectRatio` and independent `materialNormal`. Scalars are constants
or `{interpolation:'linear', knots:[[u,value],...]}`; directions are unit vectors
or analogous `slerp` profiles. Scalar keys may pair one interior parameter for
exact left/right limits; other keys increase strictly and cover 0 and 1. Antipodal
directions need an intermediate direction. Rate is nonnegative and aspect positive.
Under the shared rectangular section law, width is `sqrt(rate*aspect)` and height
is `sqrt(rate/aspect)`. The curve remains the section's **top reference**; material
extends below it along the material normal. Zero rate has no deposited section.
Local section evaluation needs no cumulative volume or material integral.

Paath stores no intrinsic roll, dimension profile or cumulative-volume authority.
The reader's derived `pose` is a deterministic computation frame from `toolAxis`;
machine adapters choose feasible roll. `materialNormal` does not imply tool axis.
Saved older paths retain their compatibility reader; new generation requires /3.

Each operation owns a neutral nonnegative integer `toolIndex`, applying to each of
its courses. Bundle material/process assignment and physical nozzle selection are
separate. A moving operation retains `{id,kind:'deposit',layerId,processId,
 toolIndex,after,interruptible,courses}`. Courses reference `{id,curveId,from,to,
 interruptible}` with optional provenance, prerequisites, traversal and seam
requirements, and optional `founded` (increasing disjoint source intervals of
declared foundation). Slice and sleeve operations carry `foundation:'stack'`:
the stack owns its support design beyond those intervals. Contract `saam-producer-validity/4`
carries these semantics; Scheduler refuses `/3` sources with a regenerate message. Layers retain native stack/index/sequence/surface/completion identity;
Trace's geometric chart does not imply layer membership. Prerequisites and atomic
or continuous-course guarantees keep their existing meanings.

Stationary entities retain `kind:'inject'` and one position authority:
`injection:{at,toolAxis,volumeMm3,flowMm3S,holdSeconds}`. Dose, flow and hold are
explicit instructions. Arrival/departure travel cannot replace them. Moving rate
is not overloaded with stationary units. Stationary injections are atomic.
Positive dose requires positive flow. Hold-only work has zero dose and flow,
positive hold. It retains the stationary schedule
identity and an identified dwell, emits no extrusion or material heating, and
still requires stationary nozzle access.
Point tool-axis anchors use normalized requested stationary time: dose/flow plus
post-dose hold, or hold alone for zero dose. The shared stationary reader cuts
views exactly at the dose/hold boundary and preserves direction, requested time,
point identity and tool in extrusion/orientation/dwell actions. Machine adapters
derive roll continuously and report unsupported simultaneous orientation and
metering; firmware timing may stretch the requested duration.

Construction keeps nominal Slice regions and Trace source snapshots separate
from stateless fill expansion. Ordinary fills expand in the consuming Slice
work node; the current implementation of stateful `fillOrder` still retains
sequential preparation. The Slice trial contracts above remove that cross-slice
cursor while preserving local fill order; this implementation migration is
pending. Completed
canonical handles remain available to live Trace contact and retry consumers. After
those consumers, references, material readiness and inspection finish,
`constructionPath({consumeResults:true,...})` transfers final result ownership:
each operation is retired after its canonical publication, followed by raw
reference buffers. The default preserves caller inputs. Admission still copies
caller-owned arrays before freezing source work. This bounds publication overlap;
nominal geometry, completed canonical work and the complete output still impose
whole-input storage, so it is not a constant-memory generation claim.

The production-only compact-work phase transfers finalized node ownership through
`appendConstructionResult(result)`. Its immutable canonical curve/course payloads
are the sole process geometry retained by completed/retry handles. Public
`generateModelResults` and extension-visible raw results keep their existing shape
unless the explicit `compactWork` option transfers ownership. Normalized geometry
charts, small boundary curves, prerequisites, reports and inspection summaries stay
with the handle; raw fill and deposited stroke arrays do not. Reference/contact
queries use the shared canonical reader. Optional substrate adaptation and its
duplicate finished-boundary leases are retired; authored geometry, nominal gaps
and explicit manufacturing prerequisites remain.
`constructionPath` finishes only the selected results, in their established order,
binding global process/surface/native/completion identities. Failed-attempt handles
cannot leak into this selection or replace a retained successful handle. Append
and finish share one operation-lowering implementation; no live Bundle lookup,
serialized closure, independent chunk schedule or second process model is allowed.

Construction preserves each finalized segment's material and section through
paired-limit scalar anchors, retaining geometry, parameter, work-course identity,
atomicity, traversal and prerequisites. Canonical authored laws retain their complete
parameter mapping when their witness survives. Existing dimension/flow authoring
keeps its sampling and finalization semantics, including zero flow; publication
lowers the resulting physical sections rather than relabelling endpoint keys or
interpolating segment centres. Native arc/chord differences use bounded local
lengths to conserve material while retaining width. Publication reports conservative
local `summary.compaction.sectionErrorMm` and accumulated `volumeErrorMm3`, including
integration uncertainty and rounding guards; integrated summary totals are estimates.
Private producer segment volumes remain construction intermediates, not persisted
material authority. Native geometry retention and bounded normal compaction remain.

Manufacturing validity proofs are optional producer optimizations with explicit
assumptions. Direct canonical source admission does not require nozzle geometry;
Scheduler resolves its logical-tool assumptions independently.

## Finalized extension input

The shared contract at `@wire/canonical-admission` and `@type/paath` owns this
boundary. Portable deposition editors receive `Toolpath.paathAssignment`:
`{id,entities,natives?,after?,process?,toolIndex?,part?}`. Each moving entity has
`{id,geometry,profiles}` and optional local `after`, native `layerId`, traversal,
interruptibility, role and provenance. A stationary entity uses point geometry,
`profiles:{toolAxis}` and `stationary:{volumeMm3,flowMm3S,holdSeconds}`.
Native records are `{id,stackId,index,sequence,surface?}`.

[The portable example](../../examples/extensions/canonical-paath/SKILL.md) enters
through the ordinary extension proposal/Bundle workflow. Bundle resolves process
inputs; common admission retains exact geometry/anchors and publishes normal
manufacturing dependencies. Canonical input bypasses raw Trace construction and
has no retained sampled stroke copy. Support/reference queries use bounded views
from the same curve reader. Producer nozzle validity remains optional.

## Stored execution: `saam-schedule/1`

`schedulePath(deposition,{sourcePathId,onProgress?})` returns `{schema:'saam-schedule/1',sourcePathId,initialPosition,initialPose,motionCurves,execution,summary,completion}` without Bundle I/O or machine selection. `completion.transfers:'routed'` means every travel is a route the qualified nozzle types can take past the deposited prefix; Export refuses older schedules.
Source and schedule join as `{sourcePathId,deposition,schedule}`; mismatched identity fails. Export checks that the qualified nozzle types contain the selected nozzles, then adds retraction, recovery and parking to the scheduled routes; it uses no scheduling code. Studio reopens that output's saved execution; machine changes retain unchanged neutral source and schedule.

`execution` is ordered data. `{kind:'deposit',courseId,from,to,reverse?}` references a source subset; bounds stay increasing, and `reverse:true` traverses from `to` to `from` with positive material. `{kind:'travel',curveId,from,to,durationSeconds?}`
references `motionCurves`, using the same curve/profile representation.
`{kind:'inject',operationId}` references its source injection. Fan, temperature,
toolChange, dwell and context retain their action fields and delta semantics; resolved machine execution adds retract/recover. Context labels source operations, layers and provenance; it cannot override material or pose profiles. Travel has zero deposited volume.
Optional travel duration preserves timed rotation; otherwise machine rate applies. Each moving source course is covered exactly once, without gaps or duplicated volume; scheduler cuts coalesce or move within print resolution and all contacts are re-solved; each injection executes once. A failed solve produces a finding, never
a partially successful schedule or unchecked fallback motion.

## Shared numerical reader

Toolpath owns `core/path/curve-path.mjs`; deterministic queries can memoize privately without mutating source.

| Export | Result and semantics |
|---|---|
| `prepareCurvePath({curves})` | Admitted curve-table/query handle (a source can be passed directly); no eager whole-path tessellation. |
| `curveAt(handle,curveId,u,{side='right'}={})` | Canonical `{point,tangent,toolAxis,speedMmS,rateMm3PerMm,aspectRatio,materialNormal}` plus derived `pose,widthMm,heightMm,areaMm2`; absent travel channels stay absent. No material integration. |
| `curveRange(handle,curveId,from,to,options={})` | Conservative position, length, volume, rate/aspect and derived section bounds, tangent/material/tool-axis cones, computation-frame cone and parameter breaks. Missing travel channels stay absent. |
| `curveHasLength(handle,curveId,from,to,minimumMm)` | Geometry proves a minimum physical length without a complete integral; rounding-sized uncertainty conservatively returns false. |
| `curveParameterAtLength(handle,curveId,from,to,distanceMm,{fromEnd=false,toleranceMm}={})` | Source parameter at physical distance, certified by Geometry; defaults to rounding accuracy. |
| `curveClosestParameter(handle,curveId,from,to,point,{toleranceMm}={})` | Source parameter nearest a point within the requested distance accuracy; Geometry owns projection/bounds. Geometry stays unchanged. |
| `curveSpans(handle,curveId,from,to,options)` | Lazy iterable of bounded local spans, each `{from,to,start,end,range}`; endpoints are `curveAt` records, range is `curveRange`. |
| `linearizePath(view,options)` | Lazy existing-style contextual action stream from the joined path, for consumers needing segments. Never the persisted authority. |

Cones `{axis,halfAngleRad}` enclose regular tangents/normals (full sphere when unproved; null for a point). `chordErrorMm` bounds distance to the interval's endpoint segment;
it does not assert linear timing. `toolAxisCone` bounds the required direction;
`poseCone` conservatively bounds the reader's computation frame, without granting roll authority.
`breaks` lists interior vertices, knots and profile discontinuities. Position bounds include both endpoints; attribute bounds use the right limit at `from` and left limit at `to`. Overlapping bounds alone prove no collision.
`curveRange` accepts positive `lengthToleranceMm` and absolute `volumeToleranceMm3` or relative `volumeToleranceRatio`; omission permits coarse bounds. Arc length spends one physical query budget, independent of knots.
Views require positive `positionToleranceMm`, `orientationToleranceRad` and either volume tolerance. Defaults bound volume uncertainty to 0.1% of material, independent of job/course counts; authored cumulative material stays exact. Explicit absolute budgets bound the requested range/path total and take precedence. Position bounds chord deviation and bead-section change; orientation bounds full-frame interpolation. Reverse spans retain increasing source bounds. Compatible boundaries may coalesce within that budget; positive zero-length moves are invalid.
Subdivision certifies convergent length/volume bounds; zero deposition stays exact.
Shared numerical shapes belong to Geometry; path/material semantics stay here. Query resolution never changes identity, profiles or accumulated material. Serialization never rounds cuts into gaps.
Geometry/profile/material knots are query information, not compulsory output moves. Physical arc-length tolerance governs nearby view boundaries and material placement; provenance cannot force microscopic extrusion. Unknown movement is a precision finding, not proof of a singularity.

## Scheduler obligations

The final scheduler is one generic interleaving engine over immutable manufactured work. Its input is SAAMpath: finalized deposition geometry/material/poses, native stack membership, minimal producer-owned prerequisites and construction-validity declarations. Its output is an execution schedule referencing that source exactly once, with permitted splits, traversal choices, process transitions and routed transfers. It neither authors deposition nor repairs missing known manufacturing prerequisites.

Producers guarantee their internal construction and validity against their declared prerequisites and the required construction history; they publish every necessary prerequisite automatically. Neutral scheduling trusts those construction relationships and resolves only potentially interfering interactions outside their coverage. An arbitrary preference/order edge is not a construction guarantee. A native slice requires its immediate predecessor; this establishes readiness, not adjacency in execution. Known solid-exterior consumers select required slice/stack completions without inspecting deposition paths. Explicit printed-edge references select their named course completion. An empty prerequisite list imposes no producer-order constraint: scheduling determines feasible placement from actual work and geometry, without a discovery opt-in. It does not imply build-plate attachment or permission to print first.

Scheduling ranks ready work by access, cooling and entry. It trusts producer validity and first tries whole slices/operations against their actual deposited prefix; future work need not be clear yet. Aggregate bounds also exclude impossible support contacts. Unproved interactions descend through producer/group bounds to implicated paths/intervals. Inconclusive bounds require inspection, not necessarily interleaving. Open a slice only when actual constraints require some before external work and some after; contracting it exposes a cycle. Cut an interruptible course only when that condition persists after allowed whole-course order/traversal choices. Hard prerequisites survive refinement; true event-level cycles fail. Vertex counts, world Z, cooling and producer/skill names cannot require splitting. Numerical subdivision creates no execution cuts. Trace and Inject share this proof hierarchy.

Manufacturing prerequisites remain hard. Access constraints must have actual geometric witnesses; overlapping bounds only request refinement. Splitting preserves geometry, material, poses, required direction/seam and exact source coverage. Unresolvable prerequisites, access or numerical precision produce a finding, never silently dropped dependencies or an unchecked schedule. Sparse gaps remain absent. [Bead qualification](bead-qualification.mjs) combines finite contact intervals wider than half the bead, using both section dimensions and local frames; cached geometry is discovered only as needed. Ready selection accepts sufficient available providers; only blocked aggregate ordering introduces supporting edges for refinement. Connected depositing courses share their actual contact anchors and bridge ratio; travel breaks a chain. Free ends have only a half-width allowance; contact gaps shorter than construction accuracy are not bridges. Declared `founded` intervals count as full contact, like the bed. Outside them, `foundation:'stack'` work waits for every other group's material it rests on without a bead proof of its own; other undeclared work needs the full proof against the bed or deposited material, including declared ancestors' material. A receiver's verdict is reused until material that can touch it is deposited. Qualification retains all source geometry for subsequent checks. Cooling only ranks ready work.

Machine selection is not an input to neutral scheduling. Producers publish internal validity, native slice order and explicit prerequisites under `manufacturing.accessGeometry`; no generic construction certification reruns collision scheduling. The neutral model is 80° included / 0.9 mm flat, with the shared 0.2 mm forgiveness for motion and Inject. Scheduling resolves uncovered interference and enclosure requirements. Export accepts the schedule only for selected nozzles its qualified types contain, then realizes retraction and parking on the scheduled routes. Adapters own installation startup/priming, tool changes and axes. `process.primeLine` is an Export-only override in bed coordinates; an ordinary sacrificial Trace remains ordinary part work.

There is no skill-specific scheduler, global layer-height ordering, inferred solid from a reference surface, geometry mutation or support generation here. Local material normals and explicit poses define access; parking follows the tool frame. Carriage and fixture collision remain outside the current nozzle/bead model. Sparse graphs and bounded evictable caches preserve correctness without arbitrary failure budgets.

## Work ownership and migration acceptance

One integrated workstream owns SP2 completion; there is no separate scheduler-task dependency. Scheduling owns ordering/execution, Toolpath owns publication/material/profile semantics, Bundle owns saved identity, and Geometry owns numerical shapes/frames. Keep these interfaces consolidated.
Current source/completion contracts invalidate older generated paths; exact saved programs remain readable. This document owns the seam; Geometry owns numerical queries.

New writers use compact source/execution. One compatibility reader retains saved paths/programs; current scheduling requires regeneration. Preserve reviewed/exported snapshots and remove superseded routes, samplers and expanded persisted motion after migration.
Verify native curves, faithful polyline fallback, varying material/poses, atomic
chains, injections, process changes and multi-owner native layers. Report
source/schedule bytes separately, peak memory, CPU/wall time and refinement counts
on pinned real and individually authored adversarial examples, including multi-axis
versions. Independently verify continuous changing-pose motion; obtain human
visual review when useful. Compression alone is not evidence of faster scheduling.
Canonical bead/Studio geometry unification, map solving, cooling dwell and slowdown are separate work. Full suites require local-note approval.

## Retained construction interfaces

Prepared references retain shell/coverage provenance. Manufactured prerequisites use completion identities; sparse patterns remain sparse material, including when their chart is used for placement. An assignment's `part` selects its named assembly component.
[Spacing](./spacing.mjs) derives pitch from bead width times positive
`spacingFactor` (default 1), divided by fill density where applicable. Actual width
and normal gap determine material; overlap/spacing does not establish printability.
[Process controls](./process-controls.mjs) retain scoped temperature validation;
machine adapters own command semantics. A travel retracts only when its route is
longer than `maxCombMm`, whether direct or over deposited work. Debt retains amount/speed through interleaving; zero retract
prevents withdrawal. [Print lifecycle](../print/README.md) owns generation and review;
[Material regions](../region/README.md) owns claims, cadence and surface contact.
