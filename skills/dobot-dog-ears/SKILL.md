---
name: dobot-dog-ears
description: Add removable first-layer corner-adhesion tabs (dog ears, mouse ears, helper discs, or brim ears) and a connected breakaway skirt to StruderBot parts. Use when a Dobot print needs wider rounded corner adhesion, when the operator requests dog ears or mouse ears, or when generating and validating the support-first path before the part's first perimeter.
---

# Dobot Mouse Ears (Dog Ears)

> **Imported legacy StruderBot manual.** The geometry and robot observations
> below are preserved from physical development, but this skill is not yet a
> callable SAAM operation. Port it through shared material regions, whole-plan
> travel, machine export, Studio review, and tests before offering it as an
> executable SAAM capability.

Create first-layer corner adhesion without changing the requested finished part
dimensions. Use this skill with `dobot-programmer` and
`dobot-prime-lead-in`. Read `references/geometry.md` before generating paths.

## Apply the defaults

- Treat a requested ear size as diameter. For the current goopy first-layer
  condition, default to the experimental 25 mm sparse ear described below;
  the earlier 15 mm solid ear is a known adhesion failure.
- Center each ear exactly on an eligible exterior corner.
- Add ears to all exterior corners unless the operator selects specific ones.
- Print ears on the first layer only unless more layers are requested.
- Default ear-only motion to 4.5 mm/s with 1.80 mm line spacing. The
  constant-feed width estimate is 0.553 mm, but this is experimental and must
  not be promoted to a calibrated bead width without measurement.
- Keep the support brim at least 1.00 mm clear edge-to-edge from the part.
- Connect each corner ear to the first perimeter only at three localized
  points: the corner apex and the two side-tangent locations where the nominal
  ear arc meets the part boundary.
- Form each connection as a narrow V-shaped jog that approaches the first
  perimeter once and immediately retreats on the next leg. Do not retrace the
  same line or extend attachment along the side.

## Preserve part ownership

Compute each nominal ear region as:

`ear_only = circle(corner, diameter / 2) minus offset(finished_part_footprint, clear_gap)`

Do not place ordinary ear or brim centerlines inside the one-millimeter clear
zone. Only the twelve deliberate tie jogs may cross it. The part owns all
material inside its finished footprint.

Clip the skirt where it crosses a filled ear. Extend each surviving skirt span
into the ear only by the standard tie-in overlap so the skirt and ear connect
without fully retracing an ear path.

## Keep one continuous extrusion window

Interpret “dog ears first” as completing the entire ear-and-skirt adhesion
scaffold before the part. Four isolated ears cannot literally precede every
skirt segment without disconnected live-extrusion travel or an intermediate
extrusion restart.

Use this continuous order:

1. print the mandatory prime lead-in;
2. enter the first ear at an exterior corner;
3. fill that ear;
4. print the adjacent breakaway-skirt span to the next ear;
5. repeat ear then skirt span until all ears and the complete loop are done;
6. finish at a shared ear/part corner and enter the part's first perimeter;
7. continue the part under the same single `PenOn()`.

If the operator requires all isolated ears before any connecting span, stop and
request explicit authorization for extrusion cycling or live-extrusion travel.
Never introduce either behavior silently.

## Generate and validate

- For axis-aligned rectangular parts, run
  `scripts/plan_rectangular_dog_ears.py` to derive centers, skirt offsets,
  clipped side spans, and continuous support order.
- Derive corners from the finished first-layer footprint, not a guide or
  centerline envelope.
- Recompute circles, clipped ear regions, skirt offsets, intersections, and
  ordering whenever part bounds, bead width, ear diameter, or gap changes.
- Keep the ear and skirt inside the printable bed after applying bead radius
  and safety margin.
- Reject ears that collide with another object, hole, exclusion zone, or purge
  path unless the regions are deliberately merged and replanned.
- Omit a skirt span when adjacent ears overlap across the entire side; merge
  the adhesion regions instead of overprinting them.
- Show ear-only regions, part-owned overlap, skirt gap, support order, and
  support-to-part transition in the approval preview.
- Keep support motion smooth. Avoid dense short segments or pauses that create
  fixed-flow blobs.
- Treat 15 mm solid ears with a 0.20 mm breakaway gap as **KNOWN FAILURE** for
  the current first-layer condition: the ears lifted and the brim fused into
  the goopy first layer.
- Treat the 25 mm / 4.5 mm/s / 1.80 mm spacing / 1.00 mm gap / three-tie
  revision as **EXPERIMENTAL** until physically tested.
- **ROBOT OBSERVATION / STILL EXPERIMENTAL — 2026-08-15:** the 25 mm
  slow-squish variant at `3.0 mm/s`, `2.70 mm` track spacing, and
  `BED_ZERO_Z + 0.55 mm` was not dense enough. Do not promote it as a new
  default. Preserve the slow/lowered-Z adhesion hypothesis, but test tighter
  spacing separately before reusing it on a cosmetic first layer.
