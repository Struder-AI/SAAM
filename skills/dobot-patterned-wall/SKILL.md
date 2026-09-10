---
name: dobot-patterned-wall
description: Generate semi-continuous thick StruderBot walls by modulating a nozzle path around a generalized 2D guide curve. Use for trochoidal, looped, sinusoidal, corrugated, woven, porous, or patterned vase-mode walls whose width, repeat interval, density, support, and phase must be controlled without solid filling.
---

# Dobot Patterned Wall

> **Imported legacy StruderBot manual.** This is the authoritative recovered
> design/evidence source for the triangular-touchback, walled-truss,
> touchback-loop, trochoid, omega/ribbon, and sine wall families. None is yet a
> callable SAAM operation. Do not claim SAAM export compatibility until each
> kernel uses shared geometry/composition, whole-plan travel, machine export,
> Studio review, and equivalent tests.

Use with `dobot-programmer`. Read `references/geometry.md` before generating a
pattern or interpreting requested wall thickness.

Read the kernel-specific reference before generating a program:

- `references/triangular.md` for perimeterless triangular touchbacks.
- `references/walled-truss.md` for bounded zig-zag trusses.
- `references/implementation.md` when modifying, validating, or exporting the
  canonical project generators.

## Define the wall

0. Treat user-specified part length, width, diameter, and height as finished
   exterior dimensions by default. Derive guide curves, perimeter centerlines,
   inside-corner spans, and patterned-core bounds inward from that finished
   envelope. Use centerline/core dimensions only when the operator explicitly
   names them as such.
1. Parameterize the 2D guide curve by arc length and compute its tangent and
   material-side normal.
2. Select a pattern kernel: `touchback_loop`, `triangular_touchback`,
   `walled_truss`, `omega`/`ribbon`, `sine`, `trochoid`, or an explicitly
   experimental derivative such as `teardrop`.
3. Treat requested width as the deposited envelope including bead width.
4. Choose an integer repeat count on every closed guide circuit so the pattern
   returns with matching position and phase.
5. Report envelope width, actual repeat interval, path-length multiplier,
   self-crossing count, minimum curvature radius, and vertical phase schedule.
6. Expose zig-zag multiplicity as `single` or `double`. Use normal infill speed
   for a single pattern repeated every layer. For a doubled A/B pattern, shift
   boundary vertices by half a repeat and use half infill speed on every layer
   because each phase recurs only every other layer.

## Build safely

- Start with a circular guide test before applying a pattern to corners or
  arbitrary curves.
- By default, do not place recirculating loops directly on the bed. Print one
  or more conventional planar parallel-path or spiral foundation layers first,
  using the requested bottom-layer count. Transition into the patterned wall
  only after the complete envelope is supported.
- End patterned walls with one or more conventional planar parallel-path or
  spiral cap layers when requested. Parameterize bottom and top foundation
  counts independently; do not assume one layer is always sufficient.
- For vase-mode patterned walls, increase Z continuously through every loop
  and distribute the requested pattern-phase change continuously over the
  revolution. Do not close a flat patterned ring and then use a discrete
  rising seam connector unless the user explicitly requests stacked layers.
- Keep pattern phase fixed between helical turns for the first hardware test so
  every feature is directly supported below.
- Increase Z monotonically and by one calibrated layer rise per complete guide
  circuit, independent of the longer patterned path length.
- Treat controller-level continuity as part of extrusion control. With the
  fixed-feed Struder, every slowdown or pause deposits excess material and can
  increase effective layer height.
- Do not implement tight patterned walls as dense chains of short `MovL`
  chords, even when the ideal mathematical curve is smooth and `CP=1` is set.
  The MG400 may execute the junctions as staccato moves.
- Prefer a small number of controller-native `Arc3` primitives with CP and no
  `SYNC`, or longer blended segments that have passed a motion-only test.
- Do not insert exact stops at loop boundaries. Verify that every primitive
  junction flows continuously on the physical robot.
- Use a radial external lead-in beyond the complete patterned envelope.
- If the final motion segment is longer than the configured retract lead, use
  the global early-shutoff helper. If dense sampling makes every segment
  shorter, calculate cumulative remaining patterned-path length, switch DO8
  off at the sampled point nearest the configured lead, finish the path, and
  lift immediately.

## Guard against failure

- Reject unintended offset self-intersections caused by guide curvature.
- Treat intentional trochoid crossings as high-heat, high-material regions.
- Do not infer density from width alone; tighter repeat spacing increases both
  path length and deposited material with the fixed Struder feed.
- Fillet polygonal guides before applying a continuous normal-field pattern,
  or use a separately approved corner kernel.
- Limit lateral phase shifts between turns until hardware testing establishes
  support capability.

## Validate experimentally

1. Preview the actual commanded primitives, including crossings and enclosed
   cells, rather than only the ideal equation.
