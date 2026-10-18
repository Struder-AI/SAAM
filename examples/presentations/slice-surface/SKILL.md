---
name: slice-surface-animation
description: Native SAAM toolpaths in a Studio-framed onboarding movie.
metadata:
  saam-kind: workspace
---
# Slice showcase
Run `node examples/presentations/generate-slice-surface.mjs` in a source checkout.
An optional output-index path selects a fresh cache directory; the next argument
sets worker count (default 4). Copy its generated `extension` to the SAAM home's
`local/extensions/slice-surface-animation`, then open that workspace through SAAM.

Edit the timeline and splines in `design.mjs`. Pipe motion happens together with
both loops kept; fill changes follow. Bridge motion precedes fill and 2 → 1 → 0
loops; its return combines motion, fill and 0 → 1 → 2. Every frame runs a complete
Slice recipe, including gyroid. Studio rendering/encoding modules are unchanged
copies with SHA-256 provenance; the toolhead marker is hidden.
Manufacturing scheduling is outside this media workflow.

The workspace streams frames, plays/scrubs, saves PNGs and exports caption-free,
silent 1080p/30 fps WebM through Studio's movie encoder, including its final hold.
