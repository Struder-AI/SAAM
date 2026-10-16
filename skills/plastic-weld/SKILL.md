---
name: plastic-weld
description: Experimental. Rivets of molten plastic injected into blind shafts across layers, placed individually or staggered through a solid body.
metadata:
  saam-kind: extension
---

# Plastic weld / injected rivets

Follow [MAKERS](../../MAKERS.md), [shared print tools](../../core/print/USAGE.md)
and [parameter policy](../../MAKERS.md#standard-parameter-policy).
A blind shaft widens into a bottom basin and is filled through ordinary
[Inject](../inject/SKILL.md). Fusion, sealing and strength remain unvalidated.

## Geometry and material

The cavity is a Boolean difference in process geometry before Slice. Geometry's
[revolved profile and native Boolean](../../core/geom/README.md#native-boolean-construction)
retain rational surfaces for spline hosts and support any entry axis. Its full
cylindrical/conical profile determines injection volume, including any portion
outside the host; placement must provide an enclosed cavity. Finished CAD stays
unchanged because injection is intended to fill the cavity.
An ordinary solid volume supplies walls/floor in sparse hosts. Slice retains its
normal loops/fill/spacing; use spacingFactor 1 for a solid envelope. Geometric requirements select enclosing floor/wall beads in the cavity's frame;
Scheduling derives nozzle access, cover order and interruptible stroke portions.
Mesh/spline components and translated assemblies use the same interfaces.

## Recipe

Enable skills.plastic-weld.enabled. A site has exactly id, part, positionMm,
axis and depthMm: positionMm is the opening in component coordinates; axis points
inward and is normalized; depthMm follows that axis. Part is null or an assembly ID.
Legacy id/part/xMm/yMm/zBottomMm/zTopMm sites remain readable, with Z relative to
the component minimum. Placement retains authored dimensions without grid snapping.

| Setting | Default | Meaning |
|---|---:|---|
| shaftDiameterMm | 1.2 | Injection passage |
| basinDiameterMm | 3 | Bottom anchor diameter |
| basinHeightMm | 1.2 | Axial taper length |
| wallMm | 1.2 | Solid material around the cavity |
| floorMm | 0.8 | Solid material beyond its end |
| seatDepthMm | 0 | Nozzle insertion along the axis |
| volumeFactor | 1 | Multiplier on full profile volume |
| flowMm3S | 0.5 | Injection flow |
| holdSeconds | 1 | Hold before withdrawal |
| nozzleC | null | Normal temperature or explicit override |

```json
{"id":"anchor","part":null,"positionMm":[7,8,4.8],"axis":[0,0,-1],"depthMm":4}
```

Defaults are untested trial values for a 0.4 mm nozzle and 0.2 mm layers.
Insertion commands position rather than force; volume excludes nozzle displacement.
Temperature overrides use existing machine operations and restore the setpoint.
Export rejects unsupported extrusion/temperature/pose output. Review cavity,
envelope, injection and covering deposition in Studio before export; physical
trials must establish fit, flow, fusion and strength.

[staggeredWeldSites](scripts/runtime.mjs) returns editable vertical sites from
columns/rows/levels, pitchMm, heightStepMm and depthMm, with optional coordinates
and part. Alternate levels shift half a pitch in X.

## Builder boundary

Checkout plastic-weld with `extension_library`; edit its local runtime,
manifest/manual and regenerate through the [process-source contract](../AUTHORING.md).
It owns settings, finite cavity/profile/volume, solid envelope and Inject. Floor/wall
requirements exclude the empty cavity and touching cover; Scheduling owns access/order.
