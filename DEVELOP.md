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
- Do not use external memories as project authority. For development work,
  rely on the repository entry documents and explicitly provided user context.
  Import a remembered fact, outside note, prior conversation, or archived
  project detail only when the human specifically asks for or approves that
  source.
- The old runtime is preserved in Git history and a local archive, outside the
  active tree. No source code has been migrated into the refresh.
- Record approvals exactly as stated. A contributor can authorize work while
  its project decision remains provisional pending the other contributor.
- Staging, committing, and publishing require explicit authorization. Honor
  authorization already given; do not ask for it again.
- Once committing is authorized, commit the existing working tree before
  starting new work. The human's in-progress changes stay separable from the
  agent's, and any later revert returns to a known state. Run `npm test` first
  and say so if that baseline does not pass.
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
npm run preview
```

`preview` runs the shell pipeline (`core/print/cli.mjs`) into the ignored
`Prints/shell-preview` bundle: plan, SAAMpath, Griffin export and software
checks for the full-fill and draped-skin skills. It creates no approvals and has
no Studio integration; see the shell pipeline section below.

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
| core/ | Shared slicing core: patch geometry, sectioning, planar regions, travel planning, SAAMpath, Griffin export, plan and preview CLI |
| skills/full-fill/ | Solid planar layers for any closed shell: manual, generator and tests |
| skills/draped-skin/ | Surface-following skins under the machine's non-planar angle limit: manual, generator and tests |
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

## Shell pipeline (full-fill and draped-skin)

`core/` holds the shared slicing core used by
[full-fill](skills/full-fill/SKILL.md) and
[draped-skin](skills/draped-skin/SKILL.md). Both skills read one plan and write
one program, so travel planning, sectioning and export are shared rather than
duplicated per skill.

**Status: software only, and less established than the wedge.** Every path in
this pipeline is a development preview. There is no Studio integration, no
approval workflow and no delivery step; `core/print/cli.mjs` cannot produce an
approved program and says so in its own output. No part from these skills has
been printed, and no maker agent has used them end to end. The wedge demo
remains the reviewed workflow for a job a person will actually run.

### Geometry contract

Input is a **closed shell of untrimmed bivariate spline patches**. Every face is
a full rectangular (u,v) patch, which is what makes sectioning tractable without
a kernel: a face's section is the zero contour of a scalar function over the
whole domain, with no trim classification. That restriction is not cosmetic.
rhino3dm is a geometry and file library, not a modelling kernel: it exposes no
booleans, no brep meshing and no surface intersection, its `BrepTrim` carries
topology indices with no parameter-space curve, and `BrepFace.loops` is unbound
in this build. A trimmed face therefore cannot be classified, and is rejected.

Closure is verified numerically: every non-degenerate patch boundary must be
matched by another patch's boundary, compared geometrically by closest point
rather than by parameter, since a ruled surface reparameterises the iso-curve it
was built from. A degenerate boundary (a pole, as at a cap centre) closes by
itself. A trimmed or missing face fails this check.

### Sectioning untrimmed spline shells

For plane (n, d) and surface S(u,v) the section is the zero set of
`g(u,v) = n . S(u,v) - d`. The numerator of that expression is an ordinary
polynomial B-spline whose control coefficients are `w_ij (n . P_ij - d)`, and it
shares the zero set because the rational denominator is positive. Working with
the numerator gives two things: cheap evaluation, and a rigorous gradient bound
from the control net.

Sampling density is then chosen by the function rather than guessed from size. A
grid doubles while any cell could still hide a contour:

- A cell with no sign change is dismissed only when the numerator at its corners
  is farther from zero than the gradient bound allows it to travel inside the
  cell. That part is rigorous.
- A cell that does change sign is trusted by marching squares to hold one simple
  crossing, so its edges are sub-sampled and must show a single crossing each.
  Two crossings on one edge cancel in the corner signs and alias into a missing
  arc; this check is what catches that, and it is a check rather than a proof.

Crossings are refined by bracketed root finds, so contour vertices lie on the
plane rather than being interpolated, and segments are subdivided until the
chord follows the surface within tolerance, with each inserted point projected
back onto the contour. What can still be missed is a component smaller than the
final cell, bounded by `minFeatureMm`, whose default is the bead width.

A plane through a critical point of the surface (a saddle, where the contour
self-touches) or flush with a whole face is genuinely ambiguous. Both are
resolved the way slicers resolve them, by displacing the plane by up to 0.1 um
and re-cutting; the displacement is reported. A section that still will not
close raises rather than returning a part with a gap in it.

### Layer regions and several solids

`core/region/` does the planar work: inward offsets for perimeters (offset,
prune against the true distance field, split at self-intersections, then verify
every emitted point keeps its standoff), scanline fill, and boolean union,
intersection and difference.

Booleans are how several solids are meant to combine: section each solid on its
own and combine the layers, rather than building a boolean B-rep. A slicer only
needs the result one layer at a time, so surface-surface intersection curves and
tolerance-consistent shell stitching are never posed. The same operation
reserves material under a top surface, by intersecting a section with the level
set of the reserve height. Coincident collinear boundaries are not supported
input.

The region layer is implemented and tested; the plan schema does not yet accept
more than one solid, so multi-solid work is available in the core but not yet
reachable from a plan.

### Travel planning

`core/path/builder.mjs` classifies each move as joined, combed or hopped, and
computes clearance per hop from a callback: a planar layer clears the layer it
is on, while a draped skin clears the surface that particular hop crosses. Fill
strokes are generated so each ends where the next begins. This is deliberately
different from the wedge demo's fixed policy of retracting and lifting to the
whole part's maximum height for every horizontal move; the wedge is unchanged.

### Formats

- `saam-shell-plan/1`: shape and its parameters, placement, setup, shared
  process settings, and each skill's settings under `skills`. Unknown or
  misspelled fields are rejected, and the strict field check is made against the
  selected shape. Generation introduces no further process choices.
- The machine file gains `nonplanar.maxAngleDeg` (15 for the S5): the surface
  slope beyond which a fixed vertical nozzle cannot follow. It is a declared
  software limit, not a measured clearance rating, and no collision model exists.
- SAAMpath and the Griffin export follow the same contracts as the wedge,
  including the header fields the printer's reader requires. The exporter reads
  `startup.zAfterStartupMm`, falling back to the older `zAfterPrimeMm`.
- Moves shorter than 1e-4 mm are not emitted: below the export's five-decimal
  coordinate resolution a move cannot be written down, and SAAMpath and the
  program would then disagree about how many moves exist.

### Checks

`npm test` runs `core/tests/` and both skills' tests alongside the wedge's. They
cover evaluation against rhino3dm, sections against analytic areas, closure
rejection, degenerate cuts, offsets and booleans against analytic areas, the
surface height field, travel and lift behaviour, the angle limit excluding steep
surface, strict interpretation of the export, determinism, and detection of an
edited export. None of that establishes clearance, surface quality, or that any
part prints.

## Legacy reference

The old implementation is outside the active tree. Its source remains in commit
`54093cadbe87020836916d53dd29a45a06bf5528`. In this working checkout, the old
folders are also hash-verified in the sibling archive
`../SAAM-legacy-20260908/legacy-reference/54093cadbe870/`. Old dependencies and
the earlier fill-review workspace are preserved beside that reference,
outside SAAM. Only the new architecture map remains under `.local/`.
No old runtime component is adopted by this refresh. Inspect or import individual
components only when separately requested and approved.
