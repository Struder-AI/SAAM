---
name: wedge-demo
description: Create an eight-point mesh wedge with an axis-aligned rectangular base, vertical sides and one planar roof sloping in any direction. Generate horizontal body and inclined roof layers through the shared S5, experimental H2D or configured Dobot output.
---

# Wedge demo

Read the applicable root context: developer agents read both
[DEVELOP.md](../../DEVELOP.md) and [MAKERS.md](../../MAKERS.md).

This package creates the bounded eight-vertex wedge as a native triangle mesh
with six named planar faces,
horizontal solid-fill toolpaths, alternating inclined skin strokes, SAAMpath, and
the selected machine export (S5 Griffin, experimental H2D sliced 3MF or configured
Dobot Lua ZIP). [Studio](../../studio/server.mjs) reconstructs motion from the
exact exported program and records three version-bound human approvals.

Use this package's own eight-point geometry and generator for the wedge.
The base is an axis-aligned rectangle; roof corners sit vertically above it
and must lie in one plane. That plane can rise along either axis or diagonally.
Mesh storage needs no Rhino/3DM. Spline geometry elsewhere is unaffected.
Export/interpretation and bundle review/delivery use the shared core. Do not
substitute shell geometry or the full-fill/draped-skin generators for this demo.

## Setup and tools

From the repository root, install with `npm ci` (Node.js 22+).

- `node skills/wedge-demo/scripts/cli.mjs init Prints/<name>` creates an unapproved geometry and process plan.
- `npm run studio -- Prints/<name>` opens that bundle on `http://127.0.0.1:4321`.
- `node skills/wedge-demo/scripts/cli.mjs generate Prints/<name>` generates directly from an approved plan and completes checks.
- `node skills/wedge-demo/scripts/cli.mjs check Prints/<name>` reopens and verifies the current bundle and exact export.
- `node skills/wedge-demo/scripts/cli.mjs deliver Prints/<name>` copies the approved export byte-for-byte into `delivery/`, retaining the selected output's filename and extension.
- `node skills/wedge-demo/scripts/cli.mjs adjust Prints/<name> <patch.json>` applies a chat-requested geometry, process or setup adjustment.
- `node skills/wedge-demo/scripts/cli.mjs remember-setup Prints/<name>` saves setup for subsequent prints.
- `node skills/wedge-demo/scripts/cli.mjs upgrade Prints/<name>` upgrades an older demo and its machine snapshot. Pre-0.3 geometry becomes an eight-point mesh and requires fresh geometry, settings and toolpath review. Existing export/delivery and old 3DM bytes are preserved. Upgrading an unchanged mesh retains geometry approval.

For a maker's first geometry review, do not wait for all process details. Once
their request reasonably identifies this supported wedge, run `init` for a new
local `Prints/<name>` bundle and open it with Studio. A request for a wedge on
an S5 is sufficient to preview the default wedge; clearly identify the default
geometry and setup as proposed, then invite chat revisions. Ask before creating
the bundle only when the requested feature cannot be represented by the bounded
wedge or is ambiguous in a way its defaults cannot resolve.

Make parameter changes through chat only: write a JSON patch and run `adjust`.
For example, `{"process":{"skinLayers":3}}` requests three sloped layers;
replace `geometry.points` to change dimensions or roof direction (example below). Studio automatically
displays updates and returns to the affected approval step. Do not require the
person to handle these files. Camera and playback controls remain in the viewer.
Face names are geometry-version-specific. A change made externally
that breaks bundle consistency is rejected; restore the original file or
initialize a new print. The tool does not import arbitrary edited Rhino files.

## Eight-point geometry

`geometry` contains only `points`: eight finite XYZ arrays, in millimeters,
in any order. There must be exactly two X and two Y coordinates, with a bottom
and top point at each XY corner. All four bottom Z values must match and each
top must be above its bottom. The four roof points must be coplanar within
0.0000001 mm; no curved or triangulated-crease roof is accepted.
Coordinates are translated so minimum XY and base Z become local zero;
`placement.xMm/yMm` positions that footprint on the bed. X increases to the
right and Y toward the back when looking from the printer's front.

For example, a 30 × 20 mm wedge with its tall side on the left:

```json
{"geometry":{"points":[
  [0,0,0],[30,0,0],[30,20,0],[0,20,0],
  [0,0,5],[30,0,2],[30,20,2],[0,20,5]
]}}
```

