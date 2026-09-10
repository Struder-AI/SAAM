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
  active tree. The user authorized selective MCP, Dobot machine/Lua and vase-wall
  adoption on 2026-09-09. Their current implementations use the shared bundle
  lifecycle; see [the adoption record](build_request.md#br-021--selective-local-mcp-dobot-and-vase-wall-adoption).
  Other archived source remains reference material pending specific authorization.
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
generation, Rhino file round trips, Griffin/H2D/Dobot interpretation and
review/delivery behavior for both kinds of print, plus SDK stdio integrations.
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

Use Node.js 22+ and Git. `npm ci` installs pinned rhino3dm, MCP SDK and Zod dependencies;
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
`npm run studio -- <directory>` opens either kind. Studio's program viewer is
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

## Local MCP access

[The MCP adapter](adapters/mcp/README.md) provides stdio tools for a compatible
local chat client. Launch `node adapters/mcp/src/server.mjs` from the client's
configuration; its README gives an absolute-path example and environment options.
No client configuration is edited automatically. This is local access to this
development checkout, not an arbitrary browser-chat or hosted connector.

The adapter reads fixed known machine IDs and skill manuals, creates and reopens
named Prints bundles, applies revision-checked chat adjustments, checks current
artifacts, starts/reuses the shared Studio, reads approvals, generates the approved
plan and delivers its exact reviewed bytes. It has no approval tool, development
generation bypass, compiler, or private HTTP review implementation. Studio retains
the three human approvals. Default remembered setup is shared with the CLI;
custom test Prints roots isolate setup and job records. Large geometry is omitted
from `get_print` unless explicitly requested, with incomplete recipes marked.

Automatic discovery and extensible registration are deferred by
[D-022](DECISIONS.md#d-022--defer-automatic-capability-discovery). A known profile
or manual is not proof that the selected geometry, settings and output will pass.
`core/tests/mcp.test.mjs` uses actual SDK clients and child processes, temporary
bundles and synthetic approval fixtures outside the adapter protocol.

## Web-agent runtime probe

[The standalone probe](scripts/web-agent-probe.mjs) tests whether a maker can
interact with a server in a web agent's temporary execution environment.
It is a transport experiment, not another manufacturing pipeline. Upload the
script and [experiment prompt](scripts/web-agent-probe-prompt.txt) to the target
web chat; no repository access or npm installation is required. Use Node.js 22+.

```sh
node scripts/web-agent-probe.mjs serve --host 127.0.0.1 --port 4321
node scripts/web-agent-probe.mjs status --url SESSION_URL
node scripts/web-agent-probe.mjs update --url SESSION_URL --control CONTROL_TOKEN --message "Updated through chat"
```

The server prints the session URL, instance ID, control token and fixture SHA-256.
In an isolated cloud environment, use `--host 0.0.0.0` if required by the
platform's native forwarding mechanism. Preserve the random session path and
trailing slash in the maker's preview URL. The probe uses relative client routes
and allows preview framing; its random path limits access to this non-sensitive
test session. It is not the authentication model for a production service.

The maker enters a phrase in the live page, the agent reads it from server state,
and an agent update appears through polling. The maker then confirms a receipt
download and repeats a check after completed chat turns and an idle interval.
Compare instance IDs to detect restarts. Browser endpoint logs identify the
request path, not a verified human, and a download request is not proof that a
file reached the person's device. Automated tests use explicitly synthetic input.

Report shell reachability, cloud-browser reachability, maker interaction,
message round trips, download and session lifetime separately. A static artifact,
screenshot or shell HTTP request does not establish live maker access. Do not
substitute deployment, an external tunnel or a local companion for the platform
capability being tested. Vendor web-session results remain untested until a
person performs the protocol on that surface. Stop only the probe process owned
by the experiment when finished. The probe stores state in memory and creates no
print files, job approvals or machine programs.

## Current organization

| Location | Purpose |
|---|---|
| AGENTS.md, DEVELOP.md and MAKERS.md | Shared entry and maker/developer contexts |
| GLOSSARY.md | User-accessible meanings |
| DECISIONS.md | Contributor choices and recorded approvals |
| build_request.md | This cycle's scope and deferred implementation |
| core/ | Shared geometry queries, planar regions, composition/travel, SAAMpath, S5/H2D/Dobot export and interpretation, native geometry, print bundles and lifecycle, plan and print CLI |
| adapters/mcp/ | Local stdio tools over the shared bundles and Studio; launch documentation |
| skills/full-fill/ | Solid planar layers for any closed shell: manual, generator and tests |
| skills/planar-infill/ | Sparse planar interiors and shared solid-surface composition |
| skills/draped-skin/ | Surface-following skins under the machine's non-planar angle limit: manual, generator and tests |
| skills/vase-wall/ | Continuous rising wall on supported convex sections, optional full-fill base |
| skills/wedge-demo/ | Bounded wedge demo manual, geometry/generation tools and shared-workflow adapter, references and tests |
| machines/ | S5, H2D and Dobot capability/setup definitions and output availability |
| studio/ | Local geometry and interpreted-program viewer, review UI and loopback server, for either kind of print bundle |
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
New wedges use eight-point indexed meshes with six named planar faces, an
axis-aligned rectangular base and vertical sides. The planar roof may slope in
any direction. Their native file is `geometry/model.mesh.json`; the wedge uses
rhino3dm only to verify older 3DM files during explicit upgrade. General edited-3DM import,
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
Features identify the geometry version and native object UUID or mesh face identity. Geometry edits
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
  geometry/model.mesh.json
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
- `saam-wedge-plan/1`: eight source points in `geometry.points`, placement, setup, complete process
  settings, generator version and selected output. Its lock hash also includes
  the native geometry, machine snapshot and generating runtime source hash.
- `saam-wedge-geometry/1`: native mesh file hash, source points, roof coefficients, mesh display and
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
in a 3DM. rhino3dm builds no general solid from a set of patches; the file is accepted only
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

Interoperability is a core design requirement: skills should work across machines through
declared capabilities and shared geometry/result interfaces; other elements
should generalize wherever practical. Keep machine behavior in machine profiles
and output adapters, not in pattern skills. Exceptions will be necessary; keep
them narrow, explain their reason and limits, and test the shared boundary.
This includes **skill composability on the same part**, as clarified by the user:
for example, full-fill base, vase-wall body and full-fill top cap. Shared output
and machine portability alone do not satisfy this requirement. Composition must
assign material regions, order operations and handle their transitions without
duplicate deposition. Report a specific unsupported transition, support need or
geometry constraint rather than treating skill identities as incompatible.
Every skill change must assess compatibility with existing geometry backends,
machines, other skills as predecessors/successors, and the public CLI/MCP/Studio
workflow. A shared exporter alone does not establish ecosystem interoperability.
A cap needs an accounted-for spiral-to-cap transition and support/bridging
assessment; simply lifting an exclusion is insufficient. The user's acceptance
example is a flat base and vase wall, flat cap, normal walls/infill under a wavy
roof, draped roof, and horizontal full fill above that roof with a wavy bottom.
Region boundaries must support such nonflat interfaces, not only height bands.
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
bundles continue using `geometry/model.3dm`. New wedges store indexed meshes;
explicit wedge upgrade converts the former four-parameter/3DM recipe and
invalidates all three approvals while preserving old artifacts. No silent migration occurs.
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
bounded eight-point wedge remains an explicit geometry/generation exception:
its planar roof is derived directly from validated corner points, with shared
mesh validation, scanline fill, export and review.

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
`planar`; drape and vase-wall additionally require `nonplanar` and a declared angle limit.
`checkMachinePath` checks geometry-independent SAAMpath bounds, axis and extrusion
feeds before export. Wedge uses the same profile validation and its bounded
eight-point generator, with S5, experimental H2D and configured Dobot output.

| Profile | Skill checks | Declared export and review |
|---|---|---|
| UltiMaker S5 | Fill, planar-infill, drape and bounded vase-wall on mesh/splines; bounded wedge | Griffin exporter/interpreter, same-file Studio review/delivery. |
| Bambu H2D | Fill, planar-infill, drape and bounded vase-wall on mesh/splines; bounded wedge | Experimental sliced-3MF exporter, checked firmware envelope and print-body interpreter; same-file review/delivery. |
| Dobot MG400 | Shared fill, planar-infill, drape, vase-wall and bounded wedge paths with synthetic configured installation checks | Experimental Lua source ZIP and bounded interpreter; same-file review/delivery. Setup is unconfigured by default; vendor project import is unverified. |

The user selected H2D left 0.4 mm nozzle, 1.75 mm PLA and experimental 15°
non-planar limit. The profile records official hardware/slicer sources, separate
nozzle work areas and conservative PLA settings. The inherited left-tool height
is 320 mm; the advertised overall height is 325 mm. The supplied left/right
Bambu Studio exports establish the bounded [H2D output contract](#h2d-output-contract).
No physical H2D print has been validated.

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
`{before, after}` edges), plus optional material `regions` described below. Batch size 1 alternates compatible results at each
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

[Vase-wall](skills/vase-wall/SKILL.md) is one atomic continuous operation with
actual changing-Z section queries. It accepts one supported convex outer section
with a common interior point and no holes or islands; mesh and restricted spline
backends remain behind the shared queries. Its locked `endTransition` can leave
a spiral rim or complete a level rim with a final turn whose material thickness
tapers to zero. A planar successor needs that level boundary. The continuous
stroke cannot weave turn by turn with infill occupying the same height band;
different regions of the same part can use the other skills. The manual owns
standoff, sampling, bead overlap and point-budget limits.

### Material regions and shared interfaces

`composition.regions` assigns skills to regions of native geometry. An empty
array retains the original whole-component recipe. Each assignment carries
`id`, `part` (null for a single component), `zStartMm`, nullable `zEndMm`,
`skills`, `supportPolicy` and nullable `lowerSurfaceFrom`. Heights are relative
to the component's minimum Z. The skill map selects the skills and holds partial
setting overrides; it resolves against the other settings locked in that plan.
It supersedes global enabled flags. Regions own selection and height bounds;
overrides cannot independently change those fields.

`core/print/regions.mjs` resolves those assignments through the existing skill
generators. Full-fill can own separate base and cap regions; planar-infill and
full-fill solid-surfaces can share complementary material in another region.
Assignments retain their component layer grid and dependencies. Conflicting
ownership, gaps in required support, unknown references and cycles are rejected.
An explicit `bridge-experimental` support policy permits the planned transition
over hollow or sparse material; it is recorded in Studio and is not a bridge
optimizer or evidence that a physical span will print.

`lowerSurfaceFrom` consumes a preceding region's published material top. It can
bound horizontal full fill above a nonflat draped surface without changing those
paths into curved layers. The producer supplies a footprint, surface query,
sampled field and operation dependencies. The selected consumer geometry supplies
the other boundaries. A referenced surface must cover the requested region;
unknown areas are rejected instead of silently omitted. Published sparse or rim
support is distinguished from area support. Native components can describe the
intermediate roof and enclosing upper volume of the same manufactured part.

`core/region/reservation.mjs` clips only material inside a roof's actual footprint,
preserving other components. It also clips sections above consumed surfaces and
subdivides horizontal strokes to integrate their locally changing initial bead
gap. Sampling is bounded by spatial step, observed interpolation error and point
budgets; it is not a proof about arbitrary features between samples. The process
still approximates bead shape and overlap. Surface boundaries must be representable
as supported single-valued height fields; arbitrary undercuts and swept-head
clearance are outside this contract.

The synthetic [regional stack fixture](core/tests/fixtures/regional-stack.mjs)
exercises base, vase wall, cap, sparse/solid body, wavy draped roof, and horizontal
full fill above the roof through the shared pipeline. Regional settings, surface
references and runtime helpers participate in the existing approval hashes;
they introduce no new approval or artifact format. Studio shows effective regional
settings and support choices. Tests and fixture calibration never authorize hardware.

## Machine program templates and S5 observations

`core/export/griffin.mjs` owns the S5 dialect and the shared motion emitter/modal
interpreter. `core/export/bambu.mjs` adds the H2D envelope and sliced-3MF package.
The selected machine output's `program.header`, `program.start` and
`program.end` arrays contain literal lines with named value substitutions.
Values come from the locked setup, release metadata and path totals/bounds;
templates execute no JavaScript. Unknown values and invalid/nonfinite path data
are rejected. The emitter writes shared SAAMpath actions between these sections.
The supported dialect remains the declared Griffin subset, not arbitrary G-code.
Coordinate and extrusion rounding must still obey the locked flow limit.

### H2D output contract

H2D output is **experimental**. The user supplied Bambu Studio 02.08.02.61
right- and left-nozzle sliced exports on 2026-09-09. The machine file records
their SHA-256 hashes. Only their machine envelope and format facts informed
implementation; reference geometry, thumbnails and personal project settings
are not copied into output or committed. This establishes a software reference,
not a successful physical print or universal firmware compatibility.

The initial contract supports one selected standard hardened 0.4 mm nozzle,
1.75 mm PLA, Textured PEI and **no chamber heating** (`buildVolumeC: 0`). Left
is the default. Left/right package maps are 1/2, nozzle IDs 0/1, and physical
heater selectors 1/0. Logical material `T0 H-1` remains the same under Bambu's
remapping. Do not replace all T numbers to select a nozzle. Package structure
also follows [Bambu Studio's format implementation](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Format/bbs_3mf.cpp).

The pinned start/end arrays come from the reference's executable blocks.
Allowed substitutions are planned temperatures, selected physical heater,
placed geometry's probe rectangle and whole-plan shutdown/parking clearance.
The reference PLA purge recipe uses 240 °C and up to 25 mm³/s independently of
the conservative print-body flow limit. The startup explicitly establishes
`[100,100,20]` before the body's explicit units, absolute XYZ/E, extrusion reset
and temperature waits. Whole-plan shutdown lifts by at least 10 mm and never
descends below the completed path's maximum Z; parking remains at or below
320 mm. Reject a plan that cannot fit that clearance. The bed's -0.02 mm
Textured PEI correction and service-area purge moves are part of the firmware
contract, not object geometry.

Probing, homing, wiping, purge, calibration, unloading and firmware-conditioned
service moves are **not motion-simulated**. The interpreter matches the complete
rendered envelope to its pinned contract; altered or unknown commands are
rejected. Firmware flags remain controlled by the printer. Calibration may heat
both nozzles; the scoped S5 promise about unused-nozzle heating does not apply
to H2D. Inside that envelope, the shared modal engine reconstructs XYZ,
deposition, retractions, fan and dwell from the actual G-code and checks bounds,
feeds, flow and temperature state. Studio displays this print body and states
the simulation boundary. Its time and material totals exclude service routines.
Envelope matching is not a proof of their physical motion or clearance.

The H2D print body uses `M83` relative extrusion, matching the supplied Bambu
Studio reference. On 2026-09-09 the first physical SAAM H2D attempt reached the
part successfully, but the user reported severe over-extrusion beginning on the
second flat layer while the first looked correct. Inspection found that the
then-delivered body incorrectly selected `M82` and emitted cumulative E values;
that artifact is unsafe to reuse. The exporter was corrected to emit relative E
amounts and covered by a second-layer regression, but the corrected output still
requires physical retesting. S5 remains on its separate Griffin `M82` contract.

`bambu-gcode` produces `exports/bambu-gcode/part.gcode.3mf`. The output registry
accepts text or binary artifacts; the shared lifecycle hashes, regenerates and
compares the complete artifact. ZIP entries have deterministic bytes/dates,
CRC checks and a G-code MD5. No filesystem extraction is needed. The package
contains fresh metadata and a schematic thumbnail generated from interpreted
printing moves. Metadata, program and thumbnail must agree. Studio's code view
reads the archive's G-code; toolpath approval binds the complete archive hash,
and delivery copies the original archive unchanged. Unsupported ZIP features,
unknown envelopes and edited files fail closed.

Software tests cover both nozzle maps, both geometry backends, all three skills,
malformed/tampered output and the shared approval/HTTP delivery path. The installed
Bambu Studio CLI's model-import (`--info`) check reported -6, "The input model
file to the slicer can not be parsed," for both the user's sliced reference and
the generated archive, including a retry outside the sandbox. This does not
check the program-viewer route. Independent Bambu Studio program-viewer import
and physical validation therefore remain unconfirmed. No printer
was connected or run. Older H2D bundles must explicitly set `buildVolumeC: 0`
with `adjust` before `upgrade`; plan/toolpath approvals are invalidated normally.

On 2026-09-08 the user reported that the **last wedge change** achieved no routine
bed leveling and no heating of the unused nozzle. Preserve that observed envelope:
Griffin compatibility `4.4.0`, SAAM's own version field, build date, material GUID,
build-volume metadata, active-tool temperature commands, no G280, and shutdown.
The default recipe uses nozzle #2/T1. Earlier in the day the user reported initial
under-extrusion; the wedge recipe now accounts for its terminal retraction on the
next start. These are scoped observations, not a claim of complete physical print
validation. Never treat an earlier export revision as the reported working one.

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

## Legacy reference

The old implementation is outside the active tree. Its source remains in commit
`54093cadbe87020836916d53dd29a45a06bf5528`. In this working checkout, the old
folders are also hash-verified in the sibling archive
`../SAAM-legacy-20260908/legacy-reference/54093cadbe870/`. Old dependencies and
the earlier fill-review workspace are preserved beside that reference,
outside SAAM. Current private development artifacts remain ignored under `.local/`.
The 2026-09-09 comparison verified remote `main` and `refresh` at `b3302de`.
The user subsequently authorized restoring MCP, Dobot machine/Lua support and
vase-wall through the local reset's shared pipeline. The comparison and its
isolated legacy source are ignored under `.local/comparison-2026-09-09/`.
Other components still require a specific adoption request. These runtime
instructions supersede legacy workflow/approval instructions; do not import the
old plan approval gate or a parallel preview/delivery pipeline.

Automatic capability discovery and extensible registration are deferred by
[D-022](DECISIONS.md#d-022--defer-automatic-capability-discovery). This is one
development installation with known machines. Fixed lists are sufficient for
MCP access; geometry/skill/machine compatibility checks remain necessary when
using a plan.

The user excluded legacy gusset and layer-filling adoption. They also requested
recovery of the earlier twisted cellular annular print and tilted-loop wall.
The available Git refs and unreachable commits were searched without locating
either source. An earlier private repository is a lead for the user's follow-up
with the other developer. These descriptions do not establish component names
or implemented patterns. No additional pattern roadmap is implied.

## Opening local prints in Studio

**Open print** lists saved bundles below `Prints/` (up to three directory levels).
It also accepts a local bundle folder, `plan.json`, or an export/delivery file
inside the bundle. It opens the owning bundle through the same adapter and
integrity checks; standalone machine-program import is not implemented.
Selecting another bundle updates this Studio server's active print, including
other tabs attached to that server. The client sends the current print identity
with mutations, so an old tab cannot approve, generate or deliver the new print.

Opening does not regenerate stored files or write approvals. Unchanged approvals
retain their existing version binding: geometry-only confirmation resumes at
settings, and a current export opens directly in the toolpath viewer. A development
export can be viewed but cannot authorize delivery. A stale or edited program
stays unavailable for approval. Failed opening retains the previous print.

An accessible, animated busy banner covers initial loading, reopening, changed
bundle validation, toolpath/export generation and delivery. It remains visible
through checks and playback loading, disables duplicate actions, and clears on
success or error. Settings confirmation says saving/preparing/checking the toolpath; it does not expose the internal export step. After a successful download, that exact print/export shows "Export again" for the current page session, including after switching away and reopening it. Animation respects reduced-motion preferences. It represents
indeterminate work, not a fabricated percentage or hardware status.
## General collision avoidance — options for review

Proposed 2026-09-09 at the user's request. No implementation or contributor
approval is implied. Recommendation: own one small SAAM contract for machine
motion and clearance, implement its XYZ case first, and evaluate Tesseract as
the first robot-arm backend. Keep the same skills, composition, print bundle,
three approvals and exact-export Studio review.

### Three implementation options

| Option | What SAAM would own | Advantages | Cost and limits |
|---|---|---|---|
| A. Small in-house motion layer plus a collision library | Scene, travel search, kinematics integration, process constraints and validation; a library supplies distance/contact queries. | Lightest initial XYZ integration; full control of the contract and deployment. | Robot reachability, continuous joint solutions, singularities and trajectory optimization become substantial SAAM work. A collision library alone cannot plan a robot print. |
| B. Shared SAAM contract with a Tesseract backend — recommended for evaluation | Process intent, deposited-material history, locked policies, export and review; Tesseract supplies robot scene/kinematics/planning and contact queries. | Fits surface-following manufacturing; core can run without ROS. Keeps robotics details out of slicing skills. | Native C++/Python dependency and packaging work; additive occupancy and controller verification remain ours. Validate Windows deployment and the first actual robot before choosing it. |
| C. Shared SAAM contract with a MoveIt 2 backend | Same SAAM-facing interface, with a ROS robot/planning scene integration. | Attractive when the robot cells already use ROS 2 and MoveIt. Reuses their robot configuration and surrounding tooling. | Larger runtime integration for a local printer app; deposition constraints and exact controller replay still need SAAM adapters. Choose it when the existing robot ecosystem justifies it. |

These are alternative backends, not separate printing workflows. FCL supplies
collision, distance and continuous-motion queries but does not supply our
manufacturing planner ([FCL project](https://github.com/flexible-collision-library/fcl)).
Tesseract documents process trajectories, URDF/SRDF models and a ROS-independent
core ([Tesseract](https://tesseract-robotics.github.io/tesseract/why_tesseract.html));
its contact-manager interface separates geometry/transform queries from robot
connectivity and supports discrete and swept checks
([collision API](https://tesseract-robotics.github.io/tesseract/collision.html)).
MoveIt's planning scene combines robot state, robot model and environment for
kinematics, constraints and collision checks
([MoveIt planning scene](https://moveit.picknik.ai/main/api/html/planning_scene_overview.html)).
The recommendation is an architectural assessment, not a benchmark result or
an endorsement of vendor performance comparisons.

### The shared contract

**Describe the whole moving system.** Extend machine definitions with a link/joint
model, tool center point and calibrated frames, joint limits, collision shapes,
parking/start state and a declared controller interpolation model. Include both
nozzles, carriage and moving bed on printers; include every arm link, extruder,
mount, positioner and conservative cable/hose envelope on robot cells. A printable
XYZ box is not a collision model. Store fixture/table/clamp geometry and placement
in the local job setup, separate from reusable machine geometry. Unknown geometry
must remain explicitly unchecked. Account for model, calibration, deflection and
bead uncertainty with declared clearance margins, without inventing measured values.

**Keep process intent separate from the solved machine configuration.** Skills
produce deposition curves, volumes, feature/operation IDs and tool-orientation
constraints through one common result interface. Existing XYZ skills imply a
fixed nozzle orientation. Robot support needs a versioned SAAMpath extension
for tool pose (position and orientation), frame identity, coordinated external
axes, motion/interpolation semantics and a resolved joint trajectory or bound
companion data in the same bundle. Preserve units explicitly: SAAM uses mm;
robot libraries commonly use meters and radians. Do not force every slicing
skill to solve inverse kinematics or adopt robot-library objects.

**Track material as the print progresses.** Test against existing stock, fixtures
and beads already deposited at that point in the composed sequence. The final
CAD solid alone both over-restricts future empty space and misses real bead,
prime and support geometry. Start with conservative bead volumes or chunked
voxels with a locked tolerance. Keep direct spline slicing; a bounded conservative
collision proxy does not replace native geometry. A coarse height field is an
XYZ optimization, not the contract for overhangs or arbitrary orientations.

**Check more than endpoints.** A nozzle can have clear endpoints while its body
hits a wall between them, and an elbow can collide while the nozzle clears.
Validate the swept geometry of all relevant links under the actual interpolation.
For articulated motion, simply interpolating endpoint link poses is not generally
the same as interpolating joints and applying forward kinematics. Use a supported
continuous method or conservative subdivision with explicit error bounds; report
unsupported cases instead of calling sparse sampling a proof. Also reject
unreachable poses, joint-limit violations, branch jumps and configured singularity
or motion-limit violations. These are related feasibility checks, distinct from
collision detection.

**Allow only the intended printing contact.** The depositing tip/bead region needs
a narrow, operation-specific contact allowance. Do not disable collision checking
between the entire head and the entire printed object. Nearby shrouds, an inactive
nozzle and robot links still need clearance.

### Where it belongs in the current pipeline

The composer owns chronology and calls one machine-motion interface for joins,
travels, cooling and parking. Collision queries answer whether a candidate
motion clears the scene; a planner searches alternative motions using those
queries. Start by checking/reporting; automatic travel repair comes afterward.
Deposition is checked too, not just non-extruding travel. Existing wedge travel
remains its documented bounded policy until a separate change adopts the shared
planner; it can still feed the common validator.

The approved process plan locks clearance margins, allowed contact, orientation
freedom, motion limits, planner/version, search budget and any seed, and permitted
travel/reordering rules. Generation solves those choices directly. If a valid
solution requires changing deposition geometry, exceeding allowed tilt or changing
operation dependencies, return to settings review. Do not silently distort a
printing stroke or add a fourth approval stage. Persist the resolved trajectory;
reopening must not pick a different robot configuration through a fresh random
search. Reuse exact stored trajectories with integrity and validity checks.

After timing, smoothing and export, reconstruct and validate the commanded
trajectory again. Controller blending and Cartesian versus joint interpolation
can change the swept motion. MoveIt's documentation explicitly notes that its
time-optimal parameterization can change a path within tolerance and may require
another collision check
([trajectory processing](https://moveit.picknik.ai/main/doc/examples/time_parameterization/time_parameterization_tutorial.html)).
Joint timing must remain synchronized with deposition volume and process speed.
Unknown firmware/service routines stay outside a claimed complete collision pass;
this is already relevant to the H2D startup envelope.

Studio should play the interpreted export with the machine geometry and deposited
material, highlight the first conflicting bodies and operation, show the required
versus achieved clearance, and state any unchecked portions. Bind the report to
geometry, scene, calibration, machine model, solver settings and exact export
hashes. Changes invalidate the affected settings/toolpath approvals. This remains
software validation; cell interlocks and personnel protection are separate systems.

### Suggested evaluation sequence

1. Agree on the shared data and query boundary. Model measured S5/H2D head geometry,
   both nozzles and fixtures; validate existing paths without altering deposition.
2. Add deterministic XYZ travel repair, then prove it across mixed skill operations,
   clamps, nearby walls, rising deposited material, cooling and parking. Missing
   geometry must fail coverage reporting rather than produce an all-clear result.
3. Use one real arm/end-effector/positioner model to compare the Tesseract and,
   if relevant, MoveIt adapter. Test two joint solutions for one nozzle pose,
   mid-motion link collisions, singularities, an unreachable stroke, a tilted
   nozzle near a wall, units/transforms and export blending. Measure runtime and
   packaging cost on our supported platforms before selecting a backend.
4. Add independent controller/offline-simulator comparison for that machine,
   then physical validation under its normal cell commissioning procedure.

The review choices are the backend direction (A/B/C), the first robot/controller
and external axes, and how much orientation freedom a deposition skill may offer.
A lean first implementation can establish the common contract without making a
robotics framework mandatory for S5/H2D users.
