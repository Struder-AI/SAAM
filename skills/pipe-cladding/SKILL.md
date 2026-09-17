---
name: pipe-cladding
description: Wrap a substrate with alternating lengthwise and helical cladding, or opposite-handed helices for a crossed exterior pattern. Supports circular pipes and explicitly mapped periodic spline or mesh surfaces; this development capability requires a configured DENSO RC8 robot and external rotary.
---

# Pipe cladding

For maker work, read [MAKERS.md](../../MAKERS.md). For development, start with the
[builder orientation](../../BUILDERS.md) and follow its task-specific references.
This is a bounded development implementation for the DENSO VP-6242 with RC8 and
an external rotary. RC8 is user-confirmed; ceiling mounting with the robot base
axis coaxial with the rotary remains provisional. No physical print is validated.

## Geometry and process

Choose an explicit [finished-surface selection](#finished-surface-composition)
to coat an existing printed boundary, including a hollow vase wall. The circular
pipe recipe below is the legacy `surface: null` mode with an inward reserved band.

The native `pipe` recipe takes `innerRadiusMm`, `outerRadiusMm`, `heightMm` and
`toleranceMm`. It stores a closed annular indexed mesh through the shared geometry
lifecycle. The bore remains open. This geometry can also use ordinary planar
skills and other machine outputs with cladding disabled.

Enable `full-fill` in body mode and `pipe-cladding`; disable planar-infill,
draped-skin and vase-wall on this pipe. Place the pipe center at the configured
rotary center. The substrate owns the region from the bore to
`outerRadiusMm - shells * normalMm`. Its real sections are clipped with the shared
Clipper2 tool, then full-fill supplies perimeters and concentric interior loops.
With positive full-fill `perimeters`, the normal perimeter and overlap settings
apply. With `perimeters: 0`, the native pipe body uses evenly spaced concentric
loops across its radial thickness. The count is the nearest integer to thickness
divided by line width (at least two); first and last centers lie half a bead from
the bore and substrate outside. Nonintegral thickness can leave overlap or gaps.
For exactly three nominal-width loops, use a substrate thickness of three line
widths (1.2 mm for 0.4 mm lines). Fill-angle settings are superseded by the
concentric substrate pattern. This stays within full-fill's existing composition,
travel and export lifecycle; it is not a general annular medial-axis fill.

Cladding owns the remaining radial band. The first shell runs up and down along
the cylinder, with extrusion off while the bed indexes between tracks. Track
count is even and bead width adjusts slightly downward to divide the circumference.
The next shell is a circumferential helix, rising one line width per turn. Further
shells alternate these patterns. Each entire shell depends on its predecessor;
the first waits for the entire substrate. The existing operation composer owns
these dependencies, joins and ordering. There is no separate scheduler.

Set `pattern: "crossed-helices"` for a helix on every shell with opposite winding
on successive shells. Each runs bottom to top; the shared transition retreats
and returns to the next shell's lower end with extrusion off. Wider
[line spacing](../../core/print/USAGE.md#line-spacing) opens the crossed pattern
without increasing bead width. This works on circular pipes and the selected
periodic surfaces below. It remains substrate cladding, not a free-standing
mesh generator or a physically validated TPU process.

The nozzle points inward and downward, at `tiltDeg` from downward vertical.
At 45 degrees its shank retreats outward/upward from the contact point. This
improves the intended approach at the bed but is not a clearance guarantee.
Bed rotation brings each contact point to a fixed azimuth in the room; the
arm largely moves vertically for cladding and slightly outward between shells.
Inner loops use a stationary bed and a downward nozzle. The continuous helix
uses unwrapped rotary angles, including many revolutions without a modulo reset.

| Setting under `skills.pipe-cladding` | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Select radial cladding. |
| `part` | `null` | Component whose finished surface is coated; required for assembly surface selection. |
| `pattern` | `axial-hoop` | Alternating axial/helix shells, or `crossed-helices` for opposite winding on successive helical shells. |
| `shells` | `4` | Positive integer; follows the selected pattern outward. |
| `normalMm` | `0.2` | Radial shell thickness. |
| `tiltDeg` | `45` | Tool axis tilt from downward vertical, between 0 and 90. |
| `sampleStepMm` | `1` | Maximum axial/circumferential sample spacing. |
| `toleranceMm` | `0.01` | Circumferential chord tolerance. |
| `maxPoints` | `500000` | Explicit generation budget; increase if a larger plan needs it. |
| `offsetTightness` | `1` | For explicit spline surfaces, blend a fixed-size loose NURBS offset field (`0`) toward the exact unit-normal offset (`1`). Mesh-strip surfaces retain their existing exact normal interpolation. |

By default, shared line width sets track spacing and helix pitch; `skinSpeedMmS` controls
cladding speed. Intent volume uses rectangular bead area. Axial centers stay
half a bead from the ends; helix centers are clamped there with tapered intent
on the edge turns. These are deposition approximations, not a measured bead
model or proof of level, fully filled end surfaces. In the legacy circular mode,
the substrate must retain more than one line width and the pipe must be taller
than two line widths.

The legacy `surface: null` mode requires the native circular pipe recipe. It does not infer a
cylinder from arbitrary STL/CAD or accept `composition.regions` Z assignments.
The explicit surface mode below adds outward cladding to an assigned substrate.
General support/rim contact
with the radial band is not established. Those are explicit remaining geometry
and composition boundaries; ordinary skills still share the RC8 output in their
existing fixed-orientation scope.

## Machine setup and source output

Read the [RC8 output contract](../../core/export/denso.md#denso-rc8-output-contract).
The profile is unconfigured by default. Record the actual tool/work frames,
arm group and figure, rotary interface/axis/sign/zero, bed center, frame offset/yaw,
initial position/orientation, relay IO and measured relay rate in `setup.denso`.
`configurationSource` and `mounting` describe the basis for those values.
Work coordinates must be defined with Z parallel to the bed axis; the calibrated
RC8 Work definition accounts for the ceiling installation. The SAAM transform
currently supports translation and yaw between that frame and the displayed room.
The optional [nominal presentation model](../../core/machine/README.md) requires
separate explicit base/tool alignment and model seed; it does not establish
controller joint or FIG parity.

The implemented rotary interface is `rc8-relative-ex`: a configured RC8 extended
joint commanded through `EX`. An independently controlled rotary needs another
machine adapter and synchronized execution; it must not be silently treated as
this interface. Continuous multi-turn capacity and cable routing are unresolved
installation properties.

The ZIP contains `main.pcs`, included helper `.pcs` files and a manifest. Add the
source to the appropriate WINCAPS III project and compile/transfer using its
installed controller configuration. SAAM has not verified that vendor import or
compilation. It interprets its emitted literal `Move L, @0 T(...) EX(...), Time=...`
subset and relay `Set/Reset IO` commands; it is not a general PacScript interpreter.
The same exact archived source drives Studio and delivery.

RC8 handles inverse kinematics for Cartesian poses. SAAM defers reach, singularity,
joint and motion-limit checks as requested, alongside collision avoidance.
Travel uses prescribed retreat/reorient/approach moves; it does not solve a clear
route. Pose changes do not silently flatten to XYZ or disappear during compaction.

Playback assumes synchronized linear command progress at external speed 100%.
`Time` is requested milliseconds; `@0` endpoints, acceleration, rotary interpolation,
IO latency and actual speeds are not physically verified. Relay intent volume
and duration-times-rate material estimates are displayed separately, as with
Dobot. Fixed relay flow does not automatically follow tapered intent or speed
changes. No heating, homing or initial positioning is inserted. Temperature
control is external; retraction and fan control are unavailable.

## Public workflow and development demo

Create an isolated synthetic development bundle from the repository root:

```sh
node skills/pipe-cladding/scripts/demo.mjs Prints/development/denso-rc8-pipe
node studio/server.mjs Prints/development/denso-rc8-pipe
```

The fixture is a 16 mm bore, 20.8 mm outside diameter, 12 mm tall pipe with
2.4 mm walls: 1.6 mm substrate plus four 0.2 mm radial shells. Its invented
installation values are labeled in the plan and never remembered by this script.
It creates no human manufacturing approvals and executes no hardware.
For any new provisional RC8 part, call `developmentPipePlan()` from
[demo.mjs](scripts/demo.mjs), replace its geometry and selected skills, then
`initBundle(directory, plan, {machineId:'denso-vp6242-rc8'})` and generate in
development mode; the labeled setup is reusable across shapes and is not remembered.
Disable pipe-cladding when selecting only ordinary fixed-orientation skills.
For an existing development bundle, use `node core/print/cli.mjs demo <directory>`;
use `upgrade` first if its saved machine snapshot needs the current profile.

Studio defaults to **Follow build plate**, retaining stationary part coordinates;
clear it to inspect bed and material rotation in the room frame. **Machine view**
independently switches from faint context to assembly framing. Both modes use
one source interpreter and timeline. The nominal arm is shown only when its
installation/model inputs are supplied; otherwise bed and tool remain visible
with an explanation in **Machine model**.

Normal use follows the [shared print tools](../../core/print/USAGE.md) for recipe
adjustment, Studio review and delivery. The fixed
MCP catalog includes this manual and machine. Do not reuse synthetic fixture
calibration for an actual installation.

Software coverage is in [denso.test.mjs](../../core/tests/denso.test.mjs): native
geometry, radial ownership/order, unwrapped turns, tilted poses, source edits,
relay behavior, both preview frames, mesh/spline predecessor skills, cold reopen,
synthetic approval invalidation and exact-byte delivery.

## Finished-surface composition

An explicit `surface` selection consumes the nominal finished boundary of the
selected component, independently of the pattern that prints it. Full-fill,
planar-infill, automatic vase-wall and draped-skin participate through shared
composition. The substrate can use whole-component settings or several
`composition.regions`; keep cladding in the global skill settings, and set
`part` when selecting an assembly component. Cladding waits for that component's
surface producers, then builds outward with either cladding pattern.

For a hollow vase substrate, enable vase-wall and disable full-fill unless a
solid base is wanted. Select the same geometry's side chart for cladding; its
nominal outer boundary is the coating reference. A level vase ending supplies
the complete side height. A spiral ending publishes only the side below its
lowest unfinished rim height. The vase generator, stroke width and deposition
path are unchanged by selecting cladding.

The [finished-surface interface](../../core/path/README.md#finished-surfaces)
binds chart geometry, material extent, coverage and source operation IDs.
Other producers can publish this interface without adding their names to
cladding. Unprinted components and selections outside a published extent are
rejected. These are nominal material boundaries; sparse coverage remains
identified as sparse, and contact or bridging still requires process judgment.
Authored free-form paths do not implicitly publish a filled surface.

This removes the full-fill prerequisite from explicit surface cladding.
The legacy `surface: null` circular recipe retains its full-fill adapter and
inward reserved band; use an explicit finished-surface selection for composition.

## Bumpy spline and explicit surface cladding

The development example uses a 16-column periodic cubic exterior with eight
vertical control points, stored as a native NURBS surface in the bundle's 3DM.
Three seam columns repeat to close the periodic cubic; there are 16 independent
angular columns. An exact rational circular bore and ruled annular ends close
the substrate. Full-fill sections the native surfaces and uses its ordinary
three perimeters, overlap and scanline fill. It does not replace that section
with a circle or a constant wall thickness. In the example's first two layers,
opposing perimeter fronts meet locally and produce five closed loops per layer.

```sh
node skills/pipe-cladding/scripts/bumpy-demo.mjs Prints/development/denso-bumpy-spline
node studio/server.mjs Prints/development/denso-bumpy-spline
```

Defaults: 16 mm bore, 32 mm substrate height, sampled 2.00–7.99 mm radial wall,
three perimeters, six alternating cladding shells at 0.2 mm normal thickness.
Pseudo-random phases are fixed and the resulting control net is saved. Geometry
review shows the substrate boundary; cladding adds outward from this surface.
This is deliberately different from the legacy pipe recipe, where the pipe's
outer radius includes the cladding and its band is reserved inward. Nothing in
this example implements arbitrary inward surface-volume reservations.

Set `skills.pipe-cladding.surface` to an explicit selection:

- Native spline: `{kind:'spline', patch:'outer', periodicU:true, normalSide:1,
  uvBounds:[[0,16],[0,1]]}`. Bounds are native patch parameters. Positive V runs
  upward on this example, and positive normal points out of the substrate.
- Native mesh: `{kind:'mesh-strip', rows:[[...],...], periodicU:true,
  normalSide:1}`. Each row lists native vertex indices along V; consecutive rows
  progress in U. The last U row repeats the first for a periodic seam. Every
  cell must match two existing native mesh triangles. Point evaluation stays
  on those triangles; area-weighted selected-face vertex normals are interpolated
  for an explicitly smooth offset/pose field. This does not reconstruct a CAD surface.

Use the selected component's saved native vertices/triangles for mesh-strip
indices (`get_print` with `includeGeometry:true` through MCP); rebuilding or
reordering that mesh requires rebuilding the chart too.
For a periodic spline, use its actual U domain rather than copying `[0,16]`;
the `spline-tube` builder uses `[0, controlPoints.length]` and V `[0,1]`.

When authoring a new `spline-tube`, use 8–64 angular columns and 4–32 vertical
controls; with `k = clampedKnots(nv,3)` from
[spline-tube.mjs](../../core/geom/spline-tube.mjs), set
`z[j] = heightMm * (k[j+1] + k[j+2] + k[j+3]) / 3`, not evenly spaced control Z.
Column `i` lies at angle `2*pi*i/nu`, and every radius must satisfy
`radius * cos(3*pi/nu) > innerRadiusMm`; the builder repeats seam columns itself.

The shared [surface-region query](../../core/geom/surface-region.mjs) retains
native parameters. The shared [normal-surface operations](../../core/region/normal-surface.mjs)
evaluate ambient normal offsets and refine curve samples using millimeter chord
and step targets. Native spline evaluation calls the existing NURBS evaluator.
These are ambient offsets, not geodesic boundary offsets; the intrinsic offset
tool has separate capabilities. Mesh normal interpolation and the new coverage
construction are experimental SAAM code, not a copied upstream offset kernel.

Axial coverage partitions the periodic U domain into local sectors, measures
their offset-surface arc length at sampled V rows, and allocates bead-width cells
within each sector. A cell's course starts or ends when local width crosses its
threshold. The root is refined in V, and the last cell tapers its intended bead
width; no full-height course is forced through a disappearing cell. Alternating
direction avoids flipping the nozzle frame. Repositioning between separate
courses turns extrusion off and uses the shared oriented retreat/approach policy.
Hoop layers use a continuous periodic helix with pitch based on a sampled longest
meridian and locally scaled bead width. All substrate operations precede the
first shell; every later shell depends on the complete preceding shell.

Nozzle direction blends inward surface normal and negative V tangent using
`tiltDeg`; 45 degrees bisects them. This is a local surface tilt, not a fixed
angle to the room's vertical. Tool Y is V cross normal. Unwrapped rotary angles
bring each contact azimuth to the working side. The same interpreted tool frame
drives Studio's bead orientation; neither playback nor material display guesses
a cylindrical normal for the new mode.

Current limits: one selected component and one rectangular periodic surface chart;
no arbitrary face-region unwrapping, holes in the chart, multi-patch seam routing,
open-patch cladding or general inward material reservation. The substrate's
Z-regions can compose through their published boundaries.
The `spline-tube` authoring shape uses evenly angled columns and linear V height,
with a control-hull condition that keeps its bore separate. Other regular native
patches can be selected through the same query. Arbitrary folded offset surfaces,
offset self-intersections and mesh normal-field singularities are not resolved.
Coverage uses sampled arc-length cells and projected cell widths; it is not a
globally certified geodesic spacing or complete bead-volume coverage proof.
`sampleStepMm`, `toleranceMm` and `maxPoints` control construction. Narrow terminal
cells have small intended bead widths. Fixed relay flow cannot meter those widths;
software intent and relay estimates remain separate. Physical clearance, robot
feasibility and execution remain unverified.

[Surface-cladding tests](../../core/tests/surface-cladding.test.mjs) cover native
round trips, bore and wall dimensions, normal offsets/refinement, mesh-strip
mapping, perimeter-front interaction, partial courses, rotary continuity, bead
frames, packaging beyond 64 helper files and the shared export/review lifecycle.

## Shared example

The [wavy-denso workspace](../../examples/prints/wavy-denso/README.md) packages a
reproducible recipe using this skill. Its guide describes dimensions, setup and
current limits; generated workspaces begin without manufacturing approvals.