For corners ordered front-left, front-right, back-right, back-left, coplanarity
means `frontLeft + backRight = frontRight + backLeft` for their heights.
The footprint remains bounded to 8–80 mm in X and 8–60 mm in Y; positive
heights must fit the selected tool's Z bounds and leave printable skin extent.
The total roof angle is `atan(hypot(dz/dx,dz/dy))`, limited to 0–15° and the
machine's declared limit. A level roof is allowed. Studio shows dimensions,
height range, total angle and which direction rises, with named selectable faces.

New native geometry is `geometry/model.mesh.json`: eight vertices and twelve
triangles, with named face references in `geometry/model.json`. Generation uses
the plane and footprint derived from these same points. Read
[generation notes](references/generation.md) when changing this geometry/slicing contract.

The default recipe is a 30 × 20 mm wedge with a 2 mm low end and 15° slope.
It uses right nozzle #2 (`T1`), AA 0.4, 2.85 mm PLA at 215°C, a proposed 60°C
bed, 28°C build-volume setting, Generic PLA material profile, 0.2 mm first and subsequent horizontal layers, and two 0.2 mm
skins measured normal to the slope. Reuse the user's confirmed setup; do not
describe defaults such as bed temperature as separately human-approved.

Printing speed defaults are 20 mm/s flat, 10 mm/s sloped and 12 mm/s first
layer. A request to double printing speed sets targets of 40, 20 and 24 mm/s.
Targets are validated against the machine XY feed limits; actual moves remain
capped by the locked material flow and Z-speed limits. Travel, lift, retraction,
flow and cooling settings are separate choices, not automatically doubled.
Do not silently substitute a lower target for a requested speed.

S5 export includes `BUILD_VOLUME.TEMPERATURE` and the active tool's material
GUID. Use Generic PLA's identifier when the person has specified PLA without a
specific profile; a known material profile can replace it through chat. The
build-volume value matches the supplied Cura S5 reference and is adjustable as
`setup.buildVolumeC`. It is separate from nozzle and bed temperatures.

