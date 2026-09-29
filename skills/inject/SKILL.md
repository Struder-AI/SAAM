---
name: inject
description: Meter stationary material at authored points, with explicit volume, flow, vertical approach and hold, through the shared recipe or slice editor.
---

# Inject

Inject deposits at a point; [trace](../trace/SKILL.md) deposits along a curve.
Points-only bundles omit `geometry`. Use `slice` or `adjust_recipe` for `plan.slices`
assignment: `{id:"spot",construction:"inject",points:[{point:[5,5,2],volumeMm3:1,flowMm3S:.5,approachMm:1,holdSeconds:2}]}`.
The editor fills `filament:null`, `process:null`, `nozzleC:null`, empty
`dependencies:{afterParts:[],beforeParts:[],after:[]}` and `description:""`.
XYZ follows authored traces: add recipe XY placement; no component transform.
Each point executes in list order: descend without deposition from `approachMm`
above it, extrude for volume/flow seconds, then hold. Dependencies name part
prerequisites or exact operation IDs; injection IDs are `assignmentId:index`.

Select a filament/material, override common process values (including fan), or
set an operation `nozzleC` restored afterward. Bounds, temperature and material
flow limits apply. Stationary injection requires a supported filament-axis
G-code output; robot outputs reject it. World-frame flow modulation scales volume
and rate together, retaining extrusion duration and hold; moving-path channels
reject stationary points. Approach strokes carry zero material and no effects.
No occupied support shape follows from volume alone. [Plastic-weld](../plastic-weld/SKILL.md)
uses this same operation with cavity geometry, enclosure checks and cover dependencies.
