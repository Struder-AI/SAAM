---
name: trace
description: Deposit along explicit XYZ, NURBS or surface UV curves with varying bead and process.
---

# Trace

Trace deposits curves stored in [geometry](../../GEOMETRY.md), separating spatial IDs from recipe settings on save. Inline curves remain accepted. Add `construction:"curves"` to `plan.slices.assignments` with `slice` or bulk edit: supply `id`, `curves`, common `part`, `filament`, `process` and `after`; [nozzle rules](../../core/print/USAGE.md#nozzle-selection) apply. [Slice](../slice/SKILL.md) covers solid regions.

Each curve has `closed` and XYZ `points`, `nurbs`, or surface `uv`; [line-text](../line-text/SKILL.md) compiles XYZ curves. Local `id` and `after:[ids]` declare required predecessors within each repetition, including every expanded parallel bead; missing predecessors fail. Helpers add these only for manufacturing needs; `orderGroup` instead marks consecutive curves as a soft traversal chunk. `directionRequired` and closed-loop `seamRequired` preserve essential authored constraints (Trace defaults true). Scheduling owns travel and optional traversal; [the path contract](../../core/path/README.md) owns these distinctions.

Scalar beadWidthMm, heightMm, speedMmS and flowMultiplier override process defaults. `vary` supplies increasing normalized-parameter `[t,value]` samples spanning 0–1 for those values. Unread fields, malformed profiles, width rules and non-positive widths are ignored and listed in `limitations`; repeated vertices are dropped, and collapsed curves print nothing.

`toolPose:null|{alignToSliceNormal:boolean}` derives optional pose from reference frames; field modulation can vary it. Trace does not accept authored pose samples. `widthRule` fits one or parallel paths to widthMm within beadRangeMm, with optional spacingFactor and initialNormal. Sleeve/mesh-roof creases use physical facet transitions; nonzero normal offsets join faces with tolerance-controlled round strips, retaining base UV and source parameter. Native-shell roofs use tolerance-controlled tessellation; disconnected heights stay separate. General offset folds are unresolved.

`repeat` translates by count/translation or selects named Slice indices with `{stack:referenceId,indices:null}` (all slices) or explicit indices. References use finalized source data; prerequisites must exist. Optional [modulation](../slice/SKILL.md#contact-poses-and-extensions) primarily adds visual effects; profiles express direct process variation.

## Generated layer curves

An extension can supply `source:{extension,assignment,parameters}` with `curves:[]` and `repeat:null`. Its manifest's `trace-source` factory receives the [shared engines](../AUTHORING.md) and returns `constructLayer({source,parameters})`, which synchronously returns `{curves,report}`. Trace reads those curves through its ordinary deposition route.

The source names a Slice assignment. Each callback receives its actual layer chart, material boundaries, resolved settings, process, width, pitch, wall inset, gap, component placement, perimeter fronts and solid/sparse fill masks. Trace inherits that layer's process and pose internally; explicit `process`, curve fields or `toolPose` can override them. Reference preparation imposes no host-material barrier; generated Trace shares the native slice, while declared and physical requirements determine execution. Empty source layers are counted skips; empty curves print nothing. A failed source excludes its Trace and reports the cause while other assignments regenerate. Static Trace inputs remain readable. `Toolpath.fillSliceRegion(region,{source,angleDeg,role})` returns ordinary solid rows on the inherited chart. `denseRegion` covers main fill at dense spacing; material-changing modulation invalidates that mask.

Extensions can also submit already mapped batches through `traceResult(assignment,{batches,process})` in [curves.mjs](../../core/print/curves.mjs). [Networks](../line-network/SKILL.md), [bridging](../bridging/SKILL.md) and [advanced vase](../advanced-vase-wall/SKILL.md) supply curves; Trace owns their deposition. Generation establishes no adhesion or strength.

## Ordered repetitions and declared contact

`sequence:true` chains all repetitions and preserves their internal order. `ordered:true` preserves each repetition's required internal order independently; `repetitionAfter:{name:[predecessors]}` adds only selected dependencies using `repetitionIds`. External `operationAfter:{repetition:[ids|{assignment}]}` binds a named/ordinal repetition to required operations or full producer completion; missing targets/producers fail. Helpers use the [Recipe interface](../AUTHORING.md). Curve `repetitions:[indices]` selects repeats. `maxExcursionMm` bounds each group's Z span; null imposes no ceiling.

A curve may declare `contact:{source:null,gapMm:null,sampleStepMm:0.1,referenceZMm:null}`. Null source uses available predecessors; a producer or operation ID narrows it. Null gap uses resolved bead height; null reference Z uses sampled curve points. Contact is checked vertically against positive-volume strands, with no inferred solid guide. Unsupported spans print as authored and appear in `limitations`. A down-and-up curve can declare `depositionAction:{kind:"press",depthMm}` within its bead height; polyline `segmentMetadata` retains identities through resampling and compaction.
