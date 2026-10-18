---
name: slice-surface-animation
description: Native SAAM toolpaths in a Studio-framed onboarding movie.
metadata:
  saam-kind: workspace
---
# Slice showcase
Run `node examples/presentations/generate-slice-surface.mjs` in a source checkout.
An optional output-index path selects a fresh cache directory; the next argument
sets worker count (default 8). Copy its generated `extension` to the SAAM home's
`local/extensions/slice-surface-animation`, then open that workspace through SAAM.

The 80-second sequence includes planar parameters, alternating layers, native
gyroid density transitions, tilts/waves, cladding, a ruled bridge and both returns.
Outlines and loops switch instantly; shape precedes fill changes. Cube frames use a widely spaced ordinary stack. Finite surface frames supply
one prepared region to the same native Slice bead and connector finalization.
No custom infill algorithm or toolpath drawing is used. Rendering modules are
unchanged Studio source copies with SHA-256 provenance; display skips only
sub-rounding segments. Manufacturing scheduling is outside this media workflow.

The workspace streams frames, plays/scrubs, saves PNGs and exports caption-free,
silent 1080p/30 fps WebM through Studio's movie encoder, including its final hold.
