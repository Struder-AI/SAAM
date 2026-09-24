# Machine presentation models

[presentation.mjs](./presentation.mjs) implements the provider side of the
[Studio contract](../../studio/KINEMATICS.md). Gantry machines are drawn from
profile data alone (`kinematics` of `cartesian-fixed-vertical-nozzle` and the
profile bounds), so every such profile gets the schematic without code. A closed registry selects the two arm
models by machine ID. Profiles supply data, never executable module paths.
The renderer receives simple rigid components and world transforms; it has no
machine-specific solvers. [Study tools](../../tools/kinematics/README.md) open
nominal mechanisms in the same Studio.

## Source and installation

[source-time.mjs](../export/source-time.mjs) evaluates one source time for both
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
[jog.mjs](./jog.mjs) prioritizes the dragged coordinate
and adjusts other coordinates through local constraint projection; all returned
poses pass the owning model checks. S5/H2D enforce travel bounds, Dobot
supplies reach and reserved joint limits, and DENSO uses nominal wrist reach plus
its existing seeded IK branch. A solve failure stops the jog; unknown physical
socket limits and collisions remain outside these nominal models.
The [presentation contract](../../studio/KINEMATICS.md#provider-interface) owns
manual request identity, display retention and return-to-playback behavior.

## Dobot

[dobot-kinematics.mjs](./dobot-kinematics.mjs) uses nominal
[official MG400 URDF](https://github.com/Dobot-Arm/MG400_ROS/blob/main/mg400_description/urdf/mg400_description.urdf)
centerlines with an idealized vertical wrist. Its fixed elbow branch and
deterministic wrist winding are model policies. They do not verify the installed
controller's user/tool frames or coupled interference. The program
sampler now consumes the shared command-time evaluator.

## DENSO VS-068A4

[denso-kinematics.mjs](./denso-kinematics.mjs) uses the nominal centerlines in
[DENSO VS-068 drawing](https://www.denso-wave.com/fsys/en/robot/product/five-six/vs068-087/en_VS-068-W.pdf):
395 mm shoulder height with 30 mm radial offset from J1, 340 mm upper arm,
340 mm forearm with 20 mm elbow offset, and 80 mm standard wrist-to-flange
length. A separate installed tool length extends the flange. These dimensions
also agree with the supplied WINCAPS model pivots. The shoulder offset rotates
with J1; nominal reach margins account for that offset before seeded IK.

An explicit DENSO `flangeFromTool` rigid transform can replace the scalar
extension. Its translation is the TCP offset in mechanical flange coordinates;
its rotation maps tool axes into flange axes, with tool **+Z toward extrusion**.
The presentation converts that into its own -Z nozzle convention. For the reported
Tool 6, translation is [155,0,35] mm and rotation is +90 degrees about flange Y.
The schematic draws the flange-normal leg and the in-plane leg separately, and
nominal IK/reach calculations use the complete transform. A straight tool length
alone cannot represent this right-angle tool.

The nominal model defines flange +Z along the model wrist +X, flange +X along
model wrist -Z, and flange +Y along model wrist +Y. That fixes a model wrist-zero
convention; it is not evidence of the installed RC8 joint zeros, FIG branch or
joint-limit mapping. Changing a tool transform does not establish those mappings.

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

Presentation poses, frame alignment, provider conformance and study-adapter
behavior have no stored tests: their expected values follow from the model and
the contracts above, so write the checks you need on demand. The external
controller facts they build on stay covered by [denso.test.mjs](../tests/denso.test.mjs)
and [dobot.test.mjs](../tests/dobot.test.mjs).
