# SAAMpath and scheduling

Contract **SP2, 2026-10-15** is the implementation target for 0.3.9, replacing the expanded-stroke/expanded-motion contract. This document owns the seam. It describes the target, not a claim that the migration has shipped.

## Ownership and pipeline

Geometry owns numerical shapes, evaluation and conservative geometric bounds. Material regions prepares ownership and interlock cadence before Toolpath.
Toolpath finalizes Slice/Trace/Inject geometry, connections, Modulation, material
and poses. Bundle stores that immutable source once. Scheduling orders source
ranges and adds checked transfers and process events. Studio and exporters read
the resulting path through the same numerical reader; exporters own machine axes.
No stage reconstructs slices from deposition or treats a layer surface as solid. Native curves survive when exact; arbitrary mapping or Modulation may instead
produce a faithful polyline. A spline fit is never compulsory or silently lossy.

## Stored deposition: `saampath/2`

All records are serializable finite numerical data, in the part frame, with mm, seconds and mm3 units. Tables are objects keyed by opaque nonempty string IDs.
IDs are stable within one Bundle path identity; they never encode surface JSON. The source contains `curves`, `layers`, `surfaces`, `processes`, `operations`,
`planning`, `summary`, and optional existing provenance/generator metadata.

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
- Keys strictly increase, include 0 and 1, and cover the domain. Step values are
  right-continuous except at 1; callers can request a knot's left limit.
  Deposition requires positive width and an explicit material normal. Toolpath
  resolves ordinary three-axis poses explicitly; `materialNormal` never implies pose.
  Travel can omit width, normal and material, but always supplies pose and speed.
- Material has exactly one authoritative form: `{kind:'area',areaMm2:profile}`
  integrates nonnegative area against arc length; or
  `{kind:'cumulative',knots:[[u,totalMm3],...]}` defines piecewise-linear cumulative
  volume, starting at zero and never decreasing. Range volume is its difference.
  The latter preserves existing per-edge volumes without repeated move records.
  Local area is dV/ds. Positive volume on zero length or unbounded density is invalid.
  No independently authoritative height or segment-volume array duplicates it.
- A layer is `{stackId,index,surfaceId}`: Slice's actual native identity and order,
  including adjusted shared-material layers. `surfaces` holds the producer's
  admitted Geometry reference records once. Neither index nor rank means world Z.
  Trace without a native slice has `layerId:null`; do not invent one by height.
- A moving operation is `{id,kind:'deposit',layerId,processId,filament,after,
  interruptible,courses,...}`. Each course is `{id,curveId,from,to,interruptible,
  role?,provenance?}`, with `0 <= from < to <= 1`. Course IDs are source-wide unique.
  Each whole course is initially one scheduling unit; vertices and profile keys
  do not create execution boundaries. Curves/profile data are referenced, never copied into refinements.
  `processes` deduplicates the existing resolved process records; `planning`
  retains its existing defaults, explicit start and motion settings.
- `after` names whole source operations. Each predecessor must finish before any
  of its successor executes. `interruptible:false` makes an operation, or course,
  atomic. Otherwise pieces may interleave/reorder, preserving each piece's forward
  direction and all physical/declared constraints. Splitting cannot relax an
  authored continuous chain; connected atomic chains belong to an atomic operation.
- A stationary operation has `kind:'inject'`, no courses, and
  `injection:{at,pose,volumeMm3,flowMm3S,holdSeconds}`. Existing `requiredMaterial`,
  occupied geometry, process selection, scoped `nozzleC`/`restoreNozzleC` and
  source-part provenance retain their meanings. Injection is atomic.

## Stored execution: `saam-schedule/1`

`schedulePath(deposition,{sourcePathId,onProgress?})` consumes admitted source and
returns `{schema:'saam-schedule/1',sourcePathId,initialPosition,initialPose,
motionCurves,execution,summary,completion}`. It performs no Bundle I/O.
Bundle supplies the exact source identity, saves source and schedule separately, and joins them for readers as `{sourcePathId,deposition,schedule}`. Identity mismatch is an error; editing source invalidates its schedule and checked program.

`execution` is ordered data. `{kind:'deposit',courseId,from,to}` references a
subset of that source course. `{kind:'travel',curveId,from,to,durationSeconds?}`
references `motionCurves`, using the same curve/profile representation.
`{kind:'inject',operationId}` references its source injection. Fan, temperature,
toolChange, retract, recover, dwell and context retain their current action fields
and delta semantics. Context labels source operations, layers and provenance; it cannot override material or pose profiles. Travel has zero deposited volume.
Optional travel duration preserves timed rotation; otherwise machine rate applies. Each moving source course is covered exactly once, with no gaps or duplicated
volume; each injection executes once. A failed solve produces a finding, never
a partially successful schedule or unchecked fallback motion.

## Shared numerical reader

