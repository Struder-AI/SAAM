# Bambu H2D output

The experimental Bambu export contracts. H2D and X1 Carbon share one exporter,
interpreter and package writer ([bambu.mjs](../../core/export/bambu.mjs)); each
machine file owns its pinned envelope, output constraints, shutdown heights and
package facts. See the [shared machine interface](output.md) for common motion semantics.

### H2D output contract

H2D output is **experimental**. Its software reference is the supplied Bambu
Studio 02.08.02.61 right- and left-nozzle sliced exports; the machine file records
their SHA-256 hashes. Only their envelope and format facts define the contract;
reference geometry, thumbnails and personal settings stay outside generated
output and Git. The [reference checks](../../DEVLOG.md#2026-09-09-to-2026-09-10--h2d-reference-and-startup-checks)
do not establish successful physical printing or universal firmware compatibility.

The initial contract supports one selected standard hardened 0.4, 0.6 or 0.8 mm
nozzle, 1.75 mm PLA, Textured PEI and **no chamber heating** (`buildVolumeC: 0`).
Left is the default. Left/right package maps are 1/2, nozzle IDs 0/1, and
physical heater selectors 1/0. Logical material `T0 H-1` remains the same under
Bambu's nozzle remapping. Do not replace all T numbers to select a nozzle.
Package metadata records both installed diameters and declares hardened-steel
nozzle type; in a mixed configuration the preset-family name follows the left
nozzle while the selected nozzle and slice records carry the actual diameter.
Package structure also follows [Bambu Studio's format implementation](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Format/bbs_3mf.cpp).

The pinned start/end arrays originate in the reference's executable blocks.
Machine revision 10 uses `h2d-02.08.02.61-pla-textured-v3`, which omits startup
triage item H10: initial X homing, early wiping-area moves, `M972 S24` and the
`M1009`-bracketed Z-clearance/center-positioning/Z-homing sequence (13 lines). Adjacent
object/bin checks and all later probing, calibration and priming remain; this
is not a no-probing startup. The revised sequence requires physical testing.
The v3 envelope adds a locked AMS selector placeholder to the otherwise pinned
service sequence. It is the only recognized envelope; a bundle holding an
earlier machine snapshot is recreated, with normal plan/toolpath review
invalidation. Existing exports and delivery files are not rewritten.
Allowed substitutions are planned temperatures, selected physical heater,
placed geometry's probe rectangle and whole-plan shutdown/parking clearance.
The reference PLA purge recipe uses 240 °C and up to 25 mm³/s independently of
the conservative print-body flow limit. The startup explicitly establishes
`[100,100,20]` before the body's explicit units, absolute XYZ/E, extrusion reset
and temperature waits. Whole-plan shutdown lifts by at least 10 mm and never
descends below the completed path's maximum Z; parking remains at or below
320 mm. Reject a plan that cannot fit that clearance. The bed's -0.02 mm
Textured PEI correction and service-area purge moves are part of the firmware
contract, not object geometry.

Spool choice and colour are optional and blank by default; nothing prompts for
them, and a printer without an AMS needs neither. `setup.ams` is null or
`{unit, slot}`. The profile's `ams` block declares how many units and slots per
unit may be requested (two units of four for the H2D); `validateSetup` is the
single check, through `feederSelector`. Null keeps selector 0, the first
filament path. Otherwise the renderer numbers slots continuously across units
(unit 1 gives 0–3, unit 2 gives 4–7) and writes that selector consistently in the
paired `M620`, `T` and `M621` startup commands. Selectors above 3 and the
pairing of an AMS unit with the selected nozzle are untested on hardware.
`setup.filamentColor` is null or a six-digit hex colour used only for package
labelling; null uses the output's `defaultFilamentColor`. A request makes the
intended setup explicit, but neither software interpretation nor metadata
proves that a particular AMS is connected, loaded or mapped as expected on the
printer.

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
explain the second-layer regression; corrected output had one user-reported successful
[left-nozzle PLA print](../../DEVLOG.md#2026-09-18--x1-carbon-output-through-the-shared-bambu-exporter) on 2026-09-18. S5 uses its separate Griffin `M82` contract.

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
[recorded acceptance limits](../../DEVLOG.md#br-018--h2d-output-from-the-supplied-nozzle-references).
The 0.6/0.8 diameter metadata, mixed-nozzle preset naming and AMS unit/slot selection
have software round-trip checks only.
Model-import CLI checks do not verify the program-viewer route.

### X1 Carbon output contract

X1 Carbon output is **experimental** and uses the same `bambu-gcode` adapter as
the H2D. Everything in the H2D contract about the print body, `M83` extrusion,
envelope matching, the simulation boundary, package determinism, AMS selection
and colour applies unchanged; only machine-file data differs.

The reference is a Bambu Studio 02.08.02.61 slice made on 2026-09-18 with the
installed CLI from the flattened system presets `Bambu Lab X1 Carbon 0.4 nozzle`
(including its start/end template includes), `0.20mm Standard @BBL X1C` and
`Bambu PLA Basic @BBL X1C` on Textured PEI; the machine file records its SHA-256.
Contract `x1c-02.08.02.61-pla-textured-v1` keeps the reference's executable
start, PLA filament-start and end commands in order, with comments and slicer
`M73` progress lines removed, and appends the same explicit `[100,100,20]` body
handoff as the H2D. No startup step is removed: homing, nozzle wipe, bed
leveling, mechanical-mode check, first-layer scan registration, front-edge purge
(Y 1–12 mm) and extrusion/lidar calibration remain under printer control.

The contract supports the single hardened 0.4 mm nozzle, 1.75 mm PLA, Textured
PEI (`G29.1 Z-0.04`) and no chamber heating. The reference took the PLA
anti-jamming branch that applies above a 45 °C bed, so `constraints.bedC`
requires 46–70 °C. Substitutions are the planned bed and nozzle temperatures, the
nozzle wipe temperature (nozzle − 20 °C), the AMS selector, the placed geometry's
leveling rectangle and the shutdown heights. The 250 °C flush, 140 °C wipe and
the reference preset's purge/calibration feeds stay fixed. Shutdown lifts 0.5 mm
above the part (never below the completed path), parks at part height + 100 mm
capped at 250 mm, then settles 2 mm without descending below that lift. Other
materials in the X1 profile remain setup-review profiles without output.

Software tests cover the round trip, rendered substitutions, package facts,
bed/material/startup/envelope rejection and cross-model rejection.

**Package facts the X1 Carbon's card loader needs.** `slice_info.config` must
carry a Bambu Studio release as `X-BBL-Client-Version`: with `SAAM-0.1.0` the
loader froze for several minutes and then failed without a message, and with
`02.08.02.61` the same file loaded. `package.clientVersion` in each machine file
supplies it; SAAM remains identified in the G-code header and the model's
`Application` metadata. Both XML configs use Bambu Studio's one-element-per-line
layout; whether the loader needs that is untested. The H2D accepted either
version string.

**Physical status.** One user-reported X1 Carbon print (58 mm cat, PLA, no
supports, 2026-09-18) used this contract's G-code inside Bambu Studio's reference
package, hand-assembled outside the exporter. Bed leveling, vibration testing and
dynamic flow calibration ran and the part printed well; the purge line could not
be told apart from the calibration lines. SAAM's own `slice_info.config` with the
client version above also loaded inside that package, and so did each other SAAM
entry swapped in singly: the 256 px thumbnails, `project_settings.config`, the
empty model with `model_settings.config`, the extra `saam.json`, and
`plate_1.json` with `filament_sequence.json`. The client version is the only cause
found. The exporter's complete archive then loaded too, with a printer warning that
the file does not support manual AMS mapping. The warning does not block: the
printer still pre-selected the spool matching the recorded colour and let the print
start; only changing the tray on the printer's screen is lost. Bambu Studio's
reference package around the same G-code gives no such warning, so a package fact
is missing; which one is not yet known (SAAM's `project_settings.config` omits about
130 filament/AMS keys Bambu Studio writes, its model has no object, and its
slice/plate records are minimal). Isolation archives `W1`–`W3` are in
`Prints/freehand-spline-cat-x1-r2/diagnostics/`, untested. The exporter's archive
has not itself been printed. A failed load costs the
operator several minutes, so test package changes from an archive known to load.
The [diagnosis record](../../DEVLOG.md#2026-09-18--x1-carbon-output-through-the-shared-bambu-exporter)
lists what is cleared.

**Choosing the spool.** On the X1 Carbon the `M620 S<n>A`/`T<n>` selector names a
logical filament. When a card print starts, the printer maps it to an AMS tray by
matching the package's recorded filament type and colour against the loaded
spools, and the operator can change that on the confirmation screen. So
`setup.filamentColor` is what steers the choice: set it to the colour of the
intended spool (a gray label selected the gray spool). `setup.ams` does not pick
a physical slot from the card; whether it does on the H2D is unverified.