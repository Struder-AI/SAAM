# Build requests

Track concrete development work here. Decisions belong in [DECISIONS.md](DECISIONS.md);
terms belong in [GLOSSARY.md](GLOSSARY.md). Implementation status is not approval status.

## Initial refresh scope — historical snapshot, 2026-09-08

Authorized by remettub on 2026-09-08: finish a clean refreshed repository, commit,
and push a new `refresh` branch directly to `Struder-AI/SAAM`.

| Build now | Document now | Defer |
|---|---|---|
| New local map viewer and source-anchor checks | Maker/developer routing and glossary | Rhino runtime integration |
| Dependency-free repository checks and CI | Decisions and three-approval workflow | SAAMpath encoding and generation |
| Clean repository skeleton and local Prints exclusion | Skill-package guidance and machine-output vocabulary | Process-plan schema and manufacturing skills |
| Preserve legacy working files locally; remove them from the active tree | Rhino/3DM direction and print-bundle contents | Studio's geometry/program viewers and a real print |

Legacy reference: commit `54093cadbe87020836916d53dd29a45a06bf5528`.
Working-folder archive destination: `../SAAM-legacy-20260908/legacy-reference/54093cadbe870/`.
Archive scope: old adapters, interfaces, machines, operations, registry, schemas,
tests, examples, docs/architecture, docs/authoring, ROADMAP.md, package.json and
package-lock.json. Preserve all contents by moving those named paths; do not
touch personal `Prints/` or `.saam/`. Following remettub's clean-folder
clarification, the archive, old `node_modules/` and earlier `.local/fill-review/`
work are preserved outside SAAM in the sibling archive directory. Keep
licenses/notices and update developer entry documents. No legacy runtime is adopted.

## BR-001 — Local architecture map

- Status: complete locally
- Requested by: remettub, 2026-09-08, restart conversation R3
- Build: A new local map viewer with a maker-flow view and a project view; selection details, source links, drag/pin layout, and a focus view.
- Verify: Real document anchors, clearly labelled proposed/unimplemented nodes, saved layout, working navigation, no legacy runtime adoption.
- Location: `.local/architecture-map/` (ignored by Git).
- Verified: Two views, 16 source anchors, node selection, cross-view navigation, search, focus, light/dark themes, and dragged positions surviving browser reload.

## BR-002 — Simplify restart terminology and guidance

- Status: complete
- Requested by: remettub, 2026-09-08, restart conversation R3
- Build: Maker-agent vocabulary, glossary, three approvals, direct generation from the locked plan, skill packages, local Prints, and concise developer documentation.
- Verify: Consistent current documents; superseded decisions preserved in the log.

## Initial foundation verification — historical snapshot

The old implementation is removed from the active tree. All 114 archived files
were checked against their original SHA-256 hashes. No legacy runtime was adopted.
The new `npm test` checks document links, decision metadata, and private-file
exclusions, including that curated examples remain visible to Git. CI runs it
on pushes and pull requests. These checks do not validate manufacturing behavior.

## BR-003 — Resolve native path versus machine file

- Status: resolved
- Source: R3 refers to both a native-format path and an output toolpath in a print.
- Result: R4/R5 establish SAAMpath as the internal representation, with a separate export using an output option in the machine file. Encoding and bundle layout were open at this point; see DEVELOP.md for the implemented formats.

## BR-004 — Rhino geometry integration

- Status: wedge integration implemented; general integration deferred
- Direction: remettub selected Rhino; use 3DM as native geometry. The earlier kernel comparison is closed.
- Result needed: Choose and test the Rhino integration method, preserve spline surfaces and feature references, and establish runtime/install/licensing requirements.
- Wedge result: pinned rhino3dm creates a capped extrusion and six named NURBS reference surfaces; 3DM round-trip tests pass. General spline intersections and edited-file import remain deferred.

## BR-005 — First complete print

- Status: software demo implemented; physical print pending
- Result needed: One specified printer/material/nozzle, geometry edit, three approvals, direct generation, automated checks, same-file preview/delivery, and save/reopen of the print bundle.
- Depends on: BR-003, BR-004, and selection of the first printer/setup.
- Current implementation: BR-007 supplies the S5 wedge workflow. Each job requires three actual print approvals; software tests do not complete a physical print. Standard S5 startup is assumed without requiring firmware identification.

## BR-006 — SAAM Studio interaction and export interpretation