Toolpath owns `core/path/curve-path.mjs`, with these exports. All queries are deterministic; a prepared handle can memoize privately without mutating source.

| Export | Result and semantics |
|---|---|
| `prepareCurvePath({curves})` | Admitted curve-table/query handle (a source can be passed directly); no eager whole-path tessellation. |
| `curveAt(handle,curveId,u,{side='right'}={})` | `{point,tangent,pose,widthMm,speedMmS,materialNormal,areaMm2}`; absent travel channels stay absent; tangent is null only at a singularity/point. |
| `curveRange(handle,curveId,from,to,options={})` | Conservative `{bounds:{min,max},lengthMm:[lo,hi],volumeMm3:[lo,hi],widthMm:[lo,hi],areaMm2:[lo,hi],tangentCone,chordErrorMm,normalCone,poseCone,breaks}`. Missing travel channels stay absent. |
| `curveSpans(handle,curveId,from,to,options)` | Lazy iterable of bounded local spans, each `{from,to,start,end,range}`; endpoints are `curveAt` records, range is `curveRange`. |
| `linearizePath(view,options)` | Lazy existing-style contextual action stream from the joined path, for consumers needing segments. Never the persisted authority. |

`tangentCone` and `normalCone` are `{axis,halfAngleRad}`. The tangent cone encloses
all regular forward tangents (full sphere when unproved; null for a point).
`chordErrorMm` bounds distance from the entire curve interval to its endpoint segment;
it does not assert that curve and chord share linear timing. `poseCone` is
`{reference,halfAngleRad}`, bounding full SO(3) frame deviation, including roll.
`breaks` contains interior vertices, knots and profile discontinuities. Bounds enclose the entire interval; overlapping bounds prove no collision by themselves.
`curveRange` options are optional positive `lengthToleranceMm` and `volumeToleranceMm3`. Without them it may return coarse certified bounds.
`curveSpans` and `linearizePath` require positive `positionToleranceMm`,
`orientationToleranceRad`, `volumeToleranceMm3`; these bound chord deviation,
full-frame deviation from endpoint interpolation, and total volume error over the
requested range/path. Intrinsic/profile breaks are retained. Subdivision tightens
bounds; sampling midpoint agreement alone is never a certificate. Length/volume
bounds must also converge. Zero deposition is represented exactly.
Shared numerical shape calculations delegate to Geometry; path/material semantics
stay here. Consumers can request different resolutions without changing identity,
profiles or accumulated material. Serialization never rounds range cuts into gaps.

## Scheduler obligations

Reason first about whole native slices, then courses, then source intervals. Derive conservative aggregate proofs before opening their children. Only unresolved
contacts/access conflicts require finer queries; envelopes never fill sparse gaps.
Local substrate follows material normals; nozzle access follows explicit tool poses. Explicit process prerequisites, continuity, required material and layer cooling
remain constraints. Cadence is prepared material intent, not a substitute for
physical scheduling. Reuse native slice records; do not slice the part again.

Printing, startup, transfers, reorientation, parking, temperature changes, cooling
and finishing share continuous nozzle-clearance checks against actual deposited
material. The nozzle is an effectively infinite sharp cone, 15-degree included
angle, with 0.1 mm surface forgiveness while moving and none for stationary Inject.
Deposited beads may overlap. Carriage, fixtures and automatic supports are outside
this model. No world-axis entry, support, retreat or motion-speed assumption is valid.
Source material placement retains current semantics pending separate bead-geometry
unification. Refinement preserves material and poses, uses contact witnesses where
possible, and rejects proven impossibility; arbitrary subdivision budgets cannot
turn an unresolved case into success. Bounded caches may evict without losing correctness.

## Work ownership and migration acceptance

The scheduler task owns `schedule.mjs`, `compose.mjs`, `course-order.mjs`,
`physical-order.mjs`, `precedence.mjs`, `planning.mjs`, `toolpath.mjs`, scheduling
diagnostics and `core/geom/convex-clearance.mjs`. The Toolpath/SAAMpath task owns
curve production/admission, `curve-path.mjs`, `saampath.mjs`, `dependencies.mjs`, the other Toolpath-owned path helpers,
Bundle joins and Studio/export/other consumer migrations. It updates the source
contract to `saam-deposition/22` and completion to `saam-neutral-motion/9` together.
Each task leaves the other's files alone. This document owns contract changes;
implementation difficulties requiring a changed seam must be raised explicitly.
The Toolpath task notifies the person before changing Geometry-bin capabilities;
numerical curve-query additions belong there, not hidden in Toolpath wrappers.

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
machine adapters own command semantics. Retraction debt retains amount/speed
through interleaving, zero retract prevents new withdrawal, and cooling uses native
layer identity. [Print lifecycle](../print/README.md) owns generation and review;
[Material regions](../region/README.md) owns claims, cadence and surface contact.
