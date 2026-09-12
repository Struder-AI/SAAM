# Dobot MG400 output

The configured-installation Lua output contract. See the [shared machine interface](README.md) for common motion semantics.

### Dobot output contract

`machines/dobot-mg400.json` declares experimental `dobot-lua` output through
`core/export/dobot.mjs`. `core/export/dobot-lua-subset.mjs` adopts the selected
legacy Lua runtime; export, inspection, hashing, approvals and delivery use the
existing SAAMpath and print lifecycle. Geometry can be reviewed with the default
profile, but its installation fields are null and generation refuses an
unconfigured installation. The locked setup must supply frame IDs, XY calibration
and offsets, bed Z, fixed orientation, initial position, Cartesian workspace,
motion limits, relay output/rate/policy and external temperature-control basis.
Never substitute synthetic fixture numbers for actual installation values.

The ZIP contains `global.lua`, `src1.lua`, `src0.lua` and `manifest.json`.
It is a transport package for Lua source, not a verified DobotStudio project
import format. Vendor importer acceptance, controller execution and physical
printing remain unvalidated. Studio interprets the actual delivered entry,
helper and motion files, transforms their fixed-orientation Cartesian commands
back to the design frame and rejects missing/altered helpers, unsupported Lua
or motion semantics, incompatible setup and stale artifact hashes.

Only bounded linear `MovL` at `CP=0`, explicit fixed frames/orientation, `DO`,
`Sync` and relay-off `Wait` are supported. The selected
`stroke-stop-start-unblended` policy keeps the relay on through consecutive
deposition moves and switches it off for travel and dwell. Each motion segment
uses a modeled rest-to-rest acceleration profile. This differs from the legacy
continuous-through-travel reference and must be explicitly selected in setup.
No startup positioning, heating commands or priming wait are inserted. External
positioning and temperature control must already be established. Retraction,
fan control, arcs, joint moves, rotation changes and tool changes are rejected.

SAAMpath bead volume is process intent; relay material is a separate estimate
from the configured rate and modeled motion time. Checks and Studio expose that
distinction and do not claim metered flow or simulated temperature state. A
continuous vase stroke does not establish smooth deposition when this output
stops at every segment. Actual acceleration, relay lag and controller queue
timing can alter the result. Cartesian workspace checks are not inverse
kinematics, robot reachability, singularity or link/fixture collision checks.

Targeted software checks cover Lua execution and rejection, transformed workspace
and motion limits, shared skill and wedge outputs, synthetic three-stage review,
changed helper/archive rejection, MCP access and exact-byte ZIP delivery.
Use the same native geometry, locked plan, Studio and delivery on every profile.
