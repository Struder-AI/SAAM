---
name: stained-glass-deposition
description: Plan stained-glass-style artwork where continuous dark leading/caming lines define cells on a bed or placed substrate. Preserves connected line networks, uses contour/offset fill for thick lead, and treats machine export as future work until a deterministic generator exists.
metadata:
  saam-kind: task
---

# Stained glass deposition

Use this for stained-glass-style linework: acrylic overlays, Tree of Life
artwork, black leading/caming networks, and cell borders where continuous dark
lines define cells. Do not apply these assumptions to ordinary image deposition:
in general illustration, a pen stroke may taper, fade, or end without needing to
close or preserve a cell boundary.

This is currently a workflow/design skill, not a finished deterministic SAAM
printing pattern. It records manufacturing intent and review criteria for a
future operation. Do not claim executable stained-glass paths until a generator
or operation exists and its preview has been approved through the normal SAAM
loop.

## Geometry intent

Source-line continuity outranks local width classification. A line that is
continuous in the source artwork should remain continuous in the deposited part
even if local thresholding sees a narrow, faint, or bead-width-limited segment.
Width classification may add or remove neighboring beads, but it must not sever
the source line network.

Prefer these path classes when describing or prototyping the operation:

- `continuous_network`: the primary connected lead/caming network, often using a
  skeleton or medial-axis path for fine strokes.
- `fine_shared_line`: one shared bead where tracing both adjacent cell edges
  would make a border too thick.
- `edge_trace`: contour-following paths just inside visible cell boundaries.
- `offset_fill`: inward offset paths grown from preserved edges into thick black
  regions.
- `lifted_dry_return`: non-extruding return motion over already planned
  linework, using verified clearance.
- `raster_infill`: optional texture only inside an already traced thick region;
  never use raster strokes as visible cell perimeters.

Raster scanlines must not define cell edges. They make curves jagged and break
the stained-glass intent.

## Branches and dry returns

Stained-glass linework is often a graph. At branch intersections, preserve the
network first. A traversal may need to revisit a junction or branch to cover the
whole graph.

If the traversal backtracks over already deposited linework, classify that move
separately from new extrusion. For taped acrylic, glass, plastic, paper, or
other lightly fixtured substrates, dry returns should use a tiny Z lift or
another verified clearance strategy instead of dragging the nozzle across fresh
material. Dragging can bump a bead and shift the substrate registration.

## Substrate and preview

Before machine output, model the bed, printable area, substrate footprint,
thickness, tape/clamp margins, artwork scale, rotation, origin, and probe or
verification points. Probe points must stay on the substrate unless the height
difference between substrate and bare bed is explicitly modeled.

Preview the extracted or simplified lead network, path classes, lifted dry
returns, physical dimensions, placement, margins, and any proposed Z checks.
The preview should show the deposited linework, not merely the source image.

Exploratory previews, inspection-only G-code, or chat-derived experiments are
scratch evidence. They do not become SAAM project artifacts unless a human
explicitly promotes them into a fixture, example, generator test, or documented
milestone.

## Validation status

Concept only. No deterministic SAAM operation or physical print validation is
included with this skill yet. A future implementation should add a generator,
tests for continuity preservation and fine-border handling, preview fixtures,
and machine-specific export only through the normal post-processing layer.
