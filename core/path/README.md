# SAAMpath and scheduling

Contract **SP2, 2026-10-16** owns the compact source, execution and reader shipped in 0.3.9.

## Ownership and pipeline

Geometry owns numerical shapes, evaluation and conservative bounds. Material regions prepares claims; interlock cadence is developer-only research.
Toolpath finalizes Slice/Trace/Inject geometry, connections, Modulation, material and poses. Bundle stores immutable source once; Scheduling orders ranges and adds checked transfers/process events. Studio and exporters share the numerical reader; exporters own machine axes.
Native layers are producer records; no stage reconstructs them or treats their surfaces as solid. Every producer retains regular native curves through flow/width/speed/pose edits. Mapping and position edits construct NURBS with whole-interval position and positive-speed certificates; serialized geometry size selects faithful spline or polyline storage automatically. `summary.compaction` records approximation bounds.

## Stored deposition: `saampath/2`

Records contain finite serializable numbers in the part frame (mm, seconds, mm3). Tables use opaque nonempty string IDs, stable within one Bundle path identity; they never encode surface JSON.
The source contains `curves`, `layers`, `surfaces`, `processes`, `operations`, `planning`, `summary`, and optional provenance/generator metadata.

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
  Travel can omit width, normal and material, but always supplies pose and speed.
- Material has one authority: `{kind:'area',areaMm2:profile}` integrates nonnegative area against arc length;
  `{kind:'cumulative',interpolation:'monotone',knots:[[u,totalMm3],...]}` retains every stored total and interpolates monotone C1 volume. Omitted interpolation retains older linear meaning.
  One prepared law supplies point rates, interval bounds and stable local integration; never subtract nearly equal evaluated totals. Local area is dV/ds.
  Positive volume on zero length or unbounded density is invalid. No separate height or segment-volume authority.
- A layer is `{stackId,index,surfaceId}`: Slice's actual native identity and order,
  including adjusted shared-material layers. `surfaces` holds the producer's
  admitted Geometry reference records once. Neither index nor rank means world Z.
  Trace without a native slice has `layerId:null`; do not invent one by height.
- A moving operation is `{id,kind:'deposit',layerId,processId,filament,after,
  interruptible,courses,...}`. Each course is `{id,curveId,from,to,interruptible,
  role?,provenance?,after?,orderGroup?,directionRequired?,seamRequired?}`, with `0 <= from < to <= 1`. Course IDs are source-wide unique.
  Each whole course is initially one scheduling unit; vertices and profile keys
  do not create execution boundaries. Curves/profile data are referenced, never copied into refinements.
  `processes` deduplicates the existing resolved process records; `planning`
  retains its existing defaults, explicit start and motion settings.
- Operation `after` names whole source operations; course `after` names source-wide courses.
  Every predecessor must finish before its successor starts. Construction lowers local curve names, including parallel expansions, to these IDs. These are unbreakable manufacturing requirements, never convenience or travel choices.
  Consecutive courses sharing `orderGroup` form a soft traversal chunk; internal requirements constrain its permitted traversals and survive splitting. Slice retains uninterrupted fill cells; splits/merges end cells. Scheduling chooses entry, reversal and travel, and may split an implicated chunk for physical or required dependencies. Group names impose no hard precedence.
  `interruptible:false` makes an operation or course atomic. Otherwise pieces may interleave/reorder subject to physical/declared constraints. `directionRequired:false` permits reversal; `seamRequired:false` permits cyclic entry changes on interruptible closed courses. Material and poses retain their source locations. A required seam stays first even after refinement. Ordinary Slice frees direction/seam; causal fronts and Trace preserve them. Atomic/continuous operations retain their authored traversal.
- A stationary operation has `kind:'inject'`, no courses, and
  `injection:{at,pose,volumeMm3,flowMm3S,holdSeconds}`. Existing `requiredMaterial`,
  occupied geometry, process selection, scoped `nozzleC`/`restoreNozzleC` and
  source-part provenance retain their meanings. Injection is atomic.

## Stored execution: `saam-schedule/1`

