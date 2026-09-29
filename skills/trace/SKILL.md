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
`part`, `filament`, `process`, `after` settings as needed.

Each curve has `closed` and exactly one source: XYZ `points`; `nurbs` with degree,
knots, controlPoints and optional weights; `uv` with a named slice/sleeve/patch
reference and UV points or NURBS; or `text` with fontId, text, heightMm,
beadRangeMm and origin. Line text becomes actual glyph curves, not solid geometry.

Scalar beadWidthMm, heightMm, speedMmS and flowMultiplier override process
defaults. `vary` provides increasing normalized-parameter `[t,value]` samples
spanning 0–1 for those values or toolAxis, toolUp and rotaryDeg. Tool poses require
a compatible machine. `widthRule` fits one or parallel real paths to widthMm
within beadRangeMm, with optional spacingFactor and initialNormal for spatial
frames. Invalid or infeasible records report their cause.

`repeat` translates a curve set by count/translation or selects indices from a
named slice family. Surface references and family repetition use finalized
source data; dependencies must exist. Optional [modulation](../slice/SKILL.md#modulation)
primarily adds visual/surface effects; the profiles above directly express process variation.

Read [line networks](../line-network/SKILL.md) for sparse frame construction and
[bridging](../bridging/SKILL.md) for explicitly supported spans. Trace alone does
not establish adhesion, junction strength or unsupported-span feasibility.
