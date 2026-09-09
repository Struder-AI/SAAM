# Developing SAAM

Read [the product direction](README.md#project-direction),
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
documentation, decision metadata, private-file exclusions, wedge and shell
generation, Rhino file round trips, Griffin interpretation and review/delivery
behavior for both kinds of print.
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

`node_modules/` is the conventional installation folder for packages used by
Node.js, the JavaScript runtime. Here it contains dependencies such as
`rhino3dm`, installed by `npm ci`. `package.json` declares dependencies and
`package-lock.json` pins their resolved versions. Keep dependency source out of
our own source edits and Git; change the package declarations when needed and
reinstall. The folder name comes from the Node ecosystem, not SAAM geometry.

```sh
npm ci
npm test
npm run demo
npm run studio
npm run check:print
```

Both print adapters use one lifecycle in `core/print/workflow.mjs`.
`npm run shell -- <command> <directory>` exposes `init`, `demo`, `adjust`,
`generate`, `check`, `upgrade`, `remember-setup`, and `deliver` for shell
plans; the wedge CLI exposes the same lifecycle for its bounded recipe.
`npm run studio -- <directory>` opens either kind. Studio's G-code viewer is
the toolpath preview. There is no standalone shell-preview command or artifact
format. Development generation uses the same bundle and checks with no approvals.

`demo` creates/reopens the ignored `Prints/s5-wedge-demo` bundle and generates a
development preview without approvals. Studio serves that print on
`http://127.0.0.1:4321`; set `SAAM_STUDIO_PORT` to select another port. Pass a
print directory after `--` to the Studio script to open another bundle.
There is no hardware connection or automatic machine execution.

`scripts/check-repo.mjs` checks local document links and heading anchors, decision-record structure
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
| core/ | Shared slicing core: patch geometry, sectioning, planar regions, travel planning, SAAMpath, Griffin export, native 3DM geometry, print bundle and review workflow, plan and print CLI |
| skills/full-fill/ | Solid planar layers for any closed shell: manual, generator and tests |
| skills/draped-skin/ | Surface-following skins under the machine's non-planar angle limit: manual, generator and tests |
| skills/wedge-demo/ | Bounded wedge demo manual, geometry/generation tools and shared-workflow adapter, references and tests |
| machines/ | S5 and H2D capability/setup definitions and output availability |
| studio/ | Local geometry and G-code viewer, review UI and loopback server, for either kind of print bundle |
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

The spline backend uses Rhino and native 3DM files. Imported meshes use
[native indexed geometry](#geometry-interoperability-for-skill-authors), with
the user-confirmed shared interface preserving direct spline slicing.
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

The agent applies patches with the owning package's `adjust` command - the wedge
CLI for a wedge, `core/print/cli.mjs` for a shell print. Studio polls a bundle
fingerprint and reloads changed data automatically, keeping the view when nothing
changes and returning to the affected approval step after edits.
Geometry edits invalidate all three approvals; settings edits preserve geometry
approval and invalidate settings/toolpath approval. A server running old imported
code must be restarted after runtime changes. Reuse the correct existing viewer
when possible; identify its print directory and port before replacing a process.
Do not launch another viewer as a workaround for stale imports. Check the loaded
geometry and export afterward. `--close-when-idle` is available for a temporary
Studio session; only stop processes known to belong to the current work.

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
firmware startup is external and its internal motions are not simulated. The S5
wedge export does not issue G280 or run a bed-leveling routine. An unknown installed firmware version does not block review;
the standard profile assumption is shown with the settings. Development preview
creates no approvals and cannot authorize delivery.
A path display alone cannot establish arbitrary machine-program behavior.

## Print bundle and current formats

The shared workflow stores one directory per print (wedge filenames shown):

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

`delivery/` exists only after approval and delivery. Geometry and plan schemas remain adapter-specific; lifecycle and SAAMpath formats are shared:

- `saam-machine/1`: millimeter bounds, nominal axis limits, tools, output options
  and the declared firmware startup contract. Output options carry program
  header, start and end templates; these are part of the locked machine snapshot.
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

On reopening, verify native geometry/source integrity, regenerate from the locked recipe, compare
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
[draped-skin](skills/draped-skin/SKILL.md). Both skills return operation results to the shared composer. One plan produces
one SAAMpath and one reviewed export. See [skill-result composition](#skill-result-composition).

**Status: software only, and less established than the wedge.** The workflow is
implemented once in `core/print/workflow.mjs`; `core/print/bundle.mjs` supplies the shell adapter for a print bundle
with native spline or mesh geometry and a review record, Studio serves it, a person gives
the three approvals, and delivery copies the reviewed bytes. What that does not
establish: no part from these skills has been printed, no maker agent has used
them end to end. The plan expresses shapes in `core/geom/shapes.mjs`
(`box`, `wedge`, `spline-top`, `spline-shell`, `vertical-spline-shell`), indexed
triangle meshes, and an `assembly` of these components. An
edited or imported 3DM is still not accepted as input. The vertical spline shell
extrudes its bulged spline footprint vertically below a spline roof; arbitrary
side editing remains deferred. Generation without approvals is recorded as
`mode: development` and cannot satisfy delivery.

### Geometry contract

The **spline backend** accepts a closed shell of untrimmed bivariate spline
patches. Mesh input uses the [shared geometry interface](#geometry-interoperability-for-skill-authors).
Every spline face is
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

The region layer is implemented and tested. Assemblies now select separate
components for fill instances and a roof for draping. Automatic solid union and
overlap resolution in a plan remain deferred; an assembly is not a boolean union.

### Travel planning

`core/path/builder.mjs` classifies each move as joined, combed or hopped.
The composer sets whole-plan clearance; local callbacks decide direct/combed
eligibility. See [travel requirements](#whole-plan-travel-requirement). Fill
strokes alternate their direction to keep neighbouring endpoints close. The wedge
uses its own bounded travel policy: nearby starts stay down, while longer moves
lift to the part maximum plus clearance. Both use the shared export and checks.

### Print bundle and review

`core/print/geometry.mjs` writes the shell as its named untrimmed NURBS surfaces
in a 3DM. rhino3dm builds no general solid from a set of patches, so there is no
capped extrusion to store as the wedge does; instead the file is accepted only
once it reopens, rebuilds the same patches, passes the closure check and matches
the reviewed control nets. That check runs again on every load, so an edited or
substituted file stops the print rather than being sliced as something else. The
descriptor also carries a quad proxy mesh, tessellated per patch, for the viewer.

`core/print/workflow.mjs` owns initialization, geometry verification, plan and
runtime hashes, adjustment, approvals, generation/checks, reopening, setup reuse,
upgrades and delivery. The shell and wedge bundle modules only provide adapters:
recipe validation, geometry, generation, limitations and release metadata.
Studio chooses an adapter by the saved plan schema and uses this same lifecycle.
Geometry changes invalidate all approvals; process, composition, runtime or
machine-template changes invalidate plan and toolpath approval. Reviewed delivery
bytes are never regenerated during delivery.

Old machine snapshots without templates must be explicitly upgraded with the
owning CLI's `upgrade` command before generation. It installs the current machine
snapshot and invalidates plan/toolpath approval, retaining unchanged geometry
approval. Do not rewrite a person's existing export or delivery as a migration.

### Formats

- `saam-shell-plan/1`: shape and its parameters, placement, setup, shared
  process settings, and each skill's settings under `skills`. Composition rules, component selections and settings are locked with the plan. Unknown or
  misspelled fields are rejected, and the strict field check is made against the
  selected shape. Generation introduces no further process choices.
- `saam-shell-geometry/1`: native file hash, shape parameters, geometry version,
  per-patch control-net hash, named face references and the display proxy.
- The bundle layout matches the wedge's, with `exports/griffin-gcode/part.gcode`
  and `delivery/part.gcode` in place of `wedge.gcode`. `saampath/1`,
  `saam-review/1` and `saam-checks/1` are unchanged.
- The machine file gains `nonplanar.maxAngleDeg` (15 for the S5): the surface
  slope beyond which a fixed vertical nozzle cannot follow. It is a declared
  software limit, not a measured clearance rating, and no collision model exists.
- SAAMpath and the Griffin export follow the same contracts as the wedge,
  including machine-owned header/start/end templates and the header fields the printer's reader requires. The exporter reads
  `startup.zAfterStartupMm`, falling back to the older `zAfterPrimeMm`.
- Moves shorter than 1e-4 mm are not emitted: this conservative cutoff avoids commands collapsing at the export's five-decimal coordinate resolution, and SAAMpath and the
  program would then disagree about how many moves exist.

### Checks

`npm test` runs `core/tests/` and both skills' tests alongside the wedge's. They
cover evaluation against rhino3dm, sections against analytic areas, closure
rejection, degenerate cuts, offsets and booleans against analytic areas, the
surface height field, travel and lift behaviour, the angle limit excluding steep
surface, strict interpretation of the export, determinism, and detection of an
edited export. `core/tests/workflow.test.mjs` adds the review workflow: the 3DM
round trip and rejection of a substituted file, development generation creating
no approvals, three synthetic approvals with stale views and byte-identical
delivery, the approvals each kind of edit invalidates, remembered setup, and
Studio serving and delivering a shell print. Synthetic approvals are written
with an actor name that says so. None of that establishes clearance, surface
quality, or that any part prints.

## Interoperability and one workflow

Prefer one shared pipeline with narrow adapters. Introduce a parallel pipeline
only when it is genuinely necessary; normally explain why a shared extension
cannot serve the need and ask the user before building it. Authorization already
given applies. Convenience, a demo, an agent's private test, or a new skill is
not by itself a reason to duplicate generation, preview, review or delivery.
Intermediate developer experiments belong in temporary scratch directories and
call the same components. They must not become a second product command, artifact
format or approval route without an explicit scope decision.

Interoperability is a design ideal: skills should work across machines through
declared capabilities and shared geometry/result interfaces; other elements
should generalize wherever practical. Keep machine behavior in machine profiles
and output adapters, not in pattern skills. Exceptions will be necessary; keep
them narrow, explain their reason and limits, and test the shared boundary.
The bounded S5 wedge is one such exception in geometry and generation. It uses
the common exporter and print lifecycle. Mesh and NURBS backends should share
downstream regions, composition, SAAMpath, export and review; neither is a reason
for another complete pipeline. Both backends now use the shared geometry-query interface described below.

## Geometry interoperability for skill authors

`core/geom/query.mjs` is the skill-facing boundary: `sectionGeometry`, `topAt`
and `sampleTopSurface`, with conservative bounds on the geometry object. It
supports the existing closed untrimmed spline shells and validated indexed
triangle meshes. Full-fill, planar-infill and draped-skin use these queries;
pattern code must not branch on triangle versus spline internals. Declare new
capabilities here and provide a backend implementation or an explicit rejection.
The user confirmed retaining both backends on 2026-09-09. Mesh conversion is not
required before SAAMpath generation.

| Representation | Role |
|---|---|
| Spline shell / triangle mesh | Part geometry behind common queries. |
| Closed regions with holes | Planar sections, offsets, solid masks and infill clipping. |
| Surface height and normal | Accessible roof sampling for drape; faceted normals stay faceted. |
| Skill operation result | Composable strokes, dependencies, layer references and travel policies. |
| SAAMpath | Machine-independent XYZ motion, deposition and process actions. |
| Output artifact | Machine-specific commands/packaging with a matching interpreter. |

Native mesh assets use `geometry/model.mesh.json` with `saam-native-geometry/1`,
millimeter indexed triangles, original source provenance and shape parameters.
Mixed assemblies retain spline recipes for spline components. Existing spline
and wedge bundles continue using `geometry/model.3dm`; no silent migration occurs.
STL import accepts ASCII and binary with explicit mm/inch units, indexes exact
shared vertices, records translation onto the bed, and retains `geometry/source.stl`
and its hash. File changes invalidate review. STL does not supply semantic CAD
faces, so Studio selects the imported component as a whole.

`core/geom/mesh.mjs` rejects invalid indices/nonfinite coordinates, degenerate or
duplicate triangles, open edges, inconsistent winding, nonmanifold vertices and
intersecting nonadjacent triangles. It does not repair geometry. Checks are
bounded to 100000 triangles and two million candidate intersection tests; adjacent
facets sharing vertices are excluded from the intersection pass, so this is not
a complete solid-kernel validity proof. Mesh sections preserve holes/islands and
report nudged boundary cuts. Normals at equal-height creases use the steeper
facet. Drape requires a continuous accessible roof; discontinuities or sampled
segments above its angle limit are rejected. Sampling and bead-width limits remain.

Equivalent mesh/spline fixtures and mixed assemblies exercise shared skills,
regions, machine checks, native-file integrity, approvals and exact-byte S5
export delivery. Add equivalent backend tests for each general skill. The
bounded eight-point S5 wedge remains an explicit geometry/machine exception.

## Whole-plan travel requirement

The shared composer computes a conservative height from all operation strokes
and the entire placed plan's geometry bounds, including later or unselected
components. Lifted traverses clear it by the locked `liftMm`; cooling uses the
same bound. Traverses never start below either endpoint. Final parking clears
the plan. Required clearance above the selected tool's Z bounds is rejected.
Single-skill compatibility helpers supply their geometry bounds to the same
composer; compose all results together for a multi-skill process plan.

Nearest wall starts, alternating infill and verified combing reduce travel.
Planar combing checks boundary crossings and standoff, then can route around
holes via a bounded visibility graph (256 offset corners, `maxCombMm` route
length); otherwise it hops. Earlier operation queries can forbid combing.
Drape retains its own local surface query for direct moves. These conservative
policies are not a full swept-head collision or support model. Wedge's bounded
nearby/direct and full-part-height policy remains unchanged.

## Planar-infill design

[Planar-infill](skills/planar-infill/SKILL.md) is implemented: walls and sparse
alternating rectilinear interiors. Full-fill `mode: solid-surfaces` supplies
local top/bottom solid masks by comparing neighboring sections. Sparse/solid
interiors are complementary; walls have one owner and each layer's supporting
operations precede the next. The shared region booleans now handle coincident
sections and collinear edges. Drape reservation clips both planar patterns.

The 20-layer box regression verifies three solid bottom/top layers, fourteen
sparse layers, and one set of walls per layer across both backends/machines.
A sloping roof regression checks local solid regions. Bridge optimization and
support generation remain unimplemented; solid beads above sparse infill are
an approximate deposition model, not validated physical bridges.

## Machine interoperability design

`core/machine/profile.mjs` validates selected tool bounds, nozzle/core, filament,
material temperatures, flow/retraction and required skill capabilities. Profiles
own setup defaults; remembered setup is separate per machine. Skills target
compatible XYZ extrusion machines through this interface. Planar skills require
`planar`; drape additionally requires `nonplanar` and a declared angle limit.
`checkMachinePath` checks geometry-independent SAAMpath bounds, axis and extrusion
feeds before export. Wedge explicitly rejects machines other than the S5.

| Profile | Skill checks | Runnable output |
|---|---|---|
| UltiMaker S5 | Fill, planar-infill, drape on mesh/splines; bounded wedge | Griffin exporter/interpreter, same-file Studio review/delivery. |
| Bambu H2D | Fill, planar-infill, drape on mesh/splines | Pending a verified startup/command/packaging envelope; export explicitly unavailable. |

The user selected H2D left 0.4 mm nozzle, 1.75 mm PLA and experimental 15°
non-planar limit. The profile records official hardware/slicer sources, separate
nozzle work areas and conservative PLA settings. Its internal path-check start
is an explicit development assumption, not verified firmware state. The inherited
left-tool height is 320 mm; the advertised overall height is 325 mm. No H2D print
or machine file is validated. A known-good Bambu Studio export for the target
setup is needed to finish startup, physical tool mapping, proprietary commands
and sliced-3MF packaging. Geometry/settings review remains usable meanwhile.

`core/export/registry.mjs` dispatches the selected output to its exporter and
interpreter; it rejects unavailable outputs. SAAMpath is an interoperability
boundary, not an automatic translator to every machine language. Current actions
are XYZ moves with deposition volume, retraction/recovery, fan and dwell for one
selected tool. New dialects need adapters; rotary orientation, in-program tool
changes or other unsupported semantics need explicit representation extensions.
Preserve units, transforms, feature identity and material ownership across every
boundary. A common extension or file suffix alone does not establish compatibility.

## Documentation maintenance

README owns the introduction and product direction for people and agents;
PROJECT_CHARTER is only a compatibility pointer. AGENTS routes agents;
MAKERS owns the maker interaction; DEVELOP owns shared
implementation, formats and commands; skill manuals own their tools and limits.
The glossary owns terms, decisions own contributor approvals, and build requests
own requested work and dated implementation history. Keep capability status at
its owning implementation/manual and link from entry summaries. Do not duplicate
detailed status or behavior across entry files. Mark past build results as dated
history and point to their replacement, rather than presenting old limitations as
current. Distinguish user-reported machine observations, software verification and
a validated physical print. Update affected documentation in the same change.
Link/anchor checks cannot establish factual accuracy: review claims against the
code, tests and explicitly authorized user reports.

## Skill-result composition

Skills return an in-memory result `{id, operations, report}`. An operation has
a unique `id`, a `layerId` identifying its deposition layer/surface, a numeric
`rank` for default ordering, and `after` dependencies. Rank is a scheduling
coordinate, not universally Z: planar fill uses layer height. Operations also
provide strokes (3D points, speed, role, and either uniform bead area or per-segment
volume/metadata), travel-policy queries, and a cooling clearance. An operation is
atomic; expose smaller operations when within-layer interleaving is permitted.
These runtime results are not separate machine files or a persisted preview
format. Travel policies may contain geometry-query callbacks.

`core/path/compose.mjs` is skill-independent. It topologically orders operations,
rejects duplicate IDs, missing dependencies and cycles, and uses stable result
order to break ties. Plan `composition` contains `batchLayers` (1–20), `order`
(an optional ordered subsequence of operation IDs), and `dependencies` (additional
`{before, after}` edges). Batch size 1 alternates compatible results at each
rank; size 2 gives AA–BB for two results with matching layers. Explicit ordering
and dependencies can interleave operations within a layer. They cannot remove a
skill's prerequisites. The agent proposes these choices before plan approval;
generation executes the locked rules without a new planning or approval stage.

One PathBuilder owns the resulting travel/retraction state, and the composer
finishes cooling once after all operations assigned to a shared layer. Hops
account conservatively for previous operations' clearance queries, including
travel from a taller batched column toward a lower one. This is not a full
collision or swept-head model. Results must describe compatible regions and
material ownership; the composer does not infer arbitrary geometric overlap, support,
bridge printability or a safe order from arbitrary strokes alone.

Full-fill produces separate wall and interior-fill operations for each layer.
An assembly's `geometry.parts` holds named components with `geometry` and
`xMm/yMm/zMm` translations; native geometry preserves each component's representation.
`skills.full-fill.parts` selects the components to fill (empty means all),
producing one skill instance per component. `skills.draped-skin.part` selects
the roof component for an assembly. Assemblies accept supported spline builders
and validated meshes; they are not automatic boolean solids. Assign regions
and geometry deliberately; component selection is part of the reviewed recipe.

Full-fill and draped-skin do **not** weave through each other. All supporting fill
operations precede the first skin, and skin layers remain ordered. Two supporting
columns may alternate or batch before a spanning roof. The current skin bead
model is approximate and does not prove that an unsupported span will print.
Future skills use the same operation/dependency boundary; do not add a new
composer for each skill pair.

## Machine program templates and S5 observations

`core/export/griffin.mjs` is the single implemented G-code emitter/interpreter.
The selected machine output's `program.header`, `program.start` and
`program.end` arrays contain literal lines with named value substitutions.
Values come from the locked setup, release metadata and path totals/bounds;
templates execute no JavaScript. Unknown values and invalid/nonfinite path data
are rejected. The emitter writes shared SAAMpath actions between these sections.
The supported dialect remains the declared Griffin subset, not arbitrary G-code.
Coordinate and extrusion rounding must still obey the locked flow limit.

On 2026-09-08 the user reported that the **last wedge change** achieved no routine
bed leveling and no heating of the unused nozzle. Preserve that observed envelope:
Griffin compatibility `4.4.0`, SAAM's own version field, build date, material GUID,
build-volume metadata, active-tool temperature commands, no G280, and shutdown.
The default recipe uses nozzle #2/T1. Earlier in the day the user reported initial
under-extrusion; the wedge recipe now accounts for its terminal retraction on the
next start. These are scoped observations, not a claim of complete physical print
validation. Never treat an earlier export revision as the reported working one.

## Legacy reference

The old implementation is outside the active tree. Its source remains in commit
`54093cadbe87020836916d53dd29a45a06bf5528`. In this working checkout, the old
folders are also hash-verified in the sibling archive
`../SAAM-legacy-20260908/legacy-reference/54093cadbe870/`. Old dependencies and
the earlier fill-review workspace are preserved beside that reference,
outside SAAM. Only the new architecture map remains under `.local/`.
No old runtime component is adopted by this refresh. Inspect or import individual
components only when separately requested and approved.