`schedulePath(deposition,{sourcePathId,onProgress?})` consumes admitted source and
returns `{schema:'saam-schedule/1',sourcePathId,initialPosition,initialPose,
motionCurves,execution,summary,completion}`. It performs no Bundle I/O.
Bundle supplies the exact source identity, saves source and schedule separately, and joins them for readers as `{sourcePathId,deposition,schedule}`. Identity mismatch is an error; editing source invalidates its schedule and checked program.

`execution` is ordered data. `{kind:'deposit',courseId,from,to,reverse?}` references a source subset; bounds stay increasing, and `reverse:true` traverses from `to` to `from` with positive material. `{kind:'travel',curveId,from,to,durationSeconds?}`
references `motionCurves`, using the same curve/profile representation.
`{kind:'inject',operationId}` references its source injection. Fan, temperature,
toolChange, retract, recover, dwell and context retain their current action fields
and delta semantics. Context labels source operations, layers and provenance; it cannot override material or pose profiles. Travel has zero deposited volume.
Optional travel duration preserves timed rotation; otherwise machine rate applies. Each moving source course is covered exactly once, without gaps or duplicated volume; scheduler cuts coalesce or move within print resolution and all contacts are re-solved; each injection executes once. A failed solve produces a finding, never
a partially successful schedule or unchecked fallback motion.

## Shared numerical reader

Toolpath owns `core/path/curve-path.mjs`, with these exports. All queries are deterministic; a prepared handle can memoize privately without mutating source.

| Export | Result and semantics |
|---|---|
| `prepareCurvePath({curves})` | Admitted curve-table/query handle (a source can be passed directly); no eager whole-path tessellation. |
| `curveAt(handle,curveId,u,{side='right'}={})` | `{point,tangent,pose,widthMm,speedMmS,materialNormal,areaMm2}`; absent travel channels stay absent; tangent is null only at a singularity/point. |
| `curveRange(handle,curveId,from,to,options={})` | Conservative `{bounds:{min,max},lengthMm:[lo,hi],volumeMm3:[lo,hi],widthMm:[lo,hi],areaMm2:[lo,hi],tangentCone,chordErrorMm,normalCone,poseCone,breaks}`. Missing travel channels stay absent. |
| `curveParameterAtLength(handle,curveId,from,to,distanceMm,{fromEnd=false,toleranceMm}={})` | Source parameter at physical distance, certified by Geometry; defaults to rounding accuracy. |
| `curveClosestParameter(handle,curveId,from,to,point,{toleranceMm}={})` | Source parameter nearest a point within the requested distance accuracy; Geometry owns projection/bounds. Geometry stays unchanged. |
| `curveSpans(handle,curveId,from,to,options)` | Lazy iterable of bounded local spans, each `{from,to,start,end,range}`; endpoints are `curveAt` records, range is `curveRange`. |
| `linearizePath(view,options)` | Lazy existing-style contextual action stream from the joined path, for consumers needing segments. Never the persisted authority. |

`tangentCone` and `normalCone` are `{axis,halfAngleRad}`. The tangent cone encloses all regular forward tangents (full sphere when unproved; null for a point).
`chordErrorMm` bounds distance from the entire curve interval to its endpoint segment;
it does not assert that curve and chord share linear timing. `poseCone` is
`{reference,halfAngleRad}`, bounding full SO(3) frame deviation, including roll.
`breaks` lists interior vertices, knots and profile discontinuities. Position bounds include both endpoints; attribute bounds use the right limit at `from` and left limit at `to`. Overlapping bounds alone prove no collision.
`curveRange` options are optional positive `lengthToleranceMm` and `volumeToleranceMm3`. Without them it may return coarse certified bounds.
`curveSpans` and `linearizePath` require positive `positionToleranceMm`,
`orientationToleranceRad`, `volumeToleranceMm3`; these bound chord deviation,
full-frame deviation from endpoint interpolation, and total volume error over the
requested range/path. Source breaks remain queryable. Reverse views enumerate source spans backwards; each span retains increasing source bounds. Moving views may coalesce compatible coincident boundaries within tolerance, preserving source parameter coverage and total material; never emit a positive zero-length move.
Subdivision certifies convergent length/volume bounds; zero deposition stays exact.
Shared numerical shapes belong to Geometry; path/material semantics stay here. Query resolution never changes identity, profiles or accumulated material. Serialization never rounds cuts into gaps.
Geometry/profile/material knots are query information, not compulsory output moves. Physical arc-length tolerance governs nearby view boundaries and material placement; provenance cannot force microscopic extrusion. Unknown movement is a precision finding, not proof of a singularity.

