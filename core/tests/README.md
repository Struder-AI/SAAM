# Development tests

`request-index.test.mjs` covers warm operational queries with 1,000 historical
records, external changes, full history, lease activity and late tour choices.
`studio-generation-control.test.mjs` covers real worker cancellation/retry, the
before-save cancellation boundary and compact approval/delivery updates.
`file-write.test.mjs` covers concurrent temporary-file isolation, bounded Windows
sharing-conflict retries and preservation of prior contents on permanent failure.

Use [Avoid check spirals](../../DEVELOP.md#avoid-check-spirals) to decide whether
verification is needed. This reference locates coverage and describes useful test
design; it adds no verification pass. Commands and source paths in code spans are
relative to the repository root.

## Runtime setup and CI

The [agent CLI toolkit](../agent/README.md) has focused integration coverage in
`agent-toolkit.test.mjs`: bundled context, fresh tour startup, recipe/STL previews,
saved-export preservation, request coordination and partial failures. Manual
access and MCP request transport remain covered by their existing test files.

First-use capability is checked by [setup](../../SETUP.md); repeat only when a
relevant dependency or environment changes or fails. A new task or print is not
a new environment.

The [CI workflow](../../.github/workflows/test.yml) provides the required
`test` status through `npm run setup:check` on each fresh Linux pull-request
runner, with manual dispatch and no duplicate push run. The full regression
suite is available locally and is not an automatic CI gate. Branch protection
is repository administration; workflow commands are ordinary source.

Before publication, obtain only missing, applicable verification evidence for
the change and any required branch checks. Reuse successful local results while
their relevant inputs remain unchanged; publication does not require a new local
run. A fresh CI runner still performs its own setup. Fix locally detectable
failures within the selected scope before publication.

## Worthwhile tests

`material-travel.test.mjs` covers local planar/surface obstacles, thin crossings,
holes and disconnected regions, descending travel, curved comb detours and
per-edge collision checks. `travel.test.mjs` retains planar routing and global
lift-height compatibility; draped-skin and curved-text tests exercise producers.

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

Examples to build from: [analytical and independent geometry](geometry.test.mjs),
[upstream intersection references and an independent cell oracle](intersection.test.mjs),
[changed-input cache reuse](program-cache.test.mjs), and
[bounded manual-link fixtures](mcp-access.test.mjs). Their assertions
demonstrate the failure they protect against without requiring an extra checklist.

## Test registry

[Vase motif tiling](../../skills/vase-wall/tests/motif.test.mjs) covers compact
single-cell recipes, exact cell/course joins, tilt before mapping, guide-side
placement, changing host sections, course progress, authoring-form changes and
checked S5/H2D/configured Dobot output. Existing
[mapped-path tests](../../skills/vase-wall/tests/paths.test.mjs) retain advanced
authored-path, regional, sleeve and review coverage.

[Curved text composition](../../skills/text/tests/draped-text.test.mjs) covers
four draped glyph layers above a native wavy roof, holes and disconnected glyphs,
support-derived first-bead volumes, ordering, machine-command preservation and
missing or intersecting support. Regional planar start-height checks remain in
[regions.test.mjs](regions.test.mjs).

[Text interoperability](../../skills/text/tests/interoperability.test.mjs) covers
geometry approval across pattern changes, disjoint raised/engraved ownership,
translated assembly selections, retained standalone references, atomic feature
and region edits, legacy records and whole-solid side lettering. The main
[text suite](../../skills/text/tests/text.test.mjs) also checks imported mesh
reference retention and source hashes.

[Heat-set tests](../../skills/heat-set-inserts/tests/heat-set.test.mjs) cover
catalog-sized blind bores, six local loops independent of global settings,
reserved interior material, sparse/solid composition, translated assembly and
regional generation, and insert edits beneath text. The accompanying
[MCP test](../../skills/heat-set-inserts/tests/mcp.test.mjs) covers discovery,
revision checks, retained settings and removal through the public adapter.

Tour speed regressions cover current-byte production reuse and stage progress in
[program-cache.test.mjs](program-cache.test.mjs), step-4 preparation in
[studio-tour.test.mjs](studio-tour.test.mjs), edit generation and completion in
[studio-tour-ui.test.mjs](studio-tour-ui.test.mjs), and compact material-buffer
equivalence across chunk boundaries in [studio-material.test.mjs](studio-material.test.mjs).
Request-target publication, pause/resume identity and stale-response merging live
in the Studio work/agent-UI tests. The open tests check that ordinary review and
unconfirmed generation start no slicing worker. Reconnect tests also exercise
metadata-only tour updates without stopping playback; tour-UI tests cover missing
or unavailable start-layer fallback and generation waiting for published edits.
These are software checks; real agent response latency requires a timed tour pass.

`read-scope.test.mjs` instruments application filesystem calls and motion copies:
one selected manual, discovery without geometry/exports, export-free edits and
geometry fingerprints, direct request lookup, malformed-record isolation and
machine-study polling. It also checks that changed export bytes remain rejected.
Tour tests cover fresh runs, cancellation of teaching on lesson changes, and the
absence of a resume route; individual edit cancellation retains the live tour.
`studio-tour-lifetime.test.mjs` covers reconnect continuity, end-of-grace shutdown,
fresh startup after reopening and isolation from observer/older-owner shutdown.

[studio-view-readiness.test.mjs](studio-view-readiness.test.mjs) exercises ordinary
geometry confirmation through rendered toolpath acknowledgement and activity
settling. [studio-playback-cache.test.mjs](studio-playback-cache.test.mjs) covers
Back/Continue and same-print reopen reuse, plus invalidation on changed inputs.
[studio-import.test.mjs](studio-import.test.mjs) covers worker responsiveness,
failed-import cleanup, selection preservation and tour generation recovery.
[chat-geometry-confirmation.test.mjs](chat-geometry-confirmation.test.mjs) covers
shared, CLI and MCP evidence binding and stale confirmation rejection. Tour
recovery tests cover both confirmation inputs, same-lesson return, geometry-only
edit completion and waiting-state visibility.

Shared line spacing is covered by [spacing.test.mjs](spacing.test.mjs):
all seven producers, density and solid-mask independence, sparse surface
composition, curved and mesh cladding, plan review and exact-byte delivery.
Opposite-handed cladding is covered by
[crossed-cladding.test.mjs](crossed-cladding.test.mjs), including
surface charts, rotary direction, export/review and material preview.
Finished-boundary interoperability is covered by
[finished-cladding.test.mjs](finished-cladding.test.mjs): unchanged
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
| `core/geom/`: spline evaluation, sections, prepared mesh section index, height queries, STL/mesh input | [geometry.test.mjs](geometry.test.mjs), [mesh.test.mjs](mesh.test.mjs), [mesh-boundary.test.mjs](mesh-boundary.test.mjs) | Affected skill tests; pipeline and regional tests for shared query changes |
| Exact mesh cleanup, CGAL patch repair, bounded hole filling, source preservation and geometry chunks | [mesh-repair.test.mjs](mesh-repair.test.mjs), [mesh.test.mjs](mesh.test.mjs), [mesh-large.test.mjs](mesh-large.test.mjs) | Shared STL import and unapproved S5/H2D bundles |
| `core/geom/polyline.mjs`: numerical contour seams before offsets and deposition | [contour-cleanup.test.mjs](contour-cleanup.test.mjs) | Mesh sections, full-fill and planar-infill |
| `core/region/offset.mjs`, Clipper normalization and offset compatibility | [offset.test.mjs](offset.test.mjs), [offset-junctions.test.mjs](offset-junctions.test.mjs), [offset-remnants.test.mjs](offset-remnants.test.mjs) | Fill, infill, drape, vase and wedge consumers as affected |
| `core/region/perimeters.mjs`: coincident closed wall fronts | [perimeters.test.mjs](perimeters.test.mjs) | [perimeter-wall.test.mjs](../../skills/full-fill/tests/perimeter-wall.test.mjs) covers full-fill, planar-infill, solid masks and S5/H2D export |
| `core/region/surface-offset.mjs`, surface derivatives | [surface-offset.test.mjs](surface-offset.test.mjs) | [Wave overhangs](../../skills/wave-overhangs/tests/wave.test.mjs) exercises constrained growth, physical spacing and surface composition |
| `core/region/intersection.mjs`, closed planar booleans | [intersection.test.mjs](intersection.test.mjs) | Infill masks, reservations and regional composition |
| `core/region/region2d.mjs`, `core/path/builder.mjs`: scanline cells and closest-entry ordering, segment-preserving reversal | [scanline-cells.test.mjs](scanline-cells.test.mjs), [geometry.test.mjs](geometry.test.mjs) | Full-fill, line-based planar-infill and draped-skin |
| `core/path/`: travel, combing, deposited height, move coalescing | [travel.test.mjs](travel.test.mjs), [straight-moves.test.mjs](straight-moves.test.mjs), [interoperability.test.mjs](interoperability.test.mjs) | Affected skill paths, composition and machine round trips |
| `core/path/compose.mjs`: scheduling, weaving and joins | [composition.test.mjs](composition.test.mjs) | Pipeline and regional workflow |
| Material regions, reservations and consumed surfaces | [regions.test.mjs](regions.test.mjs), [assembly-reservation.test.mjs](assembly-reservation.test.mjs), [reservation-surface.test.mjs](reservation-surface.test.mjs), [regional-workflow.test.mjs](regional-workflow.test.mjs) | Infill, drape and vase composition |
| `core/print/plan.mjs`, generation and machine compatibility | [pipeline.test.mjs](pipeline.test.mjs), [interoperability.test.mjs](interoperability.test.mjs) | Affected skill and machine tests |
| `core/print/workflow.mjs`, bundles, approvals, reopening and exact delivery | [workflow.test.mjs](workflow.test.mjs), [program-cache.test.mjs](program-cache.test.mjs), [regional-workflow.test.mjs](regional-workflow.test.mjs) | Wedge lifecycle, machine-specific delivery and MCP callers |
| `core/export/griffin.mjs`: S5 templates, G-code interpretation | [export.test.mjs](export.test.mjs) | Pipeline and wedge Griffin round trips |
| Shared modal G-code fields and final-export checks | [modal-export.test.mjs](modal-export.test.mjs) | S5/H2D, wedge, cold bundle reopening |
| Nonblocking short-travel advisories, complete trip endpoints and bounded evidence | [travel-advisory.test.mjs](travel-advisory.test.mjs), [program-cache.test.mjs](program-cache.test.mjs), [studio-open.test.mjs](studio-open.test.mjs) | S5/H2D interpretation, saved-source reuse, listener deduplication and unchanged approval/delivery |
| `core/export/bambu.mjs`, H2D profile and ZIP output | [bambu.test.mjs](bambu.test.mjs) | [h2d.test.mjs](../../skills/wedge-demo/tests/h2d.test.mjs) |
| `core/export/`: streamed G-code lines and chunk-boundary errors | [gcode-stream.test.mjs](gcode-stream.test.mjs) | Griffin/H2D interpretation and ZIP consumers |
| Large move counts and G-code/ZIP size boundaries (explicit stress run) | [stress/large-export.test.mjs](stress/large-export.test.mjs), [stress/large-program.test.mjs](stress/large-program.test.mjs) | `npm run test:stress`; real former size and call-stack boundaries |
| Dobot profile, Lua export/interpreter and relay behavior | [dobot.test.mjs](dobot.test.mjs), [robot-playback.test.mjs](robot-playback.test.mjs) | [dobot.test.mjs](../../skills/wedge-demo/tests/dobot.test.mjs), vase and regional machine coverage |
| Nominal MG400 FK/IK | [dobot-kinematics.test.mjs](dobot-kinematics.test.mjs) | Shared Studio model coverage |
| Shared machine presentation providers, constrained jogging, nominal DENSO model and read-only study source/bundles | [machine-presentation.test.mjs](machine-presentation.test.mjs), [machine-jog.test.mjs](machine-jog.test.mjs), [machine-study.test.mjs](machine-study.test.mjs) | Source-time playback, actual-source transport and Studio machine-view checks |
| VP-6242 / RC8, oriented/rotary motion, native pipe cladding and both Studio frames | [denso.test.mjs](denso.test.mjs) | Shared mesh/spline regional skills, wedge, composition, browser source and exact-byte lifecycle |
| Periodic spline tube, selected surface charts, normal-offset cladding and partial courses | [surface-cladding.test.mjs](surface-cladding.test.mjs) | Native spline/bore, explicit mesh strips, three-perimeter interaction, RC8 lifecycle, bead orientation and ZIP32 helper counts |
| `studio/`: camera, display detail, mesh visibility, playback and offline movies | [studio-camera.test.mjs](studio-camera.test.mjs), [studio-detail.test.mjs](studio-detail.test.mjs), [studio-visibility.test.mjs](studio-visibility.test.mjs), [studio-geometry.test.mjs](studio-geometry.test.mjs), [studio-material.test.mjs](studio-material.test.mjs), [studio-movie.test.mjs](studio-movie.test.mjs), [robot-playback.test.mjs](robot-playback.test.mjs) | Wedge playback; browser inspection when visual behavior changes |
| Studio settings, server and saved-print opening | [studio-settings.test.mjs](studio-settings.test.mjs), [studio-open.test.mjs](studio-open.test.mjs), [studio-lifetime.test.mjs](studio-lifetime.test.mjs), [studio-tour-ui.test.mjs](studio-tour-ui.test.mjs), [studio-reconnect.test.mjs](studio-reconnect.test.mjs) | Viewer lifetime/owner isolation, workflow, regional workflow and machine-specific Studio delivery |
| Studio active-work dots and viewport fade, prepared results, overlapping requests and interruption | [studio-work.test.mjs](studio-work.test.mjs), [studio-agent-ui.test.mjs](studio-agent-ui.test.mjs), [studio-agent.test.mjs](studio-agent.test.mjs) | MCP request coordination; tour readiness and completion cues |
| Studio machine-source transport, browser interpreters and compact local drawing data | [source-player.test.mjs](source-player.test.mjs) | S5/H2D/Dobot source identity, timeline/layer equivalence, stale requests, workflow and exact delivery |
| Studio machine primitives, source alignment, unavailable/stale poses and per-mode cameras | [studio-kinematics.test.mjs](studio-kinematics.test.mjs), [studio-movie.test.mjs](studio-movie.test.mjs) | Shared provider conformance; browser inspection of ghost, machine and reference frames |
| `adapters/mcp/`: stdio tools, shared import/setup, CLI access and bounded manual/section reading | [mcp.test.mjs](mcp.test.mjs), [mcp-access.test.mjs](mcp-access.test.mjs) | One lifecycle per transport/output shape; synthetic manual-link fixtures and unresolved robot setup |
| `scripts/bench/`: analytical fixtures and mesh convergence | [benchmark-fixtures.test.mjs](benchmark-fixtures.test.mjs) | Performance measurements remain opt-in; see benchmark instructions |
| Full-fill generation | Shared geometry, travel and pipeline tests as affected | [full-fill.test.mjs](../../skills/full-fill/tests/full-fill.test.mjs) |
| Plastic-weld reservations, sealed infill envelopes, injection order/volume, operation temperatures, mesh/region composition and reviewed delivery | Shared composition, modal export, regional workflow and source-player tests | [weld.test.mjs](../../skills/plastic-weld/tests/weld.test.mjs) |
| Planar infill patterns, open clipping, solid masks and sparse/drape composition | Shared booleans, scanlines and reservations as affected | [infill.test.mjs](../../skills/planar-infill/tests/infill.test.mjs), [patterns.test.mjs](../../skills/planar-infill/tests/patterns.test.mjs) |
| Explicit conventional/tree supports, interfaces and support-before-part ordering | Pipeline, workflow, regional and machine tests as affected | [supports.test.mjs](../../skills/supports/tests/supports.test.mjs) |
| Bivariate support surfaces, horizontal/normal section offsets and rimming composition | Shared geometry, plan, workflow and machine boundaries | [rimming.test.mjs](../../skills/rimming-planar/tests/rimming.test.mjs) covers both rimming skills |
| Draped skin, normal spacing, slope exclusion and support | Shared surface/reservation and pipeline tests as affected | [draped-skin.test.mjs](../../skills/draped-skin/tests/draped-skin.test.mjs) |
| Vase wall, contour correspondence including expanding sections, topology, offset rounding, budgets and level ending; repeated sleeve motifs, inward tilted loops, continuous/segmented mapping and bead-height integration | Regional composition, travel, Studio settings and machine tests as affected | [vase.test.mjs](../../skills/vase-wall/tests/vase.test.mjs), [paths.test.mjs](../../skills/vase-wall/tests/paths.test.mjs) |
| Bounded eight-point wedge geometry, generator and lifecycle | Shared travel, export and workflow tests as affected | [eight-point.test.mjs](../../skills/wedge-demo/tests/eight-point.test.mjs), [wedge.test.mjs](../../skills/wedge-demo/tests/wedge.test.mjs), H2D/Dobot wedge tests above |
| Skill catalog, generated digest freshness and coverage | [skill-digest.test.mjs](skill-digest.test.mjs) | MCP catalog tests when shared discovery changes |
| [gridfinity](../../skills/gridfinity/SKILL.md) | | [gridfinity](../../skills/gridfinity/tests/gridfinity.test.mjs), [gridfinity](../../skills/gridfinity/tests/access.test.mjs) |
| Text outlines, circular/Bezier layout, top-surface/independent references, solid modifiers and editable geometry | [text-layout.test.mjs](text-layout.test.mjs); MCP integration for `apply_text` | [text.test.mjs](../../skills/text/tests/text.test.mjs): analytical material volume, counters, spline conversion, curved text, persistence and generation |
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

[Demo workspace checks](demos.test.mjs) verify unapproved creation and protection of existing work.
