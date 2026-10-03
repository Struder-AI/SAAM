---
name: trace
description: Deposit along explicit XYZ, NURBS or surface UV curves with varying bead and process.
---

# Trace

Trace deposits along curves stored in [geometry](../../GEOMETRY.md); its recipe references each curve by stable `geometry` ID and owns deposition settings. [Slice](../slice/SKILL.md) covers solid regions.
Inline curve inputs below remain accepted: saving separates their spatial definitions from the recipe. Extensions also supply generated curves through `traceResult(assignment, {courses, process})` in [curves.mjs](../../core/print/curves.mjs).

Use the existing `slice` editing tool, or the same bulk recipe edit, to add a
`construction: "curves"` record in `plan.slices.assignments`; no separate controller.
Supply `id`, `curves`, and common `part`, `filament`, `process`, `after` settings as needed; [print nozzle rules](../../core/print/USAGE.md#nozzle-selection) apply.

Each curve has `closed` and exactly one source: XYZ `points`; `nurbs` with degree,
knots, controlPoints and optional weights; or `uv` with a named slice/sleeve/patch
reference and UV points or NURBS. The [line-text](../line-text/SKILL.md)
extension compiles lettering into explicit XYZ curves.

Scalar beadWidthMm, heightMm, speedMmS and flowMultiplier override process
defaults. `vary` provides increasing normalized-parameter `[t,value]` samples
spanning 0–1 for those values. Pose is optional derived Slice output, with field
modulation; Trace does not accept hand-authored pose samples. `widthRule` fits one or parallel real paths to widthMm
within beadRangeMm, with optional spacingFactor and initialNormal for spatial
frames. Sleeve/mesh-roof creases use physical facet transitions; nonzero normal
offsets join faces with tolerance-controlled round strips while retaining base UV
and source parameter. Native-shell roofs use tolerance-controlled tessellation;
disconnected roof heights remain separate. General offset folds are unresolved.

`repeat` translates a curve set by count/translation or selects indices from a
named slice family. Surface references and family repetition use finalized
source data; dependencies must exist. Optional [modulation](../slice/SKILL.md#modulation)
primarily adds visual/surface effects; the profiles above directly express process variation.

[Networks](../line-network/SKILL.md) and [bridging](../bridging/SKILL.md) supply curves.
[Advanced vase](../advanced-vase-wall/SKILL.md) owns sleeve fitting and pattern repetition;
Trace receives its resolved curves. Generation establishes no adhesion or strength.

## Ordered courses and declared contact

`sequence:true` finalizes each repeated course before constructing the next;
`courseIds` may name each course. Optional `maxExcursionMm` is an authored
per-course Z-span bound; null (the default) imposes no ceiling. Curves use `courses:[indices]` to select them.
A curve may require supporting material with
`contact:{source:null,gapMm:null,sampleStepMm:0.1,referenceZMm:null}`. Null source
uses available predecessors; a producer or operation ID narrows it. Null gap
uses the resolved bead height; null reference Z uses each sampled curve point.
Contact is checked vertically against positive-volume strands, not inferred
from a solid guide. No enclosing solid is required.

A down-and-up curve can declare `depositionAction:{kind:"press",depthMm}` within its bead height.
Polyline `segmentMetadata` retains segment identities through resampling and compaction.
