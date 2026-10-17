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
The saved Trace curves regenerate without this extension.

```json
{"id":"label","fontId":"hershey-sans-1","text":"SAAM","heightMm":6,
 "beadRangeMm":[0.35,0.5],"origin":[10,10,0.2],"layers":2,"layerMm":0.2}
```

Use [bundled fonts](scripts/fonts/README.md); for joined cursive choose
`hershey-script-1`, `ems-allure` (Allura) or `ems-swiss` (Italianno). Review actual
word joins and counters. The same `id` replaces text; `{"id":"label","remove":true}`
removes it. Recipe-local `origin` starts two 0.2 mm layers by default. `reference:{kind:'slice',assignment,index}` maps onto a manufactured slice and attaches its completion automatically; part/spline references provide geometry only. Optional `substrate` selects support independently of the chart.
`weight` (`light`, `regular`, `bold`) or numeric `stemRatio` sets stroke weight;
`letterSpacingMm`, `align` (`left`, `center`, `right`), `chain` and
`onInfeasible` (`reduce`, `error`) tune layout.
Parallel beads require a local builder edit to the [planner](scripts/plan.mjs)
and [compiler](scripts/compile.mjs); no parallel switch ships. Keep font licenses.
Reauthor retired Trace `curve.text` with its text, font, height and origin; regenerate and review.
