---
name: plastic-weld
description: Experimental. Rivets of molten plastic injected into blind shafts across layers, placed individually or staggered through a solid body.
---

# Plastic weld / injected rivets

For maker work read [MAKERS](../../MAKERS.md); for development start at
[BUILDERS.md](../../BUILDERS.md). Use the [shared print tools](../../core/print/USAGE.md)
and [standard parameter policy](../../MAKERS.md#standard-parameter-policy).

This skill prints a blind cavity, then injects molten plastic through its small
opening. The wider bottom basin anchors the resulting plug, while the shaft
crosses multiple printed layers. It is an experimental reinforcement technique:
the software specifies volume and motion, not measured pressure, fusion, seal
quality or strength. No physical result has been validated.

## Material and interoperability

Full-fill is the natural host. The shaft and basin are reserved through shared
planar material regions before walls and fill are generated. The bottom basin
narrows upward as a stepped cone; the shaft continues to the injection height.
The exterior CAD model remains the intended finished part. These temporary
process cavities are visible in the generated toolpath, not as permanent CAD holes.

For **planar-infill**, shared complementary solid masks add a solid envelope
around the entire cavity and a floor beneath it. Sparse lines are excluded from
that material. Ordinary sparse infill alone cannot contain an injection. The
envelope is a nominal planned seal, not proof of pressure-tight printed material.
Its reinforcement value inside an otherwise sparse body remains unmeasured.

Supported combinations:

- Native closed mesh and supported spline components, including translated
  assembly parts, imported STL, text and Gridfinity bodies.
- Full-fill and planar-infill in whole components or material regions. Global
  weld sites can cross region boundaries when the required solid host is continuous.
  Regional surface consumers can use the completed mouth after injection.
  For an unfinished cavity crossing a boundary, use ordinary contiguous flat
  bands; `lowerSurfaceFrom` still sees that cavity's deeper floor.
- Draped roofs, vase walls, thick lips, waves and supports can coexist elsewhere
  in the plan. The cavity itself must lie in solid planar material. Continuous or
  curved deposition crossing a cavity is rejected, rather than split silently.
- Existing composition ordering, travel, cooling, plan locking, CLI/MCP edits,
  Studio review and exact-byte delivery. Higher operations wait for injection.
- S5 Griffin and experimental H2D output. The robot relay exporters cannot yet
  represent metered stationary extrusion or nozzle-temperature changes; they
  reject this skill.

The skill does not insert arbitrary holes into a one-bead vase wall, infer
pressure-tightness from spaced fill, or turn supports into permanent rivets.
The same feature can occupy a solid base beneath a vase or a solid band beneath
a curved roof. Required solid masks use the existing full-fill spacing setting;
use factor 1 so their envelope does not become sparse.

## Recipe and initial trial values

Enable global `skills.plastic-weld.enabled`, then supply `sites`. Each site has
exactly `id`, `part`, `xMm`, `yMm`, `zBottomMm`, `zTopMm`. `part` is null for one
component or its assembly ID. XY is in that component's model coordinates before
assembly and print placement. Z is relative to the component's minimum Z.
Bottom, opening and floor start align with its normal planar layer grid.

For an ordinary 0.4 mm nozzle and 0.2 mm layers, begin with these **untested**
values and adjust after a small coupon trial:

| Setting | Default | Meaning |
|---|---:|---|
| `shaftDiameterMm` | 1.2 | Small vertical injection passage |
| `basinDiameterMm` | 3 | Wider anchor at the cavity bottom |
| `basinHeightMm` | 1.2 | Upward taper from basin to shaft |
| `wallMm` | 1.2 | Required solid material outside the cavity; infill gets a full cylindrical envelope |
| `floorMm` | 0.8 | Solid floor below the blind cavity |
| `seatDepthMm` | 0 | Nozzle tip at the opening plane; adjustable 0–0.5 mm insertion |
| `volumeFactor` | 1 | Multiplier on the reserved, stepped cavity volume |
| `flowMm3S` | 0.5 | Injection flow, capped by the normal process flow limit |
| `holdSeconds` | 1 | Stationary hold after injecting, before withdrawal |
| `nozzleC` | null | Use normal temperature; a numeric value requests an operation temperature |

Example site in a body at least 6 mm tall:

```json
{
  "id": "anchor",
  "part": null,
  "xMm": 7,
  "yMm": 8,
  "zBottomMm": 0.8,
  "zTopMm": 4.8
}
```

The default depth is specified by those site heights: 4 mm. Nozzle seating is a
position command, not force control. Confirm the tip geometry can seat over the
chosen shaft; increasing insertion can collide with or deform the mouth. The
metered amount does not subtract unknown nozzle displacement; tune volume factor
with any seat-depth change. Trapped air, leakage, pressure, cooling and adhesion
must be assessed in the physical trial. More temperature is not assumed better.

Temperatures stay within the locked machine/material ranges. A temperature
override parks at clearance, emits the existing dialect's `M109 S` request,
approaches and injects, then withdraws and restores the ordinary setpoint. Firmware
heating/cooling waits are not thermally simulated; elapsed preview time excludes
them. No override changes the machine profile or another skill's settings.

## Individual points and staggered heights

Choose explicit points where the reinforcement is wanted. To distribute points,
the authoring helper `staggeredWeldSites` in [weld.mjs](scripts/weld.mjs) returns
ordinary site records. For example:

```js
staggeredWeldSites({columns: 2, rows: 2, levels: 2,
  pitchMm: 12, heightStepMm: 3, depthMm: 4,
  xMm: 4, yMm: 4, zBottomMm: 0.8, part: null})
```

Alternating levels shift half a pitch in X. With these values, successive 4 mm
depths overlap in height by 1 mm while their cavities remain separate. This
distributes reinforcement through the part; it does not claim intersecting rivet
columns or measured whole-part strength. Keep overlapping-height envelope centers
at least `basinDiameterMm + 2*wallMm` apart. The helper defaults to 12 mm pitch;
overlapping staggered levels need at least 10.8 mm pitch with these diameters.
At most 256 sites are accepted. Check that the chosen grid fits the body.

## Generate, review and adjust

Use the normal recipe template, `create_print`/CLI `init`, and
`adjust_print`/CLI `adjust`; no separate weld command or artifact format exists.
Disable draped-skin in a plain coupon recipe. For a reproducible unapproved trial:

```sh
node skills/plastic-weld/scripts/example.mjs Prints/plastic-weld-trial
node core/print/cli.mjs demo Prints/plastic-weld-trial
node studio/server.mjs Prints/plastic-weld-trial
```

The example creates a 24 × 16 × 9 mm solid coupon with two staggered rivets. Add
`--sparse` to its creation command for the sealed-envelope infill variant. Creation
refuses an existing destination. Development generation creates no human approval.

In Studio, inspect the empty basin and shaft before each weld layer, the solid
floor and envelope, then the stationary injection marker. The marker shows the
source-decoded volume and temperature during injection. It does not simulate
molten flow or display an invented filled shape. Review nozzle entry/withdrawal
and later cover layers before the normal toolpath confirmation and delivery.

If enclosure fails, move the site farther inside the solid, thicken its host,
or assign a solid region; do not accept a leak into sparse cells. If an operation
crosses the pocket, move it or change the region assignment. For conflicting
dependencies, inspect the atomic operation and injection height: a continuous
path cannot be interrupted mid-operation. Test modest coupons and adjust the
dimensions, seating, volume, flow and temperature using observed results.

For developer callers, `plasticWeldResult({plan, sites, modelResults})` returns
`{result, dependencyChanges}`; `result` is null when there are no sites.
It does not modify the supplied model operations. Cover prerequisites are
`{operationId, after, mode: 'union'}` records: apply them with
`applyResultDependencies` from `core/print/generate.mjs` before adding the weld
result and scheduling. Union preserves first occurrence order while removing
duplicate prerequisites, including duplicates already present on the operation.
