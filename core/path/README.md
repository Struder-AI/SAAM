# SAAMpath and scheduling

Contract **SP2, updated 2026-10-17** owns the compact source, execution and reader shipped in 0.3.9.

## Ownership and pipeline

Geometry owns numerical shapes, evaluation and conservative bounds. Material regions prepares claims; interlock cadence is developer-only research.
Toolpath finalizes deposition, minimal manufacturing prerequisites and internal access validity. Bundle stores immutable source once. Scheduling chooses ready work and endpoint transfers; Export realizes selected-machine access, routes and axes. Studio and exporters share the numerical reader.
Native layers are producer records; no stage reconstructs them or treats their surfaces as solid. Regular native curves survive process edits. Native witnesses and certified surface mappings retain NURBS. Sampled fits require whole-interval position bounds, positive speed and a constant material plane; their budget is at most five print-resolution units and 1/80 of each deposited dimension. Unproved frames retain samples. Serialized size selects storage; `summary.compaction` records bounds.

## Stored deposition: `saampath/2`

Records contain finite serializable numbers in the part frame (mm, seconds, mm3). Tables use opaque nonempty string IDs, stable within one Bundle path identity; they never encode surface JSON.
Source tables are `curves`, `layers`, `surfaces`, `processes`, `operations` and `completions`, with `manufacturing`, `planning`, `summary` and optional provenance/generator metadata.

- A curve is `{geometry, profiles}`. Geometry is `{kind:'polyline',points}`,
  `{kind:'nurbs',degree,knots,controlPoints,weights?}`, or `{kind:'point',point}`.
  NURBS use Geometry's existing positive-weight, full-knot representation.
  Closing edges are explicit. Curves are continuous; disconnected spans are
  separate curves. Point curves serve orientation-only travel, never moving extrusion.
- Parameter `u` is immutable on `[0,1]`: cumulative chord length for a polyline;
  normalized active knot domain for NURBS; elapsed interpolation for a point.
  Splitting a traversal never renormalizes the source or its profiles.
- `profiles` holds `widthMm`, `speedMmS`, `materialNormal`, `pose`, and `material`.
  Width/speed are constants or `{interpolation:'step'|'linear',knots:[[u,value],...]}`.
  Normals are unit vectors or keyed profiles with `interpolation:'slerp'`.
  Poses are `{toolAxis,toolUp}` or keyed profiles with `interpolation:'frame'`.
  Frame interpolation uses Geometry's existing shortest rigid-frame interpolation,
  retaining roll. Antipodal normal keys require an authored intermediate direction.
  Publication removes redundant width/feed/frame keys and compacts generated normal/material fields with continuous interval proofs, preserving roll, exact course totals and zero-material intervals. Connected atomic or explicitly required consecutive courses share width/feed/frame endpoints over one bead width, capped at half each course.
- Keys strictly increase, include 0 and 1, and cover the domain. Step values are
  right-continuous except at 1; callers can request a knot's left limit.
  Deposition requires positive width and an explicit material normal. Toolpath
  resolves ordinary three-axis poses explicitly; `materialNormal` never implies pose.
  Optional normal alignment uses a canonical up direction; only an explicit
  producer `referenceAlong` requests roll from a reference frame.
  Travel can omit width, normal and material, but always supplies pose and speed.
- Material has one authority: `{kind:'area',areaMm2:profile}` integrates nonnegative area against arc length;
  `{kind:'cumulative',interpolation:'monotone',knots:[[u,totalMm3],...]}` retains every stored total and interpolates monotone C1 volume. Omitted interpolation retains older linear meaning.
  One prepared law supplies point rates, interval bounds and stable local integration; never subtract nearly equal evaluated totals. Local area is dV/ds.
  Positive volume on zero length or unbounded density is invalid. No separate height or segment-volume authority.
