---
name: pipe-cladding
description: Experimental. Lengthwise, helical or crossed-helix cladding around a spline or mesh sleeve, or a finished vase wall. Development only; needs a configured DENSO RC8A robot with external rotary.
---

# Pipe cladding

For maker work, read [MAKERS.md](../../MAKERS.md). For development, start with the
[builder orientation](../../BUILDERS.md) and follow its task-specific references.
This is a bounded development implementation for the DENSO VS-068A4 with RC8A and
an external rotary. RC8A is user-confirmed; ceiling mounting with the robot base
axis coaxial with the rotary remains provisional. No physical print is validated.

## Geometry and process

Cladding coats the finished outer boundary of a printed substrate, selected as a
[sleeve](#select-the-sleeve). Author the substrate like any other part: a spline
or mesh tube printed by full-fill, planar-infill, vase-wall or draped-skin, in
whole components or `composition.regions`. Keep cladding in the global skill
settings and set `part` when selecting an assembly component. Cladding waits for
that component's surface producers, then builds outward.

The first shell runs up and down the sleeve, continuing deposition across the
short index between neighboring tracks at each end. The next is a circumferential
helix. Further shells alternate. Set `pattern: "crossed-helices"` for a helix on
every shell with opposite winding on successive shells; each runs bottom to top,
and the shared transition returns to the next shell's lower end with extrusion
off. Wider [line spacing](../../core/print/USAGE.md#line-spacing) opens the
crossed pattern without increasing bead width. Each shell depends on the complete
preceding shell; the existing operation composer owns dependencies, joins and order.

| Setting under `skills.pipe-cladding` | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Select cladding. |
| `part` | `null` | Component whose finished surface is coated; required in an assembly. |
| `pattern` | `axial-hoop` | Alternating axial/helix shells, or `crossed-helices`. |
| `shells` | `4` | Positive integer; follows the selected pattern outward. |
| `normalMm` | `0.2` | Shell thickness along the surface normal. |
| `tiltDeg` | `45` | Tool tilt from the downward surface tangent toward the surface, between 0 and 90. |
| `sampleStepMm` | `1` | Maximum sample spacing along courses. |
| `toleranceMm` | `0.01` | Chord tolerance. |
| `surface` | `null` | The sleeve; required when enabled. |
| `offsetTightness` | `1` | For spline sleeves, blend a fixed-size loose NURBS offset field (`0`) toward the exact unit-normal offset (`1`). Mesh strips keep exact normal interpolation. |

Shared line width sets track spacing and helix pitch; `skinSpeedMmS` controls
cladding speed. Intent volume uses rectangular bead area. These are deposition
approximations, not a measured bead model or proof of level, filled end surfaces.

### Select the sleeve

A **sleeve** is a surface periodic in one direction, closing on a seam, and open
in the other (the side of a tube). Cladding is laid out on it; the sleeve itself
is not deposited.

- Spline: `{kind:'spline', patch:'outer', periodicU:true, normalSide:1,
  uvBounds:[[u0,u1],[v0,v1]]}`. Bounds are the patch's own parameters, normally
  its whole domain; positive normal points out of the substrate.
- Mesh: `{kind:'mesh-strip', rows:[[...],...], periodicU:true, normalSide:1}`.
  Each row lists native vertex indices along V; consecutive rows progress in U,
  and the last U row repeats the first for a periodic seam. Every cell must match
  two existing native mesh triangles. Point evaluation stays on those triangles;
  area-weighted selected-face vertex normals are interpolated for an explicitly
  smooth offset/pose field. This does not reconstruct a CAD surface. Rebuilding
  or reordering the mesh requires rebuilding the rows.

A spline tube is four patches that share one periodic cubic U basis (exterior,
bore, and two annular ends ruled between them); [GEOMETRY.md](../../GEOMETRY.md#spline-surfaces)
describes periodic sleeves and the tube.

For a hollow vase substrate, enable vase-wall and disable full-fill unless a solid
base is wanted, and select the same geometry's side as the sleeve. A level vase
ending supplies the complete side height; a spiral ending publishes only the side
below its lowest unfinished rim. The [finished-surface interface](../../core/path/README.md#finished-surfaces)
binds chart geometry, material extent, coverage and source operation IDs.
Unprinted components and selections outside a published extent are rejected.
Sparse coverage stays identified as sparse; contact or bridging still requires
process judgment. Authored free-form paths do not publish a filled surface.

### Coverage and pose

The shared [surface-region query](../../core/geom/surface-region.mjs) retains
native parameters; the [normal-surface operations](../../core/region/normal-surface.mjs)
evaluate ambient normal offsets and refine curve samples to millimetre chord and
step targets. These are ambient offsets, not geodesic boundary offsets.

Axial coverage partitions the periodic U domain into local sectors, measures
their offset-surface arc length at sampled V rows, and allocates bead-width cells
within each sector. A cell's course starts or ends when local width crosses its
threshold; the last cell tapers its intended width. Alternating direction avoids
flipping the nozzle frame. Neighboring courses ending within 2 mm continue
deposition across that index; other repositioning turns extrusion off and uses
the shared oriented retreat/approach policy. Hoop layers use a continuous
periodic helix with pitch from a sampled longest meridian and locally scaled bead
width.

Nozzle direction blends inward surface normal and negative V tangent using
`tiltDeg`; 45 degrees bisects them. Tool Y is V cross normal. Unwrapped rotary
angles bring each contact azimuth to the working side, including many
revolutions without a modulo reset. The same interpreted tool frame drives
Studio's bead orientation.

Current limits: one selected component and one rectangular sleeve chart; no
arbitrary face-region unwrapping, chart holes, multi-patch seam routing,
open-patch cladding or inward material reservation. Folded offset surfaces,
offset self-intersections and mesh normal-field singularities are not resolved.
Coverage is sampled, not a certified geodesic spacing or bead-volume proof. The
sample count follows from `sampleStepMm`, `toleranceMm` and the surface, with no
fixed budget. Fixed relay flow cannot meter narrow terminal cells; software
intent and relay estimates remain separate. Physical clearance, robot feasibility
and execution remain unverified.

## Machine setup and source output

Read the [RC8A output contract](../../core/export/denso.md#denso-rc8a-output-contract).
The profile is unconfigured by default. Record the actual tool/work frames,
arm group and figure, rotary interface/axis/sign/zero, bed center, frame offset/yaw,
initial position/orientation, relay IO and measured relay rate in `setup.denso`.
`configurationSource` and `mounting` describe the basis for those values.
Work coordinates must be defined with Z parallel to the bed axis; the calibrated
RC8A Work definition accounts for the ceiling installation. The SAAM transform
currently supports translation and yaw between that frame and the displayed room.
The optional [nominal presentation model](../../core/machine/README.md) requires
separate explicit base/tool alignment and model seed; it does not establish
controller joint or FIG parity.

The implemented rotary interface is `rc8a-relative-ex`: a configured RC8A extended
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

RC8A handles inverse kinematics for Cartesian poses. SAAM defers reach, singularity,
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

## Development demos

Create isolated synthetic development bundles from the repository root:

```sh
node skills/pipe-cladding/scripts/demo.mjs Prints/development/denso-rc8a-pipe
node skills/pipe-cladding/scripts/bumpy-demo.mjs Prints/development/denso-bumpy-spline
node studio/server.mjs Prints/development/denso-rc8a-pipe
```

The first is a 16 mm bore, 20.8 mm outside, 12 mm tall spline tube clad with four
0.2 mm shells. The second is a 16-column bumpy exterior with eight vertical
controls around a 16 mm bore, 32 mm tall, printed with three full-fill perimeters
and six shells; its pseudo-random phases are fixed. Both use invented installation
values labeled in the plan and never remembered, create no approvals and execute
no hardware. For another provisional RC8A part, call `developmentPipePlan()` from
[demo.mjs](scripts/demo.mjs), replace its geometry and skills, then
`initBundle(directory, plan, {machineId:'denso-vs068a4-rc8a'})` and generate in
development mode. Disable pipe-cladding when selecting only ordinary
fixed-orientation skills.

Studio defaults to **Follow build plate**, retaining stationary part coordinates;
clear it to inspect bed and material rotation in the room frame. **Machine view**
independently switches from faint context to assembly framing. Both modes use
one source interpreter and timeline. The nominal arm is shown only when its
installation/model inputs are supplied; otherwise bed and tool remain visible
with an explanation in **Machine model**. Do not reuse synthetic fixture
calibration for an actual installation.

Software coverage is in [denso.test.mjs](../../core/tests/denso.test.mjs): tube
geometry, shell order, unwrapped turns, tilted poses, source edits, relay
behavior, both preview frames, mesh/spline predecessor skills, cold reopen and
exact-byte delivery. The [wavy-denso workspace](../../examples/prints/wavy-denso/README.md)
packages the bumpy recipe.
