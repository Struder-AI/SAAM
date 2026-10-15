---
name: trace
description: Deposit along explicit XYZ, NURBS or surface UV curves with varying bead and process.
---

# Trace

Trace deposits along curves stored in [geometry](../../GEOMETRY.md); its recipe references stable `geometry` IDs and owns deposition settings. Inline curves remain accepted: saving separates their spatial definitions from deposition. [Slice](../slice/SKILL.md) covers solid regions.

Add `construction:"curves"` to `plan.slices.assignments` with the existing `slice` tool or bulk recipe edit. Supply `id`, `curves`, and common `part`, `filament`, `process`, `after` settings; [print nozzle rules](../../core/print/USAGE.md#nozzle-selection) apply.

Each curve has `closed` and one source: XYZ `points`; `nurbs` with degree, knots, controlPoints and optional weights; or `uv` with a named slice/sleeve/patch reference and UV points or NURBS. [Line-text](../line-text/SKILL.md) compiles explicit XYZ curves.

Scalar beadWidthMm, heightMm, speedMmS and flowMultiplier override process defaults. `vary` supplies increasing normalized-parameter `[t,value]` samples spanning 0–1 for those values. Unread fields, malformed profiles, width rules and non-positive widths are ignored and listed in `limitations`; repeated vertices are dropped, and collapsed curves print nothing.

`toolPose:null|{alignToSliceNormal:boolean}` derives optional pose from reference frames; field modulation can vary it. Trace does not accept authored pose samples. `widthRule` fits one or parallel paths to widthMm within beadRangeMm, with optional spacingFactor and initialNormal. Sleeve/mesh-roof creases use physical facet transitions; nonzero normal offsets join faces with tolerance-controlled round strips, retaining base UV and source parameter. Native-shell roofs use tolerance-controlled tessellation; disconnected heights stay separate. General offset folds are unresolved.

`repeat` translates by count/translation or selects named Slice indices with `{stack:referenceId,indices:null}` (all slices) or explicit indices. References use finalized source data; prerequisites must exist. Optional [modulation](../slice/SKILL.md#contact-poses-and-extensions) primarily adds visual effects; profiles express direct process variation.

## Generated layer curves

An extension can supply `source:{extension,assignment,parameters}` with `curves:[]` and `repeat:null`. Its manifest's `trace-source` factory receives the [shared engines](../AUTHORING.md) and returns `constructLayer({source,parameters})`, which synchronously returns `{curves,report}`. Trace reads those curves through its ordinary deposition route.

The source names a Slice assignment. Each callback receives its actual layer chart, material boundaries, resolved settings, process, width, pitch, wall inset, gap, component placement, perimeter fronts and solid/sparse fill masks. Trace inherits that layer's process and pose internally; explicit `process`, curve fields or `toolPose` can override them. Dependencies run source layer → generated Trace → next source layer. Empty source layers are counted skips; empty curves print nothing. A failed source excludes its Trace and reports the cause while other assignments regenerate. Static Trace inputs remain readable. `Toolpath.fillSliceRegion(region,{source,angleDeg,role})` returns ordinary solid rows on the inherited chart. `denseRegion` covers main fill at dense spacing; material-changing modulation invalidates that mask.

Extensions can also submit already mapped batches through `traceResult(assignment,{batches,process})` in [curves.mjs](../../core/print/curves.mjs). [Networks](../line-network/SKILL.md), [bridging](../bridging/SKILL.md) and [advanced vase](../advanced-vase-wall/SKILL.md) supply curves; Trace owns their deposition. Generation establishes no adhesion or strength.

## Ordered repetitions and declared contact

`sequence:true` finalizes each static repetition before constructing the next. `repetitionIds` names repetitions; curve `repetitions:[indices]` selects them. `maxExcursionMm` bounds each group's Z span; null imposes no ceiling.

A curve may declare `contact:{source:null,gapMm:null,sampleStepMm:0.1,referenceZMm:null}`. Null source uses available predecessors; a producer or operation ID narrows it. Null gap uses resolved bead height; null reference Z uses sampled curve points. Contact is checked vertically against positive-volume strands, with no inferred solid guide. Unsupported spans print as authored and appear in `limitations`.

A down-and-up curve can declare `depositionAction:{kind:"press",depthMm}` within its bead height. Polyline `segmentMetadata` retains identities through resampling and compaction.
