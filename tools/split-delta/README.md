# Standalone machine kinematics lab

The standalone browser app models Splitty (profile ID `split-delta`) and
the nominal Dobot MG400.
It shares browser/Node numerical modules with developer tooling and does not
depend on Studio, a print bundle, an account, or a machine connection.

```sh
npm run split-delta
npm run split-delta:assess -- --fine
```

Open the printed loopback URL. The split-delta page links to `/dobot.html`.
Keep that terminal running; Ctrl+C stops its server. The server serves an explicit
asset list, not the checkout. Assessment runs in a browser worker. Geometry and
workspace edits invalidate prior results. Save the configuration or assessment
as JSON; saved configuration is a design profile, not an approved machine setup.

## Split-delta geometry and coordinates

[The profile](../../machines/split-delta.json) is discoverable through
`loadMachine('split-delta')` and the machine catalog. The browser, CLI assessment,
and preview interpreter use [one reference model](../../core/machine/split-delta.mjs).
Its inputs are six independent straight rails (vertical or radially inclined), six equal fixed-length rods, and
one effective spherical pivot center at each rod end. The joint design permits
at most two layers; no three-layer fallback is assumed. The articulation limit
is an explicit input requiring mechanical evidence, not a consequence of layer count.

For tower angles 0°, 120°, 240°, let `e` be the horizontal radial unit vector
and `t` its counterclockwise tangent. Each tower contributes a minus and plus rod:

```text
rail XY     = towerRadius * e ± railSeparation/2 * t
plate pivot = platformRadius * e ± platformPair/2 * t
plate center = nozzle TCP + R * [0, 0, toolLength]
world pivot pᵢ = plate center + R * platePivotᵢ
carriage hᵢ = pᵢ.z + sqrt(rodLength² - |pᵢ.xy - railᵢ.xy|²)
```

All lengths use mm between joint centers. Positive Z points up from the bed.
The root sign is always positive along the rail direction; at zero inclination, carriages are above their plate pivots. The opposite assembly mode is not automatically selected. XYZ commands
refer to the nozzle tip, so a long hotend's offset participates in every IK solve.
Tilt is measured from upright, azimuth specifies its horizontal direction, and
spin rotates the tool about its own axis. The mechanism has six local degrees of
freedom where its constraint matrix has rank six. Printing with a rotationally
symmetric nozzle normally specifies five and selects tool spin explicitly.

`inverse()` returns carriage distances along the rails (the legacy `heights` field), rod endpoints and diagnostics. At zero rail inclination these distances equal Z heights.
`forward()` uses damped Newton steps from a required previous-pose seed and
verifies the positive rod branch; it does not search all assembly modes.
The normalized constraint rows are `[uᵢ, (R aᵢ × uᵢ)/platformPivotRadius]`.
Jacobi singular values detect parallel singularity. The configured minimum
smallest/largest ratio is 0.02; this dimensionless threshold is separate from
an angular margin and is not a stiffness or load rating.

## Splayed rails and plate pairing

For rail unit direction `dᵢ`, its Z=0 origin `bᵢ`, plate pivot `pᵢ`, and rod length `L`, the positive-root inverse is:

`v = dot(pᵢ-bᵢ,dᵢ); sᵢ = v + sqrt(L² - |pᵢ-bᵢ|² + v²)`.

The carriage is `bᵢ + sᵢ dᵢ`. Outward rail inclination rotates each direction toward its tower radial vector. The viewer offers 0–15°, with tower radius constrained at the bed. At height Z the tower radius is `Rbase + Z tan(inclination)`; wider upper structure is an explicit consequence. A nonzero `railReferenceHeightMm` can specify a radius at another height for developer comparisons; the path study fixes it to zero.

The serial singularity reserve is the rod's angle away from the plane perpendicular to its rail, which is rod elevation for vertical rails. The socket axes are aligned to the neutral pose at TCP Z=0. Inclination invalidates height-independent XY reach: cylinder assessments sample both intermediate heights and endpoints. Carriage limits and working travel use distance along the rail.

