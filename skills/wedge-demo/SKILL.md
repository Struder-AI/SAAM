---
name: wedge-demo
description: Create a Rhino wedge and generate a mixed horizontal and inclined-layer demo for an UltiMaker S5 with an AA 0.4 core and PLA. Use for this bounded S5 demo, not general CAD or arbitrary curved slicing.
---

# S5 wedge demo

Read the applicable root context: developer agents read both
[DEVELOP.md](../../DEVELOP.md) and [MAKERS.md](../../MAKERS.md).

This package creates a capped Rhino extrusion and named NURBS face references,
horizontal solid-fill toolpaths, alternating inclined skin strokes, SAAMpath, and
Griffin G-code. [Studio](../../studio/server.mjs) reconstructs motion from the
exact G-code and records three version-bound human approvals.

## Setup and tools

From the repository root, install with `npm ci` (Node.js 22+).

- `node skills/wedge-demo/scripts/cli.mjs init Prints/<name>` creates an unapproved geometry and process plan.
- `npm run studio -- Prints/<name>` opens that bundle on `http://127.0.0.1:4321`.
- `node skills/wedge-demo/scripts/cli.mjs generate Prints/<name>` generates directly from an approved plan and completes checks.
- `node skills/wedge-demo/scripts/cli.mjs check Prints/<name>` reopens and verifies the current bundle and exact export.
- `node skills/wedge-demo/scripts/cli.mjs deliver Prints/<name>` copies the approved export byte-for-byte into `delivery/wedge.gcode`.
- `node skills/wedge-demo/scripts/cli.mjs adjust Prints/<name> <patch.json>` applies a chat-requested geometry, process or setup adjustment.
- `node skills/wedge-demo/scripts/cli.mjs remember-setup Prints/<name>` saves setup for subsequent prints.
- `node skills/wedge-demo/scripts/cli.mjs upgrade Prints/<name>` upgrades a 0.1 demo to the current generator, retaining geometry approval and invalidating settings/toolpath approval.

Make parameter changes through chat only: write a JSON patch and run `adjust`.
For example, `{"process":{"skinLayers":3}}` requests three sloped layers;
`{"geometry":{"widthMm":15}}` changes the wedge width. Studio automatically
displays updates and returns to the affected approval step. Do not require the
person to handle these files. Camera and playback controls remain in the viewer.
Face names are geometry-version-specific. A change made externally
that breaks bundle consistency is rejected; restore the original file or
initialize a new print. The tool does not import arbitrary edited Rhino files.

The default recipe is a 30 × 20 mm wedge with a 2 mm low end and 15° slope.
It uses right nozzle #2 (`T1`), AA 0.4, 2.85 mm PLA at 215°C, a proposed 60°C
bed, 0.2 mm first and subsequent horizontal layers, and two 0.2 mm
skins measured normal to the slope. Reuse the user's confirmed setup; do not
describe defaults such as bed temperature as separately human-approved.

`skinLayers` is the adjustable sloped-layer count. Sloped strokes always
alternate uphill/downhill, and flat-layer traversal reverses every layer.
For this profile, every generated horizontal travel retracts and lifts first
to the full part's maximum Z plus `liftMm` (default 2 mm), then traverses,
descends and recovers. It does not use just the height printed so far.

Setup changes are remembered in ignored `.local/machine-setups/ultimaker-s5.json`
with source and update time; `init` reuses this setup for a new print unless an
explicit plan is supplied. Reuse does not confer approval. Firmware version is
optional: assume standard S5 Griffin startup, retaining `startupVerified:false`
until the user actually reports verification. Resolve specific incompatibilities
through chat as described in [MAKERS.md](../../MAKERS.md#printer-setup-and-assumptions).

## Human workflow

1. Show the geometry in Studio; revise through chat and show it again until the
   person confirms that geometry version.
2. Show the complete proposed settings; revise through chat and show them again
   until the person confirms the locked plan. Firmware version is not required.
3. Generate SAAMpath and its declared Griffin export directly. Automated checks
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

- 1–15° is this generator's bounded input range, not a validated S5 clearance rating.
  The user explicitly owns physical clearance for this demo. No head collision
  model or collision pass is implemented, including for the second nozzle.
- The first inclined skin uses a rectangular bead-volume approximation above
  a stepped substrate. Read [generation notes](references/generation.md) when
  changing slicing, bead dimensions, or transition behavior. No physical print
  or surface-quality outcome has been established.
- The standard Griffin startup is a declared assumption; installed firmware
  and verification metadata are optional. G280 S1 is a firmware priming operation, not a
  generic homing command. Studio displays this operation as an event; it does
  not emulate the firmware's hidden preflight/prime motions or heating time.
  Read [S5 export notes](references/s5-export.md) before changing that contract.
- Bounds, axis feeds, flow, temperature state, unsupported commands, artifact
  integrity and SAAMpath/export agreement are checked. Software checks do not
  measure clearance or certify printability.

Run `npm test` after changes. General freeform surface slicing, dual-material
printing, UFP packaging, network sending and full Rhino computation are outside
this package.
