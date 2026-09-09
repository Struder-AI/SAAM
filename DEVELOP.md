# Developing SAAM

Read [the product direction](PROJECT_CHARTER.md),
[decisions](DECISIONS.md), [glossary](GLOSSARY.md), and
[build requests](build_request.md), then the manuals relevant to the change.
Every developer agent must also read [MAKERS.md](MAKERS.md), even when not
exercising maker tools. Developer is the default role for now when unspecified.
This file consolidates developer-agent rules and development documentation.

## Restart boundary

- Do local work requested by the human. Import a previous component, decision,
  or concept only with their approval of that specific adoption.
- The old runtime is preserved in Git history and a local archive, outside the
  active tree. No source code has been migrated into the refresh.
- Record approvals exactly as stated. A contributor can authorize work while
  its project decision remains provisional pending the other contributor.
- Staging, committing, and publishing require explicit authorization. Honor
  authorization already given; do not ask for it again.
- The canonical destination is Struder-AI/SAAM. Use the requested feature
  branch when authorized to publish. Do not assume a personal fork is required.
  Do not push to main without an explicit request, or merge your own PR.

## Testing through the use context

Read [MAKERS.md](MAKERS.md) and exercise the same public tools and skill manuals
a maker agent receives. Test installation, error recovery, and discoverability
from AGENTS.md as capabilities are built.

Use isolated test projects, fixtures, and machine simulators. Synthetic test
approval data must remain distinguishable from human approval and must never
authorize a real job. Do not manufacture a human approval record or run hardware
as a shortcut to testing. Report software and physical validation separately.

## Checks

Run `npm test` at the repository root before and after changes. It checks the
documentation, decision metadata, private-file exclusions, wedge generation,
Rhino file round trips, Griffin interpretation and review/delivery behavior.
Add meaningful implementation checks as runtime capabilities are introduced.

## Developer documentation outside skills

Keep setup, test/build commands, code organization, and shared file-format
definitions in this file. Skill-specific
usage and implementation notes live in the skill package.
The glossary owns shared meanings; decisions own contributor choices;
`build_request.md` owns requested work.

`Prints/` and `.local/` are ignored by Git. Copy only explicitly selected,
checked examples into `examples/prints/` for sharing.

## Setup and checks

Use Node.js 22+ and Git. `npm ci` installs the pinned rhino3dm dependency;
no Rhino desktop installation or Compute server is needed for the wedge.

```sh
npm ci
npm test
npm run demo
npm run studio
npm run check:print
```

`demo` creates/reopens the ignored `Prints/s5-wedge-demo` bundle and generates a
development preview without approvals. Studio serves that print on
`http://127.0.0.1:4321`; set `SAAM_STUDIO_PORT` to select another port. Pass a
print directory after `--` to the Studio script to open another bundle.
There is no hardware connection or automatic machine execution.

`scripts/check-repo.mjs` checks local document links, decision-record structure
and approval metadata, and exclusion of private Prints and local artifacts.
It does not verify that a human actually approved a decision or that a part is
printable. The subsequent Node tests check manufacturing software behavior.
CI installs dependencies and runs the same tests. Synthetic approval tests use
temporary bundles and never authorize the person's real print.

## Current organization

| Location | Purpose |
|---|---|
| AGENTS.md, DEVELOP.md and MAKERS.md | Shared entry and maker/developer contexts |
| GLOSSARY.md | User-accessible meanings |
| DECISIONS.md | Contributor choices and recorded approvals |
| build_request.md | This cycle's scope and deferred implementation |
| skills/wedge-demo/ | Bounded wedge demo manual, geometry/generation/export tools, references and tests |
| machines/ | S5 machine definition and declared export |
| studio/ | Local geometry and G-code viewer, review UI and loopback server |
| examples/prints/ | Specifically curated public examples |
| Prints/ | Ignored local print bundles |

Keep skill-specific documentation in its package. Root documents own the shared
guidance; do not recreate a docs folder.

## Generation and review

The user approves geometry, then the locked process plan. Generate SAAMpath
directly from that complete plan, then produce an export in an output option
declared by the machine file. Finish automated checks before SAAM Studio runs
the exact export for the third approval: toolpath. Deliver those bytes unchanged.

Generation performs the calculations specified by the plan. It does not add
another planning stage. A plan must include the choices, settings and versions
required for repeatable generation. A random seed is only appropriate for a
future skill that deliberately randomizes a result, such as seam placement;
there is no mandatory seed field or randomized skill in this foundation.

## Rhino geometry

Rhino is the selected geometry platform and 3DM is the native geometry format.
The wedge uses pinned rhino3dm 8.32.2 to create a capped extrusion and six named
NURBS reference surfaces, then tests the saved 3DM by reopening it. The exact
planar faces also supply a small display proxy. General edited-3DM import,
spline-surface intersections and full Rhino computation remain deferred.
rhino3dm is a geometry/file library, not the complete Rhino computation engine.