A1/A2, B1/B2 and C1/C2 connect to three respective near edges of the plate, with no crossed tower mapping. Large pair separation is not mandatory. Narrowing pairs changes yaw leverage: for vertical rails at the neutral pose, the homothetic layout `platformPair/platformRadius = railSeparation/towerRadius` makes the rods radial and loses yaw rank. A 35 mm pair-center radius with 40 mm pair spacing retains rank and has an 80.6 mm pivot envelope; full-path capacity still needs checking. Pivot-envelope diameter excludes sockets, plate rim and thickness.

## Cylinder assessment and dimension choices

The default operating cone is 45° in every direction. Assessment expands it by 4° (to 49°, or to 44° for a 40° requirement),
adds ±4° spin around a nominal zero-spin policy, retains at least 4° rod elevation,
and keeps joint deflection at least 4° inside each configured socket cone.
Both socket axes are aligned to their respective neutral rod directions: the
carriage socket axis is fixed in the machine, the plate socket axis rotates
with the plate. Different actual socket mount directions need a model extension.
The assessment checks the disk interior as well as its boundary, every sampled
tilt direction, matrix conditioning and determinant sign relative to neutral.

`assessCylinder()` reports sample counts, first failure, joint articulation,
carriage extrema and working track. `findCylinder()` holds the operating cone
and reserve fixed and bisects the diameter up to an explicit cap. The viewer uses
400 mm and a 1 mm bisection bracket. That bracket is **not** the sampling uncertainty.
The geometric maximum can exceed a collision-free frame opening.

Quick sampling uses four radial intervals, 15° position/tilt azimuth steps and
seven tilt intervals. Fine uses six radial intervals, 10° azimuth steps and
14 tilt intervals. Spin reserve is sampled at -4°, 0°, +4°; a user-selected spin
range expands those endpoints. These are sampled estimates, not proofs over the
continuous configuration domain. A 4° clearance from every possible singular
surface is not certified by this grid or by the singular-value ratio. A final
machine envelope needs converged/adaptive or interval analysis and measured limits.

The four reference candidates use a 180 mm tower radius, 50 mm track-pair spacing,
55 mm plate pair-center radius and 120 mm plate pivot-pair spacing. Thus the
tower-center triangle side is about 312 mm, the six rail centers fit inside a
363.5 mm circle, and the plate pivot circle is about 162.8 mm diameter. These are
custom design dimensions; the uncertain “WASP 2080” reference is not used as a
source of rod lengths or pivot dimensions.

| Candidate cylinder | Rod length | Tool length | Assumed joint cone | Fine sampled required cone, including reserve | Working track for height H |
|---|---:|---:|---:|---:|---:|
| Ø150 compact | 400 mm | 120 mm | 90° | 85.79° | H + 188.72 mm |
| Ø200 compact | 450 mm | 120 mm | 90° | 85.12° | H + 198.68 mm |
| Ø200 reduced articulation | 600 mm | 120 mm | 80° | 75.05° | H + 173.49 mm |
| Ø200 long tool | 500 mm | 160 mm | 90° | 85.55° | H + 214.85 mm |

Values reference the [saved fine assessment](assessment-fine.json), rounded upward
for dimensional planning; its generated timestamp identifies the evidence.
The 450 mm rod option is a compact starting point only if the two-layer joint
can provide the required cone. The 600 mm option reduces required articulation
at the cost of a higher machine. No unique optimum is claimed without the
joint's measured cone, collision envelopes, mass, stiffness and packaging constraints.

Height does not affect ideal horizontal reach: `hᵢ = Z + fᵢ(X,Y,R)`.
Raising the nozzle by ΔZ translates all carriages by exactly ΔZ, leaving rod
angles and the constraint matrix unchanged. For a cylinder of height H:

```text
working travel = H + max(fᵢ) - min(fᵢ)
absolute rail interval = [min(fᵢ), H + max(fᵢ)] above the bed
```

With the compact Ø200 geometry and H=200 mm, the sampled reserve-inclusive rail
interval is about 390.63–789.31 mm above the bed, requiring 398.68 mm of working
travel. Carriage body length, endstop/homing travel, end clearances and assembly
tolerances are additional purchased-rail allowances. Shorter rods reduce absolute
frame height but can increase carriage excursion and articulation. Real build
height can also be constrained by frame, tool, part and cable collisions.

