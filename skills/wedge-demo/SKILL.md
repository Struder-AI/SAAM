---
name: wedge-demo
description: Demonstrate horizontal body layers and inclined roof layers on a bounded eight-point wedge. Uses its own generator for a rectangular base, vertical sides and one planar sloping roof, providing a small example for exploring inclined deposition.
---

# Wedge demo

For maker work, read [MAKERS.md](../../MAKERS.md). For development, start with the
[developer orientation](../../DEVELOP.md) and follow its task-specific references.

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

This bounded demo uses `node skills/wedge-demo/scripts/cli.mjs` instead of the
shell CLI. Initialize its eight-point recipe with:

```sh
node skills/wedge-demo/scripts/cli.mjs init Prints/my-wedge --machine ultimaker-s5
```

The [shared print-tool manual](../../core/print/USAGE.md) owns review, adjustment,
checks, generation, setup reuse and delivery. For this demo, replace the shell
CLI path in those commands with `skills/wedge-demo/scripts/cli.mjs`. Its `init`
accepts a machine selection but no recipe file; apply changes with `adjust`.
It has no STL importer. MCP selects this adapter with `kind: "wedge"` and routes
later operations from the saved bundle.

Wedge `upgrade` also migrates pre-0.3 geometry to an eight-point mesh, requiring
fresh geometry, settings and toolpath review. Existing export/delivery and old
3DM bytes remain intact. Upgrading an unchanged mesh retains geometry approval.

For a request that identifies this supported wedge, its default geometry can
provide the first proposed preview. Identify the dimensions and assumptions so
the maker can revise them through chat.

This bounded generator requires PLA and a 0.4 mm nozzle; remembered setup for
another material or nozzle must be revised before using it.

For example, an `adjust` patch of `{"process":{"skinLayers":3}}` requests three
sloped layers; replace `geometry.points` to change dimensions or roof direction
(example below).
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

S5 and H2D printing speed defaults are 40 mm/s flat, 20 mm/s sloped and
24 mm/s first layer, with 120 mm/s XY travel and 10 mm/s Z travel.
Targets are validated against the machine XY feed limits; actual moves remain
capped by the locked material flow and Z-speed limits. Retraction, flow and
cooling retain their existing defaults. Saved plans retain their locked speeds.
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
See the [shared travel rule](../../core/path/README.md#whole-plan-travel-requirement). A new job assumes the prior SAAM
wedge ended with its terminal retraction, so its first recovery cancels that
retraction rather than backing filament up a second time.

Machine setup reuse and the three human review stages follow the
[shared workflow](../../core/print/USAGE.md). For S5 startup assumptions and
reported incompatibilities, use the [S5 setup guidance](../../core/export/griffin.md#s5-setup-and-troubleshooting).

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
  integrity are checked on the exported program. Export round-trip agreement is
  covered by software regression tests. Software checks do not
  measure clearance or certify printability.

General freeform surface slicing, dual-material
printing, UFP packaging, network sending and full Rhino computation are outside
this package.

The shared exporter uses the machine profile's header/start/end templates.
The [S5 contract](../../core/export/griffin.md#machine-program-templates-and-s5-observations)
defines startup assumptions and links revision-specific observations; complete
print quality and physical clearance remain unverified.

## Dobot output

Select `--machine dobot-mg400` when initializing. The same eight-point mesh,
horizontal body and inclined-roof generator produce SAAMpath; export uses the
shared Dobot Lua interpreter and the same three approvals. Geometry can be
reviewed before installation configuration is supplied. Export requires the
locked frame, calibration, workspace, external initial pose and relay/thermal
settings described in the [Dobot contract](../../core/export/dobot.md#dobot-output-contract).

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
has been validated. See the [H2D contract](../../core/export/bambu.md#h2d-output-contract).
Remembered setup is separate in `.local/machine-setups/bambu-h2d.json`.

For saved bundles, use [opening and resuming review](../../core/print/USAGE.md#open-and-resume-review).
