---
name: draped-skin
description: Surface-following skin layers over the top of any closed shell of untrimmed spline patches, limited by the machine's max non-planar angle. Steep area is excluded and reported. Reviewed in SAAM Studio through the three approvals; no part from it has been printed.
---

# draped-skin

Read the applicable root context: developer agents read both
[DEVELOP.md](../../DEVELOP.md) and [MAKERS.md](../../MAKERS.md).

This skill lays the top of a part along its actual surface instead of stepping
across it in flat slices. It is the general form of the final pattern in the
[wedge demo](../wedge-demo/SKILL.md): where that demo follows one flat inclined
face computed from wedge parameters, this follows whatever top surface the
geometry has.

It also accepts the plan's `vertical-spline-shell` shape: a control-point-grid
roof over a bulged footprint whose side walls remain vertical. The roof is
surveyed as usual; its over-limit area is excluded when it exceeds the machine
limit.

**Nothing here has been printed.** No physical validation has been performed,
no surface finish claim is established, and no maker has yet used this skill end
to end. What is implemented is the software workflow it shares with
[full-fill](../full-fill/SKILL.md): a print bundle with native 3DM geometry,
SAAM Studio review, the three human approvals, and delivery of the exact
reviewed bytes. Generation without those approvals is a development preview and
says so.

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
the shared pipeline's, documented in
[full-fill](../full-fill/SKILL.md#setup-and-tools). In short:

- `node core/print/cli.mjs init Prints/<name>` creates the print,
  `npm run studio -- Prints/<name>` opens it for the three approvals, and
  `node core/print/cli.mjs adjust Prints/<name> patch.json` applies a change
  asked for in chat.
- `node core/print/cli.mjs demo|preview Prints/<name>` generates without a
  person in the loop; neither creates an approval or can be delivered.

The excluded steep area and the surface's maximum slope appear in the settings
and toolpath review, so a person sees what will not be skinned before approving.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Print surface-following skins at all. |
| `layers` | `2` | Number of stacked skins. |
| `normalMm` | `0.2` | Skin thickness measured along the surface normal. |
| `strokeAngleDeg` | `0` | Direction of the skin strokes across the surface. |
| `sampleStepMm` | `0.5` | Spacing at which a stroke is lifted onto the surface. |
| `surveyStepMm` | `0.5` | Grid step for the surface survey and the reserve field. |
| `maxAngleDegOverride` | `null` | Explicit per-print experimental limit. It leaves the machine file unchanged and is flagged in Studio and checks. |

## Travel

A curved surface has no single safe travel height, so clearance is computed per
hop: a lifted move clears the highest surface **along that hop** plus the locked
`liftMm`. Between neighbouring strokes the nozzle crosses directly along the
surface without retracting, since the surface between two adjacent strokes is at
the same height as both ends. The wedge demo instead lifts to the whole part's
maximum height for every travel; that demo is not being changed.

## Implemented boundaries

- An experimental `maxAngleDegOverride` can make this skill generate beyond the
  machine profile's declared limit for a deliberately reviewed test. It is a
  process-plan choice, not evidence that the machine can clear or deposit at
  that angle. The machine file remains unchanged and the override is shown in
  the toolpath review and checks.

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
being required, and per-hop travel clearance. The shared review workflow is
tested in [core/tests/workflow.test.mjs](../../core/tests/workflow.test.mjs).