Rod reach and socket angles do not prove collision clearance. The model excludes
rod thickness, sockets, plate thickness, heater block/shank envelope, deposited
material, frame/rails, cables, elastic deflection, tolerances and dynamics.
The pointed hotend rendering is illustrative. Extending the tool improves some
approach clearances while increasing lateral platform displacement at tilt.

## Preview source and SAAMpath

[The preview adapter](../../core/export/split-delta-player.mjs) exports SAAMpath
and interprets an explicit, bounded G-code subset. It supports `G21`, `G90`,
`M82`, `G93`/`G94`, `G0`/`G1 XYZABC E F`, and `G4 P` in milliseconds. ABC uses
`Rz(C) Ry(B) Rx(A)` in degrees. E is absolute filament mm. G94 feed is mm/min;
G93 feed is inverse minutes and is required on every timed move. Pure orientation
moves require G93. Arc, relative positioning, homing, heater and IO commands fail.
G0 uses the same explicit-feed simulation as G1, not a hardware rapid policy.

The interpreter samples linear TCP/Euler progress at at most 2 mm translation
and 1° per Euler component, solves IK at each sample, and reports source line,
time and carriage heights. It checks the actual rounded source, with 0.000002°
angular numerical tolerance for six-decimal ABC export. This tolerance is distinct
from the 4° mechanical reserve. It does not prove continuous segment feasibility,
model acceleration, enforce actuator speed/acceleration, produce steps or control heat.
SAAMpath phase/operation labels are not preserved in this preview dialect; fan
intent appears as a comment and has no simulated IO effect.

```sh
node tools/split-delta/preview.mjs path.json preview.sdgcode
node tools/split-delta/server.mjs --preview preview.sdgcode
```

The viewer imports SAAMpath `.json`/`.saampath` or the preview dialect directly.
Large source displays show the first 50 lines; interpretation and download use
the complete source. This source is explicitly marked simulation-only.
The SAAM profile's production output remains unavailable, so ordinary delivery
cannot mistake this preview for commissioned firmware output.

## Existing DENSO parts

The importer consumes the existing checked PacScript ZIP through SAAM's DENSO
interpreter. It uses the interpreted part-relative motion, not robot joint IK:

```sh
node tools/split-delta/import-denso.mjs source-bundle preview-directory
node tools/split-delta/server.mjs --preview preview-directory/preview.sdgcode
```

This explicit adaptation holds the bed stationary, retains interpreted TCP
positions, commanded bead volume and requested durations, caps tool inclination
at 45°, and selects a zero-spin minimal-tilt frame. It writes an adaptation report
with source hashes and changed-pose counts. The default simulator adds an approach
from `[0,0,20]` to the source's initial TCP at 10 mm/s. Rotary and tool-spin changes
are intentional replanning, not equivalent execution of the old machine program.
The altered deposition approach needs process and collision review. Personal
parts and generated previews stay in ignored `Prints/`; no old job approvals transfer.

## Controller boundary and Studio integration

Recommended division: SAAM plans part-relative nozzle poses, tool spin and
extrusion intent; the controller plans time and solves calibrated IK along the
Cartesian trajectory before generating six synchronized actuator trajectories
plus extrusion. Limits, homing, emergency handling and thermal control belong
with the controller. Converting only G-code endpoints to carriage positions and
linearly moving between them generally does not preserve a straight nozzle path.

