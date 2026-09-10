---
name: dobot-non-planar-cladding
description: "Plan StruderBot non-planar cladding: printing a known AI-authored support scaffold, grid, frame, or mass-building path, then adding a coordinated XYZ surface skin over it. Use when the operator asks for non-planar printing, surface cladding, 3D top skins, ramp/dome/saddle surfaces, loose support grids with curved top surfaces, or multi-axis deposition tests that must start from manufacturing intent rather than STL/G-code slicing."
---

# Dobot Non-Planar Cladding

> **Imported legacy StruderBot manual.** This preserves robot-tested coupon
> evidence and transition lessons. Use SAAM's implemented `draped-skin` skill
> for current jobs; port any missing behavior through the shared pipeline
> before presenting it as executable SAAM capability.

## Overview

Use with `dobot-programmer`. Treat this as an AI-native deposition workflow,
not as a conventional slicer. The support structure below the surface is known
because Codex generated it; generate the 3D cladding path from that support
geometry and the operator's intended surface behavior.

## Core Mental Model

- Start from manufacturing intent: "make this scaffold, then clad it with this
  surface."
- Do not default to STL, G-code transformation, or flat-plane projection as the
  primary method.
- Use a heightfield or explicitly described surface while the geometry is
  simple:

```text
surface point = (x, y, z_surface(x, y))
```

- Define support contact intentionally. The cladding surface should know where
  support strands, ribs, walls, or nodes exist below it.
- Prefer small, inspectable coupons before arbitrary freeform surfaces.

## First Coupon Family

Default first tests to 40 mm square coupons unless the operator specifies
otherwise:

1. Print a loose planar support grid or scaffold.
2. Add one non-planar cladding surface over it.
3. Keep the surface shallow enough to avoid nozzle drag.
4. Preview top, front, right, and isometric views from the same path data.
5. Record support contact, sag, bead thinning, nozzle drag, blobs at turns, and
   adhesion.

Suggested early surfaces:

- `single_slope`: a ramp with a small Z rise over the 40 mm span.
- `dome`: a shallow convex heightfield.
- `saddle`: mixed positive/negative curvature.
- `arched_span`: a narrow cladding bead bridging between known supports.

## Generate The Support

Design the support before the cladding:

- Use planar or simple stepped support first.
- Keep the support sparse enough that the cladding test reveals span behavior,
  but dense enough that the surface has known contact opportunities.
- Record support line spacing, support line width, support Z, and intended
  contact points.
- If the support is a grid, decide whether the top cladding lines run parallel
  to one grid family, across both families, or diagonally across cells.

## Generate The Cladding

For simple coupons:

1. Define a bounded XY domain.
2. Define the surface function.
3. Generate an ordered 2D path directly from the intended bead layout.
4. Sample each point onto the surface.
5. Calculate true 3D segment length and local slope.
6. Reject segments that exceed the experimental slope limit.
7. Keep transitions supported, visible in preview, and deliberate.

Use modest segmentation. Do not create thousands of tiny `MovL` moves unless
the robot has already passed an extrusion-off motion test for that exact style.

## Motion And Flow

- Treat fixed Struder feed as a central constraint.
- Start with constant conservative robot speed for the first coupon so failure
  modes are easy to interpret.
- After a baseline, compensate robot speed by true 3D path length and desired
  bead volume. Slower motion deposits more material per millimeter; faster
  motion deposits less.
- Avoid retractions inside the cladding surface. Prefer one continuous
  extrusion window or intentional printed connectors.
- Keep CP/blending conservative until a motion-only test confirms that the path
  is smooth without cutting off intended contact.
- Treat every layer boundary as deposited geometry. With fixed extrusion, a
  dwell or exact-stop transition creates a visible blob even when the next
  non-planar stroke prints cleanly.
- Do not assume print-speed connectors remove controller dwell. The 40 mm,
  20 degree Y-slope coupon still paused visibly at some layer starts after
  jump-speed repositioning was removed.
- Next, derive tangent-continuous boundary transitions from the preceding path
  into the following layer. Avoid isolated vertical Z changes, abrupt speed
  changes, and polygonal rising loops whose vertices can become stop points.

## Collision And Drag Checks

Before Lua:

- Report maximum surface slope and maximum Z delta per move.
- Check whether the vertical nozzle or tool body could drag through previously
  printed material.
- Show where cladding lines cross unsupported cells.
- Check that lifted travel cannot strike the scaffold or fresh cladding.
- Use a dry or safe-height motion pass for the first non-planar path style.

## Evidence

Use evidence labels from `docs/ROBOT_KNOWLEDGE.md`.

- **EXPERIMENTAL**: all non-planar cladding behavior until physical tests are
  recorded.
- Promote only measured, observed robot behavior to **ROBOT-CONFIRMED**.
- Record whether failure came from geometry, support spacing, heat, speed,
  extrusion amount, nozzle drag, or motion stutter.

## Current Robot Baseline

- **ROBOT-CONFIRMED**: A 40 mm square coupon with a 20 degree slope along Y
  produced a very good non-planar top layer.
- **ROBOT-CONFIRMED / KNOWN FAILURE**: Some layer shifts still contain long,
  cosmetically damaging pauses. Speed-3 connectors and small rising square
  loops did not eliminate them.
- Preserve the successful surface geometry while changing only the
  layer-transition strategy in the next coupon.
