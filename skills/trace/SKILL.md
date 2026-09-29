---
name: trace
description: Deposit authored curves, NURBS, surface UV paths and line text, with varying bead dimensions, process and tool pose; no filled solid is inferred.
---

# Trace

Trace follows authored centerlines. Use it for sparse networks, line lettering,
surface paths and explicit reinforcement. [Slice](../slice/SKILL.md) derives loops
and fill from owned material; [text](../text/SKILL.md) makes solid lettering.

Use the existing `slice` editing tool, or the same bulk recipe edit, to add a
`construction: "curves"` record in `plan.slices.assignments`. The skill distinction
does not create another controller or tool. Supply `id`, `curves`, and common
`filament`, `process`, `after` settings as needed.

Each curve has `closed` and exactly one source: XYZ `points`; `nurbs` with degree,
knots, controlPoints and optional weights; `uv` with a named slice/sleeve/patch
reference and UV points or NURBS; or `text` with fontId, text, heightMm,
beadRangeMm and origin. Line text becomes actual glyph curves, not solid geometry.

Scalar beadWidthMm, heightMm, speedMmS and flowMultiplier override process
defaults. `vary` provides increasing normalized-parameter `[t,value]` samples
spanning 0–1 for those values or toolAxis, toolUp and rotaryDeg. Tool poses require
a compatible machine. `widthRule` fits one or parallel real paths to widthMm
within beadRangeMm, with optional spacingFactor and initialNormal for spatial
frames. Sleeve/mesh-roof creases use physical facet transitions; nonzero normal
offsets join faces with tolerance-controlled round strips while retaining base UV
and source parameter. Native-shell roof bands remain unfinished (facet artifacts);
use a native patch or spline height-field reference. General offset folds are unresolved.

`repeat` translates a curve set by count/translation or selects indices from a
named slice family. Surface references and family repetition use finalized
source data; dependencies must exist. Optional [modulation](../slice/SKILL.md#modulation)
primarily adds visual/surface effects; the profiles above directly express process variation.

[Line networks](../line-network/SKILL.md) and [bridging](../bridging/SKILL.md) describe
their constructions; generation alone establishes no physical adhesion or strength.
