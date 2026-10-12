---
name: dobot
description: Dobot MG400 relay Lua output contract
metadata:
  saam-kind: machine
---

# Dobot MG400 output

See the [shared machine interface](../../core/export/README.md) for common motion semantics.

## Kinematics

[kinematics.mjs](kinematics.mjs), this extension's kinematics plug, poses the arm
in Studio when `kinematicModel` gives `worldFromBase` and `toolLengthMm`; otherwise
Studio shows bed and tool only. It uses the nominal
[MG400 URDF](https://github.com/Dobot-Arm/MG400_ROS/blob/main/mg400_description/urdf/mg400_description.urdf)
with an idealized vertical wrist; its elbow branch and wrist winding are model
policies. The controller solves the written program's joints.

### Dobot output contract

`machines/dobot/dobot-mg400.json` declares experimental `dobot-lua` output through
`machines/dobot/dobot.mjs`. `machines/dobot/debug/dobot-lua-subset.mjs` adopts the selected
legacy Lua runtime; export, inspection and delivery use the existing SAAMpath
and print lifecycle. The default profile's installation fields are null:
generation builds and shows the SAAMpath, and the program waits for them, naming
what is missing. The locked setup must supply frame IDs, XY calibration
and offsets, bed Z, fixed orientation, initial position, motion limits, relay
output/policy and external temperature-control basis. Provenance and recorded
Cartesian envelopes are optional; a rectangle establishes no robot reachability.
The optional positive relay rate supplies an estimate; otherwise that estimate is unavailable.
Never substitute synthetic fixture numbers for actual installation values.

The ZIP contains `global.lua`, `src1.lua`, `src0.lua` and `manifest.json`.
It is a transport package for Lua source, not a verified DobotStudio project
import format. Vendor importer acceptance, controller execution and physical
printing remain unvalidated. The debug verifier interprets the delivered entry,
helper and motion files, transforms their fixed-orientation Cartesian commands
back to the design frame and rejects missing/altered helpers, unsupported Lua
or motion semantics, incompatible setup and stale artifact hashes.

No program length cap; the debug reader detects loops executing more statements
between commands than the source contains. Generated source is straight-line; Studio draws SAAMpath.

Only bounded linear `MovL` at `CP=0`, explicit fixed frames/orientation, `DO`,
`Sync` and relay-off `Wait` are supported. The selected
`stroke-stop-start-unblended` policy keeps the relay on through consecutive
deposition moves and switches it off for travel and dwell. A pause is not limited
by what one command can express: the writer splits a longer dwell into consecutive
`Wait` commands whose milliseconds sum to the requested pause, and the reader keeps
the 0–60,000 ms range per command, reporting one dwell event for each. Each motion segment
uses a modeled rest-to-rest acceleration profile. This differs from the legacy
continuous-through-travel reference and must be explicitly selected in setup.
No startup positioning, heating commands or priming wait are inserted. External
positioning and heating must already be established. Requested nozzle temperature
changes are named in the print's limitations for external arrangement at those
points; fan and retraction actions are separately named as omitted controls.
Arcs, joint moves, rotation changes, tool changes and stationary extrusion actions
have no implemented command and produce a named export error. Temperatures keep
the shared 350 °C ceiling.

Calibrated controller XYZ use 0.001 mm; orientation and SpeedL/AccL retain ten decimals.
Timing follows those written points and percentages; SpeedL adapts through 100%.
Collapsed material carries to the next written deposition; terminal material
with no representable deposition is reported as omitted.

SAAMpath bead volume is process intent; relay material is a separate estimate
from the configured rate and modeled motion time. Checks and Studio expose that
distinction and do not claim metered flow or simulated temperature state. A
continuous vase stroke does not establish smooth deposition when this output
stops at every segment. Actual acceleration, relay lag and controller queue
timing can alter the result. Export does not check robot reachability,
singularities or link/fixture collisions.

Software checks cover Lua, frame identity, timing, shared skills, stale edits and exact-byte delivery.
