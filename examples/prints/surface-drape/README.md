# Wavy roof — surface drape

A 100 × 60 mm body has a wavy spline roof, conventional walls, gyroid infill,
solid bottom/top regions and three surface-following skin layers. Its 7 × 5
control net combines transverse waves with a steady 6 mm fall toward Y=0.
Each valley leads downhill to that edge; physical water shedding is untested.

```sh
node studio/server.mjs
```

This is the second shape in the tour, after the handle/fin block. Your copy is
created from the recipe and saved automatically; toolpaths are generated later.

Ask the agent to compare the curved skin with ordinary planar top layers, turn
the stroke direction by 90 degrees, or change the roof heights. Compare geometry,
material ownership and the actual toolpath after each edit. The same skin consumes
the shared height/normal interface for supported mesh roofs as well as splines.

[recipe.mjs](recipe.mjs) reproduces the wavy roof using the
current S5 defaults. [Draped skin](../../../skills/draped-skin/SKILL.md) owns slope,
coverage and thickness limits. Excluded steep areas are reported; this demo does
not establish physical nozzle clearance or a successful print.
