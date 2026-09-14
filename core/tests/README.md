# Development tests

Use [Avoid check spirals](../../DEVELOP.md#avoid-check-spirals) to decide whether
verification is needed. This reference locates coverage and describes useful test
design; it adds no verification pass. Commands and source paths in code spans are
relative to the repository root.

## Runtime setup and CI

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
| Explicit STL repair, winding reconstruction, spatial queries and collision-checked simplification | [mesh-repair.test.mjs](mesh-repair.test.mjs), [mesh.test.mjs](mesh.test.mjs) | Shared STL import and unapproved S5/H2D bundles |
| Volumetric fields, rational controls, local refinement, explicit extraction and persisted identity | [voxel.test.mjs](voxel.test.mjs), [voxel-refine.test.mjs](voxel-refine.test.mjs), [mcp.test.mjs](mcp.test.mjs) | Voxel task demo, shared slicing, mixed spline/field assembly and exact-byte lifecycle |
| `core/geom/polyline.mjs`: numerical contour seams before offsets and deposition | [contour-cleanup.test.mjs](contour-cleanup.test.mjs) | Mesh sections, full-fill and planar-infill |
| `core/region/offset.mjs`, Clipper normalization and offset compatibility | [offset.test.mjs](offset.test.mjs), [offset-junctions.test.mjs](offset-junctions.test.mjs), [offset-remnants.test.mjs](offset-remnants.test.mjs) | Fill, infill, drape, vase and wedge consumers as affected |
| `core/region/perimeters.mjs`: coincident closed wall fronts | [perimeters.test.mjs](perimeters.test.mjs) | [perimeter-wall.test.mjs](../../skills/full-fill/tests/perimeter-wall.test.mjs) covers full-fill, planar-infill, solid masks and S5/H2D export |
| `core/region/surface-offset.mjs`, surface derivatives | [surface-offset.test.mjs](surface-offset.test.mjs) | Experimental surface tool; no implicit skill adoption |
| `core/region/intersection.mjs`, closed planar booleans | [intersection.test.mjs](intersection.test.mjs) | Infill masks, reservations and regional composition |
| `core/region/region2d.mjs`, `core/path/builder.mjs`: scanline cells and closest-entry ordering, segment-preserving reversal | [scanline-cells.test.mjs](scanline-cells.test.mjs), [geometry.test.mjs](geometry.test.mjs) | Full-fill, line-based planar-infill and draped-skin |
| `core/path/`: travel, combing, deposited height, move coalescing | [travel.test.mjs](travel.test.mjs), [straight-moves.test.mjs](straight-moves.test.mjs), [interoperability.test.mjs](interoperability.test.mjs) | Affected skill paths, composition and machine round trips |
| `core/path/compose.mjs`: scheduling, weaving and joins | [composition.test.mjs](composition.test.mjs) | Pipeline and regional workflow |
| Material regions, reservations and consumed surfaces | [regions.test.mjs](regions.test.mjs), [assembly-reservation.test.mjs](assembly-reservation.test.mjs), [reservation-surface.test.mjs](reservation-surface.test.mjs), [regional-workflow.test.mjs](regional-workflow.test.mjs) | Infill, drape and vase composition |
| `core/print/plan.mjs`, generation and machine compatibility | [pipeline.test.mjs](pipeline.test.mjs), [interoperability.test.mjs](interoperability.test.mjs) | Affected skill and machine tests |
| `core/print/workflow.mjs`, bundles, approvals, reopening and exact delivery | [workflow.test.mjs](workflow.test.mjs), [program-cache.test.mjs](program-cache.test.mjs), [regional-workflow.test.mjs](regional-workflow.test.mjs) | Wedge lifecycle, machine-specific delivery and MCP callers |
| `core/export/griffin.mjs`: S5 templates, G-code interpretation | [export.test.mjs](export.test.mjs) | Pipeline and wedge Griffin round trips |
| Shared modal G-code fields and final-export checks | [modal-export.test.mjs](modal-export.test.mjs) | S5/H2D, wedge, cold bundle reopening |
| `core/export/bambu.mjs`, H2D profile and ZIP output | [bambu.test.mjs](bambu.test.mjs) | [h2d.test.mjs](../../skills/wedge-demo/tests/h2d.test.mjs) |
| `core/export/`: streamed G-code lines and chunk-boundary errors | [gcode-stream.test.mjs](gcode-stream.test.mjs) | Griffin/H2D interpretation and ZIP consumers |
| Large move counts and G-code/ZIP size boundaries (explicit stress run) | [stress/large-export.test.mjs](stress/large-export.test.mjs), [stress/large-program.test.mjs](stress/large-program.test.mjs) | `npm run test:stress`; real former size and call-stack boundaries |
| Dobot profile, Lua export/interpreter and relay behavior | [dobot.test.mjs](dobot.test.mjs), [robot-playback.test.mjs](robot-playback.test.mjs) | [dobot.test.mjs](../../skills/wedge-demo/tests/dobot.test.mjs), vase and regional machine coverage |
| Standalone split-delta kinematics, cylinder/track assessment, simulation source and nominal MG400 FK/IK | [split-delta.test.mjs](split-delta.test.mjs), [dobot-kinematics.test.mjs](dobot-kinematics.test.mjs) | Standalone browser inspection; existing Dobot/MCP profile checks |
| Shared machine presentation providers, constrained jogging, Tilty constraints, nominal DENSO model and read-only study source/bundles | [machine-presentation.test.mjs](machine-presentation.test.mjs), [machine-jog.test.mjs](machine-jog.test.mjs), [machine-study.test.mjs](machine-study.test.mjs) | Source-time playback, actual-source transport and Studio machine-view checks |
| VP-6242 / RC8, oriented/rotary motion, native pipe cladding and both Studio frames | [denso.test.mjs](denso.test.mjs) | Shared mesh/spline regional skills, wedge, composition, browser source and exact-byte lifecycle |
| Periodic spline tube, selected surface charts, normal-offset cladding and partial courses | [surface-cladding.test.mjs](surface-cladding.test.mjs) | Native spline/bore, explicit mesh strips, three-perimeter interaction, RC8 lifecycle, bead orientation and ZIP32 helper counts |
| `studio/`: camera, display detail, mesh visibility, playback and offline movies | [studio-camera.test.mjs](studio-camera.test.mjs), [studio-detail.test.mjs](studio-detail.test.mjs), [studio-visibility.test.mjs](studio-visibility.test.mjs), [studio-geometry.test.mjs](studio-geometry.test.mjs), [studio-material.test.mjs](studio-material.test.mjs), [studio-movie.test.mjs](studio-movie.test.mjs), [robot-playback.test.mjs](robot-playback.test.mjs) | Wedge playback; browser inspection when visual behavior changes |
| Studio settings, server and saved-print opening | [studio-settings.test.mjs](studio-settings.test.mjs), [studio-open.test.mjs](studio-open.test.mjs), [studio-lifetime.test.mjs](studio-lifetime.test.mjs) | Viewer lifetime/owner isolation, workflow, regional workflow and machine-specific Studio delivery |
| Studio machine-source transport, browser interpreters and compact local drawing data | [source-player.test.mjs](source-player.test.mjs) | S5/H2D/Dobot source identity, timeline/layer equivalence, stale requests, workflow and exact delivery |
| Studio machine primitives, source alignment, unavailable/stale poses and per-mode cameras | [studio-kinematics.test.mjs](studio-kinematics.test.mjs), [studio-movie.test.mjs](studio-movie.test.mjs) | Shared provider conformance; browser inspection of ghost, machine and reference frames |
| `adapters/mcp/`: stdio tools, shared import/setup, CLI access and bounded manual/section reading | [mcp.test.mjs](mcp.test.mjs), [mcp-access.test.mjs](mcp-access.test.mjs) | One lifecycle per transport/output shape; synthetic manual-link fixtures and unresolved robot setup |
| Temporary HTTP/OAuth bridge, Claude package and web probe | [mcp-http.test.mjs](mcp-http.test.mjs), [claude-plugin.test.mjs](claude-plugin.test.mjs), [web-agent-probe.test.mjs](web-agent-probe.test.mjs) | MCP stdio integration when shared tools change |
| `scripts/bench/`: analytical fixtures and mesh convergence | [benchmark-fixtures.test.mjs](benchmark-fixtures.test.mjs) | Performance measurements remain opt-in; see benchmark instructions |
| Full-fill generation | Shared geometry, travel and pipeline tests as affected | [full-fill.test.mjs](../../skills/full-fill/tests/full-fill.test.mjs) |
| Planar infill patterns, open clipping, solid masks and sparse/drape composition | Shared booleans, scanlines and reservations as affected | [infill.test.mjs](../../skills/planar-infill/tests/infill.test.mjs), [patterns.test.mjs](../../skills/planar-infill/tests/patterns.test.mjs) |
| Explicit conventional/tree supports, interfaces and support-before-part ordering | Pipeline, workflow, regional and machine tests as affected | [supports.test.mjs](../../skills/supports/tests/supports.test.mjs) |
| Bivariate support surfaces, horizontal/normal section offsets and rimming composition | Shared geometry, plan, workflow and machine boundaries | [rimming.test.mjs](../../skills/rimming-planar/tests/rimming.test.mjs) covers both rimming skills |
| Draped skin, normal spacing, slope exclusion and support | Shared surface/reservation and pipeline tests as affected | [draped-skin.test.mjs](../../skills/draped-skin/tests/draped-skin.test.mjs) |
| Vase wall, contour correspondence including expanding sections, topology, offset rounding, budgets and level ending; repeated sleeve motifs, inward tilted loops, continuous/segmented mapping and bead-height integration | Regional composition, travel, Studio settings and machine tests as affected | [vase.test.mjs](../../skills/vase-wall/tests/vase.test.mjs), [paths.test.mjs](../../skills/vase-wall/tests/paths.test.mjs) |
| Bounded eight-point wedge geometry, generator and lifecycle | Shared travel, export and workflow tests as affected | [eight-point.test.mjs](../../skills/wedge-demo/tests/eight-point.test.mjs), [wedge.test.mjs](../../skills/wedge-demo/tests/wedge.test.mjs), H2D/Dobot wedge tests above |
| Skill catalog, generated digest freshness and coverage | [skill-digest.test.mjs](skill-digest.test.mjs) | MCP catalog tests when shared discovery changes |
| [gridfinity](../../skills/gridfinity/SKILL.md) | | [gridfinity](../../skills/gridfinity/tests/gridfinity.test.mjs), [gridfinity](../../skills/gridfinity/tests/access.test.mjs) |
| Text outlines, independent references, solid modifiers and editable geometry | MCP integration for `apply_text` | [text.test.mjs](../../skills/text/tests/text.test.mjs): analytical material volume, counters, spline conversion, curved text, persistence and generation |
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
