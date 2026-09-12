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
separable. The [commit test requirement](#checks) applies to that checkpoint too.

The canonical destination is Struder-AI/SAAM. Publish to the requested feature
branch when authorized; a personal fork is optional. Pushing to main requires an
explicit request. Leave your own PRs for human review and merging.

## Testing through the use context

Develop and exercise maker-facing changes through [MAKERS.md](MAKERS.md), the
public tools and the relevant skill manuals. Assess the complete affected
experience, including installation, discoverability and error recovery where
they matter to the change.

Use isolated projects, fixtures and machine simulators for development tests.
Identify synthetic approvals as test data and keep them unable to authorize
a real job. Hardware execution and human print approvals remain with the person;
report software verification and physical results separately.

## Checks

Choose verification from the behavior being changed and its affected consumers.
The [test registry](#test-registry) helps locate existing coverage. During
development, use focused tests and broaden or repeat them when a change, failure
or unresolved concern warrants it. Documentation-only work normally needs
`node scripts/check-repo.mjs`; discussion and read-only investigation need no tests.

Every authorized commit, including documentation and checkpoint commits, requires
a complete `npm test` run against the final state being committed. Subsequent
edits require a fresh run before committing. Resolve failures first unless the
user explicitly authorizes committing that failing state. The successful run
remains valid through staging and the commit itself. CI runs the full suite on
push and pull requests.

Add meaningful coverage for new behavior and maintain the registry associations.
Report the checks performed and their results with their actual scope. These are
repository checks; generated-print validation has its own workflow and evidence.

### Test registry

This table maps implementation areas to existing test files. It is a selection
aid, not an automatic dependency resolver or a requirement to run every listed
neighbor on each edit. For shared code, inspect the affected consumers and select
their integration tests as needed. Test names and imports describe finer coverage.
Update this table when adding, moving or removing a test file, or changing its
responsibility. Keep new tests under the existing `core/tests/*.test.mjs` or
`skills/*/tests/*.test.mjs` patterns so `npm test` continues to include them all.

All file names in the core column below are relative to `core/tests/`.

| Implementation area / behavior | Core test files | Related skill tests / integration selection |
|---|---|---|
| `core/geom/`: spline evaluation, sections, prepared mesh section index, height queries, STL/mesh input | [geometry.test.mjs](core/tests/geometry.test.mjs), [mesh.test.mjs](core/tests/mesh.test.mjs), [mesh-boundary.test.mjs](core/tests/mesh-boundary.test.mjs) | Affected skill tests; pipeline and regional tests for shared query changes |
| Explicit STL repair, winding reconstruction, spatial queries and collision-checked simplification | [mesh-repair.test.mjs](core/tests/mesh-repair.test.mjs), [mesh.test.mjs](core/tests/mesh.test.mjs) | Shared STL import and unapproved S5/H2D bundles |
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
| `core/export/griffin.mjs`: S5 templates, G-code interpretation | [export.test.mjs](core/tests/export.test.mjs), [large-export.test.mjs](core/tests/large-export.test.mjs) | Pipeline and wedge Griffin round trips |
| Shared modal G-code fields and final-export checks | [modal-export.test.mjs](core/tests/modal-export.test.mjs) | S5/H2D, wedge, cold bundle reopening |
| `core/export/bambu.mjs`, H2D profile and ZIP output | [bambu.test.mjs](core/tests/bambu.test.mjs) | [h2d.test.mjs](skills/wedge-demo/tests/h2d.test.mjs) |
| `core/export/`: streamed G-code lines and large ZIP members | [gcode-stream.test.mjs](core/tests/gcode-stream.test.mjs) | Griffin/H2D interpretation and ZIP consumers |
| Dobot profile, Lua export/interpreter and relay behavior | [dobot.test.mjs](core/tests/dobot.test.mjs), [robot-playback.test.mjs](core/tests/robot-playback.test.mjs) | [dobot.test.mjs](skills/wedge-demo/tests/dobot.test.mjs), vase and regional machine coverage |
| VP-6242 / RC8, oriented/rotary motion, native pipe cladding and both Studio frames | [denso.test.mjs](core/tests/denso.test.mjs) | Shared mesh/spline regional skills, wedge, composition, browser source and exact-byte lifecycle |
| Periodic spline tube, selected surface charts, normal-offset cladding and partial courses | [surface-cladding.test.mjs](core/tests/surface-cladding.test.mjs) | Native spline/bore, explicit mesh strips, three-perimeter interaction, RC8 lifecycle, bead orientation and ZIP32 helper counts |
| `studio/`: camera, display detail, mesh visibility, playback and offline movies | [studio-camera.test.mjs](core/tests/studio-camera.test.mjs), [studio-detail.test.mjs](core/tests/studio-detail.test.mjs), [studio-visibility.test.mjs](core/tests/studio-visibility.test.mjs), [studio-geometry.test.mjs](core/tests/studio-geometry.test.mjs), [studio-material.test.mjs](core/tests/studio-material.test.mjs), [studio-movie.test.mjs](core/tests/studio-movie.test.mjs), [robot-playback.test.mjs](core/tests/robot-playback.test.mjs) | Wedge playback; browser inspection when visual behavior changes |
| Studio settings, server and saved-print opening | [studio-settings.test.mjs](core/tests/studio-settings.test.mjs), [studio-open.test.mjs](core/tests/studio-open.test.mjs), [studio-lifetime.test.mjs](core/tests/studio-lifetime.test.mjs) | Viewer lifetime/owner isolation, workflow, regional workflow and machine-specific Studio delivery |
| Studio machine-source transport, browser interpreters and compact local drawing data | [source-player.test.mjs](core/tests/source-player.test.mjs) | S5/H2D/Dobot source identity, timeline/layer equivalence, stale requests, workflow and exact delivery |
| `adapters/mcp/`: stdio tools, shared import/setup, CLI access and bounded manual/section reading | [mcp.test.mjs](core/tests/mcp.test.mjs), [mcp-access.test.mjs](core/tests/mcp-access.test.mjs) | Shared workflow, recipe validation and documentation-link access |
| Temporary HTTP/OAuth bridge, Claude package and web probe | [mcp-http.test.mjs](core/tests/mcp-http.test.mjs), [claude-plugin.test.mjs](core/tests/claude-plugin.test.mjs), [web-agent-probe.test.mjs](core/tests/web-agent-probe.test.mjs) | MCP stdio integration when shared tools change |
| `scripts/bench/`: analytical fixtures and mesh convergence | [benchmark-fixtures.test.mjs](core/tests/benchmark-fixtures.test.mjs) | Performance measurements remain opt-in; see benchmark instructions |
| Full-fill generation | Shared geometry, travel and pipeline tests as affected | [full-fill.test.mjs](skills/full-fill/tests/full-fill.test.mjs) |
| Planar infill patterns, open clipping, solid masks and sparse/drape composition | Shared booleans, scanlines and reservations as affected | [infill.test.mjs](skills/planar-infill/tests/infill.test.mjs), [patterns.test.mjs](skills/planar-infill/tests/patterns.test.mjs) |
| Explicit conventional/tree supports, interfaces and support-before-part ordering | Pipeline, workflow, regional and machine tests as affected | [supports.test.mjs](skills/supports/tests/supports.test.mjs) |
| Bivariate support surfaces, horizontal/normal section offsets and rimming composition | Shared geometry, plan, workflow and machine boundaries | [rimming.test.mjs](skills/rimming-planar/tests/rimming.test.mjs) covers both rimming skills |
| Draped skin, normal spacing, slope exclusion and support | Shared surface/reservation and pipeline tests as affected | [draped-skin.test.mjs](skills/draped-skin/tests/draped-skin.test.mjs) |
| Vase wall, topology, offset rounding, budgets and level ending | Regional composition and machine tests as affected | [vase.test.mjs](skills/vase-wall/tests/vase.test.mjs) |
| Bounded eight-point wedge geometry, generator and lifecycle | Shared travel, export and workflow tests as affected | [eight-point.test.mjs](skills/wedge-demo/tests/eight-point.test.mjs), [wedge.test.mjs](skills/wedge-demo/tests/wedge.test.mjs), H2D/Dobot wedge tests above |
| Documentation links, decision metadata and private-file exclusions | `node scripts/check-repo.mjs` | No manufacturing test selection needed for prose-only edits |

Run selected files directly, for example:

```sh
node --test core/tests/offset.test.mjs core/tests/offset-remnants.test.mjs
node --test skills/planar-infill/tests/infill.test.mjs
node scripts/check-repo.mjs
```

`npm test` remains the single full-suite command; selecting focused files does
not change its membership or replace the full run required at commit.

### Checks must earn their place

A production check needs a concrete failure to detect and evidence that its
placement is worthwhile. Account for compute, maintenance, false rejections and
interruption of the maker's work. Use regression tests to establish that a known
slicing defect stays fixed. A heuristic that cannot detect the defect adds an
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
3. Run `npm test` once to confirm that the checkout works.
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
npm test
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

`scripts/check-repo.mjs` checks local document links and heading anchors, decision-record structure
and approval metadata, and exclusion of private Prints and local artifacts.
It does not verify that a human actually approved a decision or that a part is
printable. The subsequent Node tests check manufacturing software behavior.
CI installs dependencies and runs the same tests. Synthetic approval tests use
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
| Requested work and implementation records | [build_request.md](build_request.md) |

Update the owning account alongside a change and link to it from the entry
points that need it. Describe the present system in current guidance. Dated
decisions, requested proposals, measurements and external observations retain
their scope and status; link them when they explain a live constraint or question.
History remains available for investigating superseded details.

Choose the owner by the question the material answers: operating a capability
belongs in its task manual; its algorithms and implementation contracts belong
with the component; onboarding establishes the purpose and judgment for the role.
When an operation lacks a suitable manual, extend a related task package or
create a focused one and connect it to the relevant workflow. Task skills can
cover preparation and recovery as well as deposition patterns. Document the
operations that actually exist as the capability develops.

Task manuals declare `metadata.saam-kind: task` in their skill frontmatter so
the connector can distinguish them from printing patterns. Its known skill list
controls registration; the manual owns its description and classification.

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
