---
name: inject
description: Deposit at points, authored directly or supplied by skills, with explicit volume, flow, vertical approach and hold.
---

# Inject

Inject deposits at points stored in [geometry](../../GEOMETRY.md); [Trace](../trace/SKILL.md) follows curves. Recipe point records use `geometry:"point-id"` plus volume, flow, approach and hold.
Inline authoring remains accepted: `slice`/`adjust_recipe` can supply `{id:"spot",construction:"inject",points:[{point:[5,5,2],volumeMm3:1,flowMm3S:.5,approachMm:1,holdSeconds:2}]}`; saving moves XYZ into geometry with a stable ID.
Defaults: `part:null`, `filament:null`, `process:null`, `nozzleC:null`, `dependencies:{afterParts:[],beforeParts:[],after:[]}`, `description:""`.
XYZ follows authored traces: add recipe XY placement; no component transform.
Each point executes in list order: descend without deposition from `approachMm`
above it, extrude for volume/flow seconds, then hold. Dependencies name part
prerequisites or exact operation IDs; injection IDs are `assignmentId:index`.

Inherit [print/part nozzle selection](../../core/print/USAGE.md#nozzle-selection), override common process values (including fan), or
set an operation `nozzleC` restored afterward. The temperature ceiling applies.
Stationary injection requires a supported filament-axis
G-code output; robot outputs reject it. World-frame flow modulation scales volume
and rate together, retaining extrusion duration and hold; moving-path channels
reject stationary points. Approach strokes carry zero material and no effects.
No occupied support shape follows from volume alone. [Plastic-weld](../plastic-weld/SKILL.md)
uses this same operation with cavity geometry, enclosure checks and cover dependencies.