## Studio feature references

Implement the [maker interaction flow](MAKERS.md#maker-interaction-flow): geometry
review and its revision loop, settings review and its revision loop, then
toolpath review followed by confirm and export. Keep the interface concise and
accessible. Use chat for all recipe adjustments; expose camera, playback speed,
scrubbing and travel visibility as viewer controls. Layer height means deposited
layer thickness; the old "horizontal body" label referred to the flat-layer
portion of the wedge, not a separate height setting.

The agent applies patches with the wedge CLI's `adjust` command. Studio polls a
bundle fingerprint and reloads changed data automatically, keeping the view
when nothing changes and returning to the affected approval step after edits.
Geometry edits invalidate all three approvals; settings edits preserve geometry
approval and invalidate settings/toolpath approval. A server running old imported
code must be restarted after runtime changes; check geometry loads afterward.

### Remembered printer setup

Follow [maker setup guidance](MAKERS.md#printer-setup-and-assumptions). Firmware
version and startup verification are optional metadata. Standard S5 Griffin
startup is an explicit profile assumption and does not block settings approval.
Resolve concrete incompatibilities through chat; do not require a technical
questionnaire. User-reported verification must remain separate from assumptions.

The ignored `.local/machine-setups/ultimaker-s5.json` stores setup, its source,
and update time. `remember-setup` saves the current setup; `adjust` automatically
saves setup changes. `init` reuses remembered setup when no explicit plan is
provided. A changed firmware version clears startup verification unless new
verification is explicitly supplied. Setup reuse does not create job approvals.

### Geometry and program views

The wedge viewer provides click-to-select faces and matching feature buttons.
Features identify the geometry version and native object UUID. Geometry edits
recreate those identifiers and invalidate geometry, plan and toolpath approvals.
Generic edge/object selection and freeform geometry editing remain deferred.

For toolpath review, the interpreter must support the selected export language
and required machine state. Unsupported commands, missing helper files, or
incompatible setup must be resolved before production review. The S5 subset
interpreter checks the actual export and rejects unsupported commands. Griffin
firmware preflight and G280 priming are external events; their internal motions
are not simulated. An unknown installed firmware version does not block review;
the standard profile assumption is shown with the settings. Development preview
creates no approvals and cannot authorize delivery.
A path display alone cannot establish arbitrary machine-program behavior.

## Print bundle and current formats

The wedge implementation stores one directory per print:

```text
Prints/<name>/
  plan.json
  machine.json
  geometry/model.3dm
  geometry/model.json
  path.saampath
  exports/griffin-gcode/wedge.gcode
  checks.json
  review.json
  delivery/wedge.gcode
```

`delivery/` exists only after approval and delivery. Current formats are scoped
to this demo, not a promise of compatibility with future general slicing:

- `saam-machine/1`: millimeter bounds, nominal axis limits, tools, output options
  and the declared firmware startup contract.
- `saam-wedge-plan/1`: geometry parameters, placement, setup, complete process
  settings, generator version and selected output. Its lock hash also includes
  the native geometry, machine snapshot and generating runtime source hash.
- `saam-wedge-geometry/1`: native file hash, parameters, display proxy and
  geometry-version-specific face references.
- `saampath/1`: JSON in a `.saampath` file. Moves carry absolute XYZ millimeters,
  speed in mm/s and deposited volume in mm³. Retraction/recovery uses filament
  millimeters; fan and dwell actions are explicit. Phase/layer labels describe
  the move without determining its geometry.
- `saam-review/1`: exact-version human approvals, history and generation hashes.
  `saam-checks/1` records software checks and limitations.

On reopening, verify 3DM integrity, regenerate from the locked recipe, compare
SAAMpath and export, and reinterpret G-code. No edited/stale artifact can inherit
toolpath approval. Delivery copies the already reviewed bytes. Local approval
records capture a person's statement; they are not authenticated digital
signatures. Use `examples/prints/` only for explicitly curated examples.

## Local map

The personal map lives in ignored `.local/architecture-map/`. Open its
`index.html` directly. Rebuild with `node .local/architecture-map/build.mjs`
when that local tool is present; it is not required for another contributor's
checkout. It resolves real document anchors and embeds their current excerpts.
Hand-authored relationships and runtime plans remain labelled as such.

## Legacy reference

The old implementation is outside the active tree. Its source remains in commit
`54093cadbe87020836916d53dd29a45a06bf5528`. In this working checkout, the old
folders are also hash-verified in the sibling archive
`../SAAM-legacy-20260908/legacy-reference/54093cadbe870/`. Old dependencies and
the earlier fill-review workspace are preserved beside that reference,
outside SAAM. Only the new architecture map remains under `.local/`.
No old runtime component is adopted by this refresh. Inspect or import individual
components only when separately requested and approved.
