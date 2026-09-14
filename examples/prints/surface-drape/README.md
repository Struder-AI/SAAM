# Rolling hills — surface drape

A 60 × 45 mm body has a bivariate spline roof, conventional walls, gyroid infill,
solid bottom/top regions and three surface-following skin layers. Its 7 × 5
control net creates variation in both directions.

```sh
node studio/server.mjs
```

Choose this example from the tour. Your copy is saved automatically.

Ask the agent to compare the curved skin with ordinary planar top layers, turn
the stroke direction by 90 degrees, or change the roof heights. Compare geometry,
material ownership and the actual toolpath after each edit. The same skin consumes
the shared height/normal interface for supported mesh roofs as well as splines.

[recipe.mjs](recipe.mjs) reproduces the selected Rolling Hills design using the
current S5 defaults. [Draped skin](../../../skills/draped-skin/SKILL.md) owns slope,
coverage and thickness limits. Excluded steep areas are reported; this demo does
not establish physical nozzle clearance or a successful print.
