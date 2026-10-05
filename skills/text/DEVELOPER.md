# Text: development

The [geometry reference](../../core/geom/README.md#text-and-solid-modifiers) owns
outline extraction, layout, surface mapping, tessellation and the solid kernel.
[text.mjs](scripts/text.mjs) owns the recipe; `saam` and Studio call the same
implementation. [The tests](tests/text.test.mjs) cover software behaviour, not
physical lettering quality or machine clearance.

