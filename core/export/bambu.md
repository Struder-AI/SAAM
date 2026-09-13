# Bambu H2D output

The experimental H2D export contract. See the [shared machine interface](README.md) for common motion semantics.

### H2D output contract

H2D output is **experimental**. Its software reference is the supplied Bambu
Studio 02.08.02.61 right- and left-nozzle sliced exports; the machine file records
their SHA-256 hashes. Only their envelope and format facts define the contract;
reference geometry, thumbnails and personal settings stay outside generated
output and Git. The [reference checks](../../DEVLOG.md#2026-09-09-to-2026-09-10--h2d-reference-and-startup-checks)
do not establish successful physical printing or universal firmware compatibility.

The H2D hardware profile follows Bambu Lab's official supported diameters:
0.2, 0.4, 0.6 and 0.8 mm hardened-steel hotends; 0.4 mm is included by default.
The current path uses one selected nozzle, a compatible generic 1.75 mm material,
Textured PEI and **no chamber heating** (`buildVolumeC: 0`). Left is the shipped
default. Left/right package maps are 1/2, nozzle IDs 0/1, and physical
heater selectors 1/0. Logical material `T0 H-1` remains the same under Bambu's
remapping. Do not replace all T numbers to select a nozzle. Package structure
also follows [Bambu Studio's format implementation](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Format/bbs_3mf.cpp).

The pinned start/end arrays originate in the reference's executable blocks.
Machine revision 4 uses `h2d-02.08.02.61-pla-textured-v2`, which omits startup
triage item H10: initial X homing, early wiping-area moves, `M972 S24` and the
`M1009`-bracketed Z-clearance/center-positioning/Z-homing sequence (13 lines). Machine revision 6 adds
`h2d-02.08.02.61-generic-material-textured-v3`, parameterizing the declared nozzle
diameter and generic material in calibration and package metadata while retaining
the same command order. Adjacent
object/bin checks and all later probing, calibration and priming remain; this
is not a no-probing startup. The revised sequence requires physical testing.
The adapter still recognizes the pinned v1/v2 envelopes in existing snapshots;
upgrade and regenerate a chosen bundle to use v2, with normal plan/toolpath
review invalidation. Existing exports and delivery files are not rewritten.
Allowed substitutions are planned temperatures, selected physical heater,
declared nozzle diameter and generic material identifier,
placed geometry's probe rectangle and whole-plan shutdown/parking clearance.
The reference PLA purge recipe uses 240 °C and up to 25 mm³/s independently of
the conservative print-body flow limit. The startup explicitly establishes
`[100,100,20]` before the body's explicit units, absolute XYZ/E, extrusion reset
and temperature waits. Whole-plan shutdown lifts by at least 10 mm and never
descends below the completed path's maximum Z; parking remains at or below
320 mm. Reject a plan that cannot fit that clearance. The bed's -0.02 mm
Textured PEI correction and service-area purge moves are part of the firmware
contract, not object geometry.

Probing, homing, wiping, purge, calibration, unloading and firmware-conditioned
service moves are **not motion-simulated**. The interpreter matches the complete
rendered envelope to its pinned contract; altered or unknown commands are
rejected. Firmware flags remain controlled by the printer. Calibration may heat
both nozzles; the scoped S5 promise about unused-nozzle heating does not apply
to H2D. Inside that envelope, the shared modal engine reconstructs XYZ,
deposition, retractions, fan and dwell from the actual G-code and checks bounds,
feeds, flow and temperature state. Studio displays this print body and states
the simulation boundary. Its time and material totals exclude service routines.
Envelope matching is not a proof of their physical motion or clearance.

The H2D print body uses `M83` relative extrusion, matching the supplied Bambu
Studio reference. Older H2D artifacts using cumulative `M82` extrusion are unsafe
to reuse. The [physical failure and correction](../../DEVLOG.md#br-019--h2d-wedge-and-studio-reopenactivity)
explain the second-layer regression; corrected output still requires a physical
retest. S5 uses its separate Griffin `M82` contract.

`bambu-gcode` produces `exports/bambu-gcode/part.gcode.3mf`. The output registry
accepts text or binary artifacts; the shared lifecycle hashes and checks the
complete artifact. ZIP entries have deterministic bytes/dates,
CRC checks and a G-code MD5. No filesystem extraction is needed. The package
contains fresh metadata and a schematic thumbnail generated from interpreted
printing moves. Metadata, program and thumbnail must agree. Studio's code view
reads the archive's G-code; toolpath approval binds the complete archive hash,
and delivery copies the original archive unchanged. Unsupported ZIP features,
unknown envelopes and edited files fail closed.

Software tests cover both nozzle maps, both geometry backends, supported skill
integration, malformed/tampered output and the shared approval/HTTP delivery path.
Independent Bambu Studio program-viewer import and physical validation remain
[open acceptance checks](../../build_request.md#br-018--h2d-acceptance-and-physical-retest).
Model-import CLI checks do not verify the program-viewer route.
Older H2D bundles must explicitly set `buildVolumeC: 0`
with `adjust` before `upgrade`; plan/toolpath approvals are invalidated normally.
