# Machine presentation models

[presentation.mjs](presentation.mjs) implements the provider side of the
[Studio contract](../../studio/KINEMATICS.md). A closed registry selects the
model by machine ID. Profiles supply data, never executable module paths.
The renderer receives simple rigid components and world transforms; it has no
machine-specific solvers. [Study tools](../../tools/kinematics/README.md) open
nominal mechanisms or existing Splitty source in the same Studio.

## Source and installation

[source-time.mjs](../export/source-time.mjs) evaluates one source time for both
the toolpath and its machine. It preserves Dobot's interpreted acceleration,
DENSO's nominal Cartesian/rotary interpolation, and study-specific Euler or
gimbal interpolation. Reverse seeks do not depend on previous screen frames.
Providers solve at the requested pose, not interpolated joint endpoints.

`machine.kinematicModel` owns dimensions and optional installation data in the
machine snapshot. Study plans can override them with `setup.kinematicModel`.
`worldFromBase` is a rigid transform from the model's base coordinates into the
source display room; `toolLengthMm` describes the modeled installed tool.
Without explicit robot alignment, the provider supplies the known bed/tool
frames and declares the missing arm. Nominal setup in a study is synthetic,
not installation calibration. Non-unit Dobot design scaling cannot be represented
by a rigid physical overlay and leaves the arm unavailable.

The provider's `part` transform maps interpreted source points into the room.
It includes a printer's descending bed or the source's rotary angle exactly once.
Following the plate applies its inverse to the entire scene. S5/H2D models show
schematic travel centerlines from the profile bounds, an XY carriage and a Z bed;
they omit housings, belts and parked tools. Tool shapes are schematic: a short
cone marks the tip, and a line represents the configured tool length.

