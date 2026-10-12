---
name: denso
description: DENSO VS-068A4 with RC8A PacScript output contract
metadata:
  saam-kind: machine
---

# DENSO RC8A output

The experimental PacScript output contract and unresolved installation requirements. See the [shared machine interface](../../core/export/README.md) for common motion semantics.

### DENSO RC8A output contract

The [pipe-cladding implementation](../../skills/pipe-cladding/SKILL.md) targets RC8A;
[BR-033](../../DEVLOG.md#br-033--denso-rc8-rotary-pipe-demo) records the user's scope.
The [VS-068A4 profile](denso-vs068a4-rc8a.json) represents
a six-joint arm plus one external rotary; the printing task's position/direction
control is not a claim that the robot has only five joints. Ceiling mounting
with J1 coaxial with the rotary is provisional. At a chosen outward radius the
robot reaches down from its base, bends its elbow and tilts its wrist to bring
the nozzle to the wall. The rotary can bring every azimuth to that working side,
reducing the arm's need to sweep around the pipe. Small radii near the base axis,
large radial/vertical distances and extreme wrist orientations can still be
inaccessible or singular. No single cylindrical reach envelope establishes
feasibility. Operator judgment and the configured RC8A handle these limitations
for production output; SAAM does not use IK to validate export, check
reach/joint/motion limits or avoid collisions. The nominal
[kinematics](#kinematics) model supplies drawing-based FK/seeded IK for Studio
when its display installation is explicit; it does not establish the RC8A
encoder/FIG mapping or authorize output.
Profile bounds are display/design coordinates, not enforced robot reach.

The SAAMpath has optional `initialPose` and per-move `pose`: `toolAxis` is tool Z
toward extrusion and `toolUp` is tool Y, unit and perpendicular, in part
coordinates. The table angle is DENSO's own choice ([kinematics](#kinematics)):
rotation by `setup.denso.tableDeg` about `rotaryCenterMm` maps the part into the
stationary room. Installation translation/yaw maps that room
to a calibrated RC8A Work frame with Z parallel to the bed axis. Ceiling mounting
belongs in the controller's calibrated frames; no guessed base height or arm
geometry is inserted. `setup.denso` owns start pose, transforms, IO and controller
selectors.

The composer keeps oriented strokes in their authored order (nearest-stroke
reordering refuses them); explicit predecessor edges order the substrate and each
radial shell. Fixed-axis skills imply the downward pose and keep their slope limits.
Reorientation is ordinary travel (retreat along the tool axis, travel while the
orientation interpolates, approach), with nonextruding on-surface indexing between
adjacent axial tracks. These are authored travel policies, not solved clear routes.

The `denso-pacscript` output is a ZIP of `main.pcs`, included helper `.pcs` sources
and a machine/setup identity manifest. It is not a complete WINCAPS project.
The exporter uses literal `Move L, @0 T(x,y,z,ox,oy,oz,ax,ay,az,figure)` with
relative `EX((axis,delta))` and requested `Time` ms (none for a turn in place). `TakeArm`,
`ChangeTool`, `ChangeWork`, `Set/Reset IO` and off-state `Delay` form the rest of
the bounded source subset. A program of any length is written: helpers split it
into source blocks of at most 2,000 statements each, called in order, which
changes no motion; installed compiler/project limits are not verified. The current source ZIP must be imported into a correctly configured WINCAPS III
RC8A project for vendor verification. Direct USB program import through a
controller-created project is a scoped candidate, not an implemented SAAM
export; see the [USB/project assessment](denso-usb-assessment.md).
RC8A solves Cartesian IK using its installed tool/work definitions and figure.

All installation selectors start unresolved; generation still builds and shows
the SAAMpath, and only the program waits for them. The implemented rotary interface
is explicitly `rc8a-relative-ex`, requiring a configured RC8A extended joint.
Axis 7 is a provisional slot, not evidence the user's bed is installed there.
An independent rotary controller needs an execution adapter with synchronization.
Start position/pose and rotary zero must already match the manifest/setup; the
program does not home or position the system before printing. Heating is external.
The relay model matches Dobot's distinction between commanded material intent
and duration-times-rate estimates. No metered E axis or temperature control is
invented; the SAAMpath's retraction and fan settings are omitted and named in the
program's limitations. Constant relay flow cannot guarantee the intended varying
bead volume, particularly near tapered ends, speed changes and endpoint stops.

Studio draws the SAAMpath, not the program; the debug verifier
(`debug/verify.mjs`) reads the checked ZIP's T, EX, TIME and IO commands.
Studio's machine view turns the bed by DENSO's table angle; **Follow build plate**
shows a stationary part. The program assumes synchronized linear Cartesian/external-axis progress
at external speed 100%; actual interpolation, acceleration, override, endpoint
stops and IO latency are unverified. `@0` makes this an experimental segmented
execution model, even where planned geometry is continuous. Software checks
report that bounded source contract and do not claim axis-feed, reach or
collision validation. Vendor compilation, coordinated execution and physical
printing remain open commissioning work.

Interoperability is shared at geometry storage, ordinary section/offset/boolean
tools, substrate generation, operations, motion, output registry, exact-source
Studio, cold reopening and delivery. Cladding accepts a periodic native
spline patch or mapped native triangle strip through
[surface-region](../../core/geom/surface-region.mjs); inward radial material-region
interfaces are not implemented. Shared
[normal-surface](../../core/region/normal-surface.mjs) operations evaluate outward normal
offsets and refine curves; they do not use the intrinsic boundary-offset tool.
The selected surface describes the substrate, and cladding adds outside it.
Scope, mesh normal
interpolation, sampled coverage, unsupported topology and normal-field limits are
owned by the [cladding manual](../../skills/pipe-cladding/SKILL.md#contact-and-pose).
The producer uses the same composer, oriented travel, RC8A export and review
workflow. General inward reservations, arbitrary chart unwrapping and multi-patch
cladding remain unimplemented.
Tests include the existing mesh/spline base-vase-cap-infill-drape stack at fixed
orientation on RC8A and ordinary pipe geometry on S5.

Large RC8A programs can exceed 64 helper files. Shared ZIP output uses the
ZIP32 non-sentinel entry limit of 65,534 while retaining CRC, path, size, overlap
and inventory checks. Studio streams the exact checked source inventory in one
NDJSON response instead of reloading the archive per helper. The browser still
checks every file hash and the server binds the stream to print, revision and
output id. This changes transport, not interpretation.

## Kinematics

[kinematics.mjs](kinematics.mjs), this extension's kinematics plug, gives the writer
and Studio's machine view every DENSO axis. Like the figure, DENSO chooses the
redundant table angle itself: it holds `setup.denso.tableDeg` (an older setup's
`initialPose.rotaryDeg`) for the whole program, so every `EX` delta is zero.
The nominal arm follows the
[VS-068 drawing](https://www.denso-wave.com/fsys/en/robot/product/five-six/vs068-087/en_VS-068-W.pdf),
matching the WINCAPS pivots: 395 mm shoulder height, 30 mm J1 offset, 340 mm upper
arm, 340 mm forearm with 20 mm elbow offset, 80 mm to the flange, then the tool
length or a `flangeFromTool` transform (tool **+Z toward extrusion**; Tool 6 is
[155,0,35] mm, +90 degrees about flange Y). Its **model angles** are not RC8A
encoder zeros or FIG. Nominal IK is a damped Jacobian solve from `modelSeedDeg`,
refusing the opposite elbow/wrist branch; it is one nominal solution, not RC8A
trajectory, joint limits or commissioning.

Primary technical references used for this experimental command contract:

- [DENSO VS-068 specifications](https://www.denso-wave.com/en/robot/product/five-six/vs068-087.html).
- [RC8 Provider Guide: position types and motion options](https://www.fa-manuals.denso-wave.com/subfolder/en/usermanuals/img/001511/RC8_ProvGuide_en.pdf).
- [DENSO TIME motion lesson](https://www.denso-wave.com/ja/robot/support/learning/d-learning/lesson3/l3-1/modals.html).
- [DENSO RC8/RC8A extended-joint option](https://support.densorobotics.com/en/support/solutions/articles/60000698512-extended-joint-option-for-rc8-rc8a).
- [DENSO RC8-series source extension guidance](https://www.denso-wave.com/ja/robot/support/learning/d-learning/faq/ja/Robot_Controller/RC8/faq005.html).