LinuxCNC is a candidate for a custom kinematics module because it provides
forward/inverse kinematics interfaces and joint/world motion modes. Its stock
`genhexkins` describes actuated strut lengths; this machine instead changes
vertical carriage heights with fixed rods. It therefore needs its own module,
not a declaration that it is an ordinary hexapod or three-carriage delta.
See the official [kinematics interface](https://linuxcnc.org/docs/html/motion/kinematics.html)
and [available kinematics modules](https://linuxcnc.org/docs/html/man/man9/kins.9.html).
This is an architecture recommendation, not implemented or selected firmware.

The numerical modules have no DOM, file or server dependencies. Studio
consumes their poses and link endpoints through the shared presentation provider;
its exact-source review contract remains the authority for manufacturing output.
Controller implementations need golden-vector parity against this reference,
measured geometry/tool offsets, branch continuity, actuator limits, interpolation
error bounds, homing strategy, and machine-specific commissioning.

## Dobot and deferred DENSO model

[Dobot's module](../../core/machine/dobot-kinematics.mjs) provides analytical FK/IK,
joint limits, a fixed elbow branch, winding selection nearest the previous wrist
angle, and straight/folded elbow singularity diagnostics. Its nominal centerline
offsets come from the [official MG400 ROS URDF](https://github.com/Dobot-Arm/MG400_ROS/blob/main/mg400_description/urdf/mg400_description.urdf).
The two principal links are approximately 175 mm; coupled rotations keep the
wrist vertical. The small URDF wrist-axis skew is idealized as vertical. The
reference TCP is 100 mm below the URDF wrist joint origin by default, editable
in the viewer. It is not an installed-tool calibration or vendor Tool0 definition.
The published [MG400 joint ranges](https://www.dobot-robots.com/products/desktop-four-axis/mg400.html)
are nominal inputs; actual hardware/software version and coupled interference
limits still need checking. The standalone preview does not change the existing
Lua exporter or impose these nominal transforms on saved prints.

[Dobot print sampling](../../core/machine/dobot-kinematic-player.mjs) consumes
the existing Lua interpreter's controller coordinates and CP=0 acceleration
timing, checks IK at time samples and returns a standalone playback record.
The caller must explicitly align those coordinates with the model frame; the
example bed and tool are synthetic. Serve a generated preview with
`node tools/split-delta/server.mjs --dobot-preview preview.json` and open the
printed Dobot URL. The same server accepts both print-preview arguments.

DENSO has a separate [nominal Studio model](../../core/machine/README.md#denso-vp-6242)
with drawing-based centerlines and explicit model-angle seeds. Controller-matched
arm motion still needs its redundancy and branch policy established. The VP-6242 has six arm axes; the
external bed makes seven actuators. Full task pose constrains six coordinates
and leaves one redundancy; a five-coordinate nozzle task leaves two. An explicit
bed angle and full orientation remove continuous redundancy at a nonsingular
pose, but discrete arm branches and wrist winding still require a deterministic
policy matching controller behavior. The existing Cartesian/rotary source
interpreter does not establish that policy.

[Studio studies](../kinematics/README.md) reuse Splitty and Dobot models in the
shared machine viewer and also support Tilty and nominal DENSO. Existing
`.sdgcode` source can be opened there without rewriting its bytes.

## Exact-path scale optimization

`optimize-path.mjs` explores smaller near-edge pivot layouts at the original
180 mm base tower radius, 50 mm rail-pair spacing and 450 mm rods.
`study-rails.mjs` compares 40°/45° operating tilt and 0, 3, 6, 9, 12, 15°
outward rail inclination. Only the base footprint is fixed; upper width may grow.
`validate-study.mjs` refines compact candidates and checks finalists on the
complete loaded path, then reinterprets the scaled source at 1 mm / 0.5° maximum
sampling increments. Each pose is also checked at 26 rotation-vector directions
on a 4° reserve sphere. Directional and path sampling remain finite.

The compact study bounds the pivot envelope to 110 mm diameter and adjacent
pivot-center gaps to at least 15 mm. It uses a 5 mm rim around the pivot hull,
6 mm plate thickness and 2 mm clearance above an infinite bed plane. These are
explicit design assumptions, not measured components. The nose is at least
40 mm, and is lengthened as needed so a circumdisk enclosing that plate clears
the bed throughout the required tilt plus reserve. This avoids a spurious
optimum where a short tool puts the plate below the bed. Other collisions,
including rods, sockets, the hotend and already-deposited material, are unmodeled.

Uniform scaling transforms every absolute XYZ command, including startup and
final travel. The 45° variant retains the loaded orientation sequence; the 40°
variant explicitly caps inclination further and rebuilds the minimal-twist frame.
Extrusion and feed words stay unchanged for this geometry-fit experiment.
Consequently the scaled preview is **not** a resliced manufacturing program:
bead dimensions, flow and timing require separate planning. Source hashes,
scale brackets, joint requirements and working travel accompany generated files.
A reported path diameter describes deposited centerlines, not an all-orientation
cylindrical workspace or collision-certified printable diameter.

Serve a generated study with:

`node tools/split-delta/server.mjs --preview study/compact-45.sdgcode --study study/validated-results.json --dobot-preview dobot-preview.json`

The study page links to both 45° and 40° comparisons. A profile saved from the
page contains its selected geometry. The numerical defaults retain the original
163 mm pivot-envelope / 120 mm nose candidate for reproducible comparisons.

## Cladding profile clearance

`cladding-clearance.mjs` checks the wavy part using its 41 circular horizontal profiles. Rod centerlines intersect the radial frusta analytically; the check includes an assumed 3 mm rod radius and 1 mm clearance. A conservative plate prism encloses the pivot disk plus a 5 mm rim and 6 mm thickness; horizontal cuts use at most 2 mm spacing and 1 mm profile clearance. The source body profile is inflated by 0.8 source mm to cover four cladding shells. The hotend is excluded at the user’s direction. This specialized shortcut rejects non-circular input profiles.

Each cladding source endpoint is checked against the completed body, or an explicitly selected stage-height cap. A stage cap studies clearance if the wall and cladding are interleaved; it does not reorder the source file or validate transitions between stages. Alternative approach azimuths and constant radial tilt are pose studies, not generated continuous orientation plans. Rod/plate checks do not certify the unsampled swept motion or real hardware dimensions.

The current machine profile uses 40° head tilt, a 64 mm tool offset, 34 mm plate pair-center radius and 86 mm pivot-pair spacing. The top rail endpoints remain at tower radius 180 mm and Z=900 mm; inward 5° rails place the base radius at 258.7398 mm and the rail coordinate at the top at 903.4379 mm. Numerical module defaults retain the original design for comparisons.

## Physical search and assembly clearance

`node tools/split-delta/optimize-physical.mjs` varies physical dimensions and uniform
scale of the existing 40-degree-adapted source, preserving orientations and order.
Its objective is part-cylinder volume divided by the cylinder using the arithmetic
average of bottom/top physical rail envelopes and full configured machine height.
The bed and 20 mm rail-body allowance contribute to that envelope; hiding rails
changes no score. `SPLITTY_ITERATIONS` sets the mutation count (default 1800).

Operating tilt is 40 degrees. Rod/joint margins apply once at operating poses.
Separate orientation probes test raw kinematic boundaries with zero added margin,
no collision test and no track-end requirement. Operating poses determine working
travel. Probe coverage is sampled, not proof of distance to every singularity.

Assembly checks use finite-segment capsule distances, including full rods against
their own rails. A fixed 25 mm inward mounting stand-off separates the spherical
pivot trajectory from the physical rail centerline. A 1 mm surface gap is required.
Full configured rails are checked. Finalists check rod/rod, rod/rail, rod/bed,
rail/rail, rail/part and rod/part, including interpolated travel. Plate/part checks
remain at cladding endpoints. Nozzle, plate/rail, carriage housings, socket bodies,
mounting brackets, drives and frame beams are not modeled. These are candidate
geometry checks, not complete assembly certification or structural evidence.

Physical-search candidates must also retain the intended paired-edge plate layout:
each tower's two anchors stay in its own radial sector, and the convex plate
perimeter follows A1,A2,B1,B2,C1,C2 cyclic order. Point separation alone does not
prevent adjacent towers from interleaving. General IK still permits other layouts
for diagnosis; the viewer flags them and the optimizer rejects them.

Set `SPLITTY_ROD_LENGTH=150` to fix all rods at150 mm and maximize part scale
instead of the average-cylinder ratio. Rail placement and other bounded physical
parameters remain variable; the toolpath is unchanged except uniform XYZ scale.
Equal-scoring feasible mutations can replace older candidates, allowing geometry
to improve before scale increases. Finalists retain the paired-edge constraint and
receive full-path checks. Output is under `Prints/development/splitty-fixed-150-rods`.