Machine view supplies manual XYZ tool-position sliders, plus two gimbal angles
for Tilty, three Euler angles for Splitty/DENSO, or yaw for an aligned Dobot.
The provider owns their coordinates and ranges, and reuses its source-pose solver.
Unaligned robots do not offer arm controls. Manual poses remain temporary display
state; they do not alter source programs or authorize hardware motion.
Rail lines show fixed working carriage limits from the machine definition.
They do not depend on loaded source or expand during slider movement.
Slider spans conservatively cover the geometry's workspace instead of using
the print display bounds. Tilty's rail cylinder bounds XY; the contained carrier
radius and unavoidable vertical rod projection bound Z with the nozzle lever.
These fixed spans contain the modeled motion, not just sampled source poses.
[jog.mjs](jog.mjs) prioritizes the dragged coordinate
and adjusts other coordinates through local constraint projection; all returned
poses pass the owning model checks. Delta manual posing also keeps the TCP above
the study bed plane. S5/H2D enforce travel bounds, Tilty supplies rod/rail/gimbal
and containment boundaries, Splitty supplies rail/reach/joint-reserve/singularity checks, Dobot
supplies reach and reserved joint limits, and DENSO uses nominal wrist reach plus
its existing seeded IK branch. A solve failure stops the jog; unknown physical
socket limits and collisions remain outside these nominal models.
The [presentation contract](../../studio/KINEMATICS.md#provider-interface) owns
manual request identity, display retention and return-to-playback behavior.

## Tippy

The machine's display name is Tippy; its existing profile ID remains `tilty`.

[tilty.mjs](tilty.mjs) models three vertical main carriages with paired rods,
an always-horizontal carrier, a two-axis gimbal and three independently driven
tilt carriages. The gimbal rotation is `Rx(pitch) Ry(tilt)`, in radians inside
the numerical model. There is no independent roll. With a specified nozzle tip,
the carrier center is `tip + R * [0, 0, toolLengthMm]`.

Main rods connect to stationary-in-carrier radial anchors. Each pair has equal
tangential spacing at both ends, forming the delta parallelogram. The three
tilt rods connect to hotend anchors at radial `rearRadiusMm`, axial
`rearLengthMm` behind the pivot. For each vertical rail, inverse kinematics uses
the positive root of the fixed rod-length equation. Main and tilt carriages
therefore move together when translation or tilt changes.

The default rear lever is 120 mm behind the pivot, with the nozzle tip 70 mm
ahead of it and a 35 mm horizontal-carrier radius. The longer rear lever improves
sampled tilt sensitivity; the smaller carrier reduces its footprint. These are
nominal study dimensions, not a collision-optimized physical design.

The profile defines working carriage travel in millimeters above the bed:
main rails start at `railMinMm: 249.5`, the three tilt rails at
`tiltRailMinMm: [284.3, 287.4, 287.4]`, and all end at `railMaxMm: 650`.
These lower stops omit travel unusable with the nozzle at or above the bed
across the allowed XY and gimbal motion, including the containment boundaries
below. Interval subdivision bounds the minima over carrier XY and gimbal angles;
reachable poses bound the other side to within 1 mm. The fixed gimbal axes make
the three tilt minima unequal. Stops are rounded down to 0.1 mm to preserve
modeled reach, leaving at most 1.1 mm of conservative lower travel.
Recalculate them after geometry changes with the
[rail-limit authoring tool](../../tools/kinematics/README.md#lower-rail-limits).

The nozzle tip stays at or above Z=0 and inside the vertical rail cylinder.
The entire circular carrier plate stays inside that cylinder, as does the
triangular tilt plate joining the three rear ball joints. This checks the
modeled plate outlines; unmodeled housings and thickness are not implied.
Studio draws the rail-radius footprint at bed height, with X/Y sliders spanning
its full diameter. Height has a conservative geometry-derived span; manual
jogging resolves its coupled limits through the full model.

The **main-arm envelope** is the intersection of the three inward half-spaces
whose side planes each contain one paired main arm. They extend upward beyond
the main carriages to accommodate the tilt carriages. The planes skew with the
carrier position and carriage heights. Both endpoints of every tilt rod must
stay inside all three planes. Since each half-space is convex, these checks
contain the entire straight rods and the triangular tilt plate, including its
interior. This envelope is a geometric containment boundary, not a rod-to-rod
clearance or housing collision calculation.

Six actuator positions control five tool coordinates. The third tilt actuator
is redundant actuation: its position must satisfy the same gimbal geometry.
`tiltyForward` solves five coordinates from all six heights and rejects
incompatible positions or nonconvergence. It requires a nearby pose seed.
`tiltyInverse` rejects independent roll, unreachable rods, track overflow and
the configured tilt-cone limit. `marginDeg: 4` keeps every main and tilt rod
at least four degrees above horizontal, away from its upper/lower branch
inversion. The tilt cone also stays at least that far from gimbal lock.
As in Splitty, parallel singularities use a separate normalized singular-value
ratio threshold (`minSingularRatio: 0.02`), not an angular distance claim.
Tilty evaluates the six-constraint, five-coordinate Jacobian with carrier XYZ
and gimbal angles scaled by the rear-anchor lever length. The same signed
margins constrain manual jogging. These checks do not model forces, compliance,
socket limits, actuator dynamics or collisions. Profile dimensions are initial
design values, not an optimized or physically validated machine.

## Splitty and Dobot

[split-delta.mjs](split-delta.mjs) remains the existing six-carriage, six-DOF
reference model; the [lab manual](../../tools/split-delta/README.md) owns its
dimensions, assembly branches and sampled assessment limits. Studio reuses it.

[dobot-kinematics.mjs](dobot-kinematics.mjs) uses nominal
[official MG400 URDF](https://github.com/Dobot-Arm/MG400_ROS/blob/main/mg400_description/urdf/mg400_description.urdf)
centerlines with an idealized vertical wrist. Its fixed elbow branch and
deterministic wrist winding are model policies. They do not verify the installed
controller's user/tool frames or coupled interference. The standalone program
sampler now consumes the shared command-time evaluator.

## DENSO VP-6242

[denso-kinematics.mjs](denso-kinematics.mjs) uses the nominal centerlines in
[DENSO drawing 001050_1](https://www.denso-wave.com/fsys/en/robot/product/five-six/vp/001050_1.pdf):
280 mm shoulder height, 210 mm upper arm, 210 mm forearm with 75 mm elbow offset,
and 70 mm wrist-to-flange distance. A separate tool length extends the flange.

These are explicitly **model angles**, not RC8 encoder zeros or FIG values.
At model zero, the upper arm points +Z, the forearm points +X with a +Z offset,
and the flange points +X. The local axes are Z, Y, Y, X, Y, X. The source nozzle
convention is converted to presentation -Z at the boundary.

Nominal IK uses a damped Jacobian solve from explicit `modelSeedDeg` (six model
angles in degrees). Each sample starts from that seed and rejects a result on
the opposite elbow/wrist seed branch; previous rendering order is irrelevant.
Nonconvergence is visible. This models one nominal solution, not the RC8's
trajectory, joint limits, winding policy or commissioning. Matching RC8 arm
motion requires verified installation transforms and an encoder/FIG mapping;
the [production output contract](../export/denso.md) remains unchanged.

## Verification

[machine-presentation.test.mjs](../tests/machine-presentation.test.mjs) includes
analytical neutral Tilty heights, fixed rods, nozzle-lever compensation,
inconsistent redundant actuation, DENSO drawing reference poses and frame
alignment. [machine-study.test.mjs](../tests/machine-study.test.mjs) exercises
the real study adapters, source identity, refusal of manufacturing operations,
all registered providers, and unchanged Splitty source playback.
