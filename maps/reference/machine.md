# Machine presentation models

## Implementation responsibilities

`8a_profile` owns known profile selection, capability checks, setup validation
and reconstructed machine-path checks. The files in `machines/` are declarations
consumed at that boundary, not executable provider paths. `8b_frames` owns rigid
installation transforms and sampled Dobot joint playback. The main machine page
owns provider selection, inverse solvers, jog continuation and Studio binding.
The [provider contract](presentation.md) specifies coordinates, source identity,
asynchrony and consumer behavior; the [machine file contract](machine-files.md)
specifies configured capabilities. Use [machine tests](testing.md#test-registry)
for the affected mechanism and integration boundary.

[presentation.mjs](../../core/machine/presentation.mjs) implements the provider side of the
[Studio contract](presentation.md). Gantry machines are drawn from profile data alone (`kinematics` of
`cartesian-fixed-vertical-nozzle` and the profile bounds), so every such
profile gets the schematic without code. A closed registry selects the two arm
models by machine ID. Profiles supply data, never executable module paths.
The renderer receives simple rigid components and world transforms; it has no
machine-specific solvers. [Study tools](../../tools/kinematics/README.md) open
nominal mechanisms in the same Studio.

## Source and installation

[source-time.mjs](../../core/export/source-time.mjs) evaluates one source time for both
the toolpath and its machine. It preserves Dobot's interpreted acceleration,
DENSO's nominal Cartesian/rotary interpolation, and study-specific Euler
interpolation. Reverse seeks do not depend on previous screen frames.
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

Machine view supplies manual XYZ tool-position sliders, plus three Euler angles
for DENSO or yaw for an aligned Dobot.
The provider owns their coordinates and ranges, and reuses its source-pose solver.
Unaligned robots do not offer arm controls. Manual poses remain temporary display
state; they do not alter source programs or authorize hardware motion.
Rail lines show fixed working carriage limits from the machine definition.
They do not depend on loaded source or expand during slider movement.
Slider spans conservatively cover the geometry's workspace instead of using
the print display bounds. These fixed spans contain the modeled motion, not
just sampled source poses.
[jog.mjs](../../core/machine/jog.mjs) prioritizes the dragged coordinate
and adjusts other coordinates through local constraint projection; all returned
poses pass the owning model checks. S5/H2D enforce travel bounds, Dobot
supplies reach and reserved joint limits, and DENSO uses nominal wrist reach plus
its existing seeded IK branch. A solve failure stops the jog; unknown physical
socket limits and collisions remain outside these nominal models.
The [presentation contract](presentation.md#provider-interface) owns
manual request identity, display retention and return-to-playback behavior.

## Dobot

[dobot-kinematics.mjs](../../core/machine/dobot-kinematics.mjs) uses nominal
[official MG400 URDF](https://github.com/Dobot-Arm/MG400_ROS/blob/main/mg400_description/urdf/mg400_description.urdf)
centerlines with an idealized vertical wrist. Its fixed elbow branch and
deterministic wrist winding are model policies. They do not verify the installed
controller's user/tool frames or coupled interference. The program
sampler now consumes the shared command-time evaluator.

## DENSO VP-6242

[denso-kinematics.mjs](../../core/machine/denso-kinematics.mjs) uses the nominal centerlines in
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
the [production output contract](denso.md) remains unchanged.

## Verification

[machine-presentation.test.mjs](../../core/tests/machine-presentation.test.mjs) includes
DENSO drawing reference poses, frame alignment and shared provider behavior.
[machine-study.test.mjs](../../core/tests/machine-study.test.mjs) exercises
the real study adapters, source identity, refusal of manufacturing operations,
all registered providers, and deterministic source playback.


## Changing machine profiles and capability checks

Sources: [profile.mjs](../../core/machine/profile.mjs), [rules.mjs](../../core/machine/rules.mjs), [denso.mjs](../../core/machine/denso.mjs).

**Contract.** Known machine IDs load their checked-in JSON profiles; setup validation resolves units, limits, tools/materials and declared output availability. Geometry review may proceed with documented unresolved installation fields, while export requires the machine-specific setup. Path checks validate finite axes, bounds, flow and supported actions; they do not simulate collisions. What differs between non-robot machines is profile data, never a machine-ID test in code: `ams` (feeder units and slots per unit that a setup may request), `limitations` (notes added to the shared list), `startup.handsOverRetracted` (the startup leaves the previous job's withdrawal outstanding) and an output's `defaultFilamentColor`. Only the Dobot and DENSO, whose installation validators, relay rules and arm models are genuinely their own, are still selected by ID.

**Failures.** Reject unknown profiles, invalid limits/setup and unsupported actions. A profile listing an output with implemented false cannot enable it. Robot installation placeholders must not acquire invented defaults merely to pass export.

**Change together.** Update profile schema/data, output registry/dialect, plan normalization, priming/process controls and presentation configuration together. Distinguish checked-in machine facts from per-installation setup.

**Verification.** Test supported/unsupported outputs, unresolved installations, boundary/flow limits and action restrictions across affected profiles. Checks: [printer-profiles.test.mjs](../../core/tests/printer-profiles.test.mjs), [export.test.mjs](../../core/tests/export.test.mjs), [denso.test.mjs](../../core/tests/denso.test.mjs), [dobot.test.mjs](../../core/tests/dobot.test.mjs).
