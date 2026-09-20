# Wing workspace prototype

Run from the repository root:

```sh
node skills/wing-design/prototype/server.mjs
```

Open the emitted local URL. The default is `http://127.0.0.1:61451`;
`SAAM_WING_PORT` selects another port. Keep this managed command session alive
while reviewing. Stop its own session when finished. The server serves only this
prototype's explicit asset list, its airfoil catalog and SAAM's camera module.
It binds to loopback and performs no remote requests or file writes.

## Implemented interaction

Use → Airfoil → Planform → Tips → Controls → Structure. Stages remain revisitable.
The application/priority choices reorder six source-backed candidate cards by
editorial tags. Search filters names/families. Thickness and camber are calculated
from the saved coordinates; no aerodynamic performance polars or ranking solver
are present. Source links open the original coordinate files.

The model updates for airfoil, span, root chord, taper, sweep, dihedral, twist,
tip shape/construction, wing controls, tail arrangement, reinforcement and
attachment. Drag to orbit, Shift-drag/right-drag to pan, scroll to zoom; keyboard
arrows orbit the focused canvas. Camera buttons give top/front/side views.
Expand **Inspect / Layers** for wireframe, ribs, reinforcement, hardware and
fuselage-reference switches. Visibility never removes design components.

Design choices auto-save in browser local storage for the current origin. Use
**Save design** to download portable JSON, and **Open design** to restore it.
Moving to another port/browser does not transfer that browser's draft; use the
JSON file. **Copy brief for your agent** places the design in the clipboard for
the conversation. Notes are retained verbatim; there is no embedded AI service
or connection to Studio's agent request channel yet.

## Geometry and limits

`model.mjs` builds a display assembly directly from the selected normalized
section. Coordinates use X for span, Y for chord and Z for height. Sweep is the
quarter-chord sweep; twist is about quarter chord. UI span/area metrics exclude
tip extensions. Tail geometry uses NACA 0012 with provisional dimensions tied to
wing size. It is selectable as conventional, V-tail or absent, but cannot yet be
independently sized or articulated.

Control surfaces occupy fixed provisional span intervals: ailerons 55–90% of
each half-span, flaps 12–48%. Chord fraction and wing-control deflection are
editable. Split flaps move only the lower patch. Motion is illustrative;
mechanical hinge/servo/linkage kinematics and collision checking are not solved.
Hardware is generic size-reference geometry, not vendor CAD. Winglet and tip
caps are concept surfaces. Large internal tubes have visible bores; ribs have
openings. The inner skin is a simple Z offset preview, not a robust wall-thickness
operation. Reinforcement channels, bonding surfaces and printable boolean solids
are not compiled. Struder/glue selections retain process intent only.

The WebGL renderer depth-tests all colored components together; wireframe removes
skin occlusion and overlays its section/span edges. It shares Studio's actual
orthographic `createProjection` function, but lives in this skill because it is
an experimental design assembly, not a checked print-bundle viewer. There are no
changes to shared Studio/core code and no machine-program export. Model faces
are display meshes, not certified watertight CAD or manufacturing geometry.

The source airfoil files and their SHA-256 values are in `data/sources.json`.
They retain their original bytes and UIUC links. No wind-tunnel/prediction dataset
is bundled. See [source research](../AIRFOIL-SOURCES.md) for the broader integration
proposal and data reuse considerations before publishing a distributable library.

## Verification

```sh
node --test skills/wing-design/tests/prototype.test.mjs
```

Checks exercise both coordinate formats against known section dimensions,
span/chord geometry, feature combinations, finite vertices, actual control motion,
missing controls/tails, depth warnings and invalid design-file rejection.
Browser inspection is needed for visibility, camera and file interactions.
The wider intended product remains in [the design brief](../DESIGN-BRIEF.md).