## Scheduler obligations

Prove whole native slices before opening unresolved courses or source intervals; enclosing bounds never fill sparse material gaps. Skills supply manufacturing requirements and deposition geometry. Scheduling owns travel, entry and traversal. Connected courses and fill cells form temporary chunks; actual entry distance and internal transfers choose permitted traversals. A witnessed conflict splits a chunk or rejects an unsafe traversal, preserving mandatory requirements. Native layer order remains a relaxable choice.
Local substrate follows material normals; nozzle access follows explicit tool poses. Explicit process prerequisites, continuity, required material and layer cooling
remain constraints. Cadence is prepared material intent, not a substitute for
physical scheduling.

Printing, startup, transfers, reorientation, parking, temperature changes, cooling
and finishing share continuous nozzle-clearance checks against actual deposited
material. Geometry's shared nozzle uses a 60° included angle, 0.5 mm flat-tip diameter and flat-face reference-height bounds. Surface forgiveness is 0.1 mm while moving and zero for stationary Inject.
Deposited beads may overlap. Carriage, fixtures and automatic supports are outside this model. No world-axis entry, support, retreat or motion-speed assumption is valid.
Source material placement retains current semantics pending separate bead-geometry
unification. Refinement preserves material and poses, uses contact witnesses where
possible, and rejects proven impossibility; arbitrary subdivision budgets cannot
turn an unresolved case into success. Keep dependency graphs sparse; bounded caches retain queried reachability results and may evict without losing correctness.

## Work ownership and migration acceptance

One integrated workstream owns SP2 completion; there is no separate scheduler-task dependency. Scheduling owns ordering/execution, Toolpath owns publication/material/profile semantics, Bundle owns saved identity, and Geometry owns numerical shapes/frames. Keep these interfaces consolidated.
Source contract `saam-deposition/32` and completion `saam-neutral-motion/17` invalidate earlier generated paths for regeneration; exact saved programs remain readable. This document owns the seam. Numerical curve queries belong in Geometry.

New writers use compact source and execution only. Existing saved paths/programs remain readable through one centralized compatibility reader; regeneration is
required for current-contract scheduling. Preserve the exact reviewed/exported
snapshot. Remove superseded generation routes, duplicated samplers and expanded
persisted motion after their consumers migrate; do not maintain two live pipelines.
Verify native curves, faithful polyline fallback, varying material/poses, atomic
chains, injections, process changes and shared-material native layers. Report
source/schedule bytes separately, peak memory, CPU/wall time and refinement counts
on pinned real and individually authored adversarial examples, including multi-axis
versions. Independently verify continuous changing-pose motion; obtain human
visual review when useful. Compression alone is not evidence of faster scheduling.
Canonical bead/Studio geometry unification, shared-material redesign, map solving and thermal scoring are separate work. Full suites require local-note approval.

## Retained construction interfaces

[Finished surfaces](./finished-surface.mjs) publish nominal native shell identity,
material extent, coverage, boundary membership and source-operation dependencies.
`publishFinishedBoundary` returns a new result; `consumeFinishedSurface` binds a
matching component/chart. Sparse patterns never become continuous support sheets.
This does not add arbitrary chart unwrapping or reconstruct bead-textured surfaces.
Assemblies retain named native components; an assignment's `part` selects its owner.
[Spacing](./spacing.mjs) derives pitch from bead width times positive
`spacingFactor` (default 1), divided by fill density where applicable. Actual width
and normal gap determine material; overlap/spacing does not establish printability.
[Process controls](./process-controls.mjs) retain scoped temperature validation;
machine adapters own command semantics. Direct travel preserves pressure; routed
travel retracts. Debt retains amount/speed through interleaving; zero retract
prevents withdrawal. Cooling uses native layer identity. [Print lifecycle](../print/README.md) owns generation and review;
[Material regions](../region/README.md) owns claims, cadence and surface contact.
