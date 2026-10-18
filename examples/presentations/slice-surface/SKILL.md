---
name: slice-surface-animation
description: Presentation workspace showing a flat slice tilting and becoming a wavy spline surface.
metadata:
  saam-kind: workspace
---
# Slice surface animation

This is a presentation asset for developer onboarding. From a source checkout run
`node examples/presentations/generate-slice-surface.mjs`. It creates calculated
frames and a self-contained extension under `.local/presentations/slice-surface/extension`.
Use a fresh output directory when rebuilding changed source.
Copy that extension to the SAAM home's `local/extensions/slice-surface-animation`,
then `saam call open_workspace --extension-id slice-surface-animation`.

One cubic spline control net supplies a 20-second flat → tilted → wavy → curved
and tilted sequence. Ordinary Slice recipes use a 0.2 mm first gap and 960 mm
subsequent spacing, placing one slice through the 24 mm cube. Source preparation
uses SAAM's existing recipe, region and Slice layout/mapping functions. The
portable viewer consumes those calculated paths; it never interpolates vertices.

A capture of the actual Studio window surrounds the viewport; Studio supplies
its projection, background, grid and blue paths. Exports have no presentation captions.
Play/scrub, toggle context/wash, save PNGs, and export silent 1080p 30 fps WebM.
Preparation packages SAAM’s movie encoder. Frames illustrate slice construction.
