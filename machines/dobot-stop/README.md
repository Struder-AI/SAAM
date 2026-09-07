# dobot_stop

An experimental Dobot MG400 machine variant for a tool that can stop and
restart extrusion between strokes. Its registry id is `dobot-stop` (machine
ids use hyphens); its display name is `dobot_stop`.

The shared Dobot translator uses `L` for print strokes and `J` for travel,
turning the relay off before each travel and on before the next print
stroke. Explicit travel paths, including Z hops, are followed point for
point. Unplanned gaps still produce a `disjoint-transition` warning.

`instanceProfile.extrusionTiming.onDwellMs` and `offDwellMs` default to zero
for this variant. They are non-negative milliseconds. Zero assumes immediate
tool response; it is a software configuration, not evidence that a physical
extruder can do this. Positive on-dwell values hold still with extrusion on
and are reported by the Lua trace checks. The original reference Dobot keeps
its one continuous extrusion window and existing 4000/500 ms dwells.

Use `settings.travelHopHeight` while generating the plan. Hops must exist
in the reviewed plan; the exporter cannot add them after approval. The new
variant remains **EXPERIMENTAL** until separately evidenced on hardware.
