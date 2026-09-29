---
name: inject
description: Meter stationary extrusion by volume and flow, with optional hold; currently authored through the plastic-weld cavity recipe rather than a generic injection tool.
---

# Inject

Inject deposits a specified material volume while the nozzle remains at one
point. The shared stationary-extrusion core carries volumeMm3, flowMm3S and
holdSeconds; volume divided by flow gives extrusion duration. It is distinct
from [trace](../trace/SKILL.md), which deposits while following a curve.

The current public authoring route is the [plastic-weld](../plastic-weld/SKILL.md)
recipe: enable `skills.plastic-weld`, author its sites and cavity settings with
the shared recipe tools, then generate and review the complete host and injection
sequence. There is no generic injection-point tool or standalone injection
assignment. Plastic-weld adds host reservation, sealing material and dependencies;
the underlying stationary primitive alone makes none of those guarantees.

World-frame `flow` modulation applies to role `injection`, multiplying volume and
flow rate together so extrusion duration stays fixed. Hold time stays unchanged.
Moving-path channels or curve/slice frames on a stationary point report an error.
The selected material's flow limit and exporter support are checked. Metered
volume does not measure pressure, fusion or cavity sealing; physical qualification
remains necessary for the intended joint.