`skinLayers` is the adjustable 1–20 sloped-layer count. Sloped strokes always
alternate uphill/downhill, and flat-layer traversal reverses every layer.
When a thin base cannot contain every inner tilted layer at the downhill end,
the earliest tilted layers begin where they reach first-layer height; later
ones extend farther downhill. This is a geometric clipping rule, not a
physical-validation claim.
For this profile, starts within `combTravelMm` (default 12 mm) stay down and
move directly; that includes nearby loops, fill strokes and adjacent sloped
strokes. All motion uses the shared PathBuilder. Longer moves retract, lift above
the highest material deposited so far plus `liftMm` (default 1 mm; zero allowed),
traverse, descend and recover. Cooling and final parking use that same height.
See the [shared travel rule](../../DEVELOP.md#whole-plan-travel-requirement). A new job assumes the prior SAAM
wedge ended with its terminal retraction, so its first recovery cancels that
retraction rather than backing filament up a second time.

Setup changes are remembered in ignored `.local/machine-setups/ultimaker-s5.json`
with source and update time; `init` reuses this setup for a new print unless an
explicit plan is supplied. Reuse does not confer approval. Firmware version is
optional: assume standard S5 Griffin startup, retaining `startupVerified:false`
until the user actually reports verification. Resolve specific incompatibilities
through chat as described in [MAKERS.md](../../MAKERS.md#printer-setup-and-assumptions).

## Human workflow

1. Initialize and open the first reasonable geometry in Studio as soon as the
   maker's request supports it; revise through chat and show it again until the
   person confirms that geometry version.
2. Show the complete proposed settings; revise through chat and show them again
   until the person confirms the locked plan. Firmware version is not required.
3. Generate SAAMpath and its declared machine export directly. Automated checks
   must pass before production toolpath review. The person reviews and approves
   the exact exported program, then confirms and exports. Revisions return to
   the affected earlier review. Delivery adds no fourth approval.

Only the human enters their approval. Agents must not use Studio's approval
buttons or the approval function to manufacture agreement. No tool here sends
a job to hardware. Keep the bundle in ignored `Prints/`.

## Development preview

`npm run demo` creates/reopens `Prints/s5-wedge-demo` and generates a development
preview. It creates no approval records and cannot authorize delivery. This
mode permits inspection against explicitly unverified startup assumptions while
developing the adapter. Never present it as a production-approved program.
Use temporary bundles and reviewer names beginning `SYNTHETIC TEST` in tests;
never test approval actions on the person's real print.

## Implemented boundaries

- 0–15° is this generator's bounded input range, not a validated S5 clearance rating.
  The user explicitly owns physical clearance for this demo. No head collision
  model or collision pass is implemented, including for the second nozzle.
- The first inclined skin uses a rectangular bead-volume approximation above
  a stepped substrate. Read [generation notes](references/generation.md) when
  changing slicing, bead dimensions, or transition behavior. No physical print
  or surface-quality outcome has been established.
- The standard Griffin startup is a declared assumption; installed firmware
  and verification metadata are optional. This export does not run a bed-leveling
  routine for each job. Studio does not emulate the firmware's hidden startup
  motions or heating time.
  Read [S5 export notes](references/s5-export.md) before changing that contract.
- Bounds, axis feeds, flow, temperature state, unsupported commands, artifact
  integrity and SAAMpath/export agreement are checked. Software checks do not
  measure clearance or certify printability.

Run `npm test` after changes. General freeform surface slicing, dual-material
printing, UFP packaging, network sending and full Rhino computation are outside
this package.

The user reported on 2026-09-08 that the final wedge change achieved the requested
no-bed-leveling and no-unused-nozzle-heating behavior. The shared exporter uses
the machine profile's preserved header/start/end templates. See
[the scoped observation](../../DEVELOP.md#machine-program-templates-and-s5-observations);
this is not a claim of complete print quality or clearance validation.

## Dobot output

Select `--machine dobot-mg400` when initializing. The same eight-point mesh,
horizontal body and inclined-roof generator produce SAAMpath; export uses the
shared Dobot Lua interpreter and the same three approvals. Geometry can be
reviewed before installation configuration is supplied. Export requires the
locked frame, calibration, workspace, external initial pose and relay/thermal
settings described in the [Dobot contract](../../DEVELOP.md#dobot-output-contract).

Output is `exports/dobot-lua/wedge.zip`, delivered unchanged as
`delivery/wedge.zip`. This is a Lua transport bundle, not a verified vendor
project import format. Motion is fixed-orientation linear `MovL` with `CP=0`;
the robot stops at each segment and the external relay's volume is an estimate,
separate from intended bead volume. Software tests cover the native mesh,
inclined moves, actual Lua interpretation and synthetic approval/delivery.
No physical wedge print or robot collision validation is established.

## H2D and reopening

Select the H2D when initializing: `node skills/wedge-demo/scripts/cli.mjs init Prints/<name> --machine bambu-h2d`.
For the development preview use `node skills/wedge-demo/scripts/cli.mjs demo Prints/h2d-wedge-demo --machine bambu-h2d`, then `npm run studio -- Prints/h2d-wedge-demo`.
The eight-point mesh geometry and bounded wedge generator are shared across
S5 and H2D. Machine profiles supply setup, nozzle bounds, material limits and
output. A wedge on either supported machine is sufficient for an initial preview.

H2D defaults to left hardened 0.4 mm nozzle, 1.75 mm PLA at 215 C, 60 C bed,
Textured PEI, no chamber heat and 0.8 mm retraction at 30 mm/s. Its firmware
hands off unretracted, so `startupRetracted` must be false. The same 0–15 degree
bounded geometry applies; H2D's limit is experimental, with no measured head
clearance (including the other nozzle). The S5 observation and terminal
retraction assumption above apply only to S5.

Output is `exports/bambu-gcode/wedge.gcode.3mf`; delivery preserves that archive
as `delivery/wedge.gcode.3mf`. Review checks the packaged print body through the
shared interpreter. Startup probing, wiping, purge, calibration and unloading
follow the fixed firmware contract and are not simulated. These routines may
use both nozzles; printing time/material exclude them. No H2D physical print
has been validated. See the [H2D contract](../../DEVELOP.md#h2d-output-contract).
Remembered setup is separate in `.local/machine-setups/bambu-h2d.json`.

Studio's **Open print** lists local bundles. A folder or a file inside a bundle
also opens that bundle. Unchanged geometry approval carries forward; confirmed
settings with a current export reopen in toolpath playback. Opening writes no
approval and regenerates no saved file. Stale or edited output requires generation
and review again. Busy indicators cover loading, toolpath/export generation,
checks and delivery. Standalone G-code/3MF import is outside this feature.