2. Run one complete circuit above the bed with extrusion off and reject any
   visible hesitation before attempting a material test.
3. Print one layer, inspect deposition at every junction, then proceed to a
   short fixed-phase circular specimen.
4. Hold temperature, layer rise, robot speed, and feed setting constant.
5. Vary one of envelope width or repeat count at a time.
6. Record collapse, crossing blobs, void geometry, measured wall envelope,
   layer alignment, heat buildup, and motion pauses.
7. Promote only robot-confirmed parameter ranges into this skill.

## Approved conceptual kernels

- `touchback_loop`: robot-confirmed native-arc cellular reference from
  `milestone_touchback_loop_ring_60d_10w_20h/`.
- `triangular_touchback`: perimeterless closed cells with forward and
  retreating diagonals. Use `references/triangular.md`. Do not add bounding
  perimeters to this kernel.
- `walled_truss`: independently printed inner/outer skins tied by one
  alternating zig-zag. Use `references/walled-truss.md`. Use this when the
  operator requests both perimeters and a triangular/truss texture.
- `omega` / `ribbon`: tangent arc-chain texture. Treat as conceptual until a
  preview and robot test establish usable primitive sequencing.

## Reusable modifiers

### Bounding perimeter

`bounding_perimeter` is a first-order modifier that can be applied to compatible
patterned-wall kernels such as `omega`/`ribbon` and `touchback_loop`. The
kernel generates the fast internal patterned mass; the bounding perimeter adds
one or more smoother skin/boundary passes around selected sides of that mass.

Do not apply `bounding_perimeter` to `triangular_touchback`. Select
`walled_truss` instead; its skins and zig-zag core are derived together.

Use this modifier when the operator wants slicer-like "infill plus wall"
behavior, while still keeping the patterned core independently printable.
Unlike conventional slicers, the wall/skin is optional and should not be baked
into the kernel definition.

Supported scope language:

- `none`: print only the patterned core.
- `outer`: add skin to the exterior boundary.
- `inner`: add skin to an interior hole/boundary when the geometry has one.
- `both`: add inner and outer skins for closed rings/tubes.
- `all_open_edges`: add skins/caps around open bar or patch boundaries.
- `custom`: use operator-specified boundary curves.

If a requested scope does not apply to the guide geometry, report it as
not applicable instead of inventing a boundary. For example, `inner` is not
meaningful for an open straight wall unless the model defines an interior hole
or second named boundary.

Bounding passes usually make pure spiral-vase execution harder because they
interrupt the repeating core path. Default to layer-based previews for bounded
variants unless the operator explicitly asks to explore a continuous helical
skin strategy.

For a continuously extruded layer-based bounded pattern, alternate traversal
side by layer:

```text
layer A: outer perimeter(s) -> patterned core -> inner perimeter(s)
layer B: inner perimeter(s) -> patterned core -> outer perimeter(s)
```

Rise to the next layer on the boundary where the current layer ends. Do not
travel across the patterned core. When the core kernel is a closed cycle, a
side-to-side traversal that preserves every core segment must reuse one
existing core edge; use a designated seam diagonal rather than inventing an
arbitrary cross-core stroke or omitting a pattern segment.

When a conventional solid foundation is requested, print it first as one
continuous spiral across the complete bounded envelope. Start the patterned
body on the next Z level. Use normal/fast diagonal speed on that first patterned
layer, then the calibrated slower touchback speed on subsequent patterned
layers.

## Robot-confirmed loop-chain update

- Native two-`Arc3` cellular loops with `CP=1` and no `SYNC` moved smoothly on
  the robot, unlike the failed dense-`MovL` approximation.
- Directly printing the recirculating pattern as the first layer can pull a
  partially adhered strand back off the bed. Use a conventional spiral or
  parallel-path foundation across the full patterned envelope.
- Stacked closed patterned rings joined by a short rising phase transition
  produce a visible Z seam. Use a continuous helical Z schedule and continuous
  phase drift for the default vase-mode implementation.
- Apparent first-layer Z errors after a patterned-wall failure may be caused by
  the toolhead being physically pushed upward by accumulated overfill. Inspect
  and restore the mechanical toolhead position before changing a known Z
  procedure or promoting a new offset.
- **ROBOT-CONFIRMED** — The open-top 60 mm guide-diameter touchback ring worked
  nicely with a 10 mm envelope, approximately 8 mm repeat, one conventional
  annular spiral foundation, continuous helical Z, and native `Arc3` loops.
- For a tied cellular structure, place forward and return nodes on opposite
  sides of the wall centerline at half the calibrated 0.78 mm spacing. The
  resulting 0.78 mm centerline separation gives approximately 0.05 mm physical
  overlap with the measured 0.83 mm bead. Keep node spacing, envelope, phase,
  and foundation count independently parameterized.
- Omit top cap layers when the operator needs to inspect the internal cellular
  structure; cap counts remain user-selectable rather than mandatory.
