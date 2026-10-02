# Light Switch Covers

Local development workspace for labeled switch covers, raised/recessed lettering,
two-color raised or flush material parts and conversationally authored relief motifs.

## Run and use

From the repository root:

```sh
node workspaces/light-switch-covers/server.mjs
```

Open http://127.0.0.1:61452. Optional `SAAM_COVER_PORT` changes the port.
The server binds only loopback, verifies Host and protects mutations with a
session token. Keep its managed command session running while using the app.

Choose location, installation, positions, opening types, labels and finish. The cover-family picker opens an illustrated gallery with local/all-location filtering, search and sourced dimension captions. Drawings show representative recognition shapes, not exact mounting or cutout geometry. Dimensions distinguish plate examples, nominal boxes and module faces; unknown values remain marked for measurement. The
first implemented family is a US draft cover: 1–6 toggle, rocker/GFCI, blank or
measured rectangular positions, including mixed layouts. Edit plate size,
position spacing, each opening and screw spacing, rear pocket and countersinks.
Preview builds the actual shared-kernel geometry, with front/back and drag orbit.
Save/load JSON preserves all design choices. Download the solid as STL or the
individual plate/letter STLs with unchanged common coordinates for color assignment.

The default is a US two-gang plate with two matching toggle openings and editable labels. Raised styles use letter height; recessed lettering uses recess depth; flush lettering locks visible height to zero.

The default location is US. International families are research references;
selecting them does not manufacture their proprietary mounting interfaces. The
current measured geometry supports rectangular openings and vertical screw pairs,
not arbitrary profiles, offsets, clips, bayonets or replacement electrical mechanisms.
Square-box mode creates a decorative overlay intended to retain the original metal
cover. Its holes and clearances must be measured; it does not replace grounding
or device-supporting metal. Box side is only a starting envelope.

`examples/kitchen-porch.json` is an editable two-position/two-color example.
All sizes are in mm. The toggle opening width and screw spacing follow the
[Leviton drawing](https://leviton.com/content/dam/leviton/residential/product_documents/none/Document-29985-Dimensional%20Data.gif);
toggle opening height, face section, screw diameters and countersinks are explicit
draft design choices requiring comparison to the actual installation. Rocker
opening sizes follow the [Decora bulletin](https://leviton.com/content/dam/leviton/residential/product_documents/product_bulletin/NM-012820%20Update%20Decora%20Plus%20Screwless%20Wallplate%20PB.pdf).
No physical fit or electrical material qualification is recorded.

## Conversation and decoration

Successful previews atomically save `.local/current-design.json` (ignored by Git).
The server reloads that saved design on restart; the browser receives it on reload.
To revise through conversation, the agent reads this file, edits the requested
labels/dimensions or `decoration` array, validates through `buildCover`, restarts
the owned server and reloads the workspace. Preserve unrelated design settings.
The optional `decorationPrompt` saves the person's idea; typing it does not invoke
an LLM independently of the conversation. Custom prompts are interpreted by the
agent, not silently turned into guessed geometry by a keyword parser.

Each motif is `{shape, x, y, size, depth, mode}` in front installation coordinates
(origin at lower left in this first prototype; +X right, +Y up). Shapes currently
include `circle`, `diamond`, and horizontal `stripe`; mode is raised or recessed.
The agent can compose these into dot textures, borders or geometric motifs.
Raised and two-color raised lettering require face up; older face-down raised designs are normalized to face up. Recessed and flush two-color lettering allow either orientation. Face-up plates with a recessed back require support beneath the rear pocket. These requirements appear in the preview and the bundle’s HANDOFF.md notes. Raised motifs printed face down still trigger a relief/support warning.
More elaborate sculpted motifs and arbitrary imported relief assets are not yet
implemented. Checks reject motif/label interference with openings, screw heads
and plate edges; actuator sweeps and fingers still require physical review.

## SAAM integration and review

Uses this checkout's maintained `core/geom/solid.mjs`, mesh validation, font
outline/layout functions and `skills/text/scripts/text.mjs`. Geometry, font bytes,
text features and material partitions enter the shared print lifecycle through
`proposedPlan` and `initBundle`. No core or Studio code is copied or modified.
Prepared against checkout `e36dcad` on `TK-DEV`; runtime imports the current checkout.

“Create print bundle” writes a unique unapproved bundle under ignored `Prints/`
and saves `cover-design.json` and `HANDOFF.md` support/review notes. It shows the managed Studio launch command; ask
the agent to open that bundle. Machine choices are H2D, X1 Carbon and S5, using
shared proposed/remembered setup. Both two-color SAAM modes require at least two
configured logical Bambu filaments: plate uses 0 and labels use 1. Flush mode retains a plate/labels assembly with font-based construction; raised mode retains prepared text partitions. These are logical
material assignments, not inferred AMS tray numbers. If setup is missing, the app
reports it and still supports separate STL parts. Decoration currently shares
plate material. Raised/recessed single-color handoffs use the whole solid.

The handoff disables draped-skin and proposes planar full-fill. It carries geometry,
orientation, saved construction and color intent, not manufacturing approval.
SAAM Studio owns generation, combined settings/exact-toolpath confirmation and
export/delivery. The workspace generates no machine program and sends nothing to hardware.

## Verification

```sh
node --test workspaces/light-switch-covers/tests/workspace.test.mjs
```

Coverage checks positive-volume raised/recessed meshes, STL round trips, readable
face-down references, disjoint color partitions conserving final volume, rejected
interference, decoration geometry, unapproved bundle persistence and local API
write protection/stale-preview rejection. These establish software behavior only.

The broader [parameter specification](PARAMETERS.md), [research](RESEARCH.md) and
[catalog](catalog.json) include future families and geometry not implemented here.

## Roadmap

**Retained-cover overlays — planned, not implemented as a complete workflow.**
Develop a separate geometry model for thin label strips, partial overlays and full
decorative overlays that retain an existing approved electrical cover. This needs
measured mating surfaces, clearance around switches/outlets, attachment choices,
and an explicit retained-cover role in the gallery and SAAM handoff. Thickness
and coverage must be independent of the replacement-plate model. The current
square-box overlay draft is not this future general overlay system.

Add material-evidence guidance for electrical insulation, flammability, heat and
mechanical performance, covering both plate and lettering materials. Evaluate
3D-print-specific evidence and destination requirements; a filament rating does
not qualify the finished cover. Current models remain unqualified prototypes.
References: [UL cover-plate standard](https://www.shopulstandards.com/ProductDetail.aspx?UniqueKey=26093),
[UL additive-manufacturing guidance](https://www.ul.com/resources/certification-program-plastics-additive-manufacturing-faqs).

This roadmap is future work, with no delivery date or expanded implementation
claimed by this prototype.

## Credits and support

The current requester originated the concept, label/print modes, conversational
decoration and international/box-format scope. Their name and complete lead-design
attribution are unconfirmed. Codex prepared the research, specification and local
prototype. Supporting human contributors are unconfirmed. Credits and support
status are available in the app's About & credits section.

Community workspace. No maintainer designated; no Struder support commitment.
