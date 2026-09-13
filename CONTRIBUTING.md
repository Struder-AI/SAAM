# Contribution practices

Setup, work authorization, test selection and documentation maintenance.
Read [DEVELOP](DEVELOP.md) for engineering orientation; use the relevant section
here when setting up, verifying or publishing a change. Source paths in code
spans are relative to the repository root; Markdown links resolve from their file.

## Work boundaries

The user's request and existing authorization define the scope of the work.
Repository guidance supplies the shared context for carrying it out. Contributor
approval of project direction is recorded in [DECISIONS.md](DECISIONS.md); a
contributor can authorize implementation while a decision remains provisional
pending the other contributor. Human approval of a print belongs to the separate
[maker workflow](MAKERS.md#maker-interaction-flow).

Staging, committing and publishing require explicit authorization, including
authorization already given in the conversation. Once committing is authorized,
checkpoint the existing working tree before new work so the changes remain
separable. Checkpoints follow the same [change-based test selection](#checks).

The canonical destination is Struder-AI/SAAM. Publish to the requested feature
branch when authorized; a personal fork is optional. Pushing to main requires an
explicit request. Leave your own PRs for human review and merging.

Prefer working into main or merging back frequently, with at most one active pending branch per account; purpose-saved side branches (such as the legacy skills library) are exempt, and discuss merging to main when the user has not mentioned it and the right action is unclear.

Tasks sharing a checkout may contribute to the same commit: keep its current branch, reread affected lines before editing, preserve other tasks' changes, and coordinate Git operations through one task; create another branch only for intentional isolation and integrate it promptly.

## Context and selective adoption

Use the live checkout's instructions, current shared contracts and the user's
authorization as the development context. A superseded repository, old transcript,
saved branch or historical implementation supplies reference material; its past
requirements do not become current requirements merely by entering an agent's
context. On a repository/context switch, read the current entry point and owning
contracts before choosing an implementation. Raise an unresolved conflict with
the current task's scope instead of silently importing an older design.

Before admitting a component or method from superseded work, identify its purpose
and provenance, compare its actual producers and consumers with the current
geometry, composition, machine and lifecycle interfaces, and obtain explicit
human approval for that selective adoption. Approval of a conceptual capability
does not approve its previous implementation. A commit, merge, passing test or
catalog entry alone does not establish architectural fit or machine support.
Ordinary development already authorized in the current context proceeds under
that authorization; this adds no per-task approval or test gate.

When integrating contributions, account for changes to behavior, defaults, shared
interfaces and agent guidance as well as code conflicts. State which changes are
retained, withdrawn or deferred and the evidence limits. Preserve unrelated work
and record any remaining decision at its owner. In-progress agents must reread
changed entry guidance after an integration; restart affected long-running
services before relying on their behavior.

## Testing through the use context

Develop and exercise maker-facing changes through [MAKERS.md](MAKERS.md), the
public tools and the relevant skill manuals. Assess the complete affected
experience, including installation, discoverability and error recovery where
they matter to the change.

Use isolated projects, fixtures and machine simulators for development tests.
Identify synthetic approvals as test data and keep them unable to authorize
a real job. Hardware execution and human print approvals remain with the person;
report software verification and physical results separately.

A demo's setup, assets and recipe assumptions must be reachable from the skill
manual for a fresh part; put reusable preparation in packaged tools and describe
any necessary setting changes there, rather than relying on the originating task.

## Checks

Choose verification from the behavior being changed and a concrete failure it
could introduce. The [test registry](#test-registry) locates existing coverage;
run the relevant tests locally and fix failures before publication. Use the full
`npm test` suite when broad integration risk or the user's request warrants it.
Committing, checkpointing, staging, writing a work record and finishing a task
do not independently require tests. Prose-only edits and read-only work need no
software tests. Use `node scripts/check-repo.mjs` when document links, catalog
output or repository metadata need diagnosis; it is an optional maintenance tool.

Reuse a successful result while its relevant source, dependencies and environment
remain unchanged. An unrelated edit or a new agent does not invalidate it. Broaden
or repeat verification only for a relevant change, failure or unresolved concern.
Use existing coverage first; add a regression for a concrete defect or meaningful
new behavior, not a test that merely repeats the implementation or checks wording.
Skill manuals describe available coverage and do not impose additional gates.

First-use environment capability is checked once by [setup](#setup-and-checks).
For a component with hardware or environment dependencies, check those capabilities
when first used in that environment, and repeat only when the dependency changes
or fails. A new task or print is not a new environment.

GitHub main requires a `test` status. Its job in
[test.yml](.github/workflows/test.yml) runs `npm run setup:check` on each fresh
Linux pull-request runner after dependency installation, with manual dispatch
available and no duplicate push run. The job name satisfies branch
protection; its commands are ordinary repository code. Changing branch protection
requires repository administration access. Existing successful local setup covers
the local capability check; changes to setup itself warrant a local setup run.
The full regression suite is available locally and is not an automatic CI gate.
If a target branch imposes additional checks, run the same meaningful checks
locally before publication and reuse their results; do not add a second checklist
or rely on remote failures to discover locally detectable problems.

Report verification with its actual scope and any unresolved failure. Generated
print validation and human review retain their own workflow and evidence.

### Worthwhile tests

A test earns its cost by distinguishing a plausible wrong result from the intended
behavior. Prefer an analytical answer, independently produced reference, observed
defect, or externally visible state transition. A round trip checks agreement;
pair it with independent evidence where both sides could share the same mistake.
For invalidation, start from an approved state; checking that an already-false
approval stays false proves nothing about invalidation.

Keep coverage at the owning boundary. Transport tests exercise routing, isolation
and serialization; they need not repeat every skill on every machine. Avoid
copying the implementation into an expected-value function, freezing prose or
cosmetic constants, asserting re-export identity, or preserving retired commands
merely because they once existed. Remove obsolete and duplicate tests instead of
teaching future contributors to copy them. No test-count target or coverage quota
substitutes for this judgment.

Use the smallest fixture that reaches the defect. The 200,000-move export and
25–64 MB size-boundary regressions live in `core/tests/stress/` and run explicitly
with `npm run test:stress` when large-program handling changes. Routine chunk
boundaries and malformed input stay in the ordinary suite. Setup smoke checks
belong to first use, not inside a regression test that calls setup again. Tests
own and close their servers/workers before deleting their temporary files; use
mocked time for timer policy instead of waiting out the same policy twice.

Examples to build from: [analytical and independent geometry](core/tests/geometry.test.mjs),
[upstream intersection references and an independent cell oracle](core/tests/intersection.test.mjs),
[changed-input cache reuse](core/tests/program-cache.test.mjs), and
[bounded manual-link fixtures](core/tests/mcp-access.test.mjs). Their assertions
demonstrate the failure they protect against without requiring an extra checklist.

### Test registry

Shared line spacing is covered by [spacing.test.mjs](core/tests/spacing.test.mjs):
all seven producers, density and solid-mask independence, sparse surface
composition, curved and mesh cladding, plan review and exact-byte delivery.
Opposite-handed cladding is covered by
[crossed-cladding.test.mjs](core/tests/crossed-cladding.test.mjs), including
surface charts, rotary direction, export/review and material preview.
Finished-boundary interoperability is covered by
[finished-cladding.test.mjs](core/tests/finished-cladding.test.mjs): unchanged
vase deposition, fill/infill sources, regional and assembly selection, published
extents, producer-independent dependencies and checked reopening.

This table maps implementation areas to existing test files. It is a selection
aid, not an automatic dependency resolver or a requirement to run every listed
neighbor on each edit. For shared code, inspect the affected consumers and select
their integration tests as needed. Test names and imports describe finer coverage.
Update this table when adding, moving or removing a test file, or changing its
responsibility. Ordinary regression tests use `core/tests/*.test.mjs` or
`skills/*/tests/*.test.mjs`; expensive size-boundary tests use `core/tests/stress/`
and the explicit stress command.

All file names in the core column below are relative to `core/tests/`.

| Implementation area / behavior | Core test files | Related skill tests / integration selection |
|---|---|---|
| `core/geom/`: spline evaluation, sections, prepared mesh section index, height queries, STL/mesh input | [geometry.test.mjs](core/tests/geometry.test.mjs), [mesh.test.mjs](core/tests/mesh.test.mjs), [mesh-boundary.test.mjs](core/tests/mesh-boundary.test.mjs) | Affected skill tests; pipeline and regional tests for shared query changes |
| Explicit STL repair, winding reconstruction, spatial queries and collision-checked simplification | [mesh-repair.test.mjs](core/tests/mesh-repair.test.mjs), [mesh.test.mjs](core/tests/mesh.test.mjs) | Shared STL import and unapproved S5/H2D bundles |
| Volumetric fields, rational controls, local refinement, explicit extraction and persisted identity | [voxel.test.mjs](core/tests/voxel.test.mjs), [voxel-refine.test.mjs](core/tests/voxel-refine.test.mjs), [mcp.test.mjs](core/tests/mcp.test.mjs) | Voxel task demo, shared slicing, mixed spline/field assembly and exact-byte lifecycle |
| `core/geom/polyline.mjs`: numerical contour seams before offsets and deposition | [contour-cleanup.test.mjs](core/tests/contour-cleanup.test.mjs) | Mesh sections, full-fill and planar-infill |
| `core/region/offset.mjs`, Clipper normalization and offset compatibility | [offset.test.mjs](core/tests/offset.test.mjs), [offset-junctions.test.mjs](core/tests/offset-junctions.test.mjs), [offset-remnants.test.mjs](core/tests/offset-remnants.test.mjs) | Fill, infill, drape, vase and wedge consumers as affected |
| `core/region/perimeters.mjs`: coincident closed wall fronts | [perimeters.test.mjs](core/tests/perimeters.test.mjs) | [perimeter-wall.test.mjs](skills/full-fill/tests/perimeter-wall.test.mjs) covers full-fill, planar-infill, solid masks and S5/H2D export |
| `core/region/surface-offset.mjs`, surface derivatives | [surface-offset.test.mjs](core/tests/surface-offset.test.mjs) | Experimental surface tool; no implicit skill adoption |
| `core/region/intersection.mjs`, closed planar booleans | [intersection.test.mjs](core/tests/intersection.test.mjs) | Infill masks, reservations and regional composition |
| `core/region/region2d.mjs`, `core/path/builder.mjs`: scanline cells and closest-entry ordering, segment-preserving reversal | [scanline-cells.test.mjs](core/tests/scanline-cells.test.mjs), [geometry.test.mjs](core/tests/geometry.test.mjs) | Full-fill, line-based planar-infill and draped-skin |
| `core/path/`: travel, combing, deposited height, move coalescing | [travel.test.mjs](core/tests/travel.test.mjs), [straight-moves.test.mjs](core/tests/straight-moves.test.mjs), [interoperability.test.mjs](core/tests/interoperability.test.mjs) | Affected skill paths, composition and machine round trips |
| `core/path/compose.mjs`: scheduling, weaving and joins | [composition.test.mjs](core/tests/composition.test.mjs) | Pipeline and regional workflow |
| Material regions, reservations and consumed surfaces | [regions.test.mjs](core/tests/regions.test.mjs), [assembly-reservation.test.mjs](core/tests/assembly-reservation.test.mjs), [reservation-surface.test.mjs](core/tests/reservation-surface.test.mjs), [regional-workflow.test.mjs](core/tests/regional-workflow.test.mjs) | Infill, drape and vase composition |
| `core/print/plan.mjs`, generation and machine compatibility | [pipeline.test.mjs](core/tests/pipeline.test.mjs), [interoperability.test.mjs](core/tests/interoperability.test.mjs) | Affected skill and machine tests |
| `core/print/workflow.mjs`, bundles, approvals, reopening and exact delivery | [workflow.test.mjs](core/tests/workflow.test.mjs), [program-cache.test.mjs](core/tests/program-cache.test.mjs), [regional-workflow.test.mjs](core/tests/regional-workflow.test.mjs) | Wedge lifecycle, machine-specific delivery and MCP callers |
| `core/export/griffin.mjs`: S5 templates, G-code interpretation | [export.test.mjs](core/tests/export.test.mjs) | Pipeline and wedge Griffin round trips |
| Shared modal G-code fields and final-export checks | [modal-export.test.mjs](core/tests/modal-export.test.mjs) | S5/H2D, wedge, cold bundle reopening |
| `core/export/bambu.mjs`, H2D profile and ZIP output | [bambu.test.mjs](core/tests/bambu.test.mjs) | [h2d.test.mjs](skills/wedge-demo/tests/h2d.test.mjs) |
| `core/export/`: streamed G-code lines and chunk-boundary errors | [gcode-stream.test.mjs](core/tests/gcode-stream.test.mjs) | Griffin/H2D interpretation and ZIP consumers |
| Large move counts and G-code/ZIP size boundaries (explicit stress run) | [stress/large-export.test.mjs](core/tests/stress/large-export.test.mjs), [stress/large-program.test.mjs](core/tests/stress/large-program.test.mjs) | `npm run test:stress`; real former size and call-stack boundaries |
| Dobot profile, Lua export/interpreter and relay behavior | [dobot.test.mjs](core/tests/dobot.test.mjs), [robot-playback.test.mjs](core/tests/robot-playback.test.mjs) | [dobot.test.mjs](skills/wedge-demo/tests/dobot.test.mjs), vase and regional machine coverage |
| Standalone split-delta kinematics, cylinder/track assessment, simulation source and nominal MG400 FK/IK | [split-delta.test.mjs](core/tests/split-delta.test.mjs), [dobot-kinematics.test.mjs](core/tests/dobot-kinematics.test.mjs) | Standalone browser inspection; existing Dobot/MCP profile checks |
| VP-6242 / RC8, oriented/rotary motion, native pipe cladding and both Studio frames | [denso.test.mjs](core/tests/denso.test.mjs) | Shared mesh/spline regional skills, wedge, composition, browser source and exact-byte lifecycle |
| Periodic spline tube, selected surface charts, normal-offset cladding and partial courses | [surface-cladding.test.mjs](core/tests/surface-cladding.test.mjs) | Native spline/bore, explicit mesh strips, three-perimeter interaction, RC8 lifecycle, bead orientation and ZIP32 helper counts |
| `studio/`: camera, display detail, mesh visibility, playback and offline movies | [studio-camera.test.mjs](core/tests/studio-camera.test.mjs), [studio-detail.test.mjs](core/tests/studio-detail.test.mjs), [studio-visibility.test.mjs](core/tests/studio-visibility.test.mjs), [studio-geometry.test.mjs](core/tests/studio-geometry.test.mjs), [studio-material.test.mjs](core/tests/studio-material.test.mjs), [studio-movie.test.mjs](core/tests/studio-movie.test.mjs), [robot-playback.test.mjs](core/tests/robot-playback.test.mjs) | Wedge playback; browser inspection when visual behavior changes |
| Studio settings, server and saved-print opening | [studio-settings.test.mjs](core/tests/studio-settings.test.mjs), [studio-open.test.mjs](core/tests/studio-open.test.mjs), [studio-lifetime.test.mjs](core/tests/studio-lifetime.test.mjs) | Viewer lifetime/owner isolation, workflow, regional workflow and machine-specific Studio delivery |
| Studio machine-source transport, browser interpreters and compact local drawing data | [source-player.test.mjs](core/tests/source-player.test.mjs) | S5/H2D/Dobot source identity, timeline/layer equivalence, stale requests, workflow and exact delivery |
| `adapters/mcp/`: stdio tools, shared import/setup, CLI access and bounded manual/section reading | [mcp.test.mjs](core/tests/mcp.test.mjs), [mcp-access.test.mjs](core/tests/mcp-access.test.mjs) | One lifecycle per transport/output shape; synthetic manual-link fixtures and unresolved robot setup |
| Temporary HTTP/OAuth bridge, Claude package and web probe | [mcp-http.test.mjs](core/tests/mcp-http.test.mjs), [claude-plugin.test.mjs](core/tests/claude-plugin.test.mjs), [web-agent-probe.test.mjs](core/tests/web-agent-probe.test.mjs) | MCP stdio integration when shared tools change |
| `scripts/bench/`: analytical fixtures and mesh convergence | [benchmark-fixtures.test.mjs](core/tests/benchmark-fixtures.test.mjs) | Performance measurements remain opt-in; see benchmark instructions |
| Full-fill generation | Shared geometry, travel and pipeline tests as affected | [full-fill.test.mjs](skills/full-fill/tests/full-fill.test.mjs) |
| Planar infill patterns, open clipping, solid masks and sparse/drape composition | Shared booleans, scanlines and reservations as affected | [infill.test.mjs](skills/planar-infill/tests/infill.test.mjs), [patterns.test.mjs](skills/planar-infill/tests/patterns.test.mjs) |
| Explicit conventional/tree supports, interfaces and support-before-part ordering | Pipeline, workflow, regional and machine tests as affected | [supports.test.mjs](skills/supports/tests/supports.test.mjs) |
| Bivariate support surfaces, horizontal/normal section offsets and rimming composition | Shared geometry, plan, workflow and machine boundaries | [rimming.test.mjs](skills/rimming-planar/tests/rimming.test.mjs) covers both rimming skills |
| Draped skin, normal spacing, slope exclusion and support | Shared surface/reservation and pipeline tests as affected | [draped-skin.test.mjs](skills/draped-skin/tests/draped-skin.test.mjs) |
| Vase wall, contour correspondence including expanding sections, topology, offset rounding, budgets and level ending; repeated sleeve motifs, inward tilted loops, continuous/segmented mapping and bead-height integration | Regional composition, travel, Studio settings and machine tests as affected | [vase.test.mjs](skills/vase-wall/tests/vase.test.mjs), [paths.test.mjs](skills/vase-wall/tests/paths.test.mjs) |
| Bounded eight-point wedge geometry, generator and lifecycle | Shared travel, export and workflow tests as affected | [eight-point.test.mjs](skills/wedge-demo/tests/eight-point.test.mjs), [wedge.test.mjs](skills/wedge-demo/tests/wedge.test.mjs), H2D/Dobot wedge tests above |
| Skill catalog, generated digest freshness and coverage | [skill-digest.test.mjs](core/tests/skill-digest.test.mjs) | MCP catalog tests when shared discovery changes |
| [gridfinity](skills/gridfinity/SKILL.md) | | [gridfinity](skills/gridfinity/tests/gridfinity.test.mjs), [gridfinity](skills/gridfinity/tests/access.test.mjs) |
| Text outlines, independent references, solid modifiers and editable geometry | MCP integration for `apply_text` | [text.test.mjs](skills/text/tests/text.test.mjs): analytical material volume, counters, spline conversion, curved text, persistence and generation |
| Documentation links, open build-request structure, devlog presence, skill digest freshness and coverage, decision metadata and private-file exclusions | `node scripts/check-repo.mjs` | No manufacturing test selection needed for prose-only edits |

Run selected files directly, for example:

```sh
node --test core/tests/offset.test.mjs core/tests/offset-remnants.test.mjs
node --test skills/planar-infill/tests/infill.test.mjs
node scripts/check-repo.mjs
```

`npm test` runs ordinary software regressions. Stress tests and the optional
repository-document check are separate; focused selection needs no subsequent
full-suite run.

### Checks must earn their place

A check in production, CI or an agent workflow needs a concrete failure to detect
and evidence that its placement is worthwhile. Account for compute, maintenance,
false rejections and interruption of the person's work. Reuse the owning result
for unchanged inputs rather than adding preflight, postflight or closeout checks.
Use regression tests to establish that a known slicing defect stays fixed.
A heuristic that cannot detect the defect adds an
ongoing obligation; reconsider the heuristic before adding a user-facing bypass.

When the value or placement of a proposed geometry, toolpathing or extrusion gate
is ambiguous, discuss its failure case, evidence, cost and alternatives with the
user before implementation. Existing authorization still applies. A maker's
judgment about a particular print informs that job; changing general product
policy needs a developer-side scope decision.

Resource-budget failures should report the limit and how to raise it, leaving
geometry and quality choices explicit.

## Setup and checks

For a checkout that has not been used yet, complete setup before either role's
work; the person need not request it separately:

1. Run `node --version`. Node.js 22+ is required. If it is missing or older,
   direct the person to the Node.js 22+ installer for their operating system.
2. Run `npm ci` from the repository root unless `node_modules/` is already
   present, as in a packaged download.
3. Run `npm run setup:check` to verify dependency loading, geometry kernels and
   an unapproved geometry preview served by Studio. This short check needs no Git
   metadata and creates no toolpath or manufacturing approval. Do not run the
   full regression suite as maker onboarding.
4. Apply [Studio agent permissions](studio/README.md#studio-agent-permissions): project trust,
   the shared launcher permission and browser access.

Report a failure as a setup problem and stop there. Setup does not create a
manufacturing approval. Git is needed only to clone; the wedge requires no
Rhino desktop installation or Compute server. After setup, use the
[check-selection policy](#checks) for development work.

Manage dependencies through `package.json`, `package-lock.json` and installation
with `npm ci`. Installed source in `node_modules/` stays outside project edits
and Git.

```sh
npm ci
npm run setup:check
npm run demo
npm run studio
npm run check:print
```

The public commands use the [shared generation/review lifecycle](core/print/README.md#generation-and-review).
`npm run shell -- <command> <directory>` exposes `init`, `demo`, `adjust`,
`generate`, `check`, `upgrade`, `remember-setup`, and `deliver` for shell
plans; the wedge CLI exposes the same lifecycle for its bounded recipe.
`npm run studio -- <directory>` opens either kind. Development generation uses
the same bundle and checks, without manufacturing approvals.

`demo` creates/reopens the ignored `Prints/s5-wedge-demo` bundle and generates a
development preview without approvals. Studio serves that print on
the free loopback port printed by the command; set `SAAM_STUDIO_PORT` to select
an explicit port. Each launch is independent. Pass a
print directory after `--` to the Studio script to open another bundle.
There is no hardware connection or automatic machine execution.

`scripts/check-repo.mjs` checks local document links and heading anchors, open
build-request structure and devlog presence, skill digest freshness and catalog
coverage, decision-record structure and approval metadata, and exclusion of
private Prints and local artifacts.
It is optional and does not verify that a human actually approved a decision or
that a part is printable. Node regression tests check manufacturing software
behavior. CI checks runtime setup on its fresh runner. Synthetic approval tests use
temporary bundles and never authorize the person's real print.

## Documentation maintenance

Use the [writing orientation](DEVELOP.md#working-context) when deciding
what knowledge a change needs to leave behind. The document owners are:

| Context | Owner |
|---|---|
| Product purpose and direction | [README.md](README.md) |
| Shared agent orientation and task selection | [AGENTS.md](AGENTS.md) |
| Maker interaction | [MAKERS.md](MAKERS.md) |
| Developer orientation and task routes | [DEVELOP.md](DEVELOP.md) |
| Contribution practices and documentation maintenance | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Implementation contracts | The owning component reference, reached through [core architecture](core/README.md), [Studio](studio/README.md) or the [adapter](adapters/mcp/DEVELOP.md) |
| Shared print-tool operation | [Print tools](core/print/USAGE.md) |
| Pattern or preparation-task tools, settings and limits | The relevant [skill manual](skills/README.md) |
| Shared terms | [GLOSSARY.md](GLOSSARY.md) |
| Contributor decisions and approval status | [DECISIONS.md](DECISIONS.md) |
| Outstanding or incomplete work | [build_request.md](build_request.md#outstanding-work) |
| Dated work records, measurements and observations | [DEVLOG.md](DEVLOG.md) |

Update the owning account alongside a change and link to it from the entry
points that need it. Write current contracts, manuals, proposals and open work
in present tense (or imperatives for instructions). State a proposal's status
explicitly; conditional wording describes proposed behavior without presenting
it as implemented. Move change narratives, completed-work summaries, dated test
results, benchmark runs and external observations to the devlog. Keep current
limits and reproducible procedures at their owner, with links to historical
evidence when it explains a live constraint. Git retains superseded source.

Work normally proceeds build-first within the user's authorization. Do not create
a build request just to document work that can be completed in the current task.
Use the open list for an explicit outstanding request, incomplete implementation
or unresolved acceptance check. Use a `### BR-NNN — Title` heading with `Status`
(`open`, `in progress` or `blocked`), `Remaining`, `Completion` and `Context`
fields; `Source` is optional. An unsupported capability or deferred
idea is not automatically a request; deferred direction belongs in decisions or
a clearly labeled proposal. An empty open list is valid.

On completion, update the current manuals, add a dated devlog entry with the work
and actual verification scope, and remove the request from the open list. If
only part is complete, move that part's work record to the devlog and leave only
the remainder in the request. Preserve request IDs for continuity; new devlog
entries need no request ID. Redirect evidence links to the devlog when moving
records. Do not copy entire contracts into the log or turn test counts into
claims of present coverage or physical success.

Date devlog entries by the work or observation when evidence supports it. Cite
the dated source or commit; distinguish a request date or commit checkpoint from
an exact completion date. Preserve explicit follow-up dates and timezone
conventions. Mark an unknown work date as unknown and record the migration or
recording date separately. Never backdate from file modification time alone.

The present-tense rule has narrow provenance exceptions: decision source quotes,
approval/status events and preserved approved wording in [DECISIONS.md](DECISIONS.md);
exact quotations; and license, third-party source or fixture provenance notices.
These retain their wording and dates. Their surrounding current guidance still
uses present tense. A development narrative or benchmark result is not an
exception merely because it appears in a technical reference.

Update affected owners as part of the edit; there is no separate documentation
closeout gate. The optional `scripts/check-repo.mjs` diagnoses open-request
structure and devlog links. Semantic review determines whether prose describes
open work or history; a broad grammatical tense checker is not reliable for code examples
and technical terms.

Choose the owner by the question the material answers: operating a capability
belongs in its task manual; its algorithms and implementation contracts belong
with the component; onboarding establishes the purpose and judgment for the role.
When an operation lacks a suitable manual, extend a related task package or
create a focused one and connect it to the relevant workflow. Task skills can
cover preparation and recovery as well as deposition patterns. Document the
operations that actually exist as the capability develops.

Task manuals declare `metadata.saam-kind: task` in their skill frontmatter so
the connector can distinguish them from printing patterns. The explicit
[skill catalog](skills/catalog.mjs) controls discovery and digest ordering;
the manual owns its description and classification.

Each skill's frontmatter description explains its capability, value and essential
selection boundaries. The [maker digest](skills/README.md) and MCP catalog reuse
that description. After changing it or catalog membership, run
`node scripts/skill-digest.mjs` to refresh the Markdown table. The repository
check detects stale output and manuals missing from the catalog. Keep these
descriptions accurate as behavior changes; generated agreement cannot establish
that a capability claim is true.

Place specialized guidance where it becomes useful. Ordinary import leads to
the import instructions; a rejected mesh points to diagnosis and processing.
A task-specific failure can carry its recovery reference without making that
manual part of every successful operation. Check these routes through the access
the agent actually has, including the connector's manual reader. The same
repository document should serve local and connected agents.

Architectural references should lead conveniently to the owning source and make
its boundary and consumers understandable. Derive structural facts from source
where practical. Use ordinary repository files and collaborators' existing tools;
source navigation should require no separate documentation application or toolchain.
Review factual claims against code and recorded evidence. Link checks verify
that the route exists; they cannot establish that its account is true.
