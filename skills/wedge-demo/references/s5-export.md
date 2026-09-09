# S5 Griffin export

The machine declares `griffin-gcode`. This adapter supports one active AA 0.4
core and PLA. Right nozzle #2 is `T1`; left nozzle #1 is `T0`. Coordinates use
the active nozzle's build coordinate system. Firmware owns the calibrated tool
offset; do not subtract the nominal 22 mm right-core offset again.

The adapter is independently implemented. The following upstream sources were
consulted on 2026-09-08; no legacy SAAM component or Cura source was imported:

- [Official S5 definition](https://github.com/Ultimaker/Cura/blob/main/resources/definitions/ultimaker_s5.def.json): build dimensions, Griffin output, nominal axis limits.
- [Official right extruder definition](https://github.com/Ultimaker/Cura/blob/main/resources/extruders/ultimaker_s5_extruder_right.def.json): tool index, nominal offset, and start coordinates.
- [CuraEngine export source](https://github.com/Ultimaker/CuraEngine/blob/main/src/gcode_export/gcodeExport.cpp): Griffin header fields, filament-length E units, and G280 S1 priming semantics.
- [UltiMaker S5 specifications](https://ultimaker.com/3d-printers/s-series/ultimaker-s5/): filament diameter, cores and nozzle-temperature range.
- [McNeel rhino3dm](https://developer.rhino3d.com/guides/opennurbs/what-is-rhino3dmio/): standalone geometry/file library, distinct from the complete Rhino engine.

## Startup contract

S5 firmware handles Griffin job preflight, including machine preparation.
The export selects the tool, millimeters, absolute XYZ and absolute E, then waits
for the planned bed/nozzle temperatures. `G280 S1` invokes firmware priming
without a prime blob. An explicit `G0 Z20` follows, matching Cura's correction
for firmware versions with differing S1 behavior. `G92 E0` then makes the
program's E origin explicit. A generated prime line is included in SAAMpath.

The interpreter assumes the active tool's startup XY from the machine definition
and a resulting Z of 20 mm. This is a declared external state, not measured
hardware behavior. Standard S5 Griffin startup is the default assumption;
installed firmware version and startup verification are optional metadata, not
approval gates. The initial recipe leaves these fields unconfirmed. Reuse saved
setup from `.local/machine-setups/ultimaker-s5.json`, preserving the distinction
between user-reported verification and assumptions. If the user reports a
modified machine or different startup behavior, resolve that specific issue
through chat; a known-good Cura export or About-screen version can help when
needed. Do not require every new user to supply these details.
Material GUID is optional; if supplied it must identify the actual material.

The preview reports G280 as an external firmware event. It does not invent a
path for its hidden motion. Heating, firmware preflight, priming material, bed
leveling compensation and acceleration are outside the motion estimate.

## Supported export and checks

The generated program uses T0/T1, G21, G90, M82, M190, M109, G280 S1,
G92 E, G0/G1 XYZEF, G4 P, M106/M107, M400, M104 and M140. Shutdown lifts,
retracts, synchronizes, and switches off the active nozzle, bed and fan.
The strict interpreter additionally understands G91/M83 state but rejects
unrecognized commands, arguments and malformed tokens. It is not a generic
Griffin firmware emulator or arbitrary G-code importer.

SAAMpath stores deposited volume in mm³; Griffin E is millimeters of 2.85 mm
filament. Retraction/recovery uses filament length separately from deposition.
The header describes the selected tool, target temperatures, nozzle, estimated
material/motion time, and program bounds. All executable moves are regenerated
and compared on reopening. Any altered export or outdated plan blocks approval
and delivery until regenerated.

No UFP archive, printer connection or automatic hardware execution is included.
