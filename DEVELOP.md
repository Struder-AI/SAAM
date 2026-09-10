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
  agent's, and any later revert returns to a known state. Apply the
  [commit test requirement](#checks) to this checkpoint too.
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

During development, agents choose the tests necessary for the change using the
[test registry](#test-registry), the affected code and its consumers. Run focused
tests as needed; do not automatically run the full suite at task start, after
every edit, or at task completion. Repeat checks when subsequent changes or
failures justify them. Documentation-only work normally needs only
`node scripts/check-repo.mjs`; discussion and read-only investigation need no tests.

Before every commit, run the complete `npm test` at the repository root against
the state being committed, including for documentation and checkpoint commits.
Finish edits before this run; if files change afterward, rerun before committing.
Report a failure and resolve it before committing unless the user explicitly
authorizes committing the failing state. Do not add another identical run merely
for staging or immediately after the commit. CI also runs the full suite on push
and pull requests. This policy does not itself authorize staging or committing.

The full suite checks documentation, decision metadata, private-file exclusions,
geometry, skill generation, machine export/interpretation, Studio, the shared
review/delivery workflow and MCP integrations. Add meaningful implementation
checks as capabilities are introduced and maintain their registry associations.
Report which checks ran and their results; a focused pass is not a full-suite pass.
This scheduling policy concerns repository tests, not checks on a generated print.

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
| `core/geom/`: spline evaluation, sections, height queries, STL/mesh input | [geometry.test.mjs](core/tests/geometry.test.mjs), [mesh.test.mjs](core/tests/mesh.test.mjs), [mesh-boundary.test.mjs](core/tests/mesh-boundary.test.mjs) | Affected skill tests; pipeline and regional tests for shared query changes |
| `core/geom/polyline.mjs`: numerical contour seams before offsets and deposition | [contour-cleanup.test.mjs](core/tests/contour-cleanup.test.mjs) | Mesh sections, full-fill and planar-infill |
| `core/region/offset.mjs`, Clipper normalization and offset compatibility | [offset.test.mjs](core/tests/offset.test.mjs), [offset-junctions.test.mjs](core/tests/offset-junctions.test.mjs), [offset-remnants.test.mjs](core/tests/offset-remnants.test.mjs) | Fill, infill, drape, vase and wedge consumers as affected |
| `core/region/perimeters.mjs`: coincident closed wall fronts | [perimeters.test.mjs](core/tests/perimeters.test.mjs) | [perimeter-wall.test.mjs](skills/full-fill/tests/perimeter-wall.test.mjs) covers full-fill, planar-infill, solid masks and S5/H2D export |
| `core/region/surface-offset.mjs`, surface derivatives | [surface-offset.test.mjs](core/tests/surface-offset.test.mjs) | Experimental surface tool; no implicit skill adoption |
| `core/region/intersection.mjs`, closed planar booleans | [intersection.test.mjs](core/tests/intersection.test.mjs) | Infill masks, reservations and regional composition |
| `core/region/region2d.mjs`: scanline fill and stroke ordering | [scanline-cells.test.mjs](core/tests/scanline-cells.test.mjs), [geometry.test.mjs](core/tests/geometry.test.mjs) | Full-fill and planar-infill |
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
| `studio/`: camera, display detail, mesh visibility, playback and offline movies | [studio-camera.test.mjs](core/tests/studio-camera.test.mjs), [studio-detail.test.mjs](core/tests/studio-detail.test.mjs), [studio-visibility.test.mjs](core/tests/studio-visibility.test.mjs), [studio-geometry.test.mjs](core/tests/studio-geometry.test.mjs), [studio-material.test.mjs](core/tests/studio-material.test.mjs), [studio-movie.test.mjs](core/tests/studio-movie.test.mjs), [robot-playback.test.mjs](core/tests/robot-playback.test.mjs) | Wedge playback; browser inspection when visual behavior changes |
| Studio settings, server and saved-print opening | [studio-settings.test.mjs](core/tests/studio-settings.test.mjs), [studio-open.test.mjs](core/tests/studio-open.test.mjs), [studio-lifetime.test.mjs](core/tests/studio-lifetime.test.mjs) | Viewer lifetime/owner isolation, workflow, regional workflow and machine-specific Studio delivery |
| Studio machine-source transport, browser interpreters and compact local drawing data | [source-player.test.mjs](core/tests/source-player.test.mjs) | S5/H2D/Dobot source identity, timeline/layer equivalence, stale requests, workflow and exact delivery |
| `adapters/mcp/`: stdio tools, shared import/setup and CLI access | [mcp.test.mjs](core/tests/mcp.test.mjs), [mcp-access.test.mjs](core/tests/mcp-access.test.mjs) | Shared workflow and recipe validation |
| Temporary HTTP/OAuth bridge, Claude package and web probe | [mcp-http.test.mjs](core/tests/mcp-http.test.mjs), [claude-plugin.test.mjs](core/tests/claude-plugin.test.mjs), [web-agent-probe.test.mjs](core/tests/web-agent-probe.test.mjs) | MCP stdio integration when shared tools change |
| `scripts/bench/`: analytical fixtures and mesh convergence | [benchmark-fixtures.test.mjs](core/tests/benchmark-fixtures.test.mjs) | Performance measurements remain opt-in; see benchmark instructions |
| Full-fill generation | Shared geometry, travel and pipeline tests as affected | [full-fill.test.mjs](skills/full-fill/tests/full-fill.test.mjs) |
| Planar infill patterns, open clipping, solid masks and sparse/drape composition | Shared booleans, scanlines and reservations as affected | [infill.test.mjs](skills/planar-infill/tests/infill.test.mjs), [patterns.test.mjs](skills/planar-infill/tests/patterns.test.mjs) |
| Explicit conventional/tree supports, interfaces and support-before-part ordering | Pipeline, workflow, regional and machine tests as affected | [supports.test.mjs](skills/supports/tests/supports.test.mjs) |
| Bivariate support surfaces, horizontal/normal section offsets and rimming composition | Shared geometry, plan, workflow and machine boundaries | [rimming.test.mjs](skills/rimming-planar/tests/rimming.test.mjs) covers both rimming skills |
| Draped skin, normal spacing, slope exclusion and support | Shared surface/reservation and pipeline tests as affected | [draped-skin.test.mjs](skills/draped-skin/tests/draped-skin.test.mjs) |
| Vase wall, topology, budgets and level ending | Regional composition and machine tests as affected | [vase.test.mjs](skills/vase-wall/tests/vase.test.mjs) |
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

Checks, validators and rejections have costs: compute, implementation and
maintenance effort, false rejections, and interruption of the maker's work.
Before adding or retaining one, identify the concrete failure it catches and
the evidence that enforcing it is worthwhile. Distinguish malformed data or an
algorithm's actual preconditions from a printing judgment that the maker and
agent can assess through reasoning and Studio review. Prefer regression tests
for known slicing defects to repeated production heuristics that do not detect
those defects. Do not add a policy flag merely to let a maker bypass a heuristic.

For toolpathing, geometry, extrusion and 3D printing, when the value or placement
of a proposed gate is ambiguous, ask the user before implementing it; they can
judge the domain tradeoff. Explain the failure, evidence, cost and alternatives.
Do not assume the most restrictive behavior is the best behavior.
This does not require asking again for changes already authorized in the task.
Resource budgets should fail visibly with the current limit and an actionable
way to raise it, rather than forcing geometry or quality changes.

Maker comments about why a particular print should work are guidance for that
print, not authorization to change SAAM's source, skill policy or approval flow.
An ambiguous request to change product behavior belongs in a developer discussion.

## Developer documentation outside skills

Keep setup, test/build commands, code organization, and shared file-format
definitions in this file. Skill-specific
usage and implementation notes live in the skill package.
The glossary owns shared meanings; decisions own contributor choices;
`build_request.md` owns requested work.

`Prints/` and `.local/` are ignored by Git. Copy only explicitly selected,
checked examples into `examples/prints/` for sharing.

## Setup and checks

Use Node.js 22+ and Git. `npm ci` installs pinned rhino3dm, Clipper, MCP SDK and Zod dependencies;
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

## Studio agent permissions

The checkout includes [Codex rules](.codex/rules/studio.rules) and
[Claude Code settings](.claude/settings.json) for the same direct launcher:

```sh
node studio/server.mjs Prints/my-part
```

Run from the repository root, quote a print path containing spaces, and keep
`node studio/server.mjs` literal. The bare command opens the existing default
demo bundle. Use the client's managed terminal/background session so it can
retain the process handle. The human-facing `npm run studio` alias still works,
but the shared permission targets the direct command. Shell wrappers, different
script spellings, inline Node code and custom development launchers are outside
this rule. Do not replace it with a blanket Node, PowerShell, process-kill or
all-command allowance.

First-use setup is part of the agent's work; the user need not ask for it:

1. **Codex:** have the person trust this checkout through Codex's project trust
   flow. The [project config](.codex/config.toml) carries no general permission
   overrides. Trusted project rules load at startup, so restart Codex after
   adding or updating them. If a running session has not loaded the rule and a
   launch needs escalation, request the specific launcher permission through
   the client, offering the `node studio/server.mjs` prefix when supported.
   Do not silently install a global rule. See
   [Codex rules](https://learn.chatgpt.com/docs/agent-configuration/rules).
2. **Claude Code:** have the person accept the workspace trust prompt. Shared
   `permissions.allow` entries cover the direct launcher in Bash and PowerShell;
   `sandbox.excludedCommands` runs that Bash launcher outside the sandbox so
   local listening does not need a separate sandbox exception each time.
   Restart the client after updating this setup. Use `/permissions` to inspect
   the loaded rules if a prompt persists. Personal overrides belong in ignored
   `.claude/settings.local.json`. See
   [Claude Code settings](https://code.claude.com/docs/en/settings),
   [permission rules](https://code.claude.com/docs/en/permissions), and
   [sandboxing](https://code.claude.com/docs/en/sandboxing).
3. **Browser:** open the printed `http://127.0.0.1:<port>` URL using the client's
   browser integration. Use its site permission flow if needed; keep any request
   scoped to Studio. Codex manages allowed sites in Settings > Browser; see
   [browser permissions](https://learn.chatgpt.com/docs/browser). Claude browser
   integrations have their own setup and permissions. These command rules do
   not preauthorize browser tools. Persistence across Studio's different ports
   is client-dependent and has not been verified; do not promise exactly one
   prompt. Claude Desktop/web MCP connections also retain their separate
   [connection setup](adapters/mcp/README.md); Claude Code settings do not configure them.

During work, inspect geometry, source and playback and use camera/view controls
without another conversational permission question. Keep each instance's print,
URL and terminal handle together. To finish or restart it, close that instance's
viewer tabs; after three seconds without a viewer its server exits. If no viewer
was ever opened, or the server is stuck, stop only its recorded terminal task
or send Ctrl+C through that session. A client's stop-tool permission can still
apply. Do not scan for and kill all Node processes. Leave a viewer open while
the person is expected to review it. Existing manufacturing approvals still
belong to the person.

These allowances trust the launcher and its imported repository code; they are
command matches, not an OS boundary restricting the process to previews or the
print argument to `Prints/`. They do not pin a code hash or a working directory.
Keep the rules in the trusted project and use the repository root as instructed.
More restrictive client or administrator policies can still block or prompt.
No global approval mode or full-access setting is changed.

To check Codex matching without launching Studio:

```sh
codex execpolicy check --rules .codex/rules/studio.rules -- node studio/server.mjs Prints/my-part
codex execpolicy check --rules .codex/rules/studio.rules -- node --eval 1
```

The first must report an allow match; the second must have no matching rule.
The rule file also includes positive and negative examples validated on load.

## Slicing speed benchmarks

`scripts/bench/slicing.mjs` is an opt-in development measurement harness over
the existing geometry queries, full-fill, planar-infill, draped-skin, composer,
machine checks, Griffin exporter and interpreter. It adds no product geometry
type, approval route, toolpath viewer or manufacturing pipeline. Its twisted
fixture is not yet a shape accepted by the public plan parser. It calls skill
producers on prepared geometry; it does **not** time a complete public bundle
generation or Studio load. Geometry construction/validation, section queries,
roof queries, skill production, composition/checks and export/interpretation
have separate measurements. The bounded wedge generator is not replaced.

```sh
node scripts/bench/slicing.mjs --out .local/slicing-bench --trials 3
node scripts/bench/slicing.mjs --out .local/slicing-scale --fixtures twisted-box-large --targets 0.025 --modes full --trials 3
node scripts/bench/slicing.mjs --out .local/slicing-fine --fixtures twisted-box --targets 0.00125 --modes full --trials 3
node scripts/bench/slicing.mjs --out .local/slicing-rhino --fixtures twisted-box --targets none --stl path/to/export.stl --trials 3
node scripts/bench/slicing.mjs --out .local/slicing-precision --fixtures twisted-box --targets 0.025 --native-mesh --trials 3
node scripts/bench/diagnose-regions.mjs path/to/export.stl .local/slicing-diagnostics
node scripts/bench/report.mjs .local/slicing-bench/measurements.md .local/slicing-bench/results.json .local/slicing-rhino/results.json
```

Use a fresh output directory for each experiment. Generated Rhino 6 `.3dm`
files contain six named untrimmed surfaces in millimeters; join them in Rhino
before exporting STL with the person's normal mesh settings. Keep the supplied
STL unchanged. `--stl` expects that same fixture in millimeters at its original
coordinates. It validates the mesh and checks sampled section topology and roof
coverage; it reports deviations rather than silently registering or repairing
the geometry. The external bytes and SHA-256 are saved in the ignored output.

The control is a 24 mm cube. The main fixture has a 24 × 24 mm base, a 24 mm
rim, a top rotated 45 degrees and a shallow bicubic roof reaching 24.9 mm.
The four sides are ruled NURBS patches between the base and rotated roof edges:
they form a waist, not a constant-width helical extrusion. The large fixture
doubles all dimensions. All three use the same skill settings: 0.2 mm layers,
0.4 mm line width and two walls. `full` fills the planar body at 100%; `planar`
uses 20% rectilinear infill with three top/bottom solid layers; `draped` combines
full-fill with two 0.2 mm skins at 0.5 mm survey/stroke sampling and the S5's
15 degree limit. Cooling delay is zero in the benchmark. Draping uses the
same planar support-height callback as shared generation. All results are
software-only development data, with no approval or machine execution.

Meshes use conforming UV grids over the same six patches, refined to sampled
surface-to-triangle correspondence targets of 0.1, 0.025 and 0.005 mm by default.
A second denser sampling grid verifies the chosen tessellation. This fixture
mesher is neither Rhino's mesher nor a certified Hausdorff-error calculation.
Independent comparisons include section topology, bidirectional sampled contour
distance, section area, roof height and normals. Near-horizontal roof contours
can move farther in XY than the surface error in XYZ. Matching triangle count
alone does not establish equivalent shape or process output. The fine 0.00125 mm
target stays within the existing 100000-triangle input limit; unsupported target
sizes fail explicitly. `--native-mesh` adds the same triangles before binary
STL float32 rounding to help distinguish meshing from import precision effects.

For Cura 4.12, **Maximum Resolution** is a post-slicing segment-length setting,
not an STL edge-length floor. The installed base definition has 0.5 mm maximum
resolution and 0.025 mm maximum deviation; machine/material/quality settings
can override these. The latter is only a reference error scale for the mesh
test, not a declaration of equal slicer accuracy. See the
[Cura 4.12 base definition](https://github.com/Ultimaker/Cura/blob/4.12/resources/definitions/fdmprinter.def.json)
and [Rhino 6 meshing guidance](https://docs.mcneel.com/rhino/6mac/help/en-us/commands/mesh.htm).
Rhino's maximum distance edge-to-surface is a meshing control, a different stage.

Workers run serially, with a separately recorded first invocation and three
warm repeats by default (median, minimum, maximum and raw samples). Preparation
and query microbenchmarks are independent of the complete skill timing; do not
add them to it. Output hashes check repeatability, while action/operation counts,
deposited volume, skill reports and file sizes reveal unequal work. Failures
carry their phase and stack and are never counted as fast slices. Record Node,
CPU, memory, Git/dirty state, source hashes and exact STL hash. Do not run other
CPU-heavy work during timing. These small samples establish local trends, not
statistical significance across machines. Profiling runs should be separate
from uninstrumented timing. Copy a saved `.job.json`, give it a separate result
path and use Node's `--cpu-prof` on that worker to inspect hotspots without
overwriting timed results. The optional diagnosis command intercepts an
excessive region-index allocation in that process only and saves failing inputs;
it is not a production safety fix.

The initial 2026-09-09 run found slower direct spline queries but faster **planar
full-fill** than the generated twisted meshes. The 24 mm spline took roughly
0.34–0.40 s, versus 0.76 s / 2.10 s / 5.77 s for 768 / 3072 / 12288 triangles
at the three mesh targets. The doubled fixture took 1.17 s for splines and
14.13 s for its 12288-triangle 0.025 mm mesh. These are prepared-geometry skills
plus composition/checks, excluding export and public workflow overhead. The
mesh sections contain many more vertices, so downstream region work outweighs
their cheaper intersections. Existing planar-infill/region-reservation failures
prevent successful timings for several mesh combinations.

At the finer 0.00125 mm mesh target (49152 triangles), full-fill took 22.26 s
versus 0.39 s for splines in the same run. With the production planar-support
callback included, the non-planar body+drape pass took 18.42 s for splines and
5.00 s for the double-precision 3072-triangle mesh. The binary STL version
failed region reservation. The successful drapes do not have identical coverage:
faceted normals change the included skin area, so this is a backend diagnostic,
not an equal-output speed claim. Earlier pilot drape data in local reports used
the skill's default support callback and is superseded by `slicing-drape-final`.

The user's normal Rhino export has 1078 triangles. It passes mesh validation
and query checks but exposes a full-fill outward-offset/index blow-up at Z=12.2
mm and a solid-mask intersection failure between Z=0.2 and Z=0.4 mm. Do not
treat its failed generation as a speed measurement or disable checks to make
the comparison succeed. The user's Cura 4.12 report is 14 s to load and 2.3 s
to slice, two walls and 100% infill; the load boundary and layer height were
not specified. Record load and slice separately, and compare only planar full
fill with Cura. Non-planar measurements compare SAAM backends only.

Prioritize bounded/robust offset and boolean processing, then an explicit
error-bounded contour simplification experiment, indexed mesh Z/XY queries and
redundant spline height-solve diagnostics. Keep native spline input while testing
these shared-interface improvements. A language/runtime rewrite or forced mesh
conversion is not justified by these measurements. Measure public bundle
load/check/generate separately next, then repeat matched planar tests in Cura
and Bambu Studio with saved profiles, exact versions, thread counts and repeated
timings. No architecture decision or contributor approval is recorded by this
benchmark.

## Studio performance and display detail

Studio uses a right-handed orthographic camera: top view shows +X right and
+Y up (toward the back of the bed), with +Z toward the viewer. Orbit, side and
top views share this projection without perspective scaling. Playback has a
1×–30× slider, initially 10×; inactive toolpath layers draw at 50% opacity with
one-third of the original color lightening. Current material uses shaded oval
beads in WebGL2, with physical dimensions that scale with viewport zoom. Width
comes from commanded volume per distance divided by the nominal layer thickness,
falling back to the plan's line width. Planar and bounded wedge beads sit below
the nozzle; pipe cladding uses radial thickness around its commanded bead center.
Lighting distinguishes adjacent current tracks without an artificial gap.
This is a nominal display cross-section, not measured filament spread.

### Visually verified toolpath colors

The user verified sky blue, orange, teal and lavender as visibly distinct with
Studio's shaded bead rendering on 2026-09-10. These are the preferred visible
color set; agents may use other colors when more are needed. This records visual
feedback, not physical print validation or contributor consensus.

| Color | Display value | Current assignment |
|---|---|---|
| Sky blue | `#5b9fd3` | Body / planar paths |
| Orange | `#c65b19` | Circumferential / skin paths |
| Teal | `#53b8af` | Axial cladding |
| Lavender | `#a799dc` | Available for another operation |

Sky blue was reviewed at `#62a9df`; the current value applies the user's requested
slight darkening. Named pipe-view buttons seek to the body, axial and
circumferential samples without changing camera or speed. The shared
`TOOLPATH_COLORS` palette and style function apply to lines, material and movies.

### Material geometry and playback

Completed material uses rectangular swept sections with every source curve
segment retained. Compact instance buffers, shared cross-section templates and
cached geometry reduce storage and drawing cost without voxelizing curves.
Layers and operations remain separately colored; unprinted bores remain empty.
A depth prepass prevents hidden internal surfaces from accumulating opacity.
Draped skin and normal rimming currently lack source surface normals and retain
an explicitly labeled line fallback. Browsers without WebGL2 also use lines.
Fallback line width scales with the same camera, with a 0.04 mm current-layer
inset. Canvas device-pixel scaling applies once; travel stays a thin screen-space
guide. Display geometry does not modify deposition spacing, volume or export.

Studio displays material estimates in grams using a fixed 1.2 g/cm³ density
for all materials. Robot relay estimates and commanded material intent remain
separate and labeled; internal volumes and machine flow rates retain their units.
Outgoing layers normally ease color and opacity over two seconds of wall-clock
time, including when paused. At accelerated playback, shorten the fade only when
the next layer begins sooner, using its source timeline and the selected speed.
A new layer transition completes any preceding fade, so only one outgoing layer
can fade at a time. Changing speed or pausing never reverses fade progress.
Scrubbing, replay and opening a print reset fade history.
**Export movie** renders the whole interpreted program into a separate canvas
with the same renderer, selected speed, camera/zoom/framing, travel visibility,
rotary view, display detail and layer fade. The viewer stays paused at its current
position. Export uses 30 fps and a deterministic video clock, including two final
seconds to finish fades; it does not wait through real-time playback. WebCodecs
encodes VP9 with VP8 fallback into a seekable, silent WebM download. The browser
must support one of these encoders. Render/encode time depends on the computer;
compressed frames remain in memory until download. Progress and cancellation
keep the page usable, while view controls are locked for consistent frames.
Canvas dimensions and device-pixel ratio at export start determine resolution.
The background is painted by the shared renderer so the movie keeps Studio's
appearance. Same-tab view settings survive refresh in session storage; tabs
opened before this feature must have their settings reselected once. Movie
export does not generate machine code, approve a job, or modify its bundle.

S5 and H2D profiles supply new shell and wedge plans with 40/20/24 mm/s
planar/skin/first-layer targets, 120 mm/s XY travel and 10 mm/s Z travel.
Existing locked plans, material flow limits, retraction and firmware service
speeds are unchanged; actual deposition remains capped by flow and axis limits.

Geometry view uses opaque, depth-tested WebGL2 sky-blue surfaces, camera-relative
lighting and a subtle blurred ground shadow projected from the actual mesh.
Angle-weighted corner normals smooth curved tessellation below a 35-degree
crease threshold; named feature boundaries and sharper corners remain crisp.
Coincident patch vertices share display normals only within the same feature.
Quiet depth-tested crease/rim lines replace triangle outlines. Selection adds
a restrained tint and stronger boundary lines; pointer picking interpolates
depth at the clicked location, leaving real holes empty. The grid retains its
original contrast, with an orientation indicator in the corner instead of axes
over the part.
Geometry buffers are cached until the source changes. These operations affect
display only: source coordinates, tessellation and manufacturing data remain
unchanged. Without WebGL2, Studio labels its flat-surface fallback. Toolpath view
draws no part mesh or outline; the current phase/layer is darker, opaque and
drawn after the faded prior layers. At shutdown it retains emphasis on the last
deposition layer. Source geometry, output and approval data are unchanged.

The shared bundle workflow retains its latest interpreted export in memory per
adapter. Reuse requires the current plan/machine/geometry/runtime identity and
the hash of the actual export bytes. Review/approval records, geometry validation
and source-file checks still run on each load. A cache miss interprets and checks
the saved export; it never regenerates a path or export. Generation seeds the
cache with its checked interpreter result. Returned programs and summaries are
copies. Delivery reads and hashes the exact reviewed export. Local hash records
detect changes relative to the recorded bytes; they are not signatures proving
the provenance of files whose records were also edited. Shell, wedge, Griffin,
H2D and Dobot use this lifecycle.

Studio's state response contains geometry, review records and a small program
summary/source manifest, never move/event arrays. It fetches the checked machine
source separately: plain Griffin G-code, the exact G-code member of an H2D 3MF,
or each actual Dobot Lua file (global, definitions and entry). Requests bind the
print, review revision and export hash; the browser checks each source digest.
Archive and H2D firmware-envelope checks remain on the server. Delivery retains
the original archive bytes, not a repacked or regenerated program.

A browser worker runs the same modal G-code interpreter or bounded Lua runtime
as export checks. Lua helpers and entry code are executed; annotations cannot
substitute for actual motion commands. H2D playback retains its checked print-body
scope, with firmware service motion explicitly not simulated. The worker stores
decoded moves in chunked typed arrays and transfers their ownership inside the
browser. These are local drawing/timeline data, not another persisted path or
server transport format. No motion JSON is sent to the browser. Timeline, layer,
travel and robot acceleration controls share the existing renderer. Browsers
still decode all moves before playback; fully paged playback is not implemented.
Machine profile loading stays in the Node wrapper; pure machine rules and source
interpreters are shared with the browser through an explicit module allowlist.

Studio computes bounds/layout/camera transforms once per frame and coalesces
redraw requests. It preserves segment order, colour and transparency. The
fallback line viewer has a **40,000 drawn-endpoint budget** (two endpoints per line,
including reserved space for the active move); this is a drawing budget, not an
input/file limit or a manufacturing-path simplification. Geometry proxy and
camera decorations are separate. Full interpreted moves remain available for
playback timing, nozzle position, checks and export.

Below the budget, the viewer draws the original segments. Above it,
`studio/toolpath-view.mjs` simplifies only continuous same-operation strokes
within one phase/layer, with 0.02 mm chord deviation. It retains bends exceeding
that tolerance and never joins across travel/extrusion or operation boundaries.
If that is insufficient, it keeps representative whole layers, preferentially
retaining the latest layer. A single oversized layer gets a detailed window at
playback, preference for walls/non-planar moves and distributed older samples.
Omitted edges remain omitted, never connected into invented extrusion. Studio
labels simplified curves or a layer overview; detail follows the playback
position. This overview does not show every older segment simultaneously.

The initial browser cap sweep used 23,953 and 383,248 interpreted moves, with
10k, 20k, 40k, 80k and 160k endpoint budgets and 15 camera frames per case.
At 40k the larger repeated-path stress fixture drew 21,446 endpoints in about
2.9 ms median / 4.9 ms maximum in the isolated canvas loop; whole-layer selection
can leave the budget partly unused. Its initial detail preparation was about
148 ms. The 160k budget drew 84,694 endpoints in 10.4 / 12.9 ms. The 40k default
leaves room for Studio's other frame work and slower hardware; it is a local
empirical default, not a universal frame-rate guarantee. Raw local results are
in `.local/studio-fast/cap-results.json`; the original Studio baseline is in
`.local/studio-bench/findings.md`. Keep browser drawing measurements distinct
from server generation, cold verification, JSON transfer and UI-ready time.

## Local MCP access

[The MCP adapter](adapters/mcp/README.md) provides stdio tools for a compatible
local chat client. Launch `node adapters/mcp/src/server.mjs` from the client's
configuration; its README gives an absolute-path example and environment options.
No client configuration is edited automatically. The stdio entry point accesses
this development checkout from a local client. For a web chat, the adapter's
[temporary connection](adapters/mcp/README.md#temporary-web-chat-connection)
adds OAuth-protected Streamable HTTP and an outbound HTTPS tunnel. Studio and
generation stay local; vendor-account connection checks remain separate from
SDK integration tests. A packaged application remains a future direction.

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

`npm run web-chat -- --cloudflared /path/to/cloudflared` starts the temporary
connection. `adapters/mcp/src/http.mjs` forwards SDK HTTP requests over an
in-memory transport to one existing adapter; it owns no manufacturing schema or
approval route. `dev-oauth.mjs` adds single-installation pairing to the SDK's
OAuth routes. `web-chat.mjs` owns the tunnel, the loopback pairing page and the ignored
connection file. It starts either a quick tunnel or, given `--public-url` and a
named-tunnel token, a stable named tunnel; the token comes from a file or the
environment so it never appears in process arguments.
`core/tests/mcp-http.test.mjs` exercises the HTTP/OAuth boundary and shared
workflow with synthetic approvals. See the adapter README for startup, security,
timeouts and same-computer review limits.

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

The user approves geometry, then the locked process plan. Generate the declared
machine export directly from that complete plan, using transient motion objects.
Check the actual exported commands before SAAM Studio runs
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
code must be restarted after runtime changes. Each agent owns its Studio instances;
do not adopt another agent's viewer or terminate another agent's process. Independent
CLI launches and separate local MCP adapter processes use separate free loopback
ports. Identify the current work's print and URL before restarting its viewer.
Check the loaded geometry and export afterward.

Studio tracks open pages through authenticated persistent viewer connections,
independent of revision polling and background-tab timer throttling. There is no
deadline to open the first viewer, for either CLI or MCP launches. Once opened,
Studio closes three seconds after its last viewer disconnects, allowing ordinary
refreshes to reconnect. An accepted bundle write finishes before shutdown
completes. Saved bundles are retained and can be opened in a fresh instance later.
The old `--close-when-idle` flag is accepted but no longer needed. The CLI process
exits when its work drains. In MCP, only that Studio listener and session are
released; the adapter and its other viewers stay available. Repeated
review requests within the same adapter can use that print's still-open session.
The temporary web-chat bridge shares one adapter across clients; it does not
provide per-agent identity or locking. Independent agent ownership requires
separate adapters. Distinct instances do not lock a shared bundle against edits
from another process, so concurrent agent work should use separate bundles.

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
- `saampath/1`: transient motion objects during generation. Moves carry absolute XYZ millimeters,
  speed in mm/s and deposited volume in mm³. Retraction/recovery uses filament
  millimeters; fan and dwell actions are explicit. Phase/layer labels describe
  the move without determining its geometry. New bundles do not serialize this
  representation. Regeneration removes an obsolete `path.saampath` file.
- `saam-review/1`: exact-version human approvals, history, generation/export hashes
  and a small generation summary for display (never playback geometry).
  `saam-checks/1` records software checks and limitations.

On reopening, verify native geometry/source and plan identity, check the export
digest, and interpret the saved machine commands. Do not regenerate. A changed
export cannot inherit its previous toolpath approval. Delivery copies the already reviewed bytes. Local approval
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

`core/region/` does the planar work: shared Clipper offsets for perimeters and
coverage, scanline fill, and shared Clipper2 region boolean operations.
The previous raw-offset, distance-pruning and handwritten self-splitting
implementation has been removed. See [shared offsets](#shared-offset-functions).

Booleans are how several solids are meant to combine: section each solid on its
own and combine the layers, rather than building a boolean B-rep. A slicer only
needs the result one layer at a time, so surface-surface intersection curves and
tolerance-consistent shell stitching are never posed. The same operation
reserves material under a top surface, by intersecting a section with the level
set of the reserve height. The [shared planar intersection tool](#shared-planar-intersections)
replaces the handwritten region booleans and resolves the recorded Rhino STL
solid-mask failure. Sectioning and sampled level-set extraction remain separate
constructions; this is not a general curve/surface intersection engine.

The region layer is implemented and tested. Assemblies now select separate
components for fill instances and a roof for draping. Automatic solid union and
overlap resolution in a plan remain deferred; an assembly is not a boolean union.

### Travel planning

`core/path/builder.mjs` classifies each move as joined, combed or hopped.
The shared PathBuilder tracks deposited height; local callbacks decide direct/combed
eligibility. See [travel requirements](#whole-plan-travel-requirement). Fill
strokes alternate their direction to keep neighbouring endpoints close. The wedge
retains its bounded nearby-start policy through the same PathBuilder; longer
moves lift above material deposited so far. Both use the shared export and checks.

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

`npm test` runs `core/tests/` and every skill's tests. They
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

**Scope shared components to demonstrated needs.** Build the smallest shared
interface that serves current callers and the authorized task. Identify those
callers, their inputs, required operations and result semantics before adopting
a library. An upstream library's broader capabilities are not a SAAM feature
list: do not pre-build unused geometry types, operations, options, backends or
extension frameworks. Extend the same component when a concrete new need arises,
and add the corresponding interoperability tests then. Keep established upstream
numerical machinery intact behind a narrow adapter; minimizing our integration
does not mean cutting out robustness logic or maintaining a speculative fork.

Prefer one shared pipeline with narrow adapters. Introduce a parallel pipeline
only when it is genuinely necessary; normally explain why a shared extension
cannot serve the need and ask the user before building it. Authorization already
given applies. Convenience, a demo, an agent's private test, or a new skill is
not by itself a reason to duplicate generation, preview, review or delivery.
Intermediate developer experiments belong in temporary scratch directories and
call the same components. They must not become a second product command, artifact
format or approval route without an explicit scope decision.

For an explicitly requested historical toolpath inspection, a local scratch
launcher may pass `resolveBundle` to `createStudio`. The resolver supplies a
scratch adapter over `createBundleWorkflow`; Studio keeps its existing source
playback, print picker and lifecycle. The default CLI and known adapters are
unchanged. This is explicit development injection, not automatic discovery or
permission to load module paths from a print. Record the original revision and
settings, distinguish historical stroke geometry from modern export assumptions,
and verify the interpreted deposition against the source generator.
An adapter's optional `inspection` presentation supplies a title, description,
facts/settings rows and note for a development tour. Studio then exposes settings
for reading and hides its approval button; the scratch adapter must independently
reject approval and delivery. This presentation does not grant production rights.

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

### Shared numerical foundations

Aspire to **numerically robust, established algorithms with measured performance**.
Prefer a pinned, attributable upstream implementation behind one shared SAAM
interface over handwritten approximations or skill-local copies. Preserve the
upstream topology logic, tolerance semantics and required preconditions; an
algorithm's reputation does not automatically transfer to a port or adaptation.
Record source/version, intentional adaptations, supported geometry, precision,
reference comparisons, known failures and measured cost. Claims such as
"proven", "reliable" or "fast" must state the scope and supporting evidence.

All skills must call the shared functions when offsetting or intersecting.
Extend the shared interface when a capability is missing; do not add an inline
copy, fallback kernel or private tolerance variant. Geometry-specific algorithms
can live behind the same boundary with explicit capabilities and limitations.
This aspiration applies to numerical geometry and toolpath operations generally,
not just the two offset functions. It does not authorize replacing unrelated
algorithms or selecting a new general intersection engine.

Use source comparisons, adversarial fixtures, convergence tests and benchmarks
in development. Keep those expensive comparisons out of the production hot path.
Runtime checks must earn their cost under [the existing guidance](#checks-must-earn-their-place).
Numerical integration/subdivision needed to construct a result to its requested
tolerance is algorithm work; an additional independent verification pass needs
its own justification. Preserve parameter/point correspondence and cache useful
evaluations instead of repeatedly flattening and inverse-projecting geometry.

### Shared offset functions

**Planar:** [offsetRegion](core/region/offset.mjs) accepts closed 2D loops in mm
and a signed distance: positive expands material, negative erodes it. Pass the
whole region together, including CCW outer/island loops and CW holes. Nonzero
winding determines material; loop order and seams do not assign ownership.
The old `region2d.mjs` export is an alias to this exact function. Full-fill,
planar-infill, draped-skin, vase-wall, shared rim coverage/travel and the bounded
wedge all use it. The wedge retains its eight-point section generator and nearby-travel
policy; only its independent boundary insets were replaced. Draped-skin retains
its existing XY footprint inset, not an unrequested geodesic-spacing change.

The [adapter](core/region/clipper.mjs) uses pinned `clipper-lib@6.4.2` (internal
JS version `6.4.2.2`), a port of the Clipper 6.4.2 kernel included in the user's
`ClipperComponents 0.3.2.0` reference. Reuse includes `ClipperOffset` construction,
orientation handling, winding/union cleanup and `PolyTree` topology. Clipper2
was not substituted. SAAM's adapter selects **closed material polygons**, not
the Grasshopper wrapper's closed-line stroke/band mode. This is an intentional
interface difference: an inset must yield the remaining material, not a stroke
on both sides of each boundary. It normalizes inputs and splits point-touching
output lobes using Clipper's `StrictlySimple` union. This additional construction
step fixes observed C#/JS differences in grouping touching loops and prevents
component-aware fill from treating them as one self-touching boundary.

Options are `join: 'round' | 'square' | 'miter'` (round by default),
`miterLimit: 2`, `arcToleranceMm: 0.02` and `precisionMm: 1e-9`. Arc tolerance
is the upstream polygonal approximation target. Integer precision is distinct
from surface/section chord tolerance. A deterministic local origin reduces
coordinate magnitude; range checks leave headroom for bounded miters. Invalid
numbers/options or excessive range raise; genuine collapse returns `[]`.
There is no per-point standoff sweep or arbitrary small-area pruning in the
new offset. Reference tests account for integer quantization. Skill authors
must not import Clipper directly. General `intersect`/`difference`/`union` use
the [Clipper2 tool](#shared-planar-intersections), re-exported from
`core/region/boolean.mjs`. Clipper 6's
internal clipping needed for offset cleanup is part of the adopted offset.

`perimeterLoops` in [perimeters.mjs](core/region/perimeters.mjs) is the shared
deposition-contour wrapper used by full-fill and planar-infill. It retains a
single central closed track when an outer/hole pair meets and material erosion
loses that hole. Candidate fronts use the existing 0.001 mm chord target and
are compared within the sum of their two chord tolerances. Only their boundary
band is replaced; disconnected/nested islands and other holes remain accounted
for. This does not change `offsetRegion`'s zero-area collapse semantics, fill
masks, machine output interfaces or approval workflow. General medial-axis,
open centerline and variable-width gap fill remain unimplemented.

**Surface, experimental:** [offsetSurfaceRegion](core/region/surface-offset.mjs)
takes `(patch, loopsUv, deltaMm, options)` and returns `{loopsUv, loops, report}`;
`loops` holds corresponding XYZ points. It constructs geodesic boundary strips
and round corner sectors using native NURBS first/second derivatives and an
adaptive Runge-Kutta integrator. Clipper's actual union/difference and winding
implementation combines the swept bands with the source material and resolves
holes, nesting and collapse. The distance construction is **new SAAM code**,
not copied Rhino source. RhinoCommon's public `OffsetOnSurface` wrapper calls
a native modelling routine whose implementation is not in the public source.
No Rhino output fixture has been supplied or run; do not claim Rhino equivalence.

The surface function retains UV throughout and caches surface evaluations; it
performs **zero inverse mappings** and no global flatten/warp round trips.
Constructing new points and emitting XYZ still requires surface evaluation.
Scope is closed UV polyline regions on **one regular, injective C2 NURBS patch**,
with the required offset-side sweeps remaining inside its domain. Low-degree
single-span planes/cylinders are supported too. Poles, singular tangents,
internal knots below C2 continuity and domain escape raise. Trimmed/multiple
patches, periodic seams, folded parameterizations and mesh-surface offsets are
not implemented. Large offsets reaching geodesic caustics/cut loci and arbitrary
high-curvature surfaces are not validated; no general global distance-error
guarantee is claimed. This function is available for development, with no current
skill silently switched to it and no new maker geometry/plan/approval route.

Options: `toleranceMm: 0.01` (local integration/chord target, not a certified
global error bound), `maxStepMm: 0.5`, `precisionUv: 1e-10`,
`maxEvaluations: 250000`. The report gives actual evaluation/integration and
subdivision counts, the budget, and experimental status. Budget exhaustion
identifies the setting to raise and returns no partial result. The caller must
provide valid patch geometry and the stated chart preconditions; there is no
expensive whole-surface injectivity or clearance validation in each call.

Development checks compare 90 nested/neck/star/island/collapse cases, inward and
outward with all three joins, against the plugin's **unmodified C# 6.4.2 kernel**.
With identical material-region normalization and simple-loop cleanup, the JS
port matches every output coordinate and loop exactly. The checked fixture
contains source hash and provenance. Surface checks cover flat nesting/collapse,
an inclined plane with rescaled UV, an independently unrolled rational cylinder,
and refinement of nested regions on a doubly curved quadratic surface. These
are software tests, not universal correctness or physical print validation.

```sh
node --test core/tests/offset.test.mjs core/tests/surface-offset.test.mjs
node scripts/bench/offsets.mjs > .local/offset-timings.json
```

To regenerate the independent reference, download the plugin's `ClipperTools/clipper.cs`
into ignored `.local/offset-reference/clipper.cs` (SHA-256
`697a4d31d33642a41705e46247873a34694632cd180de46c00deb97fe7278f4f`).
Write `offsetFixtures` from `scripts/bench/offset-fixtures.mjs` as JSON to
`.local/offset-reference/inputs.json`. With .NET 8 SDK, build
`scripts/bench/clipper-reference.csproj` using `--artifacts-path .local/offset-reference/artifacts`,
then run its executable with that input and save stdout as
`.local/offset-reference/expected.json`. Run
`node scripts/bench/check-clipper-reference.mjs .local/offset-reference/expected.json --record`.
Normal `npm ci`/`npm test` needs neither .NET, a network fetch nor Rhino desktop.
Source URLs: [plugin](https://github.com/arendvw/clipper),
[JavaScript port](https://github.com/junmer/clipper-lib),
[Rhino wrapper](https://github.com/mcneel/rhino3dm/blob/main/src/dotnet/opennurbs/opennurbs_curve.cs).
The dependency carries its upstream Boost license and JS support-code notices.

Initial isolated Windows/Node 24 measurements: about **0.67 ms** warm median for
the 16-vertex nested planar case, **35 ms** for all 90 planar cases, and **18 ms**
for the four-vertex cylinder offset at 0.005 mm tolerance (1287 evaluations,
zero inverse mappings). The runner reports cold time, three warm samples,
source/output hashes and usage. These small fixtures establish local costs,
not a general speed ranking; complex surface offsets remain more expensive.
The original Rhino STL now passes all full-fill layers in the offset diagnostic;
its separate solid-mask intersection failure was subsequently resolved by the
shared Clipper2 tool below.

### Shared planar intersections

[intersect, union and difference](core/region/intersection.mjs) take two closed
2D material regions in millimeters and return closed loops. Current callers need
layer masks, wall/interior coverage and material reservation. Outer/island loops
are CCW, holes CW, with nonzero winding; overlapping material is counted once.
Empty material is `[]`; boundary-only point/edge contact has no material area.
`clipOpenPaths(paths, region)` additionally clips open 2D polylines to a closed
region using the same Clipper2 kernel, precision and allocation lifetime. Gyroid
infill needs this to retain curved strokes while splitting at holes and solid
masks. Open paths preserve point sequence; they are not rotated or closed by the
closed-loop canonicalizer. There is no XOR, contact-event API, UV surface adapter, mesh booleans,
NURBS intersections or backend-selection framework. The user selected Clipper2
first; consider CGAL only if tests show an unmet requirement.

The adapter uses pinned `clipper2-wasm@0.4.0`, C++ Clipper2 2.0.1 compiled to
WebAssembly, with upstream `Clipper64`, `NonZero`, `PreserveCollinear=false`.
Intersection, winding and topology construction stay intact. Unused upstream
functions are not exposed by SAAM; the packaged Z build uses zero/unused Z.
Module initialization occurs once on import; operations remain synchronous.
Allocated WASM objects are released on success/failure. Normal installation and
tests need no compiler or Rhino desktop; operations need no network at runtime.

Conversion shares the offset adapter's local origin/grid and canonical ordering,
using one origin for both operands. `precisionMm` defaults to `1e-9`; the range
bound is less than `2^50` grid units. Invalid numbers, non-2D points, invalid
precision or excessive spans raise. Kernel failure raises without partial output.
The booleans have no epsilon midpoint classifier, handwritten intersection
construction, endpoint stitching or small-area pruning. Integer rounding still
allows sub-grid features to collapse; JS decoding cannot recover precision lost
in the inputs. This is a precision-grid contract, not exact arithmetic or a
guarantee about unsampled spline/mesh detail.

Existing imports through [boolean.mjs](core/region/boolean.mjs) alias this tool:
full-fill, planar-infill, draped reservations and regional composition, including
vase/cap transitions. Mesh/spline sectioning, sampled level sets, Clipper 6 offsets
and experimental surface-offset cleanup retain their separate current scope.
Full-fill's bead-coverage expansion uses the existing 0.001 mm `TOLERANCE.chord`
arc target. Former 0.02 mm chords left four artificial corner gaps totaling
about 0.000252 mm² in a rectangular solid top, hidden by the old boolean's area
pruning. Tighter construction resolves those gaps without deleting material or
changing deposition strokes. Runtime identity hashes exact JS/WASM bytes.

Tests include the captured 60-vertex STL failure, analytic nesting, contacts,
slivers, nearly parallel crossings through coincidence, translation/scaling,
repeated operations and 200 seeded rectangle-set cases checked by independent
cell classification. Another 138 star/nesting/contact/sliver/STL cases match the
unmodified upstream C# results exactly in coordinates and topology. Agreement
checks integration; it is not an independent proof of the upstream algorithm.
The original 1078-triangle STL passes every offset/solid-mask diagnostic layer.

```sh
node --test core/tests/intersection.test.mjs
node scripts/bench/intersections.mjs
node scripts/bench/diagnose-regions.mjs .local/slicing-rhino/rhino-standard.stl .local/intersection-diagnostics
```

Reference provenance: [WASM source](https://github.com/ErikSom/Clipper2-WASM/tree/3c244f3edd0adae6c851460fc409c15f3d235395),
[Clipper2 source](https://github.com/AngusJohnson/Clipper2/tree/642390d0d515cfb645d2ec4d95d218e28be645f4),
Boost Software License 1.0. Installed WASM SHA-256:
`429e866b4d7813cabfa7d31e6650825343109fb7d7a1702c533e8597573449ec`.
To regenerate the saved reference, fetch that Clipper2 revision into ignored
`.local/intersection-native-reference`, then use .NET 8:

```sh
node scripts/bench/intersections.mjs --inputs .local/intersection-inputs.json
dotnet build scripts/bench/intersection-reference.csproj --artifacts-path .local/intersection-reference-artifacts
dotnet .local/intersection-reference-artifacts/bin/intersection-reference/debug/intersection-reference.dll .local/intersection-inputs.json > .local/intersection-reference-output.json
node scripts/bench/intersections.mjs --reference .local/intersection-reference-output.json --record
```

An initial Windows/Node 24 run took about 15 ms to import/initialize the adapter,
27 ms for the first 138-case batch and 9.3 ms warm median over seven repeats.
The benchmark records CPU, Node, samples and source/output hashes. These are
local software measurements, not universal speed or physical-print claims.

The follow-up twisted-fixture run passes full-fill, planar-infill and draped
generation/export/interpretation for both native splines and the user's original
Rhino STL. Prepared-geometry warm median slice times were approximately
0.35/0.61/17.82 s for spline full/planar/draped and 1.17/1.34/2.02 s for that STL,
three repeats per mode. Different draped coverage remains a backend limitation,
so these are not equal-output surface-speed claims. Results are ignored local
data in `.local/intersection-slicing/`. The public STL import/adjust/development
generation workflow also passes all three modes; a cold CLI reopen verifies the
last export. No job approval or physical validation was performed.

### Geometry query boundary

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

`PathBuilder.travelTo` is the shared travel method for full-fill, planar-infill,
draped-skin, vase-wall and the bounded wedge. The builder updates the highest
deposited Z from both endpoints of every emitted positive-volume segment,
including prime lines, sloping strokes and previous components. Travel without
deposition never raises this material height. The initial material height is
bed Z=0; pre-existing objects or fixtures are not modeled.

Lifted traverses use `max(depositedMaxZ + process.liftMm, fromZ, toZ)`.
`liftMm` is clearance in millimeters: **1 mm by default, with zero allowed**.
Future strokes and unselected geometry do not raise current travel. The endpoint
floor avoids descending before traversing from a higher startup/park position or
toward a higher destination. Cooling and final SAAMpath parking use the same
height calculation. Required clearance above the selected tool's Z bounds is
rejected. Existing recipes retain their explicit locked clearance value.
Compose all results together so one builder carries chronology across skills;
the wedge retains its bounded eight-point generator and delegates motion to it.
Machine firmware service routines (including H2D shutdown) retain their separate
export contracts; they are not ordinary SAAMpath travel.

Nearest wall starts, alternating infill and verified combing reduce travel.
The shared scanline fill completes disconnected components and splits each
connected component into uninterrupted runs of rows at interval splits/merges.
This also orders the sides of holes and concavities, rather than crossing each
hole on every row. Full-fill, planar-infill, draped-skin and the bounded wedge
use the same scanline implementation. Ordering changes neither row endpoints
nor deposition coverage; connections still use the shared travel checks.

Stroke starts within 1 mm use direct non-extruding repositioning without a new
retraction, lift or detour when the material/surface policy permits it, even
when the longer combing budget is lower. A short distance does not permit
crossing an opening or bypassing an earlier operation's clearance restriction.
No plastic is added to these gaps. Vase-wall's continuous stroke has no internal
stroke-start travels; its transitions still pass through the shared builder.

The shared PathBuilder merges consecutive forward collinear moves with the same
speed, volume per length and semantic metadata. A fixed line anchors each run
within the numerical plane tolerance (0.0000001 mm), so successive small turns
cannot accumulate into curve flattening. It sums deposited volume and retains
the endpoint. Corners, reversals, process/flow changes, operation/layer/role
boundaries and intervening retraction/fan/dwell actions remain explicit. All
skills use this writer; variable-gap/surface samples remain separate when their
flow or metadata changes. This compacts SAAMpath before any machine export,
not just the displayed path.

Mesh sections remove numerical triangle seams with `cleanPlanarLoop` before
offsetting. The distance bound is the existing 0.0000001 mm plane tolerance,
tested against every original point in the replacement span; it does not use
an angle cutoff or accumulate successive local simplifications. Closed contours
retain winding, corners and reversals. Full-fill/planar-infill also clean offset
deposition contours at that tolerance, while retaining the offset kernel's region
output for booleans. No curve-resolution or Clipper precision setting is relaxed.

The shared S5/H2D motion emitter establishes XYZ/feed state on first use, then
omits unchanged fields. Retractions update the same modal feed state. E remains
explicit with the selected absolute/relative convention. The interpreter checks
the final commands; regression tests compare their coordinates and volume with
the generator's transient motion objects.

Planar combing checks boundary crossings and standoff, then can route around
holes via a bounded visibility graph (256 offset corners, `maxCombMm` route
length); otherwise it hops. Earlier operation queries can forbid combing.
Drape retains its own local surface query for direct moves. These conservative
policies are not a full swept-head collision or support model. The wedge retains
its bounded nearby/direct policy; its lifts use the shared deposited height.

## Planar-infill design

[Planar-infill](skills/planar-infill/SKILL.md) supplies walls and rectilinear,
grid, triangles, concentric or gyroid interiors. Full-fill `mode: solid-surfaces` supplies
local top/bottom solid masks by comparing neighboring sections. Sparse/solid
interiors are complementary; walls have one owner and each layer's supporting
operations precede the next. The shared region booleans now handle coincident
sections and collinear edges. Drape reservation clips both planar patterns.

The 20-layer box regression verifies three solid bottom/top layers, fourteen
sparse layers, and one set of walls per layer across both backends/machines.
A sloping roof regression checks local solid regions. Bridge optimization remains
unimplemented; solid beads above sparse infill are
an approximate deposition model, not validated physical bridges.

The infill callback returns open/closed interior strokes to the same full-fill
producer; closed concentric interiors retain fill ownership. Solid-surface
settings, masks, drape reservations and consumed lower surfaces are unchanged.
The existing level-set contour joiner now indexes segment starts spatially,
preserving its distance tolerance, tie order and closed-loop output. A 48 mm
square gyroid construction over 16 phases at 0.2 mm sampling measured 24.60 s
before and 1.18 s after in this checkout; mean line-volume fraction was identical
(20.52% for requested 20%). This measures contour construction/clipping only,
not full bundle generation, export or Studio. The manual owns pattern limits.

## Assigned support design

[Supports](skills/supports/SKILL.md) owns explicit sacrificial footprints and tree
skeletons. [D-025](DECISIONS.md#d-025--support-areas-assigned-through-judgment)
prohibits whole-part angle-based support assignment. The maker/agent records
selected contacts and reasons in `skills.supports.assignments`; generation
constructs only those assignments. Local section queries test the assigned
geometry against the chosen part clearance; they do not select support areas.
Overlaps between assignments are unioned; walls, sparse interiors and interface
interiors have distinct owners. An optional `sectionAt` callback lets this
producer reuse full-fill without pretending sacrificial geometry is native CAD.

These bed-rooted, same-tool supports use the shared layer grid, planar machine
capability, travel, cooling, composer, export-only bundles, Studio and three
approvals. They are independent of part `composition.regions` and may coexist
with regional recipes. Required support layers precede atomic part operations
using their highest deposition Z, including nonplanar operations, rather than
assuming scheduling rank is physical height. This does not prove head clearance,
branch printability or physical contact. The current tree geometry is explicitly
authored circular branches, not Bambu's automatic routing algorithm. Supports
on the model and curved contact surfaces remain unimplemented for these two styles.

### Rimming support specification

User description, 2026-09-10 in the infill/support task. Initial implementations:
[rimming-planar](skills/rimming-planar/SKILL.md) and
[rimming-normal](skills/rimming-normal/SKILL.md). Their manuals own actual limits.
A rimming support applies to a selected edge or edge portion. Its reference
geometry is a bivariate spline surface: the top boundary matches the supported
edge, the base boundary rests on the bed or on another selected edge, and side
boundaries complete the surface. Top and base edges may curve; a slightly curved
base is generally preferred for strength. The base may lean away to avoid other
part geometry. Staying less than roughly 45 degrees from vertical is guidance,
not a numerical gate or check.

Two extrusion paths lie 0.5 and 1.5 line widths outward from the reference
surface, away from the part. For 0.4 mm beads this makes an approximately
0.8 mm solid wall with its inner material boundary on the reference surface,
sharing the exact supported edge. Do not silently apply conventional support's
top separation gap. The user describes supported edges as bridge anchors: a
vertical barbell can use an edge of its lower end as the base of a rim reaching
the lower edge of its upper end, enabling a bridge across that upper end.
This is the requested process behavior, not physical validation.

The user chose both offset metrics as separate skills for comparison. The shared
`core/geom/support-surface.mjs` authors an open, nonrational, uniform-clamped
bivariate spline and uses existing native sectioning. `core/region/section-offset.mjs`
offsets its sections horizontally or along the full normal with adaptive chord
refinement. This extends shared ambient section offsets; it is distinct from the
existing intrinsic/geodesic region offset on a surface. The current control net
must rise strictly in V for the section refinement's bracketed height solves.
No lean-angle threshold is imposed.

“Reference slice” was agent shorthand, not a new geometry object: a horizontal
intersection curve on the original unoffset surface. Using those curves as the
starting family was an implementation choice, not required by the user's initial
surface definition. Normal offsets can alter Z. Subsequent user instructions
establish whole-edge dependencies for both skills: every part of the base edge
prints before any rim starts; the whole rim finishes before anything it supports
starts. Among ready operations, keep heights similar across all mixed skills.
Horizontal boundaries are the degenerate case of these same rules. The shared
composer prefers lower maximum actual deposition Z, respecting dependencies and
selected batches. The rimming producer conservatively binds base operations
crossing the base control edge's height range and all named supported-component
operations; see the manual for single-part binding and atomic-operation limits.
Within each rim, inner/outer pairs retain increasing original section height.
This does not split continuous operations or optimize intra-rim path families.
Height shifts are reported, not silently repaired. Reference edges are assigned by the agent;
arbitrary CAD edge matching, continuous top trimming, self-intersection cleanup
and a proof of physical contact/clearance remain unimplemented. Edge assignment
stays judgment-based under D-025, with the existing three approvals.

## Machine interoperability design

`core/machine/profile.mjs` validates selected tool bounds, nozzle/core, filament,
material temperatures, flow/retraction and required skill capabilities. Profiles
own setup defaults; remembered setup is separate per machine. Skills target
compatible XYZ extrusion machines through this interface. Planar skills require
`planar`; drape and vase-wall additionally require `nonplanar` and a declared angle limit.
`checkMachinePath` remains available to developer tests; production checks run
on interpreted export commands, including selected-tool bounds, feeds and flow.
Dobot uses this shared function on commands reconstructed from Lua. Wedge uses the same profile validation and its bounded
eight-point generator, with S5, experimental H2D and configured Dobot output.

| Profile | Skill checks | Declared export and review |
|---|---|---|
| UltiMaker S5 | Fill, planar-infill, drape and bounded vase-wall on mesh/splines; bounded wedge | Griffin exporter/interpreter, same-file Studio review/delivery. |
| Bambu H2D | Fill, planar-infill, drape and bounded vase-wall on mesh/splines; bounded wedge | Experimental sliced-3MF exporter, checked firmware envelope and print-body interpreter; same-file review/delivery. |
| Dobot MG400 | Shared fill, planar-infill, drape, vase-wall and bounded wedge paths with synthetic configured installation checks | Experimental Lua source ZIP and bounded interpreter; same-file review/delivery. Setup is unconfigured by default; vendor project import is unverified. |
| DENSO VP-6242 / RC8 + rotary | Native pipe body/cladding plus fixed-orientation mesh/spline regional skills and bounded wedge, with synthetic setup | Experimental PacScript source ZIP and bounded interpreter; same Studio/lifecycle. Actual rotary/calibration and vendor execution unresolved; feasibility deferred. |

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
selected tool, plus optional part-frame tool orientation and an unwrapped rotary
angle. Existing XYZ-only adapters reject pose-bearing paths rather than discard
their orientation. New dialects need adapters; in-program tool changes and other
unsupported semantics need explicit representation extensions.
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
`rank` for ordering within a height batch, and `after` dependencies. Rank is a scheduling
coordinate, not universally Z: planar fill uses layer height. Operations also
provide strokes (3D points, speed, role, and either uniform bead area or per-segment
volume/metadata) and travel-policy queries. Existing `clearanceFor` queries
constrain combing against previous operations; legacy operation `clearanceZ`
metadata does not set lifted travel or cooling height. An operation is
atomic; expose smaller operations when within-layer interleaving is permitted.
These runtime results are not separate machine files or a persisted preview
format. Travel policies may contain geometry-query callbacks.

`core/path/compose.mjs` is skill-independent. It topologically orders operations,
rejects duplicate IDs, missing dependencies and cycles, and uses stable result
order to break ties. Plan `composition` contains `batchLayers` (1–20), `order`
(an optional ordered subsequence of operation IDs), and `dependencies` (additional
`{before, after}` edges), plus optional material `regions` described below. Ready
operations are grouped by maximum actual deposition Z to keep skill heights
similar. Batch size 1 alternates compatible results at each height; size 2 gives
AA–BB for two results with matching layers. Rank breaks ties within a result's
height batch. This preference never splits atomic continuous operations. Explicit ordering
and dependencies can interleave operations within a layer. They cannot remove a
skill's prerequisites. The agent proposes these choices before plan approval;
generation executes the locked rules without a new planning or approval stage.

One PathBuilder owns the resulting travel/retraction state, and the composer
finishes cooling once after all operations assigned to a shared layer. Hops
clear all material deposited so far, including travel from a taller batched
column toward a lower one. This is not a full
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
standoff, sampling and point-budget limits. Turn-to-turn bead overlap is a
geometry/process judgment for the agent and maker, not a generation gate.

### Material regions and shared interfaces

`composition.regions` assigns skills to regions of native geometry. An empty
array retains the original whole-component recipe. Each assignment carries
`id`, `part` (null for a single component), `zStartMm`, nullable `zEndMm`,
`skills` and nullable `lowerSurfaceFrom`. Heights are relative
to the component's minimum Z. The skill map selects the skills and holds partial
setting overrides; it resolves against the other settings locked in that plan.
It supersedes global enabled flags. Regions own selection and height bounds;
overrides cannot independently change those fields.

`core/print/regions.mjs` resolves those assignments through the existing skill
generators. Full-fill can own separate base and cap regions; planar-infill and
full-fill solid-surfaces can share complementary material in another region.
Assignments retain their component layer grid and dependencies. Conflicting
ownership, unassigned height boundaries, unknown references and cycles are rejected.
Bridging over hollow or sparse material is a process choice assessed in the
recipe and Studio, without a permission flag or automated span-support gate.
The retired `supportPolicy` field is accepted but ignored in older recipes;
new recipes omit it. Where a drape crosses a void, its initial volume uses the
assigned supporting components' layer grid, as in whole-component composition;
this is a bead-volume approximation, not a claim of deposited material in the void.

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
settings and surface references. Tests and fixture calibration never authorize hardware.

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

The Griffin/H2D modal reader has no arbitrary program-size cutoff. It walks
lines incrementally rather than splitting the entire program into a line array;
the shared reader also accepts an iterable of text chunks and preserves machine
state, CRLF handling and source line numbers across chunk boundaries. Every
command still passes the same checks, including commands after the former
25-million-character boundary. This is incremental parsing, not a fully streamed
bundle: generation, retained playback moves and
browser transfer still use memory proportional to the job.

The former 64 MB ZIP policy is also removed. H2D and Dobot keep the declared
ZIP32 container and integrity checks (CRC, member ranges, declared decompression
length, names and exact expected package contents). Its actual 32-bit member
size/offset boundary remains: a member or offset requiring ZIP64 is unsupported
and reported explicitly. No printer capacity is inferred from these software
checks. Programs/archives remain subject to available runtime memory; chunked
artifact writing and paged playback are further work if measurements require
them, rather than a reason to force smaller parts or lower print quality.

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

The pinned start/end arrays originate in the reference's executable blocks.
On 2026-09-10 the user requested removal of startup triage item H10: initial X
homing, the early wiping-area moves and `M972 S24`, then the `M1009`-bracketed
Z-clearance/center-positioning/Z-homing sequence. Machine revision 4 uses
`h2d-02.08.02.61-pla-textured-v2` with exactly those 13 lines removed. Adjacent
object/bin checks and all later probing, calibration and priming remain; this
is not a no-probing startup. The revised sequence requires physical testing.
The adapter still recognizes the pinned v1 envelope in existing snapshots;
upgrade and regenerate a chosen bundle to use v2, with normal plan/toolpath
review invalidation. Existing exports and delivery files are not rewritten.
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

On 2026-09-10 the user reported that their observed S5 startup differs from the
listed template behavior; the exact file and extra actions are not yet identified.
Absence of explicit leveling or unused-heater commands is not proof that the
Griffin firmware skips those actions. Retained bundle snapshots and delivered
bytes can also predate the current profile. Diagnose the actual file and printer
behavior before claiming that the earlier observation applies to this run.

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

### DENSO RC8 output contract

The user authorized the [pipe-cladding implementation](skills/pipe-cladding/SKILL.md)
and confirmed RC8. The [VP-6242 profile](machines/denso-vp6242-rc8.json) represents
a six-joint arm plus one external rotary; the printing task's position/direction
control is not a claim that the robot has only five joints. Ceiling mounting
with J1 coaxial with the rotary is provisional. At a chosen outward radius the
robot reaches down from its base, bends its elbow and tilts its wrist to bring
the nozzle to the wall. The rotary can bring every azimuth to that working side,
reducing the arm's need to sweep around the pipe. Small radii near the base axis,
large radial/vertical distances and extreme wrist orientations can still be
inaccessible or singular. No single cylindrical reach envelope establishes
feasibility. Operator judgment and the configured RC8 handle these limitations
for now; SAAM does not solve IK, check reach/joint/motion limits or avoid collisions.
Profile bounds are display/design coordinates, not enforced robot reach.

The shared motion representation has optional `initialPose` and per-move `pose`:
`rotaryDeg` is unwrapped, `toolAxis` is tool Z toward extrusion, and `toolUp` is
tool Y. Unit/perpendicular vectors define orientation without Euler ambiguity.
Points and directions are in part coordinates; rotation about `rotaryCenterMm`
maps them into the stationary room. Installation translation/yaw maps that room
to a calibrated RC8 Work frame with Z parallel to the bed axis. Ceiling mounting
belongs in the controller's calibrated frames; no guessed base height or arm
geometry is inserted. Machine setup owns start pose, transforms, IO and controller
selectors. The first implementation wires this through `setup.denso`; a second
oriented machine should extract that configuration mapping behind the existing
profile interface rather than fork skills or the workflow.

The existing composer receives point-aligned `poses`, preserves their authored
order and passes them to the shared builder. Nearest-stroke reordering currently
rejects oriented strokes because arbitrary reversal/closed-loop rotation would
also have to transform pose and winding data. The scheduler itself is unchanged:
explicit predecessor edges order the complete substrate and each radial shell.
Fixed-axis skills imply the downward pose and zero bed angle; their existing
process slope limits still apply. Pose-only motion survives emission and oriented
moves are not coalesced. Prescribed tool retreat, reorientation, relocation and
approach are shared transitions, with nonextruding on-surface indexing between
adjacent axial tracks. These are authored travel policies, not solved clear routes.

The `denso-pacscript` output is a ZIP of `main.pcs`, included helper `.pcs` sources
and a machine/setup identity manifest. It is not a complete WINCAPS project.
The exporter uses literal `Move L, @0 T(x,y,z,ox,oy,oz,ax,ay,az,figure)` with
relative `EX((axis,delta))` and requested `Time` milliseconds. `TakeArm`,
`ChangeTool`, `ChangeWork`, `Set/Reset IO` and off-state `Delay` form the rest of
the bounded source subset. Helpers cap source blocks at 2,000 statements;
installed compiler/project limits are not verified. The source must be added
to a correctly configured WINCAPS III RC8 project and compiled/transferred there.
RC8 solves Cartesian IK using its installed tool/work definitions and figure.

All installation selectors start unresolved. The implemented rotary interface
is explicitly `rc8-relative-ex`, requiring a configured RC8 extended joint.
Axis 7 is a provisional slot, not evidence the user's bed is installed there.
An independent rotary controller needs an execution adapter with synchronization.
Start position/pose and rotary zero must already match the manifest/setup; the
program does not home or position the system before printing. Heating is external.
The relay model matches Dobot's distinction between commanded material intent
and duration-times-rate estimates. No metered E axis, retract, fan or temperature
control is invented. Constant relay flow cannot guarantee the intended varying
bead volume, particularly near tapered ends, speed changes and endpoint stops.

The same browser-safe interpreter reads the actual T, EX, TIME and IO commands
from the checked ZIP. Comments supply process identity and volume intent only,
never playback coordinates. It reconstructs deposition relative to the bed,
including a fixed-room TCP tracing a curve during multiple rotary revolutions.
Studio defaults to a rotating bed/material view; **Follow build plate** uses
the same data with a stationary part. The nozzle is shown without invented
joint animation. Playback assumes synchronized linear Cartesian/rotary progress
at external speed 100%; actual interpolation, acceleration, override, endpoint
stops and IO latency are unverified. `@0` makes this an experimental segmented
execution model, even where planned geometry is continuous. Software checks
report that bounded source contract and do not claim axis-feed, reach or
collision validation. Vendor compilation, coordinated execution and physical
printing remain open commissioning work.

Interoperability is shared at geometry storage, ordinary section/offset/boolean
tools, full-fill/concentric substrate generation, operations, motion, output
registry, exact-source Studio, approvals, cold reopening and delivery. The new
radial skill is restricted to a native circular pipe aligned with the rotary;
general CAD cylindrical recognition and radial material-region interfaces are
not implemented. A later general cylinder query or radial region descriptor can
replace that bounded recipe check without introducing another composer.
Tests include the existing mesh/spline base-vase-cap-infill-drape stack at fixed
orientation on RC8, bounded wedge and ordinary pipe geometry on S5.

Primary technical references used for this experimental command contract:

- [DENSO VP specifications](https://www.denso-wave.com/en/robot/product/five-six/vp.html).
- [RC8 Provider Guide: position types and motion options](https://www.fa-manuals.denso-wave.com/subfolder/en/usermanuals/img/001511/RC8_ProvGuide_en.pdf).
- [DENSO TIME motion lesson](https://www.denso-wave.com/ja/robot/support/learning/d-learning/lesson3/l3-1/modals.html).
- [DENSO RC8 extended-joint option](https://support.densorobotics.com/en/support/solutions/articles/60000698512-extended-joint-option-for-rc8-rc8a).
- [DENSO RC8 source extension guidance](https://www.denso-wave.com/ja/robot/support/learning/d-learning/faq/ja/Robot_Controller/RC8/faq005.html).

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
Deposition is checked too, not just non-extruding travel. The wedge already uses the shared XYZ travel builder with its documented
bounded direct-move policy; general collision queries remain proposed.

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
