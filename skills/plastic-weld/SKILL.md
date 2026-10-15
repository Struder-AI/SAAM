---
name: plastic-weld
description: Experimental. Rivets of molten plastic injected into blind shafts across layers, placed individually or staggered through a solid body.
metadata:
  saam-kind: extension
---

# Plastic weld / injected rivets

Use the [shared print tools](../../core/print/USAGE.md) and
[standard parameter policy](../../MAKERS.md#standard-parameter-policy).

The extension prepares a blind shaft with a wider bottom basin, then fills it
through its small opening using ordinary [Inject](../inject/SKILL.md). Fusion,
sealing and strength remain experimental; no physical result has been validated.

## Geometry and material

The cavity is a Boolean difference in the part's process geometry before Slice.
Its stepped polygonal profile defines both the removed volume and the injection
amount. The intended finished CAD remains unchanged: injection fills the cavity.
Studio shows the cavity in deposition and the stationary injection event.

An ordinary solid-material volume supplies the surrounding walls and floor,
including in sparse hosts. Slice uses its normal loops, fill and spacing settings;
keep spacingFactor at 1 for a solid envelope. A geometric requirement selects
its enclosing beads before injection; the scheduler derives nozzle access and
cover order from actual deposition. It does not certify sealing or fusion.

## Recipe

Enable skills.plastic-weld.enabled and supply sites. Each site contains exactly
id, part, xMm, yMm, zBottomMm and zTopMm. Part is null for one component or its
assembly ID. XY is in the component's model coordinates; Z is relative to its
minimum Z. Bottom and opening use its resolved layer grid, with moves noted.

| Setting | Default | Meaning |
|---|---:|---|
| shaftDiameterMm | 1.2 | Injection passage |
| basinDiameterMm | 3 | Bottom anchor diameter |
| basinHeightMm | 1.2 | Upward taper from basin to shaft |
| wallMm | 1.2 | Solid material outside the cavity |
| floorMm | 0.8 | Solid floor below the cavity |
| seatDepthMm | 0 | Nozzle-tip insertion below the opening |
| volumeFactor | 1 | Multiplier on prepared cavity volume |
| flowMm3S | 0.5 | Injection flow |
| holdSeconds | 1 | Hold after injecting, before withdrawal |
| nozzleC | null | Normal temperature; a number requests an override |

Example site in a body at least 6 mm tall:

```json
{"id":"anchor","part":null,"xMm":7,"yMm":8,"zBottomMm":0.8,"zTopMm":4.8}
```

These dimensions and defaults are untested initial trial values for a 0.4 mm
nozzle and 0.2 mm layers. Insertion is a position command, with depth remaining
inside the cavity; it is not force control. Metered volume does not subtract
nozzle displacement. Adjust volumeFactor when changing insertion depth.

Temperature overrides use machine service/approach operations and restore the
normal setpoint. Outputs lacking stationary extrusion/temperature reject at export.

## Authoring and review

Use create_bundle/adjust_recipe and review/export from Studio. Inspect the cavity,
solid host, injection position/amount and covers; trials must establish fit/fusion/strength.

The staggeredWeldSites helper in [runtime.mjs](scripts/runtime.mjs) returns
ordinary editable site records from columns, rows, levels, pitchMm, heightStepMm
and depthMm, with optional coordinates and part. Alternate levels shift half
a pitch in X; overlapping height intervals can remain spatially separate.

## Builder boundary

Checkout plastic-weld with `extension_library`; edit its local [runtime](scripts/runtime.mjs),
manifest/manual and regenerate through the [process-source contract](../AUTHORING.md).
It owns schema/defaults, validation, finite cavity/profile/volume, solid envelope and Inject.
Enclosure requirements stop just inside the mouth to exclude touching cover beads;
Scheduling owns access/order.
