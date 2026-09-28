# Text: development

The [geometry reference](../../core/geom/README.md#text-and-solid-modifiers) owns
outline extraction, layout, surface mapping, tessellation and the solid kernel.
[text.mjs](scripts/text.mjs) owns the recipe; CLI and MCP call the same
implementation. [The tests](tests/text.test.mjs) cover software behaviour, not
physical lettering quality or machine clearance.

## Development examples

Use new, unused print directories. Neither creates human approvals.

```sh
node skills/text/scripts/demo.mjs Prints/text-review
node core/print/cli.mjs demo Prints/text-review
node skills/text/scripts/draped-demo.mjs Prints/draped-lettering SAAM
node studio/server.mjs Prints/draped-lettering
```

[demo.mjs](scripts/demo.mjs) builds raised and recessed flat labels, lettering on
a curved roof, and pipe lettering on an independent rational spline guide, with
the bundled Abel font; `cli.mjs demo` generates its development toolpath.
[draped-demo.mjs](scripts/draped-demo.mjs) builds the
[curved lettering composition](SKILL.md#curved-lettering-above-a-draped-roof) on
the example S5/PLA setup. Inspect geometry and deposition, especially narrow
strokes and counters.
