---
name: pipe-cladding
description: Print a circular pipe substrate with ordinary concentric loops, then alternate axial and helical cylindrical shells using oriented motion and a rotary through the shared RC8 export and Studio workflow.
---

# Pipe cladding

Read [MAKERS.md](../../MAKERS.md); developers also read [DEVELOP.md](../../DEVELOP.md).
This is a bounded development implementation for the DENSO VP-6242 with RC8 and
an external rotary. RC8 is user-confirmed; ceiling mounting with the robot base
axis coaxial with the rotary remains provisional. No physical print is validated.

## Geometry and process

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
| `shells` | `4` | Positive integer; axial first, then alternating. |
| `normalMm` | `0.2` | Radial shell thickness. |
| `tiltDeg` | `45` | Tool axis tilt from downward vertical, between 0 and 90. |
| `sampleStepMm` | `1` | Maximum axial/circumferential sample spacing. |
| `toleranceMm` | `0.01` | Circumferential chord tolerance. |
| `maxPoints` | `500000` | Explicit generation budget; increase if a larger plan needs it. |

Shared line width controls track spacing and helix pitch; `skinSpeedMmS` controls
cladding speed. Intent volume uses rectangular bead area. Axial centers stay
half a bead from the ends; helix centers are clamped there with tapered intent
on the edge turns. These are deposition approximations, not a measured bead
model or proof of level, fully filled end surfaces. The substrate must retain
more than one line width and the pipe must be taller than two line widths.

This first skill requires the native circular pipe recipe. It does not infer a
cylinder from arbitrary STL/CAD, implement general curved material interfaces,
or accept `composition.regions` Z assignments. General support/rim contact
with the radial band is not established. Those are explicit remaining geometry
and composition boundaries; ordinary skills still share the RC8 output in their
existing fixed-orientation scope.

## Machine setup and source output

Read the [RC8 output contract](../../DEVELOP.md#denso-rc8-output-contract).
The profile is unconfigured by default. Record the actual tool/work frames,
arm group and figure, rotary interface/axis/sign/zero, bed center, frame offset/yaw,
initial position/orientation, relay IO and measured relay rate in `setup.denso`.
`configurationSource` and `mounting` describe the basis for those values.
Work coordinates must be defined with Z parallel to the bed axis; the calibrated
RC8 Work definition accounts for the ceiling installation. The SAAM transform
currently supports translation and yaw between that frame and the displayed room.
The robot's joint geometry is not modeled in SAAM.

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
For an existing development bundle, use `node core/print/cli.mjs demo <directory>`;
use `upgrade` first if its saved machine snapshot needs the current profile.

Studio defaults to the room perspective, with bed and deposited material rotating.
Select **Follow build plate** to inspect stationary part coordinates. Both views
use one source interpreter and timeline. The nozzle direction is shown; robot
joint/arm animation is intentionally absent because no joint solutions were computed.

Normal use follows the same `init`, `adjust`, `check`, generation, Studio approvals
and exact-byte `deliver` lifecycle as [full-fill](../full-fill/SKILL.md). The fixed
MCP catalog includes this manual and machine. Do not reuse synthetic fixture
calibration for an actual installation.

Software coverage is in [denso.test.mjs](../../core/tests/denso.test.mjs): native
geometry, radial ownership/order, unwrapped turns, tilted poses, source edits,
relay behavior, both preview frames, mesh/spline predecessor skills, bounded
wedge, cold reopen, synthetic approval invalidation and exact-byte delivery.
