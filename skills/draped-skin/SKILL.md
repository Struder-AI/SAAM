---
name: draped-skin
description: Surface-following skin layers over the top of any closed shell of untrimmed spline patches, limited by the machine's max non-planar angle. Steep area is excluded and reported. Development preview only; not wired to Studio's approval workflow.
---

# draped-skin

Read the applicable root context: developer agents read both
[DEVELOP.md](../../DEVELOP.md) and [MAKERS.md](../../MAKERS.md).

This skill lays the top of a part along its actual surface instead of stepping
across it in flat slices. It is the general form of the final pattern in the
[wedge demo](../wedge-demo/SKILL.md): where that demo follows one flat inclined
face computed from wedge parameters, this follows whatever top surface the
geometry has.

**Nothing here has been printed.** No physical validation has been performed,
no surface finish claim is established, and this skill is not connected to SAAM
Studio or the three-approval workflow. It produces a development preview only.

## What it does

1. Survey the top surface. For each point on the bed, the height, normal and
   slope come from a vertical solve against the shell's patches.
2. Work out where skinning is allowed: the machine's non-planar angle limit
   excludes surface steeper than a fixed vertical nozzle can follow.
3. Reserve thickness under the surface for the skins, and hand that reserve to
   [full-fill](../full-fill/SKILL.md) so the body stops short of it.
4. Print each skin as strokes that ride the surface, offset downwards along the
   normal, alternating stroke direction and row order between skins.

The lowest skin bridges the body's stepped top, so its gap is measured to the
actual layer beneath rather than assumed equal to the skin thickness.

## The machine's angle limit

`machines/ultimaker-s5.json` declares `nonplanar.maxAngleDeg`, currently **15°**
for the S5. Surface steeper than that is **excluded from the skin and reported**
— the excluded area percentage and the surface's maximum slope appear in the
path summary and the checks file, so a person can see what is not covered before
approving anything. Steep area is not quietly printed flat.

That 15° is a declared software limit, taken from the inclination range the
wedge demo was built around. **It is not a measured clearance rating.** No head
collision model is implemented, and no print has established it.

## Setup and tools

From the repository root, install with `npm ci` (Node.js 22+). The commands are
the shared pipeline's, documented in [full-fill](../full-fill/SKILL.md#setup-and-tools):

- `node core/print/cli.mjs preview Prints/<name>`
- `node core/print/cli.mjs check Prints/<name>`

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Print surface-following skins at all. |
| `layers` | `2` | Number of stacked skins. |
| `normalMm` | `0.2` | Skin thickness measured along the surface normal. |
| `strokeAngleDeg` | `0` | Direction of the skin strokes across the surface. |
| `sampleStepMm` | `0.5` | Spacing at which a stroke is lifted onto the surface. |
| `surveyStepMm` | `0.5` | Grid step for the surface survey and the reserve field. |

## Travel

A curved surface has no single safe travel height, so clearance is computed per
hop: a lifted move clears the highest surface **along that hop** plus the locked
`liftMm`. Between neighbouring strokes the nozzle crosses directly along the
surface without retracting, since the surface between two adjacent strokes is at
the same height as both ends. The wedge demo instead lifts to the whole part's
maximum height for every travel; that demo is not being changed.

## Implemented boundaries

- Input geometry is a **closed shell of untrimmed bivariate spline patches**.
- Skins stack by dropping the surface along its normal. Curvature convergence
  between stacked offsets is not modelled: at small thickness on gentle surface
  the difference is minor, but on tight curvature it is not.
- Deposited volume uses a rectangular bead over each sampled interval: 3D stroke
  length by row spacing by the vertical gap, converted along the normal. Contact,
  adhesion, pressure and bead distortion are not modelled.
- The skinnable boundary is found by bisection against the real surface, but the
  region it bounds comes from a sampled grid at `surveyStepMm`.
- A direct move between strokes may pass within a quarter of the skin thickness
  of the surface, which is the same order as a flat layer's own turnaround.
- No collision model, no clearance checking, including for the second nozzle.
  Physical clearance is the operator's responsibility.

Run `npm test` after changes. Tests live in
[tests/](tests/draped-skin.test.mjs) and cover strokes lying on the surface,
normal-direction stacking, exclusion of over-limit surface, the machine limit
being required, and per-hop travel clearance.
