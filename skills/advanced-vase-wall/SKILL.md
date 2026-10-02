---
name: advanced-vase-wall
description: Experimental. Looped vase walls made by orbiting an original rising contour, with configurable wall width and overlap; accepts corner distortions without surface fitting.
metadata:
  saam-kind: guidance
---

# Orbital patterned vase walls

Use this skill for a continuous looping wall around a vase's original rising
outer contour. Use [standard vase mode](../vase-wall/SKILL.md) for a plain spiral.
The orbital method replaces this skill's former fitted-sleeve/contact workflow.
Do not use sleeve fitting, mesh fidelity, offset-contour reconstruction, surface
coverage tests or preceding-layer contact optimization for new orbital walls.
Legacy runtime code remains for saved recipes; it is not this skill's workflow.

Calculate the primary spiral once, then apply a local harmonic displacement.
The deterministic script owns the calculation; the agent supplies parameters.
Constant wall width is the default. A taper is an optional width profile, not a
requirement. Texture, crossings and distortion at sharp corners are accepted.
People can add fillets to their model when they want gentler corner behavior.
This method has been inspected in Studio, not physically validated in a print.

## Preview the parameters first

### Toolpath confirmation step

Before presenting the mid-height one-circuit Workbench preview, announce **toolpath confirmation step** and say: **please inspect this one layer and let me know if the density of the wall toolpath is what you are looking for**. Explain that this is a parameter preview, then prompt: **If you are happy with the toolpath preview, let me know and I will generate the full toolpath for your part.** Wait for the user’s acceptance before generating the complete part.


For every new parameter selection or change, show one complete circuit at the
part's middle Z before generating the full-part toolpath. This is also the first
step when the person asks to go ahead with the full toolpath. Use a real Trace
preview in SAAM Studio/workbench, not an SVG or substitute drawing. Let the person
inspect how the orbital loops follow their actual geometry and respond before
proceeding to the whole part, unless they explicitly waive this preview.

```sh
node skills/advanced-vase-wall/scripts/preview-orbit-bundle.mjs SAAM_ROOT SOURCE_BUNDLE PREVIEW_BUNDLE options.json
```

The preview cuts exactly one original contour at `(minZ + maxZ) / 2`, applies the
same selected width, overlap, bead width, speed and sampling parameters, and
creates one planar Trace course. It includes no base layers and no other wall
courses. Preserve the original mesh as context. Generate the small preview
through the normal lifecycle, open it with `request_review`, and select Top view
for inspection. This is a parameter-review artifact at the middle of the model,
not a printable whole-part job; do not deliver it as the final print file.
Preview acceptance is separate from the final settings/toolpath confirmation.
After acceptance, use the full adapter below with the identical options.

## Generate an editable print

The Slice/Trace adapter requires SAAM 0.3.0's installed APIs. This checkout's
older `skills.vase-wall` recipe format is not migrated by the adapter. Use an
installed SAAM root or a source checkout with the same Slice/Trace contracts.
Start with one imported, validated mesh bundle and a complete printer setup.
Claim existing Studio work before editing, following the
[shared lifecycle](../../core/print/USAGE.md). Preserve the source bundle.

```sh
node skills/advanced-vase-wall/scripts/build-orbit-bundle.mjs SAAM_ROOT SOURCE_BUNDLE NEW_BUNDLE options.json
```

Example `options.json`:

```json
{
  "wallWidthMm": 2,
  "overlap": 0.5,
  "baseLayers": 3,
  "orbitDirection": 1,
  "turnCompensation": true
}
```

The script creates a separate normal bundle: optional solid base Slice layers
followed by ordered orbital Trace courses. It copies the source geometry and
original STL bytes, printer setup and process defaults. It replaces deposition
assignments in the new bundle; it does not edit the source print or carry its
old fitted patterns. Use ordinary `request_review` and `generate_toolpath` to
review the new bundle. Settings and exact toolpath require the person's normal
Studio confirmation before delivery.

| Option | Default and meaning |
|---|---|
| `wallWidthMm` | 2 mm total nominal deposited wall excursion, including bead width. Must exceed bead width. |
| `overlap` | 0.5. Fraction of orbit diameter removed from forward pitch; accepts 0 inclusive to 1 exclusive. Higher overlap produces slower progress and more crossings. |
| `orbitDirection` | +1 counterclockwise orbit; -1 clockwise orbit. Primary contour travel stays counterclockwise. Preview both when choosing which texture faces outward. |
| `turnCompensation` | true. Compensate orbital phase using orbit-center travel and signed tangent-frame turning; false keeps uncompensated phase. |
| `baseLayers` | 3 solid base layers; 0 omits the base. |
| `layerMm` | Source process layer height; rise per primary circuit. |
| `beadWidthMm` | Source process line width; independent of wall excursion. |
| `speedMmS` | Source process planar speed; requested traversal speed along the actual orbital path. |
| `stepMm` | 0.06 mm spacing along the primary path when evaluating the orbit. This is a sampling interval, not a certified output chord tolerance. |
| `primaryStepMm` | 0.12 mm sampling interval for the original-section primary spiral. |