- A layer is `{stackId,index,surfaceId,completionId}`: Slice's native identity, including adjusted shared-material layers. Each completion lists only its immediate predecessor in that stack. Neither index nor rank means world Z. `surfaces` retains Geometry references once. Trace has `layerId:null`, including when it uses a Slice chart; reference and manufacturing membership are distinct.
- A moving operation is `{id,kind:'deposit',layerId,processId,filament,after,
  interruptible,courses,...}`. Each course is `{id,curveId,from,to,interruptible,
  role?,provenance?,after?,orderGroup?,directionRequired?,seamRequired?}`, with `0 <= from < to <= 1`. Course IDs are source-wide unique.
  Each whole course is initially one scheduling unit; vertices and profile keys
  do not create execution boundaries. Curves/profile data are referenced, never copied into refinements.
  `processes` deduplicates the existing resolved process records; `planning`
  retains its existing defaults, explicit start and motion settings.
- Operation `after` names operations or completion IDs; course `after` names source-wide courses.
  Every prerequisite finishes before its consumer starts. Completion records `{kind,members,after}` retain required work without expanding its courses; assignment completion uses terminal work. Recipe selectors `{assignment,index?,part?}` resolve to exact producer/slice completion. `substrate` attaches an independently selected manufactured base. Manufactured slice/exterior references derive their actual slice or stack prerequisites from nominal material frontiers; independent geometry charts leave them empty. Finite support contacts constrain only touched slices. Continuous walls advertise their owned frontier, with only a terminal boundary for open patterns. Construction lowers local curve names/parallel expansions and removes transitively implied prerequisites.
  Consecutive courses sharing `orderGroup` form a soft traversal chunk; internal requirements survive splitting. Slice retains uninterrupted fill cells; splits/merges end cells. Scheduling chooses permitted entry/reversal and transfer endpoints, opening implicated courses for external interference. Later cuts preserve those openings. Group names impose no hard precedence.
  `interruptible:false` makes an operation or course atomic. Otherwise pieces may interleave/reorder subject to physical/declared constraints. `directionRequired:false` permits reversal; `seamRequired:false` permits cyclic entry changes on interruptible closed courses. Material and poses retain their source locations. A required seam stays first even after refinement. Producers declare permitted directions/seams; ordinary Slice normally frees both. Causal fronts, Trace and atomic/continuous work retain authored requirements.
- A stationary operation has `kind:'inject'`, no courses, and
  `injection:{at,pose,volumeMm3,flowMm3S,holdSeconds}`. Existing `requiredMaterial`,
  occupied geometry, process selection and scoped `nozzleC`/`restoreNozzleC` retain their meanings. Injection is atomic. Nominal material ownership selects enclosure slices; construction publishes a whole-slice prerequisite when access is clear, or selected course/interval completion for a genuine enclosure/closure conflict. Unknown charts retain scoped geometric inspection. A shared required-material/access event is an irreducible cycle.

## Stored execution: `saam-schedule/1`

`schedulePath(deposition,{sourcePathId,onProgress?})` returns `{schema:'saam-schedule/1',sourcePathId,initialPosition,initialPose,motionCurves,execution,summary,completion}` without Bundle I/O or machine selection. Neutral `completion.transfers:'intent'` identifies endpoint connections, not collision-cleared physical routes.
Source and schedule join as `{sourcePathId,deposition,schedule}`; mismatched identity fails. Export uses the same solver with actual nozzle dimensions, realizes transfers against deposited prefixes and saves a separate `transfers:'resolved'` schedule with the program. Studio reopens that output's saved execution; machine changes retain unchanged neutral source and schedule.

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
| `curveAt(handle,curveId,u,{side='right'}={})` | `{point,tangent,pose,widthMm,speedMmS,materialNormal,areaMm2}`; absent travel channels stay absent; tangent is null only at a singularity/point. |
| `curveRange(handle,curveId,from,to,options={})` | Conservative `{bounds:{min,max},lengthMm:[lo,hi],volumeMm3:[lo,hi],widthMm:[lo,hi],areaMm2:[lo,hi],tangentCone,chordErrorMm,normalCone,poseCone,breaks}`. Missing travel channels stay absent. |
| `curveHasLength(handle,curveId,from,to,minimumMm)` | Geometry proves a minimum physical length without a complete integral; rounding-sized uncertainty conservatively returns false. |
| `curveParameterAtLength(handle,curveId,from,to,distanceMm,{fromEnd=false,toleranceMm}={})` | Source parameter at physical distance, certified by Geometry; defaults to rounding accuracy. |
| `curveClosestParameter(handle,curveId,from,to,point,{toleranceMm}={})` | Source parameter nearest a point within the requested distance accuracy; Geometry owns projection/bounds. Geometry stays unchanged. |
| `curveSpans(handle,curveId,from,to,options)` | Lazy iterable of bounded local spans, each `{from,to,start,end,range}`; endpoints are `curveAt` records, range is `curveRange`. |
| `linearizePath(view,options)` | Lazy existing-style contextual action stream from the joined path, for consumers needing segments. Never the persisted authority. |