- Status: bounded S5 demo implemented; general interpreter deferred
- Result needed: Shared geometry references and a viewer that interprets the actual export, including its helper files and declared machine state. Detect unsupported behavior before review; tie approval to the reviewed version and invalidate affected approvals after changes.
- Proposed interaction: Click-to-select geometry with shared labels; compare a feature tree and screenshot markup during usability testing. See [developer proposals](DEVELOP.md#studio-feature-references).
- Verify: A novice can identify a feature, request an edit, approve the three stages, and reopen the print. The delivered export is byte-identical to the reviewed export.
- Current result: named face selection, geometry/process editing, three version-bound approvals, exact Griffin export playback, save/reopen, and byte-identical delivery tests. Novice usability and physical validation remain pending.

## BR-007 — S5 inclined-wedge demo

- Status: implemented locally; physical validation pending
- Source: user in the S5 wedge conversation, 2026-09-08: "looks good, go ahead". Setup clarified as AA 0.4, right nozzle #2, PLA at 215°C.
- Build: S5 machine definition; Rhino wedge; horizontal solid-fill body; 15° inclined skin; SAAMpath; Griffin export; software checks; local Studio and print bundle.
- Clearance scope: user explicitly said "Don't worry about clearance for this one. I'll make sure it clears." Physical head collision checking is deferred for this demo; bounds, motion and extrusion checks remain.
- Verify: generation, native geometry round trip, supported-command interpretation, temperature/flow/bounds checks, deterministic export, stale-approval invalidation and byte-identical delivery. No real approval is fabricated and no printer is started.
- Job inputs: actual geometry, locked-plan and toolpath approvals. Bed temperature and other defaults are proposed recipe values until plan approval. Firmware identification and startup verification are optional metadata.

## BR-008 — Root developer and maker guidance

- Status: complete locally
- Source: user correction during the S5 wedge conversation, 2026-09-08.
- Result: consolidate developer rules and development notes into root DEVELOP.md; move maker guidance to root MAKERS.md; remove docs/ and update active references. Unspecified agents default to developer for now, and every developer reads both root files.
- Approval scope: this records the user's development instruction, not an inferred contributor decision approval.

## BR-009 — Accessible chat-driven review and wedge refinement

- Status: implemented locally; physical validation remains pending.
- Source: user in the S5 wedge conversation, 2026-09-08.
- Result: concise geometry → settings → toolpath review, chat-only recipe edits with automatic viewer updates, playback speed selector, adjustable sloped-layer count, 0.2 mm nominal layers, alternating sloped strokes and alternating flat-layer traversal.
- Historical travel policy: every horizontal move lifted to the full part maximum plus 2 mm. Later wedge work added direct nearby travel; the current manual owns that behavior.
- Setup: remove installed-firmware approval requirement; assume standard S5 startup, resolve concrete questions in chat, and remember setup locally for later prints.
- Guidance: MAKERS.md owns the review/revision flow and setup conversation; DEVELOP.md documents implementation and setup persistence; the wedge manual documents adjustment tools.

## BR-010 — Split the wedge patterns into general skills

Historical result at completion; Studio/delivery limitations below were replaced by BR-011.

- Status: implemented locally; untested beyond software checks
- Requested by: remettub, 2026-09-08: split the wedge skill in two, a "full fill"
  skill doing the first pattern for any shape, and a non-planar top surface skill
  doing the final pattern for any shape, limited by a max-nonplanar-angle machine
  setting (15 degrees for the S5). Also: improve on the wedge's travel moves, and
  leave the wedge skill as it is.
- Naming and behavior chosen by remettub during the work: the second skill is
  `draped-skin`; surface steeper than the limit is excluded from the skin and
  reported rather than rejecting the job.
- Geometry scope agreed in the same conversation: closed breps of untrimmed
  bivariate spline surfaces. Intersections between several such solids are
  computed at the toolpath, not as boolean geometry. Running a Rhino Compute
  server was rejected.
- Build: `core/` slicing core (patch evaluation, plane sectioning, planar regions
  and booleans, top-surface height field, travel planning, SAAMpath, Griffin
  export, plan and preview CLI); `skills/full-fill/`; `skills/draped-skin/`;
  `nonplanar.maxAngleDeg` in the S5 machine file.
- Verified in software: 29 tests covering evaluation against rhino3dm, sections
  and offsets and booleans against analytic areas, closure rejection, degenerate
  cuts, the surface height field, travel and lift behavior, exclusion of
  over-limit surface, strict export interpretation, determinism, and detection of
  an edited export.
- Not verified: no physical print, no Studio integration, no approval or delivery
  workflow, and no maker agent has used either skill end to end. Multi-solid
  geometry is implemented in the region core but not reachable from a plan.
  Contour completeness rests on a rigorous bound for cells with no sign change
  and a sampling check elsewhere, bounded by `minFeatureMm`.
- The wedge skill was left unchanged, as requested.

## BR-011 — Make full-fill, draped-skin and the core usable

Historical result at completion; later shape additions and shared lifecycle are recorded below.

- Status: implemented locally; untested beyond software checks
- Requested by: remettub, 2026-09-08: "We need to be able to use the drape and
  fill skills and the geometry core." Scope confirmed in the same conversation
  as the full maker workflow, at parity with the wedge, leaving the wedge alone.
- Build: `core/print/geometry.mjs` (native 3DM of the shell's named untrimmed
  surfaces, verified by reopening and rebuilding the closed shell, plus a display
  proxy); `core/print/bundle.mjs` (print bundle, plan lock over geometry/machine/
  runtime, chat adjustment, generation modes, three approvals, delivery);
  bundle commands in `core/print/cli.mjs`; Studio serving either kind of bundle,
  selected by the schema in `plan.json`, with a viewer that reads the part's
  shape from the display proxy.
- Verified in software: `core/tests/workflow.test.mjs` — 3DM round trip and
  rejection of a substituted file, development generation creating no approvals
  and refusing delivery, three synthetic approvals with stale-view rejection and
  byte-identical delivery, the approvals each edit invalidates, remembered setup
  reuse, one-skill plans, and Studio review and delivery of a shell print. The
  wedge's own tests, including its Studio test, still pass unchanged.
- Not verified: no physical print, no maker agent has used either skill end to
  end, and no usability testing. Geometry is still limited to the plan's shapes
  (`box`, `wedge`, `spline-top`); importing or editing a 3DM remains deferred,
  as does multi-solid input, which the region core supports but no plan can
  express.
- The wedge demo package was left unchanged. Studio, which is not part of that
  package, became bundle-agnostic. The available plan shapes now include
  `spline-shell` through BR-012.

## BR-012 — Spline-sided shell plan shape

- Status: implemented locally; untested beyond software checks
- Requested by: maker, 2026-09-08: expose spline side support through the
  geometry core rather than limiting spline geometry to the roof.
- Build: `spline-shell` adds a closed shell with a control-point-grid roof and
  four untrimmed ruled spline side patches. The plan exposes symmetric
  `longSideInsetMm` and `shortSideOutsetMm` parameters, validates the flared
  bounding box against printer placement, and shows the taper in Studio.
- Verify: geometry closure and every sampled horizontal section; both slicing
  skills generate from the locked shape and report excluded over-limit tapered
  surfaces. No physical print or clearance validation has been performed.

## BR-013 — Vertical spline-side shell

- Status: implemented locally; untested beyond software checks
- Requested by: maker, 2026-09-08: keep the walls vertical while bulging them
  outward along X and inward along Y, with a stronger domed roof.
- Build: `vertical-spline-shell` uses the same spline footprint for the base
  and roof, so its ruled side patches are vertical. It exposes `xBulgeMm` and
  `yInsetMm`, supports a 4 × 4 roof control grid, and validates its X bulge
  against printer placement.
- Verify: matching roof/base XY points, equal body sections at distinct heights,
  closed-shell checks, locked-plan generation and Studio presentation. No
  physical print or clearance validation has been performed.

## BR-014 — Experimental per-print non-planar override

- Status: implemented locally; untested beyond software checks
- Requested by: maker, 2026-09-08: test a 45° draped-skin path without changing
  the S5 machine file's declared 15° limit.
- Build: `maxAngleDegOverride` is an explicit draped-skin plan setting. It
  changes only that print's effective survey/generation limit, while checks and
  Studio show both the 15° profile declaration and the experimental override.
- Boundary: it creates no approval, delivery or machine action, and does not
  establish physical clearance or deposition behavior at the override angle.

## BR-015 — Consolidation, interoperability and general operation weaving

- Status: implemented; software verification recorded in the associated tests
- Requested by: user in the repository assessment conversation, 2026-09-08.
- Scope: fix documentation drift; make parallel pipelines exceptional and normally
  require prior user agreement; establish interoperability as an ideal with justified
  exceptions; remove standalone shell preview; share G-code generation and the
  bundle-to-delivery lifecycle; enable generalized weaving of skill results.
- Clarification: weaving applies to compatible skill operations, including separate
  full-fill instances. Supporting body fill must complete before draped-skin. A
  two-column/spanning-roof example motivates alternation and AA–BB batching but
  does not define or limit the generic composer.
- Implementation: machine-owned program templates; one exporter/interpreter;
  adapter-based shared lifecycle; one bundle in development and production modes;
  operation results with layers/surfaces, dependencies, deterministic order and
  batching; assembly component selection through the existing shell plan.
- User observation: the last S5 wedge change achieved no routine bed leveling and
  no unused-nozzle heating. Preserve that header/startup/shutdown behavior. Earlier
  first-layer under-extrusion was reported; complete physical validation is open.
- Verify: exact S5 envelope regression, strict temperature/modal/numeric checks,
  shared workflow tests for both adapters, generic composition and same-layer order,
  batch clearance, support-before-roof rejection, and woven bundle delivery.
- General mesh input, automatic overlap/support inference, and physical bridge or
  collision validation are not implemented. Developer details live in DEVELOP.md.
- Approval scope: this records the user's implementation instruction and observation;
  it does not infer either contributor's approval of new decision wording.

## What should earn adoption next

Recommend proving one complete print before adding a catalog of operations.
The value to test is whether SAAM reduces setup, clarification and recovery work
compared with the same agent using existing CAD and slicing tools. Extra agent
instructions alone are not enough. Test repeatable generation, useful machine
checks, shared geometry references, and review of the exact delivered program.
This is a proposed evaluation direction, not a claim of implemented advantage.

## BR-016 — Printing and geometry design for review

Historical design snapshot; implementation progress and remaining work are in BR-017.

- Status: design documented; implementation pending review.
- Requested by: user, 2026-09-09, this repository task; explicitly scoped to “Design and requirements for me to review. Let's keep it lean.”
- Documentation completed: README now owns the introduction and product direction; PROJECT_CHARTER is a compatibility pointer. Developer guidance explains node_modules and routes skill authors to shared requirements.
- Task: Add planar-infill (suggested name): wall count, sparse alternating rectilinear infill, travel reduction and combing. Reuse full-fill for solid top/bottom masks with one layer grid and no duplicate walls/material. Include local top/bottom detection and bridging/support limits.
- Task: Centralize whole-plan maximum-height clearance for lifted travel, cooling and parking; preserve verified joined/combed moves and test cross-skill obstacles and machine bounds.
- Task: Make mesh native part geometry (D-021); add validated ASCII/binary STL import with locked units and conversion tolerances. Adapt full-fill and draped-skin to shared geometry queries; preserve the bounded wedge exception and one export/review lifecycle.
- Task: Add a Bambu H2D machine profile and general machine interoperability. Move S5-specific setup validation out of shared plan code. Declare machine/tool/material capabilities and supported outputs; keep machine behavior out of pattern skills. Implement the H2D-compatible exporter/interpreter and packaging needed for the exact reviewed artifact, using verified machine documentation or a user-supplied known-good program for the intended configuration.
- H2D scope to resolve before implementation: target nozzle/tool and material setup, firmware/output packaging, startup/shutdown behavior and machine limits. Do not copy the S5 Griffin envelope or assume an H2D profile alone enables support. No hardware execution is requested.
- Verify: equivalent geometry across backends, material ownership, travel limits, deterministic generation, profile-specific setup rejection and supported machine-program interpretation. Exercise both machine profiles through the same skills, three approvals and exact-byte delivery. Report software checks separately from physical printing.
- Design: [geometry](DEVELOP.md#geometry-interoperability-for-skill-authors), [travel](DEVELOP.md#whole-plan-travel-requirement), [planar-infill](DEVELOP.md#planar-infill-design), [machines](DEVELOP.md#machine-interoperability-design).
- Approval scope: records requested work, not contributor consensus or manufacturing-job approval. Existing runtime remains unchanged.

## BR-017 — Implement interoperability first, then planar infill and import

- Status: geometry/skill/machine interfaces, planar-infill and STL import implemented; H2D output completed as experimental software in BR-018.
- Source: user, 2026-09-09, this task: “the interoperability work should come first” and “finish out the task list”. User confirmed both geometry backends, H2D left 0.4 mm nozzle/PLA, and experimental 15° draping.
- Completed: shared mesh/spline queries, native mesh storage and ASCII/binary STL import with explicit units/source hash; geometry validation and mixed assemblies; machine-owned defaults/capabilities and separate remembered setups; selected-tool bounds and machine-independent SAAMpath checks; H2D profile with official source references; output-adapter dispatch with explicit unsupported-output rejection.
- Completed: whole-plan lifted travel and cooling, bounded comb routes around holes; planar-infill with walls/density; full-fill solid-surface masks and single wall ownership; local top/bottom regions, drape reservation and dependencies; common booleans handle coincident boundaries and close level sets at their domain boundary.
- Completed: README/charter consolidation, maintained skill manuals and shared authoring guidance; Studio shows the actual machine, mesh dimensions, sparse/solid settings and unavailable output status. Wedge remains bounded and S5-only.
- Software verification: both backends × S5/H2D × full-fill/drape/planar-infill, material/setup rejection, wedge exception, mesh holes/islands/invalid input, changed STL source, mixed assemblies, whole-plan clearance/cooling, comb routing, sparse density/solid-layer ownership, S5 native mesh review/delivery and preservation of the prior S5 envelope. Tests create no real approvals or hardware actions.
- Remaining at this checkpoint: H2D exporter/interpreter plus sliced-3MF packaging; addressed in BR-018 using the supplied reference exports. A profile/SAAMpath pass alone does not claim output compatibility.
- Physical validation remains open for every new skill/profile. General trimmed CAD import, rotary/tool-changing SAAMpath extensions, automatic supports and bridge optimization are outside this implementation.

## BR-018 — H2D output from the supplied nozzle references

- Source: user-supplied right-nozzle `example.gcode.3mf` and left-nozzle `wedge.gcode.3mf`, 2026-09-09; this continues BR-017. Checkpoint `48e4e8c` preserves the earlier implementation before this work.
- Status: experimental H2D output implemented through the shared lifecycle. One selected 0.4 mm nozzle, PLA, Textured PEI and no chamber heat; left remains default, with both nozzle maps covered by software tests.
- Completed: pinned firmware start/end contract, explicit print-body handoff, whole-plan shutdown clearance, shared modal interpretation, deterministic sliced-3MF packaging with fresh metadata/thumbnails/checksums, binary artifact hashing/reopening, Studio review and exact-byte delivery. No reference object or private project is copied into generated files or Git.
- Verification: 89 passing software tests; both nozzle maps, three skills and mesh/spline paths, invalid temperatures/tool bounds, corrupt ZIP, altered envelope/metadata/body, synthetic approvals and HTTP archive delivery. Independent Python ZIP/CRC, XML, JSON and MD5 checks passed. Existing S5 behavior is retained. Bambu Studio's CLI model-import check rejected both sliced reference and generated files with -6; program-viewer import acceptance is unconfirmed.
- Boundary: firmware service routines are matched to a fixed contract, not simulated. Print-body time/material excludes those routines. No physical validation or hardware execution. See the [H2D contract](DEVELOP.md#h2d-output-contract) for exact scope and remaining validation.

## BR-019 — H2D wedge and Studio reopen/activity

- Source: user, 2026-09-09, requested H2D wedge support, opening previous local prints and visible activity while toolpathing/exporting. Clarified that only SAAM bundles are opened, retaining current approvals and going straight to a ready toolpath.
- Implemented: the bounded wedge uses S5/H2D profile setup, tool bounds and shared output; H2D left/right software round trips, unretracted firmware handoff, sliced-3MF review and exact archive delivery. Geometry/generation remain in the wedge package.
- Implemented: Studio local bundle picker and folder/file path opening, version-bound approval retention, ready-toolpath playback, stale-program rejection, failed-open recovery and old-tab mutation rejection. Opening changes no saved print files or approvals.
- Implemented: accessible busy banner during load, generation/export/checks and delivery, duplicate-action blocking, error cleanup and reduced-motion styling.
- Verification: automated H2D wedge and Studio reopening regressions alongside the existing suite. No physical printing or fabricated job approval.
- Collision avoidance options are a requested design review, not authorization to adopt a robotics library or implement a second pipeline.
- Physical finding and correction, 2026-09-09: the user's first H2D run reached
  the part, then showed severe over-extrusion on flat layer two. The H2D body had
  incorrectly used cumulative `M82` extrusion although the supplied Bambu Studio
  reference uses relative `M83`. H2D emission now uses relative per-move E values;
  S5 retains its Griffin `M82` contract. Software regression is required before
  a corrected export is reviewed, and physical retesting remains open.

## BR-020 — Eight-point wedge with a planar roof

- Source: user, 2026-09-09, this task: generalize to any eight-point set with an axis-aligned rectangular base and vertical corner pairs; use mesh and “limit to a flat roof”. Follow-up requests Studio with the original H2D wedge, tall side left, six skins and doubled printing speeds.
- Implemented: unordered point input, base translation, coplanarity and total-slope validation; native eight-vertex/twelve-triangle mesh with named faces; body half-plane clipping and roof rastering for either axis, diagonals and level roofs through the existing wedge generator and shared export/review lifecycle.
- Printing-speed targets use machine XY limits rather than the former demo-only caps, with material-flow and Z-speed limits still applied to actual moves. Doubling deposition targets gives 40/20/24 mm/s for flat/skin/first-layer; travel and other process settings remain separate.
- Explicit older-bundle upgrade verifies native geometry, converts to eight-point mesh and requires fresh geometry review; old native, export and delivery bytes are retained. New mesh bundles do not require Rhino computation or 3DM storage.
- Verification covers all slope quadrants, level roofs, six parallel skins, volume, travel height, mesh identity, malformed inputs, explicit migration and S5/H2D export round trips. No contributor consensus, job approval or physical print validation is implied.

## BR-021 — Selective local MCP, Dobot and vase-wall adoption

- Source: user, 2026-09-09, legacy-adoption session. Authorized restoration of MCP access, Dobot machine/Lua support and vase-wall through the reset's interoperable shared workflow. The subsequent single-location clarification defers automatic discovery; see [D-022](DECISIONS.md#d-022--defer-automatic-capability-discovery).
- Implemented: a local SDK stdio MCP adapter with fixed known profiles/manuals, persistent named Prints, revision-checked adjustments, shared checks and Studio review, fresh approval status, approved generation and exact-byte delivery. It has no approval tool, alternate compiler/review server or global plan overwrite. Local client setup is documented; arbitrary browser-chat access and automatic client configuration are not implemented.
- Implemented: Dobot profile and bounded Lua export/interpreter using the same SAAMpath, native geometry, three human approvals and delivery. Installation defaults remain unconfigured. The selected CP=0 relay policy stops at each segment and reports estimated material separately from intended bead volume. Delivered ZIP packages source files; vendor project import, controller execution and physical behavior are unverified. See [Dobot scope](DEVELOP.md#dobot-output-contract).
- Implemented: [vase-wall](skills/vase-wall/SKILL.md) queries actual changing-Z sections on supported mesh/untrimmed spline geometry, optionally above a full-fill base, through the common composer and export lifecycle. It requires one supported convex outer section without holes/islands and enforces bounded standoff, overlap, angle and sampling checks. Other unsupported topology and trimmed CAD remain outside its scope.
- Verification: final `npm test` passed all 131 software tests and repository checks. Coverage includes Lua semantics/rejection, shared skills and bounded wedge, both geometry backends, S5/H2D/configured Dobot paths, actual SDK subprocess clients, current approval binding, stale revisions/artifacts and exact reviewed-byte delivery. All approval/calibration fixtures are explicitly synthetic in temporary bundles; no physical validation is claimed.
- Excluded by the user: legacy gusset and layer-filling adoption. Requested recovery of the earlier twisted cellular annular print and tilted-loop wall was not resolved by searching the available Git refs and unreachable commits. An earlier private repository is a lead for the user's follow-up with the other developer; no implementation or authoritative component name is recorded. Do not turn these descriptions into a speculative pattern roadmap.
- Follow-up source clue: the other developer suggested “textured or patterned wall”. Searches for those terms in messages, historical diffs and archives found no implemented match. `f015cf1:ROADMAP.md` calls vase/spiral-wall strategies the private source project's most-developed pattern family, strengthening that source lead; this does not identify either sample or establish that its source was lost.
- Approval scope: this records authorized work and implementation status, not either contributor's unstated agreement or a real manufacturing-job approval. Further legacy adoption still requires specific authorization.

## BR-022 — Same-part skill composition correction

- Source: user, this legacy-adoption session: full interoperability between ecosystem components wherever possible, including same-part skill composition. Acceptance example: flat base/vase wall, flat cap, normal walls/infill to a wavy roof, drape, then full fill above the drape with a wavy bottom. User confirmed that final fill uses horizontal layers.
- Implemented: shared material-region assignments, per-region skill settings, component layer grids, material ownership/dependencies, level vase ending with tapering final-turn deposition, and producer-bound lower surfaces for subsequent horizontal fill. The existing skill generators, geometry, SAAMpath, exporter and three-approval lifecycle remain shared.
- Corrected audit findings: spatial roof reservation no longer truncates unrelated taller components; first drape gap uses actual supporting layers including translated geometry; numerical mesh-top roundoff no longer drops a valid final layer. Consumed surfaces and their coverage/order are checked instead of inferring compatibility from skill names. Fully reserved bodies are rejected, and inward offsets collapse thin remnants instead of allowing acute miters to escape the source material.
- Corrected workflow gaps: shared remembered-default/STL-import helpers, MCP import/upgrade/setup/path-check/guidance tools, safe nested print names matching Studio, geometry bounds in MCP summaries, CLI revision guards and consistent geometry-only checks. Studio shows effective regional settings, surface references, support choices, pattern settings, dependencies and robot calibration/workspace parameters.
- Verification: final `npm test` passes all 156 software tests and repository checks. Includes the requested stack across S5/H2D/configured Dobot and mesh/spline geometry, per-move exported coordinates/material, the complete regional spline/S5 synthetic approval/Studio/exact-delivery workflow, spatial reservations, offset remnants, surface coverage and access parity. Studio's regional settings were also checked in the browser with a software-only fixture. The full suite took about six minutes; the user deferred broader speed work to the next cycle.
- Remaining boundaries: supported height-field surfaces, bounded numerical section/gap sampling, vase convex sections and continuous-stroke chronology, explicit experimental bridging, and actual machine output constraints. Dobot's fixed-rate relay cannot meter arbitrary variable bead volumes; commanded intent and modeled relay output remain separate. No blanket assertion that every physical combination is printable, no automated support/collision proof, and no physical validation is implied.

## BR-023 — Slicing performance baseline

- Requested by: user, 2026-09-09. Start the speed cycle with equivalent spline/mesh tests, use a twisted box and multiple slicing skills, compare planar slicing with Cura/Bambu Studio, and recommend subsequent optimizations/diagnostics.
- Implemented: opt-in reproducible developer benchmarks over shared geometry queries, full-fill, planar-infill, draped-skin, composition, machine checks and export/interpretation; analytical fixture checks, Rhino 6 exchange files, sampled mesh convergence, STL precision diagnostic, serial repeats and phase/failure reporting. Commands, boundaries and findings are in [slicing speed benchmarks](DEVELOP.md#slicing-speed-benchmarks).
- User reference: standard Rhino-exported STL (1078 triangles); Cura 4.12 reported 14 seconds to load and 2.3 seconds to slice with two walls and 100% infill. Loading and slicing are separate, and non-planar work is excluded from the Cura comparison.
- Findings: direct spline section/height queries are slower than modest meshes, but complete planar full-fill can be faster because mesh contours amplify downstream region work. The supplied mesh reveals an offset/index memory blow-up and a solid-mask boolean failure. Keep failures separate from successful timings; the test does not justify switching native geometry architecture.
- Boundary: developer measurements do not add a public twisted-box shape, create job approvals, demonstrate physical prints, or establish a controlled overall speed ranking against external slicers. Bambu Studio timing and matched public-workflow load/check/generation measurements remain next-stage work. Existing production geometry, skills and review semantics are unchanged by the benchmark additions.

## BR-024 — Remove vase heuristics and bridge permission policy

- Source: user, 2026-09-09, explicitly in developer mode. Remove the turn-overlap gate unless evidence establishes recurring slicing defects it catches; make compute-budget exhaustion obvious and easy to raise; explain tolerance coupling; treat level-ending selection and bridge feasibility as maker guidance. The earlier maker's bridge comment did not authorize changing skill policy.
- Implemented: removed the per-point previous-turn section/radial-overlap calculation and regional bridge-permission gates, including foundation-ring support coverage. Older `supportPolicy` fields are inert compatibility data. New recipes and Studio omit the policy. This supersedes BR-021's overlap gate and BR-022's experimental bridging restriction.
- Implemented: vase point budgets retain a 100000 default with no preset 200000 ceiling; exhaustion identifies usage, region, height and the setting to raise without degrading contour quality. Contour subdivision and numerical boundary allowances are separate settings; older recipes normalize their prior boundary allowances explicitly.
- Guidance: choose a level ending for a flat cap while proposing the recipe. Developer checks must justify their compute cost and false rejections with concrete failure evidence. Ask the user when a gate's value is ambiguous in toolpathing, geometry, extrusion or 3D printing; this reflects their stated expertise, not a blanket requirement to ask about every software check.
- Scope: shared region, skill, review and export pipeline; no new approvals, changed real-job geometry, physical validation or machine execution.
- Verification: all 165 repository software tests pass. The public path check also passes for a development copy of the full twisted house at 0.2 mm pitch, 0.02 mm contour tolerance and three cap layers, with 241074 wall points under a 400000 allowance and no bridge policy.

## BR-025 — Shared Clipper and surface offsets

- Source: user, this offset-function task. Adopt the trusted `ClipperComponents 0.3.2.0` offset identified in `offset.ghx`; keep the general intersection-engine decision separate. Build shared planar and surface offsets, migrate existing skill offsets, avoid repeated inverse mapping, and guide authors toward robust established algorithms with measured performance. Development checks were authorized with the existing cost guidance retained.
- Implemented: pinned Clipper 6.4.2 JavaScript port behind `core/region/offset.mjs`; upstream construction, winding/union cleanup and topology reused. Material-region semantics deliberately use closed polygons rather than the Grasshopper wrapper's closed-line band mode. Input normalization and Clipper's simple-loop cleanup handle nesting and point-touching components. Removed the previous offset/pruning/splitting implementation; compatibility export aliases the shared function.
- Integrated: full-fill, planar-infill, draped-skin's existing projected footprint, vase-wall, shared combing/rim coverage and the bounded wedge's section/roof insets. The wedge remains its eight-point generator. Runtime identity includes the adapter and installed Clipper source/lockfile. General intersection functions were not replaced.
- Implemented experimentally: `offsetSurfaceRegion` generates distance-based geodesic strips/round joins from a native spline patch, then uses actual Clipper union/difference/winding code for material topology. UV and cached XYZ correspondences stay attached; no inverse mapping or global flatten/warp round trips. Surface-distance code is new SAAM implementation, not a copy of Rhino's unavailable native routine. Single regular C2 patch, closed UV loops and bounded domain are the current scope; no skill silently adopts it.
- Evidence: the JavaScript adapter exactly matches every coordinate and loop in 90 cases generated by the unmodified plugin C# Clipper 6.4.2 kernel using the same material-region adapter options. Surface tests include analytic derivatives, flat nesting/collapse, inclined-plane UV rescaling, independent cylinder unrolling, and convergence of nested regions on a doubly curved patch. No Rhino surface-output comparison or physical validation has been performed.
- Diagnostic: the supplied 1078-triangle Rhino STL passes every full-fill layer in the offset diagnostic. Its separate solid-mask intersection still produces an open contour; that known failure is not hidden or fixed by adopting the offset.
- Guidance and measurements: [shared numerical foundations](DEVELOP.md#shared-numerical-foundations) and [offset contracts](DEVELOP.md#shared-offset-functions) record provenance, precision, limits, reference reproduction and opt-in timing. Baseline `npm test` passed 170 tests; final `npm test` passes all 180 tests and repository checks, including mesh/spline, S5/H2D/configured Dobot, public workflow and exact export/delivery regressions. The documented .NET reference project also builds successfully. No contributor consensus, human manufacturing approval, commit or publication is inferred.

## BR-026 — Temporary web-chat connection

- Source: user, 2026-09-09 local time, requested immediate ChatGPT and Claude web access to the existing implementation and a temporary locally run relay. See [D-024](DECISIONS.md#d-024--temporary-web-chat-access-to-the-existing-local-workflow); packaged applications remain deferred.
- Implemented: a Streamable HTTP/JSON bridge forwarding the existing MCP tools to one local adapter, OAuth SDK routes with local pairing, client-bound PKCE grants, expiring tokens/refresh rotation/revocation, and a launcher for an outbound temporary HTTPS tunnel. Studio, its approval routes and print files remain local.
- Verification: 180-test baseline passed; the final full run passes 182 tests. One existing stdio workflow test failed and the first full run stalled; that failure did not reproduce in its targeted rerun or the full rerun. SDK HTTP/OAuth tests exercise unauthorized access, origins/redirects, PKCE/replay/resource checks, rotation/revocation/expiry, two clients sharing state, retained Studio lifetime, approval gates with isolated synthetic fixtures, and exact-byte delivery.
- Public connection check: verified a temporary Cloudflare endpoint with OAuth/PKCE, 18-tool discovery and read-only maker guidance; unauthenticated MCP was rejected and the Studio approval route returned 404. No real print was changed. The user is driving their external browser; Claude reached the pairing page but reported "Invalid origin". Actual vendor connection acceptance remains pending.
- Browser pairing correction: reproduced the native form's `Origin: null` under `Referrer-Policy: no-referrer`. Switched to `same-origin` and allowed the SDK-validated callback origin in the authorization page's form policy, which Chromium also applies to the OAuth redirect. A disposable browser fixture now completes the form and cross-origin callback; absent, null and foreign origins remain rejected.
- Alpha onboarding follow-up: user chose an uploadable Claude plugin, prioritizing onboarding over ChatGPT's developer-mode connection test. The launcher now builds a ZIP containing the connector address and a maker skill that reads current guidance through MCP. The package excludes local credentials and files and does not install or start SAAM. Claude upload acceptance and actual tool use are still the user's external-browser test; a stable shared alpha service is not implemented.
- Follow-up verification: `npm test` passed before the pairing/plugin edits (191 tests) and afterward (195 tests in the concurrent working tree). The plugin CLI/archive regression, independent Python ZIP check and skill validation passed. Restarted the temporary bridge and verified public OAuth/PKCE, 18-tool discovery and read-only maker guidance again. The browser fixture completed a native form submission and cross-origin callback; real Claude plugin upload remains the next user-driven check.
- Limits: single installation, temporary credentials/URLs, same-computer Studio review and delivery, and tunnel/client timeouts for long calls. No packaged app, multi-user hosted service, automatic connector installation, hardware action or physical validation.

## BR-027 — Minimal shared Clipper2 intersection tool

- Source: user, 2026-09-09 local time, authorized building/testing a Clipper2-based tool, replacing existing skill operations when tests pass, and updating documentation. Scope shared components to current needs and extend them when necessary; consider CGAL only if the Clipper2 tests are insufficient.
- Implemented: closed planar material-region intersection, union and difference behind one small adapter to pinned `clipper2-wasm@0.4.0` (upstream C++ Clipper2 2.0.1). Existing shared imports route full-fill, planar-infill, draped reservations and regional composition through it. The handwritten general booleans were removed; established offset kernels and sampled section/level-set constructors retain their scope. No open-path, 3D, CAD, UV intersection API or alternative backend was added.
- Integration correction: accurate booleans exposed artificial corner gaps from coarse bead-coverage arc approximation. Coverage expansion now uses the existing 0.001 mm chord target instead of hiding gaps with area pruning. Runtime identity hashes the actual JS/WASM bytes. Tests compare decoded numeric areas within declared precision while retaining exact upstream reference comparisons.
- Evidence: 138 cases match unmodified upstream C# results exactly, including coordinates and topology; analytic/adversarial tests and 200 seeded rectangle-set cases pass. The original 1078-triangle Rhino STL passes every offset/solid-mask diagnostic layer. Full, planar and draped benchmark modes pass for both spline and that STL. The actual public STL importer, adjustment, development generation/export and cold CLI reopen also pass, with no human approvals or delivery.
- Guidance: [minimal component scope](DEVELOP.md#interoperability-and-one-workflow) and [intersection contract, provenance and reference reproduction](DEVELOP.md#shared-planar-intersections). No CGAL was needed, and no physical validation or contributor consensus is inferred.
- Verification: baseline `npm test` passed 182 tests; the final suite passes all 195 tests and repository checks. Includes S5/H2D/configured Dobot, both geometry backends, same-part skill composition, MCP/Studio synthetic approval workflows and exact-byte delivery. Development source changes remain uncommitted.

## BR-028 — Travel above deposited material

- Source: user, this travel task: use the current highest thing on the bed plus clearance; allow zero and default to 1 mm.
- Implemented: one shared `PathBuilder.travelTo` for full-fill, planar-infill, draped-skin, vase-wall and the bounded wedge. The wedge retains its eight-point geometry and nearby-start policy; shared motion replaces its duplicate travel/retraction implementation.
- Height follows both endpoints of each emitted positive-volume segment across the print, including prime lines and sloped strokes. Lifted travel, cooling and final SAAMpath parking use deposited maximum plus `process.liftMm`, floored at departure/destination height. Future strokes, unselected geometry and non-depositing lifts do not increase material height. New recipes default to 1 mm; existing explicit settings remain locked values.
- Updated skill/developer manuals, wedge runtime identity and H2D context validation so actual print-body height may be below unprinted geometry. H2D firmware service/shutdown heights retain their fixed export contract. Existing direct/combed policies remain; no fixture sensing or swept-head collision model is added.
- Verification: baseline `npm test` passed 195 tests; final suite passes 199 tests and repository checks. Regression coverage includes rising/falling strokes, within-operation chronology, taller-to-lower transitions, repeated cooling/parking, zero-clearance S5/H2D shell and wedge export round trips, unselected tall geometry, and the existing configured Dobot/public workflow checks. No physical validation or human manufacturing approval is implied.
