# S5 Griffin export

The machine declares `griffin-gcode`. This adapter supports one active AA 0.4
core and PLA. Right nozzle #2 is `T1`; left nozzle #1 is `T0`. Coordinates use
the active nozzle's build coordinate system. Firmware owns the calibrated tool
offset; do not subtract the nominal 22 mm right-core offset again.

The adapter is independently implemented. The following upstream sources were
consulted on 2026-09-08; no legacy SAAM component or Cura source was imported:

- [Official S5 definition](https://github.com/Ultimaker/Cura/blob/main/resources/definitions/ultimaker_s5.def.json): build dimensions, Griffin output, nominal axis limits.
- [Official right extruder definition](https://github.com/Ultimaker/Cura/blob/main/resources/extruders/ultimaker_s5_extruder_right.def.json): tool index, nominal offset, and start coordinates.
- [CuraEngine export source](https://github.com/Ultimaker/CuraEngine/blob/main/src/gcode_export/gcodeExport.cpp): Griffin header fields and filament-length E units. Its `G280 S1` behavior is intentionally not part of this per-job export.
- [UltiMaker S5 specifications](https://ultimaker.com/3d-printers/s-series/ultimaker-s5/): filament diameter, cores and nozzle-temperature range.
- [McNeel rhino3dm](https://developer.rhino3d.com/guides/opennurbs/what-is-rhino3dmio/): standalone geometry/file library, distinct from the complete Rhino engine.

## Startup contract

The current machine output owns `program.header`, `program.start` and
`program.end`; the shared emitter uses those templates for both print adapters.
On 2026-09-08 the user specifically reported that the **last wedge change**
achieved no bed leveling and no heating of the unused nozzle. The regression
fixture preserves that envelope. Earlier observations below describe earlier
revisions; they must not be substituted for this final behavior. This does not
establish complete print quality or physical clearance.

S5 firmware handles Griffin job preflight, including machine preparation. The
export selects the tool, millimeters, absolute XYZ and absolute E, then waits
for the planned bed/nozzle temperatures. It does **not** emit `G280 S1`: that
routine levels the bed and is not required for each wedge job. An explicit
`G0 Z20` follows the established startup state, and `G92 E0` makes the
program's E origin explicit. The generated skirt then deposits with positive
filament-length `E` moves.

The interpreter assumes the active tool's startup XY from the machine definition
and a resulting Z of 20 mm. This is a declared external state, not measured
hardware behavior. Standard S5 Griffin startup without routine bed leveling is the default assumption;
installed firmware version and startup verification are optional metadata, not
approval gates. The initial recipe leaves these fields unconfirmed. Reuse saved
setup from `.local/machine-setups/ultimaker-s5.json`, preserving the distinction
between user-reported verification and assumptions. If the user reports a
modified machine or different startup behavior, resolve that specific issue
through chat; a known-good Cura export or About-screen version can help when
needed. Do not require every new user to supply these details.
The S5 adapter emits a material GUID for the active tool. The default is Cura's
Generic PLA profile (`506c9f0d-e3aa-4bd4-b2d2-23e2425b1aa9`); reuse a known
specific profile when supplied. This describes the material profile, not the
brand or verification of a particular spool.

The preview does not invent firmware startup motion. Heating, firmware
preflight, bed-leveling compensation and acceleration are outside the motion
estimate.

## Supported export and checks

The Griffin header includes generator name, version and fixed release build
date. The generator remains `SAAM`; `GENERATOR.VERSION:4.4.0` declares the
minimum Griffin compatibility level so the S5 does not mislabel the program as
an export from an older Cura release. SAAM's actual generator release remains
in the locked plan and `SAAM.GENERATOR.VERSION`. UltiMaker's [libCharon reader](https://github.com/Ultimaker/libCharon/blob/main/Charon/filetypes/GCodeFile.py)
requires all three; a missing build date rejects the file before motion is
executed. The exporter and checker now enforce these fields and a nonnegative
integer print time. The build date is release metadata, not the current clock,
so regenerated files remain deterministic. S5-specific checks also require the
active material GUID and build-volume temperature to match the locked setup.

On 2026-09-08 the user reported firmware 8.3.1 rejecting the 0.2.0 file while
selecting it from USB. That export omitted the required build date. Version
0.2.1 adds it without changing executable commands. Reader compatibility checks
do not establish acceptance by that physical printer or successful printing.
The public libCharon reader was run locally against both files: it rejected
the original with `GENERATOR.BUILD_DATE must be set` and accepted the correction.
All bytes after `END_OF_HEADER` matched the previously reviewed export.
At the user's explicit request, the corrected file was copied to the S5
removable drive and its SHA-256 verified. The printer then reported "does not
contain the necessary data" for the corrected file. Passing libCharon alone is
therefore insufficient to establish S5 firmware 8.3.1 compatibility.

The user's Cura 4.12.0 reference (`wedge.ufp`, also supplied as
`wedgeCURA.gcode`) contains `BUILD_VOLUME.TEMPERATURE:28` and Generic PLA's
material GUID; both were missing from 0.2.1. Version 0.2.2 adds these to the
locked setup and export, and checks their presence. All reference header keys
are now present for the active tool. The reference uses both extruders; this
demo still declares only the requested right nozzle. No slice UUID was present
in that reference, so one was not invented to address this error. The user
subsequently confirmed that firmware 8.3.1 accepted the 0.2.2 file. That result
applies to the then-current command body, not the later no-routine-leveling
startup or Griffin-4.4 compatibility declaration. Those changes have software
checks only and do not establish a completed physical print. Brief guidance is
recorded in the S5 machine file.

UFP files are ZIP containers; their embedded `/3D/model.gcode` can be inspected
without importing their geometry or running commands. The user's reference
files remain local diagnostic data, not shipped examples. Cura's official
[S5 definition](https://github.com/Ultimaker/Cura/blob/main/resources/definitions/ultimaker_s5.def.json)
enables build-volume temperature metadata; libCharon does not validate that
S5-specific field. Its acceptance is only one part of compatibility checking.

The generated program uses T0/T1, G21, G90, M82, M190, M109, G92 E,
G0/G1 XYZEF, G4 P, M106/M107, M400, M104 and M140. Shutdown lifts,
retracts, synchronizes, and switches off the active nozzle, bed and fan.
The strict interpreter additionally understands G91/M83 state but rejects
unrecognized commands, arguments and malformed tokens. It is not a generic
Griffin firmware emulator or arbitrary G-code importer.

SAAMpath stores deposited volume in mm³; Griffin E is millimeters of 2.85 mm
filament. Retraction/recovery uses filament length separately from deposition.
The wedge's terminal retraction is carried into the next wedge job as its
explicit first recovery, avoiding a second initial retraction and the resulting
first-layer under-extrusion. Nearby starts move directly without retracting or
lifting; only longer transitions use a hop.
The header describes the selected tool, target temperatures, nozzle, estimated
material/motion time, and program bounds. All executable moves are regenerated
and compared on reopening. Any altered export or outdated plan blocks approval
and delivery until regenerated.

No UFP archive, printer connection or automatic hardware execution is included.