Cones `{axis,halfAngleRad}` enclose regular tangents/normals (full sphere when unproved; null for a point). `chordErrorMm` bounds distance to the interval's endpoint segment;
it does not assert linear timing. `poseCone:{reference,halfAngleRad}` bounds full SO(3) frame deviation, including roll.
`breaks` lists interior vertices, knots and profile discontinuities. Position bounds include both endpoints; attribute bounds use the right limit at `from` and left limit at `to`. Overlapping bounds alone prove no collision.
`curveRange` accepts positive `lengthToleranceMm` and absolute `volumeToleranceMm3` or relative `volumeToleranceRatio`; omission permits coarse bounds. Arc length spends one physical query budget, independent of knots.
Views require positive `positionToleranceMm`, `orientationToleranceRad` and either volume tolerance. Defaults bound volume uncertainty to 0.1% of material, independent of job/course counts; authored cumulative material stays exact. Explicit absolute budgets bound the requested range/path total and take precedence. Position bounds chord deviation; orientation bounds full-frame interpolation. Reverse spans retain increasing source bounds. Nearby compatible boundaries may coalesce within physical tolerance; positive zero-length moves are invalid.
Subdivision certifies convergent length/volume bounds; zero deposition stays exact.
Shared numerical shapes belong to Geometry; path/material semantics stay here. Query resolution never changes identity, profiles or accumulated material. Serialization never rounds cuts into gaps.
Geometry/profile/material knots are query information, not compulsory output moves. Physical arc-length tolerance governs nearby view boundaries and material placement; provenance cannot force microscopic extrusion. Unknown movement is a precision finding, not proof of a singularity.

## Scheduler obligations

The final scheduler is one generic interleaving engine over immutable manufactured work. Its input is SAAMpath: finalized deposition geometry/material/poses, native stack membership, minimal producer-owned prerequisites and construction-validity declarations. Its output is an execution schedule referencing that source exactly once, with permitted splits, traversal choices, process transitions and endpoint transfer intent. It neither authors deposition nor repairs missing known manufacturing prerequisites.

Producers guarantee their internal construction and validity against their declared prerequisites and the required construction history; they publish every necessary prerequisite automatically. Neutral scheduling trusts those construction relationships and resolves only potentially interfering interactions outside their coverage. An arbitrary preference/order edge is not a construction guarantee. A native slice requires its immediate predecessor; this establishes readiness, not adjacency in execution. Known solid-exterior consumers select required slice/stack completions without inspecting deposition paths. Explicit printed-edge references select their named course completion. An empty prerequisite list imposes no producer-order constraint: scheduling determines feasible placement from actual work and geometry, without a discovery opt-in. It does not imply build-plate attachment or permission to print first.

