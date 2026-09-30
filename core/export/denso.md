# DENSO RC8A output

The experimental PacScript output contract and unresolved installation requirements. See the [shared machine interface](./README.md) for common motion semantics.

### DENSO RC8A output contract

The [pipe-cladding implementation](../../skills/pipe-cladding/SKILL.md) targets RC8A;
[BR-033](../../DEVLOG.md#br-033--denso-rc8-rotary-pipe-demo) records the user's scope.
The [VS-068A4 profile](../../machines/denso-vs068a4-rc8a.json) represents
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
reach/joint/motion limits or avoid collisions. A separate
[nominal presentation model](../machine/README.md#denso-vs-068a4) supplies
drawing-based FK/seeded IK when its display installation is explicit; it does
not establish the RC8A encoder/FIG mapping or authorize output.
Profile bounds are display/design coordinates, not enforced robot reach.

The shared motion representation has optional `initialPose` and per-move `pose`:
`rotaryDeg` is unwrapped, `toolAxis` is tool Z toward extrusion, and `toolUp` is
tool Y. Unit/perpendicular vectors define orientation without Euler ambiguity.
Points and directions are in part coordinates; rotation about `rotaryCenterMm`
maps them into the stationary room. Installation translation/yaw maps that room
to a calibrated RC8A Work frame with Z parallel to the bed axis. Ceiling mounting
belongs in the controller's calibrated frames; no guessed base height or arm
geometry is inserted. Machine setup owns start pose, transforms, IO and controller
selectors. The first implementation wires this through `setup.denso`; a second
oriented machine should extract that configuration mapping behind the existing
profile interface rather than fork skills or the workflow.

The existing composer receives point-aligned `poses`, preserves their authored
order and passes them to the shared builder. Nearest-stroke reordering currently
rejects oriented strokes because arbitrary reversal/closed-loop rotation would
also have to transform pose and winding data. The scheduler itself is unchanged:
explicit predecessor edges order the complete substrate and each radial shell.
Fixed-axis skills imply the downward pose and zero bed angle; their existing
process slope limits still apply. Pose-only motion survives emission and oriented
moves are not coalesced. Prescribed tool retreat, reorientation, relocation and
approach are shared transitions, with nonextruding on-surface indexing between
adjacent axial tracks. These are authored travel policies, not solved clear routes.

The `denso-pacscript` output is a ZIP of `main.pcs`, included helper `.pcs` sources
and a machine/setup identity manifest. It is not a complete WINCAPS project.
The exporter uses literal `Move L, @0 T(x,y,z,ox,oy,oz,ax,ay,az,figure)` with
relative `EX((axis,delta))` and requested `Time` milliseconds. `TakeArm`,
`ChangeTool`, `ChangeWork`, `Set/Reset IO` and off-state `Delay` form the rest of
the bounded source subset. A program of any length is written: helpers split it
into source blocks of at most 2,000 statements each, called in order, which
changes no motion; installed compiler/project limits are not verified. The current source ZIP must be imported into a correctly configured WINCAPS III
RC8A project for vendor verification. Direct USB program import through a
controller-created project is a scoped candidate, not an implemented SAAM
export; see the [USB/project assessment](./denso-usb-assessment.md).
RC8A solves Cartesian IK using its installed tool/work definitions and figure.

All installation selectors start unresolved. The implemented rotary interface
is explicitly `rc8a-relative-ex`, requiring a configured RC8A extended joint.
Axis 7 is a provisional slot, not evidence the user's bed is installed there.
An independent rotary controller needs an execution adapter with synchronization.
Start position/pose and rotary zero must already match the manifest/setup; the
program does not home or position the system before printing. Heating is external.
The relay model matches Dobot's distinction between commanded material intent
and duration-times-rate estimates. No metered E axis, retract, fan or temperature
control is invented. Constant relay flow cannot guarantee the intended varying
bead volume, particularly near tapered ends, speed changes and endpoint stops.

The same browser-safe interpreter reads the actual T, EX, TIME and IO commands
from the checked ZIP. Comments supply process identity and volume intent only,
never playback coordinates. It reconstructs deposition relative to the bed,
including a fixed-room TCP tracing a curve during multiple rotary revolutions.
A program of any length is read: each command subdivides as far as its own sweep
and travel require, and the reader fails only when a source keeps executing
statements without emitting motion or a process event for longer than the whole
loaded package could run straight through.
Studio defaults to a rotating bed/material view; **Follow build plate** uses
the same data with a stationary part. The nozzle is shown without invented
joint animation. Playback assumes synchronized linear Cartesian/rotary progress
at external speed 100%; actual interpolation, acceleration, override, endpoint
stops and IO latency are unverified. `@0` makes this an experimental segmented
execution model, even where planned geometry is continuous. Software checks
report that bounded source contract and do not claim axis-feed, reach or
collision validation. Vendor compilation, coordinated execution and physical
printing remain open commissioning work.

Interoperability is shared at geometry storage, ordinary section/offset/boolean
tools, full-fill/concentric substrate generation, operations, motion, output
registry, exact-source Studio, approvals, cold reopening and delivery. The circular
radial skill is restricted to a native circular pipe aligned with the rotary;
general CAD cylindrical recognition and inward radial material-region interfaces are
not implemented. Explicit surface cladding also accepts a periodic native
spline patch or mapped native triangle strip through
[surface-region](../geom/surface-region.mjs). Shared
[normal-surface](../region/normal-surface.mjs) operations evaluate outward normal
offsets and refine curves; they do not use the intrinsic boundary-offset tool.
The selected surface describes the substrate, and cladding adds outside it.
The `spline-tube` builder stores a periodic 16-by-8 example in native 3DM with a
rational circular bore; full-fill consumes its real sections with three
perimeters. Arc-length cells create partial axial passes as local area varies.
Scope, mesh normal interpolation, sampled coverage, unsupported topology and
normal-field limits are owned by the [cladding manual](../../skills/pipe-cladding/SKILL.md#bumpy-spline-and-explicit-surface-cladding).
The producer uses the same composer, oriented travel, RC8A export and approval
workflow. General inward reservations, arbitrary chart unwrapping and multi-patch
cladding remain unimplemented.
Tests include the existing mesh/spline base-vase-cap-infill-drape stack at fixed
orientation on RC8A and ordinary pipe geometry on S5.

Large RC8A programs can exceed 64 helper files. Shared ZIP output uses the
ZIP32 non-sentinel entry limit of 65,534 while retaining CRC, path, size, overlap
and inventory checks. Studio streams the exact checked source inventory in one
NDJSON response instead of reloading the archive per helper. The browser still
checks every file hash and the server binds the stream to print/revision/export
identity. This changes transport, not interpretation or approval requirements.

Primary technical references used for this experimental command contract:

- [DENSO VS-068 specifications](https://www.denso-wave.com/en/robot/product/five-six/vs068-087.html).
- [RC8 Provider Guide: position types and motion options](https://www.fa-manuals.denso-wave.com/subfolder/en/usermanuals/img/001511/RC8_ProvGuide_en.pdf).
- [DENSO TIME motion lesson](https://www.denso-wave.com/ja/robot/support/learning/d-learning/lesson3/l3-1/modals.html).
- [DENSO RC8/RC8A extended-joint option](https://support.densorobotics.com/en/support/solutions/articles/60000698512-extended-joint-option-for-rc8-rc8a).
- [DENSO RC8-series source extension guidance](https://www.denso-wave.com/ja/robot/support/learning/d-learning/faq/ja/Robot_Controller/RC8/faq005.html).
