---
name: line-text
description: Make printable single-line lettering as explicit Trace centerlines.
metadata:
  saam-kind: extension
---

# Single-line text

[Call `line-text`](../../core/print/USAGE.md#command-line) to add,
replace or remove lettering in a print. Each centerline receives one bead;
glyph coverage, excessive stroke weight and filled counters are reported.
The saved ordinary Trace curves regenerate without this extension.

```json
{"id":"label","fontId":"hershey-sans-1","text":"SAAM","heightMm":6,
 "beadRangeMm":[0.35,0.5],"origin":[10,10,0.2],"layers":2,"layerMm":0.2}
```

Use a [bundled font](scripts/fonts/README.md). The same `id` replaces lettering;
`{"id":"label","remove":true}` removes it. XYZ `origin` is relative to recipe
placement. Optional `weight` (`light`, `regular`, `bold`) or numeric `stemRatio`
sets stroke weight. `letterSpacingMm`, `align` (`left`, `center`, `right`),
`chain`, and `onInfeasible` (`reduce`, `error`) tune layout. Defaults are two
0.2 mm layers starting at `origin.z`.

Parallel beads require a builder to modify the local extension's
[planner](scripts/plan.mjs) and [compiler](scripts/compile.mjs); no parallel
switch or automatic changeover ships. Preserve font licenses when sharing.
Older Trace `curve.text` recipes need explicit reauthoring with their former
text, font, height and origin, followed by regeneration and review.