The adapter uses original triangle sections at each layer-height station and
linearly interpolates their normalized perimeter correspondence between heights.
It anchors the seam consistently and applies half-bead inward centerline
standoff. A modeled hollow bore is allowed; only one outer contour is required.
Multiple outer contours cannot supply this single primary spiral. A base cannot
exceed the mesh height. No smoothing fit replaces the model. The adapter keeps
Z rising along the primary spiral and stops at the source geometry's actual top.
It creates no additional level rim or guide wall.

## Math and overlap

For primary position `P(s)`, XY unit tangent `T`, and left/inward XY normal `N`:

```
A = (wallWidthMm − beadWidthMm) / 2
pitch = 2 A (1 − overlap)
C = P + A N
dθ = orbitDirection × 2π distance(Cnext, Cprevious) / pitch − dψ
orbital position = P + A sin(θ) T + A (1 − cos(θ)) N
```

Here `dψ` is the wrapped signed XY tangent-frame angle change. This local
linear-time correction applies to either orbit direction without changing width.
With compensation disabled, `dθ = orbitDirection × 2π ds / pitch`.
It requires no contact solver and does not guarantee uniform overlap at arbitrary
corners. The user inspected both directions on the original fluted vase.

The input primary spiral runs counterclockwise and already includes half-bead
standoff. Orbital displacement stays in XY; Z follows the primary spiral.
Overlap measures nominal spacing of the moving orbit centers, not an exact
intersection area or tangency guarantee for the resulting trochoid lobes.
There is no tangency, lobe-gap or bead-contact solve. For 2 mm wall, 0.4 mm bead
and 50% overlap, amplitude is 0.8 mm and pitch is 0.8 mm per orbit.

Requested head speed affects traversal time, not the geometry. With orbit
length `L`, average progress on a straight primary path is `speed × pitch / L`.
Actual segment timestamps use segment length / speed. Machine acceleration and
ordinary flow/motion limits can lower achievable speed. More overlap increases
path length, time and material while keeping nominal wall width fixed.

`orbitPrimaryPath(primaryXYZ, options)` in
[`scripts/orbit.mjs`](scripts/orbit.mjs) is geometry independent. It also accepts
an optional `widthAtHeight(z)` function: amplitude and pitch change directly with
width. Constant width remains the normal case. The bundle CLI currently exposes
constant width only. Other geometry producers can supply a precomputed primary
XYZ path to this module; the mesh CLI does not claim other geometry support.

## Cost, checks and recovery

Primary construction and orbital displacement are separate from SAAM's machine
program generation and Studio rendering. The inspected 125 mm vase required
2.50 s for its original primary path and 0.58 s for orbital displacement. Its
621 courses contained about 1.97 million points. Production machine-program
checks took 81.63 s with a 16 GiB Node heap after the default worker heap failed.
Those figures describe one job on this Mac, not a universal performance bound.
Do not respond to memory exhaustion by fitting away model detail. Increase the
Node heap within available RAM or select a coarser explicit sampling interval.
Fine sampling and overlap can create very large programs and slow the viewer.
A stuck viewer can be reopened without regenerating the checked path.

Ordinary machine bounds, flow, motion, export checks and Studio review still
apply. This skill does not infer adhesion, strength, watertightness or clearance.
Sharp corners and curvature can change local width and overlap; preserve those
results rather than introducing a geometry repair solver.

Verification:

```sh
node --test skills/advanced-vase-wall/tests/orbit.test.mjs
```

The tests check overlap-controlled pitch, speed-independent geometry, rising Z
preservation of the input guide, and signed frame-turn compensation in both orbit directions. The inspected original vase provides full
Slice/Trace generation evidence; it does not establish physical print quality.


If Studio confirms export but the browser download does not arrive, use its
“Download reviewed file” link. If necessary, locate the exact approved export
artifact in the bundle and provide a direct local file link with a readable
filename. Do not regenerate, alter settings, or bypass final confirmation to
recover a browser download. Verify the archive is intact and contains G-code.
