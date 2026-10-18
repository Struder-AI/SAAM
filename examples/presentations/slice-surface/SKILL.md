---
name: slice-surface-animation
description: Studio-framed slice, cladding and nonplanar bridge animation.
metadata:
  saam-kind: workspace
---
# Slice surface animation

From a source checkout run `node examples/presentations/generate-slice-surface.mjs`.
An optional first argument names an output index in a fresh directory. Preparation
writes native frames, bounded chunks and a portable `extension` beside that index.
Copy the extension to the SAAM home's `local/extensions/slice-surface-animation`,
then `saam call open_workspace --extension-id slice-surface-animation`.

The 79-second sequence varies planar density/loops, steps alternating layers,
morphs the infill field into gyroid and back, then tilts/waves a cube slice,
wraps dense axial cladding, returns, bridges two top edges, and returns again.
Cube slices use 960 mm spacing; cladding uses one normal-band layer; the bridge
uses one surface-domain layer. Native layout/mapping and scalar contours own
all paths; the gyroid transition blends fields. Save snapshots at its endpoints.

A real Studio-window capture uses its native camera/palette. Play/scrub, toggle
context/wash, save PNGs and export silent 1080p/30 fps WebM, without captions or printer programs.
