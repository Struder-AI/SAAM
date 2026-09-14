---
name: thick-lip
description: Thicken a vase-wall's top edge into a rigid, optionally rolled rim instead of leaving a single spiral or level-ended bead. Use when the operator asks for a rim, brim, bead, rolled edge, round-over or a more durable/rigid lip on a vase-mode print.
---

# Thick lip

A finishing skill: it does not print a part on its own, it thickens the top
edge an existing [vase-wall](../vase-wall/SKILL.md) region already produced.
Read [MAKERS.md](../../MAKERS.md); developers also read [DEVELOP.md](../../DEVELOP.md).

This recovers a real, robot-tested idea from an earlier StruderBot-only
version of this project: growing inward perimeters from a frozen rim. That
version derived its geometry by hand for one regular hexagon, and grew every
added perimeter purely inward from the frozen outer wall. This version
replaces the hand-derived corner math with the same convex-section offset
that vase-wall and full-fill already share, so it works for any convex
vase-wall section, not just a hexagon — and centers every added ring set on
the wall's own printed centerline instead of keeping it flush with the outer
face, so whatever prints here always straddles the exact line the terminal
wall bead below it followed, rather than depending on which side of a
computed envelope it happened to land on.

It also structurally avoids that version's one recorded robot failure — a
lip torn by growing off a raw spiral end — by requiring a phase-neutral,
fully closed boundary to grow from, which is what vase-wall's
`endTransition: 'level'` produces and a raw spiral does not.

Toolpath reliability across a wide perimeter-count jump is still unproven, so
this skill does not compute a schedule from a target width. The maker writes
an explicit, inspectable `steps` list instead — this is deliberately literal
rather than automatic while that gets validated.

## Use

Only through `composition.regions`, in a region assigned directly above a
`vase-wall` region on the same component, with that vase-wall region's
`endTransition` set to `level`. There is no simple/global recipe for this
skill, and no other skill may share its region:

```json
{"id": "wall", "part": null, "zStartMm": 0, "zEndMm": 40,
 "skills": {"vase-wall": {"endTransition": "level"}}},
{"id": "lip", "part": null, "zStartMm": 40, "zEndMm": null,
 "skills": {"thick-lip": {"steps": [2, 3, 2]}}}
```

`zStartMm` of the lip region must equal the vase-wall region's `zEndMm`
(the composer's normal touching-region rule); `zEndMm` is unused by this
skill's own geometry and can be left `null`. The agent proposes `steps` and
the other settings with the maker; the maker need not edit JSON.

## Locked settings

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Select thick-lip (only meaningful inside a region). |
| `part` | `null` | Required component ID in an assembly; null for a single part. |
| `steps` | `[2]` | One entry per lip layer: how many perimeters that layer prints, 1–20 each, 1–50 layers. |
| `minFeatureMm` | `0.4` | Shared section feature scale for the frozen boundary query, 0.05–5 mm. |

## Geometry

The vase-wall region's top section is queried once, at the shared boundary
Z, and frozen: every lip layer reuses that exact 2D outer loop, only Z
advances. For a step of `n` perimeters, ring offsets run symmetrically from
`-(n-1)/2` to `+(n-1)/2` bead-width spacings around the wall's own centerline
(`lineWidthMm / 2` in from the true outer surface — the same centerline
vase-wall itself prints). `n=1` reproduces that centerline exactly; `n=2`
straddles it with one bead just outside and one just inside; larger `n`
keeps straddling it symmetrically, which can put the outermost ring's
centerline outside the modeled surface — centering is not bounded to stay
inside the wall printed below it, on the reasoning that every ring should
sit a predictable distance from the bead directly below it, not from
whichever side of a computed envelope it happened to land on.

There is no automatic width-to-schedule math: `steps` is written out
explicitly, layer by layer, so its actual toolpath is fully inspectable
before printing. A schedule can rise, fall, or repeat in any order — for
example `[2, 3, 2]` prints a doubled ring, then a tripled ring centered on
the same line, then back to doubled.

Every lip layer is an ordinary planar operation — independently closed rings
with the shared travel policy between them, not a continuous nonplanar
stroke — so it only needs `xyz-extrusion`/`planar` on the selected machine,
even though the vase-wall underneath needs `nonplanar`.

## Limitations

No physical print has validated this skill. Travel between adjacent rings
uses the same shared travel/comb policy as every other planar skill; it is
not specially modeled for the hollow interior beneath a single-wall vase.
A `steps` entry large enough to push a ring's centerline well outside the
modeled surface has not been tested for adhesion or overhang at that
overhang; review the result in Studio, and prefer a short schedule change
over a large jump between steps until this is validated on hardware.

Run `node --test skills/thick-lip/tests/lip.test.mjs` for targeted software
checks, then the repository's `npm test` after changes.