Scheduling ranks ready work by access, cooling and entry. It trusts producer validity and first tries whole slices/operations against their actual deposited prefix; future work need not be clear yet. Aggregate bounds also exclude impossible support contacts. Unproved interactions descend through producer/group bounds to implicated paths/intervals. Inconclusive bounds require inspection, not necessarily interleaving. Open a slice only when actual constraints require some before external work and some after; contracting it exposes a cycle. Cut an interruptible course only when that condition persists after allowed whole-course order/traversal choices. Hard prerequisites survive refinement; true event-level cycles fail. Vertex counts, world Z, cooling and producer/skill names cannot require splitting. Numerical subdivision creates no execution cuts. Trace and Inject share this proof hierarchy.

Manufacturing prerequisites remain hard. Access constraints must have actual geometric witnesses; overlapping bounds only request refinement. Splitting preserves geometry, material, poses, required direction/seam and exact source coverage. Unresolvable prerequisites, access or numerical precision produce a finding, never silently dropped dependencies or an unchecked schedule. Sparse gaps remain absent. Cooling ranks ready work; it introduces no manufacturing edges, dwell or feed changes.

Machine selection is not an input to neutral scheduling. Producers publish internal validity, native slice order and explicit prerequisites under `manufacturing.accessGeometry`; no generic construction certification reruns collision scheduling. The neutral model is 80° included / 0.9 mm flat, with 0.2 mm moving forgiveness and zero for Inject. Scheduling resolves uncovered interference and enclosure requirements. Export reuses neutral order for contained tools and rechecks larger tools, then realizes physical transfers, reorientation and parking against deposited prefixes. Adapters own installation startup/priming, tool changes and axes. `process.primeLine` is an Export-only override in bed coordinates; an ordinary sacrificial Trace remains ordinary part work.

There is no skill-specific scheduler, global layer-height ordering, inferred solid from a reference surface, geometry mutation or support generation here. Local material normals and explicit poses define access; parking follows the tool frame. Carriage and fixture collision remain outside the current nozzle/bead model. Sparse graphs and bounded evictable caches preserve correctness without arbitrary failure budgets.

## Work ownership and migration acceptance

One integrated workstream owns SP2 completion; there is no separate scheduler-task dependency. Scheduling owns ordering/execution, Toolpath owns publication/material/profile semantics, Bundle owns saved identity, and Geometry owns numerical shapes/frames. Keep these interfaces consolidated.
Current source/completion contracts invalidate older generated paths; exact saved programs remain readable. This document owns the seam; Geometry owns numerical queries.

New writers use compact source/execution. One compatibility reader retains saved paths/programs; current scheduling requires regeneration. Preserve reviewed/exported snapshots and remove superseded routes, samplers and expanded persisted motion after migration.
Verify native curves, faithful polyline fallback, varying material/poses, atomic
chains, injections, process changes and shared-material native layers. Report
source/schedule bytes separately, peak memory, CPU/wall time and refinement counts
on pinned real and individually authored adversarial examples, including multi-axis
versions. Independently verify continuous changing-pose motion; obtain human
visual review when useful. Compression alone is not evidence of faster scheduling.
Canonical bead/Studio geometry unification, shared-material redesign, map solving, cooling dwell and slowdown are separate work. Full suites require local-note approval.

## Retained construction interfaces

[Finished surfaces](./finished-surface.mjs) retain nominal shell/coverage provenance. Manufactured prerequisites use completion identities; sparse patterns remain sparse material, including when their chart is used for placement. An assignment's `part` selects its named assembly component.
[Spacing](./spacing.mjs) derives pitch from bead width times positive
`spacingFactor` (default 1), divided by fill density where applicable. Actual width
and normal gap determine material; overlap/spacing does not establish printability.
[Process controls](./process-controls.mjs) retain scoped temperature validation;
machine adapters own command semantics. Direct travel preserves pressure; routed
travel retracts. Debt retains amount/speed through interleaving; zero retract
prevents withdrawal. [Print lifecycle](../print/README.md) owns generation and review;
[Material regions](../region/README.md) owns claims, cadence and surface contact.
