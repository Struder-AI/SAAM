# Build requests

Start with [outstanding work](#outstanding-work), then read the request relevant
to the task. The records below preserve request sources and development evidence;
they are not a current capability catalog. The [component references](core/README.md)
and skill manuals describe the implementation. [DECISIONS.md](DECISIONS.md) owns direction
and contributor approval; implementation status is not approval status.

## Outstanding work

The relevant records own each item's remaining work and evidence:

- Slicing performance and repeated validation: [BR-039](#br-039--remove-repeated-validation-and-make-slicing-progress-truthful), with subsequent measurements in [BR-041](#br-041--complete-shared-clipper2-integration).
- Precision audit follow-through: [BR-040](#br-040--dimension-aware-precision-audit-and-developer-guidance).
- Matched slicer/public-workflow comparison: [BR-023](#br-023--slicing-performance-baseline).
- Novice workflow evaluation and a validated complete print: [BR-005](#br-005--first-complete-print), [BR-006](#br-006--saam-studio-interaction-and-export-interpretation) and [evaluation direction](#what-should-earn-adoption-next).
- H2D reference acceptance and corrected physical retest: [BR-018](#br-018--h2d-output-from-the-supplied-nozzle-references) and [BR-019](#br-019--h2d-wedge-and-studio-reopenactivity).
- Actual web-client pairing and Claude plugin acceptance: [BR-026](#br-026--temporary-web-chat-connection).
- Live Claude Code permission behavior: [BR-034](#br-034--shared-studio-permissions-for-codex-and-claude-code).

These links select unfinished requests or checks; current task instructions
determine what to take up. A limitation in a completed request is not
automatically another implementation request. Deferred direction belongs to
[DECISIONS.md](DECISIONS.md), including discovery (D-022), packaged deployment
(D-023) and more complex region ordering (D-026).

## Request records

Completed implementation descriptions and test counts below describe their
recorded checkpoints. Later requests may replace them. Read the linked current
manual for present behavior; retained measurements and external observations
apply only to their stated fixture and scope.

## Initial refresh scope — historical snapshot, 2026-09-08

Authorized by remettub on 2026-09-08: finish a clean refreshed repository, commit,
and push a new `refresh` branch directly to `Struder-AI/SAAM`.

The initial delivery was a clean skeleton, local architecture map, repository
checks/CI, maker/developer routing and decision/vocabulary records. Runtime
geometry, toolpath generation and Studio were deferred at that checkpoint and
implemented in subsequent requests.

Legacy reference: commit `54093cadbe87020836916d53dd29a45a06bf5528`.
Working-folder archive destination: `../SAAM-legacy-20260908/legacy-reference/54093cadbe870/`.
Old source, dependency and local fill-review work were preserved outside SAAM;
personal `Prints/` and `.saam/` were excluded from that move. Licenses/notices
were retained. This restart did not authorize adoption of the legacy runtime.

## BR-001 — Local architecture map

- Status: complete locally
- Requested by: remettub, 2026-09-08, restart conversation R3
- Result: ignored `.local/architecture-map/`, with maker/project views, 16 source anchors, selection/navigation, search/focus, themes and persistent dragged positions checked locally. No legacy runtime adopted.

## BR-002 — Simplify restart terminology and guidance

- Status: complete
- Requested by: remettub, 2026-09-08, restart conversation R3
- Build: Maker-agent vocabulary, glossary, three approvals, direct generation from the locked plan, skill packages, local Prints, and concise developer documentation.
- Verify: Consistent current documents; superseded decisions preserved in the log.

## Initial foundation verification — historical snapshot

All 114 archived files were checked against their original SHA-256 hashes.
Initial checks covered document links, decision metadata and private-file
exclusions; they did not validate manufacturing behavior. Current checks are
described in the [check policy](CONTRIBUTING.md#checks).

## BR-003 — Resolve native path versus machine file

- Status: resolved
- Source: R3 refers to both a native-format path and an output toolpath in a print.
- Result: R4/R5 establish SAAMpath as the internal representation, with a separate export using an output option in the machine file. Encoding and bundle layout were open at this point; see DEVELOP.md for the implemented formats.

## BR-004 — Rhino geometry integration

- Status: wedge integration implemented; general integration deferred
- Historical direction: remettub selected Rhino/3DM; later mesh/direct-spline direction is recorded in [D-021](DECISIONS.md#d-021--native-mesh-geometry).
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
- Proposed interaction: Click-to-select geometry with shared labels; compare a feature tree and screenshot markup during usability testing. See [developer proposals](studio/README.md#studio-feature-references).
- Verify: A novice can identify a feature, request an edit, approve the three stages, and reopen the print. The delivered export is byte-identical to the reviewed export.
- Current result: named face selection, geometry/process editing, three version-bound approvals, exact Griffin export playback, save/reopen, and byte-identical delivery tests. Novice usability and physical validation remain pending.

## BR-007 — S5 inclined-wedge demo

- Status: implemented locally; physical validation pending
- Source: user in the S5 wedge conversation, 2026-09-08: "looks good, go ahead". Setup clarified as AA 0.4, right nozzle #2, PLA at 215°C.
- Result: the initial Rhino/S5 wedge demonstrated horizontal body fill, inclined skin and the shared review/export workflow. [BR-020](#br-020--eight-point-wedge-with-a-planar-roof) records its replacement with the bounded native-mesh geometry.
- Clearance scope: user explicitly said "Don't worry about clearance for this one. I'll make sure it clears." Physical head collision checking is deferred for this demo; bounds, motion and extrusion checks remain.
- Software checks covered geometry, generation, interpreted export and the three-approval/exact-delivery lifecycle. The [wedge manual](skills/wedge-demo/SKILL.md) owns current setup and checks.

## BR-008 — Root developer and maker guidance

- Status: complete locally
- Source: user correction during the S5 wedge conversation, 2026-09-08.
- Historical result: consolidate developer rules and development notes into root DEVELOP.md; move maker guidance to root MAKERS.md; remove docs/ and update active references. The instruction at this checkpoint defaulted unspecified agents to developer and required every developer to read both root files. Current context selection is in [AGENTS.md](AGENTS.md#choose-your-context) and the [developer orientation](DEVELOP.md).
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
- Result: shared geometry/region/path core and the two skill packages, checked
  against analytical geometry and rhino3dm with software export regressions.
  Studio and the approval/delivery workflow followed in BR-011. Current
  numerical and shape limits belong to the skill manuals and DEVELOP.md.
- The wedge skill was left unchanged, as requested.

## BR-011 — Make full-fill, draped-skin and the core usable

Historical result at completion; later shape additions and shared lifecycle are recorded below.

- Status: implemented locally; untested beyond software checks
- Requested by: remettub, 2026-09-08: "We need to be able to use the drape and
  fill skills and the geometry core." Scope confirmed in the same conversation
  as the full maker workflow, at parity with the wedge, leaving the wedge alone.
- Result: full-fill/drape bundles gained Studio review, chat adjustment,
  remembered setup, three revision-bound approvals and exact-byte delivery.
  Software tests covered native geometry identity, stale revisions and the
  distinction between development fixtures and real approvals. The wedge
  package remained unchanged while Studio became bundle-agnostic. Later shape,
  import and composition requests expanded the initial bounded geometry.
- Remaining: physical printing and novice usability were not established.

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

Historical design snapshot; implementation followed in BR-017 and BR-018.

- Status: design completed; subsequent implementation recorded in BR-017 and BR-018.
- Requested by: user, 2026-09-09, this repository task; explicitly scoped to “Design and requirements for me to review. Let's keep it lean.”
- Documentation completed: README now owns the introduction and product direction; PROJECT_CHARTER is a compatibility pointer. Developer guidance explains node_modules and routes skill authors to shared requirements.
- Task: Add planar-infill (suggested name): wall count, sparse alternating rectilinear infill, travel reduction and combing. Reuse full-fill for solid top/bottom masks with one layer grid and no duplicate walls/material. Include local top/bottom detection and bridging/support limits.
- Task: Centralize whole-plan maximum-height clearance for lifted travel, cooling and parking; preserve verified joined/combed moves and test cross-skill obstacles and machine bounds.
- Task: Make mesh native part geometry (D-021); add validated ASCII/binary STL import with locked units and conversion tolerances. Adapt full-fill and draped-skin to shared geometry queries; preserve the bounded wedge exception and one export/review lifecycle.
- Task: Add a Bambu H2D machine profile and general machine interoperability. Move S5-specific setup validation out of shared plan code. Declare machine/tool/material capabilities and supported outputs; keep machine behavior out of pattern skills. Implement the H2D-compatible exporter/interpreter and packaging needed for the exact reviewed artifact, using verified machine documentation or a user-supplied known-good program for the intended configuration.
- H2D scope to resolve before implementation: target nozzle/tool and material setup, firmware/output packaging, startup/shutdown behavior and machine limits. Do not copy the S5 Griffin envelope or assume an H2D profile alone enables support. No hardware execution is requested.
- Verify: equivalent geometry across backends, material ownership, travel limits, deterministic generation, profile-specific setup rejection and supported machine-program interpretation. Exercise both machine profiles through the same skills, three approvals and exact-byte delivery. Report software checks separately from physical printing.
- Design: [geometry](core/geom/README.md#geometry-interoperability-for-skill-authors), [travel](core/path/README.md#whole-plan-travel-requirement), [planar-infill](skills/planar-infill/DEVELOP.md#planar-infill-design), [machines](core/export/README.md#machine-interoperability-design).
- Approval scope: records requested work, not contributor consensus or manufacturing-job approval. Existing runtime remains unchanged.

## BR-017 — Implement interoperability first, then planar infill and import

- Status: geometry/skill/machine interfaces, planar-infill and STL import implemented; H2D output completed as experimental software in BR-018.
- Source: user, 2026-09-09, this task: “the interoperability work should come first” and “finish out the task list”. User confirmed both geometry backends, H2D left 0.4 mm nozzle/PLA, and experimental 15° draping.
- Completed: shared mesh/spline queries, native mesh storage and ASCII/binary STL import with explicit units/source hash; geometry validation and mixed assemblies; machine-owned defaults/capabilities and separate remembered setups; selected-tool bounds and machine-independent SAAMpath checks; H2D profile with official source references; output-adapter dispatch with explicit unsupported-output rejection.
- Completed: whole-plan lifted travel and cooling, bounded comb routes around holes; planar-infill with walls/density; full-fill solid-surface masks and single wall ownership; local top/bottom regions, drape reservation and dependencies; common booleans handle coincident boundaries and close level sets at their domain boundary.
- Completed at this checkpoint: README/charter consolidation, skill manuals and shared authoring guidance; Studio shows machine, mesh dimensions, sparse/solid settings and unavailable output status. Later H2D wedge support is in BR-019.
- Software verification: both backends × S5/H2D × full-fill/drape/planar-infill, material/setup rejection, wedge exception, mesh holes/islands/invalid input, changed STL source, mixed assemblies, whole-plan clearance/cooling, comb routing, sparse density/solid-layer ownership, S5 native mesh review/delivery and preservation of the prior S5 envelope. Tests create no real approvals or hardware actions.
- Remaining at this checkpoint: H2D exporter/interpreter plus sliced-3MF packaging; addressed in BR-018 using the supplied reference exports. A profile/SAAMpath pass alone does not claim output compatibility.
- Physical validation remains open. Trimmed CAD import, rotary/tool-changing extensions, automatic supports and bridge optimization were outside this request; subsequent requests and current manuals own their present scope.

## BR-018 — H2D output from the supplied nozzle references

- Source: user-supplied right-nozzle `example.gcode.3mf` and left-nozzle `wedge.gcode.3mf`, 2026-09-09; this continues BR-017. Checkpoint `48e4e8c` preserves the earlier implementation before this work.
- Status: experimental H2D output implemented through the shared lifecycle. One selected 0.4 mm nozzle, PLA, Textured PEI and no chamber heat; left remains default, with both nozzle maps covered by software tests.
- Completed: pinned firmware start/end contract, explicit print-body handoff, whole-plan shutdown clearance, shared modal interpretation, deterministic sliced-3MF packaging with fresh metadata/thumbnails/checksums, binary artifact hashing/reopening, Studio review and exact-byte delivery. No reference object or private project is copied into generated files or Git.
- Verification: 89 passing software tests; both nozzle maps, three skills and mesh/spline paths, invalid temperatures/tool bounds, corrupt ZIP, altered envelope/metadata/body, synthetic approvals and HTTP archive delivery. Independent Python ZIP/CRC, XML, JSON and MD5 checks passed. Existing S5 behavior is retained. Bambu Studio's CLI model-import check rejected both sliced reference and generated files with -6; program-viewer import acceptance is unconfirmed.
- Boundary: firmware service routines are matched to a fixed contract, not simulated. Print-body time/material excludes those routines. No physical validation or hardware execution. See the [H2D contract](core/export/bambu.md#h2d-output-contract) for exact scope and remaining validation.

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
- Implemented: Dobot profile and bounded Lua export/interpreter using the same SAAMpath, native geometry, three human approvals and delivery. Installation defaults remain unconfigured. The selected CP=0 relay policy stops at each segment and reports estimated material separately from intended bead volume. Delivered ZIP packages source files; vendor project import, controller execution and physical behavior are unverified. See [Dobot scope](core/export/dobot.md#dobot-output-contract).
- Implemented: [vase-wall](skills/vase-wall/SKILL.md) queries actual changing-Z sections on supported mesh/untrimmed spline geometry, optionally above a full-fill base, through the common composer and export lifecycle. It requires one supported convex outer section without holes/islands and enforces bounded standoff, overlap, angle and sampling checks. Other unsupported topology and trimmed CAD remain outside its scope.
- Verification: final `npm test` passed all 131 software tests and repository checks. Coverage includes Lua semantics/rejection, shared skills and bounded wedge, both geometry backends, S5/H2D/configured Dobot paths, actual SDK subprocess clients, current approval binding, stale revisions/artifacts and exact reviewed-byte delivery. All approval/calibration fixtures are explicitly synthetic in temporary bundles; no physical validation is claimed.
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
- Implemented: opt-in reproducible developer benchmarks over shared geometry queries, full-fill, planar-infill, draped-skin, composition, machine checks and export/interpretation; analytical fixture checks, Rhino 6 exchange files, sampled mesh convergence, STL precision diagnostic, serial repeats and phase/failure reporting. Commands, boundaries and findings are in [slicing speed benchmarks](scripts/bench/README.md#slicing-speed-benchmarks).
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
- Guidance and measurements: [shared numerical foundations](core/geom/README.md#shared-numerical-foundations) and [offset contracts](core/region/README.md#shared-offset-functions) record provenance, precision, limits, reference reproduction and opt-in timing. Baseline `npm test` passed 170 tests; final `npm test` passes all 180 tests and repository checks, including mesh/spline, S5/H2D/configured Dobot, public workflow and exact export/delivery regressions. The documented .NET reference project also builds successfully. No contributor consensus, human manufacturing approval, commit or publication is inferred.

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
- Guidance: [minimal component scope](core/README.md#interoperability-and-one-workflow) and [intersection contract, provenance and reference reproduction](core/region/README.md#shared-planar-intersections). No CGAL was needed, and no physical validation or contributor consensus is inferred.
- Verification: baseline `npm test` passed 182 tests; the final suite passes all 195 tests and repository checks. Includes S5/H2D/configured Dobot, both geometry backends, same-part skill composition, MCP/Studio synthetic approval workflows and exact-byte delivery. Development source changes remain uncommitted.

## BR-028 — Travel above deposited material

- Source: user, this travel task: use the current highest thing on the bed plus clearance; allow zero and default to 1 mm.
- Implemented: one shared `PathBuilder.travelTo` for full-fill, planar-infill, draped-skin, vase-wall and the bounded wedge. The wedge retains its eight-point geometry and nearby-start policy; shared motion replaces its duplicate travel/retraction implementation.
- Height follows both endpoints of each emitted positive-volume segment across the print, including prime lines and sloped strokes. Lifted travel, cooling and final SAAMpath parking use deposited maximum plus `process.liftMm`, floored at departure/destination height. Future strokes, unselected geometry and non-depositing lifts do not increase material height. New recipes default to 1 mm; existing explicit settings remain locked values.
- Updated skill/developer manuals, wedge runtime identity and H2D context validation so actual print-body height may be below unprinted geometry. H2D firmware service/shutdown heights retain their fixed export contract. Existing direct/combed policies remain; no fixture sensing or swept-head collision model is added.
- Verification: baseline `npm test` passed 195 tests; final suite passes 199 tests and repository checks. Regression coverage includes rising/falling strokes, within-operation chronology, taller-to-lower transitions, repeated cooling/parking, zero-clearance S5/H2D shell and wedge export round trips, unselected tall geometry, and the existing configured Dobot/public workflow checks. No physical validation or human manufacturing approval is implied.

## BR-029 — Flange toolpath size, ordering and Studio visibility

- Source: user switched this flange task to development and requested removal of the arbitrary file-size cutoff, shared region ordering around holes, straight-line compaction in all skills, nearby-stroke travel reduction, and clearer geometry/toolpath views.
- Implemented: incremental text/chunk parsing in the common Griffin/H2D modal reader; removed the 25 MB G-code and 64 MB ZIP policies while preserving command, archive-integrity and actual ZIP32 representation checks. Bundle/playback objects still scale with job size in memory; this is not fully streamed artifact storage or paged browser playback.
- Shared scanline ordering now completes uninterrupted row cells on each side of holes/concavities as well as disconnected islands. PathBuilder compacts compatible collinear commands for every skill and uses direct non-extruding repositioning for permitted gaps within 1 mm. Hole, surface, previous-operation, process and flow boundaries remain meaningful.
- Studio hides mesh edges below a 3-degree crease angle, shows no part geometry in toolpath view, and emphasizes the current layer over faded previous layers. Changes use the same Studio/export/review lifecycle.
- Baseline: 199 tests passed. The original full-size flange generated 37,843,427 G-code bytes, 15,389 retractions and 547,974 mm of travel. Ordering alone reduced this to 1,888 retractions and 73,837 mm of travel without changing deposition strokes. Development reproduction retains the original dimensions in an isolated local print, without human job approvals or physical validation.
- Verification: all 211 tests and repository checks pass, including files over 25 MB, an archive member over 64 MB, chunk-boundary/modal/error handling, scanline coverage and S5/H2D round trips, straight-run semantics and nearby travel. The final original-size flange passes public development generation/export checks: 28,360,548 bytes, 596,728 interpreted moves, 1,884 retractions and 73,829 mm of travel. Studio was restarted on the isolated development bundle and visually checked in geometry and toolpath views. No real job approval, delivery, machine execution or physical validation was performed.

## BR-030 — Export-only bundles and measured flange speed

- Source: user, 2026-09-10, requested implementing the Cura comparison findings and remeasuring the same flange. Scope includes shared contour cleanup, modal G-code output, removal of mandatory saved SAAMpath and regeneration on Studio reopen, and applicability across skills. [D-027](DECISIONS.md#d-027--export-only-print-persistence) records the persistence direction and its approval boundary.
- Implemented: mesh sections remove numerical triangle seams before offsets with the existing 0.0000001 mm plane tolerance. Full-fill/planar-infill reuse that helper on offset deposition contours; closed-region boolean results retain the original Clipper contract. Corners, reversals, narrow features and cumulative curvature are covered by regression tests. No curve-resolution, offset precision, geometry dimension or locked process setting was relaxed.
- Shared S5/H2D motion output omits unchanged XYZ/feed fields and retains explicit extrusion values and mode. Bounds/feed/flow checks run on interpreted export commands, including selected-tool bounds. Exporter round-trip comparisons remain regression tests. Dobot checks reconstructed Lua commands through the shared machine checker.
- Bundles save the export, check report and small generation summary, with transient motion objects retained only while generating. No new SAAMpath file/hash is written; regeneration removes a legacy intermediate. Cold opening interprets the saved export without invoking the generator or exporter. Playback and delivery use that export. Plan/export identity still controls stale approvals; editable local hashes are not authenticated provenance signatures. A complete replacement of transient motion objects with G-code, streaming generation and paged playback are not implemented.
- Measurement fixture: original 88.9 mm diameter, 25.4 mm tall flange, 6.35 mm plate, four walls, 35% infill, 0.2 mm layers and five top/bottom layers. The isolated `Prints/pipe-flange-speed-review` copies the exact plan, machine and geometry from the previous flange bundle, with no human approvals. Cura's supplied four-wall/35% file is 4,879,289 bytes and uses two top/bottom layers, so it is a comparison rather than an identical process plan.
- Final export is 15,551,433 bytes and 422,708 interpreted moves, versus 28,360,548 bytes and 596,728 moves before this change. The previous 183,926,147-byte intermediate is absent. A serial same-input generation/export/interpretation benchmark measured 91.27 seconds before and 41.06 seconds after (55% less time); the isolated baseline loader reproduced the old export byte-for-byte. Generation alone measured 80.03 versus 33.31 seconds. Separate final bundle generation/check/save trials took 43.94 and 51.89 seconds; cold Studio state requests took 12.92 and 13.32 seconds, including interpretation, serialization, HTTP transfer and JSON parsing, but excluding browser painting. Timings varied with machine load. The response still contains about 123 MB of interpreted move objects, and the 15.55 MB export still exceeds Cura's 4.88 MB; this is an improvement, not performance parity. Raw scripts/results are in ignored `.local/flange-dev/`.
- Verification: final `npm test` passes all 214 tests and repository checks. Coverage includes all skill families, S5/H2D/configured Dobot output, numerical seams and curvature, modal fields and extrusion round trips, cold/warm reopening without generation, legacy intermediate removal, edited exports, synthetic approval invalidation and exact-byte delivery. The new development bundle passes export checks and retains byte-identical plan/native geometry inputs. No human approvals or machine execution were added.

## BR-031 — Studio plays machine source in the browser

- Source: user requested replacing expanded motion JSON transport with a G-code player without breaking Studio, and clarified that Dobot must play the actual Lua that will run. Existing work was checkpointed first as requested.
- Implemented: a small state response plus exact checked source downloads. S5 sends its G-code; H2D sends the unchanged G-code member of the checked 3MF; Dobot sends each unchanged Lua file from the checked ZIP. Print/revision/export identity and per-source hashes bind loading to review. Archive validation and byte-identical delivery remain in the common workflow.
- Browser workers use the same G-code/Lua interpreters as export checks, with compact chunked numeric storage for local drawing/timing. No move/event JSON crosses the server/browser boundary, and no replacement path file is saved. H2D firmware routines remain outside simulated playback; Dobot retains actual Lua execution and modeled Cartesian acceleration. Geometry, settings, approvals, travel visibility, layer emphasis and the renderer remain shared. Full paged playback and replacement of transient generation SAAMpath remain outside this change.

## BR-032 — Infill choices and judgment-assigned supports

- Source: user requested four additional infill choices, standard and tree supports, and two rimming skills comparing horizontal versus surface-normal offsets of an assigned bivariate spline surface. [D-025](DECISIONS.md#d-025--support-areas-assigned-through-judgment) records the explicit prohibition on automatic whole-part angle-based support assignment.
- Implemented: grid, triangles, concentric and gyroid alongside existing rectilinear infill, using shared material regions, offsets, Clipper2 open clipping and full-fill stroke generation. Gyroid field-contour assembly reuses spatial endpoint buckets; an isolated 16-phase 48 mm square measurement fell from 24.604 s to 1.175 s without changing measured average density. Pattern manuals describe tradeoffs and numerical limits.
- Implemented: explicitly assigned standard footprints and authored tree skeletons with shared wall/interface ownership. Trees are an initial SAAM branch producer, not Bambu's automatic router. No upstream slicer source or skill prose was copied.
- Implemented experimentally: rimming-planar and rimming-normal share spline sectioning and adaptive section offsets at 0.5 and 1.5 line widths. Bed/edge bases, curved boundaries and outward lean are supported within the manuals' control-net limits; 45 degrees is guidance only. No conventional top gap is introduced. Normal offsets report height shifts; automatic endpoint correction and physical bead/contact validation remain open.
- Ordering clarification: both rim skills wait for the entire base edge, and the entire rim finishes before any supported feature starts. The shared composer favors similar actual deposition heights among ready operations, subject to dependencies and selected batching. Rim pairs still use increasing original horizontal intersection height. Atomic operations remain intact; component bindings conservatively approximate edge ownership and do not infer arbitrary CAD edge matches.
- Integration: common plan, regional composition, fixed MCP manuals, Studio settings, transient motion, machine exporters and export-only bundle lifecycle. Development comparison bundles exercise both offset metrics without manufacturing approvals. Final focused verification passes 102 software tests, including sloping-edge completion and physical-height scheduling regressions; repository documentation checks also pass. No physical print, machine execution, contributor consensus, commit or publication is inferred.

## BR-033 — DENSO RC8 rotary pipe demo

- Source: user requested a transferable robot/rotary pipe demo through the existing ecosystem, then selected the DENSO VP-6242 and confirmed RC8. Ceiling mounting with robot base axis coaxial with the rotary is provisional. User authorized implementation and explicitly deferred robot reach, IK solving in SAAM, joint/motion-limit checks and collision avoidance.
- Implemented: native annular mesh recipe; full-fill concentric substrate using shared sections, offsets and Clipper2; alternating axial/helical radial shells with inward/downward 45-degree nozzle orientation. The shared composer retains its scheduler and explicit dependencies; point-aligned poses and unwrapped rotary angles extend its existing stroke/motion boundary. Ordinary fixed-axis skill paths continue through the same writer and output registry.
- Implemented experimentally: VP-6242 / RC8 profile, literal PacScript source ZIP, bounded interpreter of actual T/EX/TIME/IO commands, and part/room coordinate transforms. Studio plays those exact sources with a rotating bed or Follow build plate view and nozzle direction, without invented arm joint animation. Setup identity, checks, MCP catalog, approvals, cold reopening and exact-byte delivery use the existing lifecycle.
- Limits: actual rotary interface/calibration and controller source compilation remain unverified. The development fixture explicitly assumes RC8 relative EX extended-joint control; a separately controlled rotary needs an execution adapter. Nominal timing assumes external speed 100% and synchronized linear command progress; @0 endpoint stops, acceleration, IO and relay deposition are not physically established. Constant relay rate and commanded bead-volume intent remain distinct. General cylindrical CAD recognition, radial material-region assignments and arbitrary oriented stroke reordering are unimplemented.
- Development result: `Prints/development/denso-rc8-pipe` contains a 16 mm bore, 20.8 mm outside diameter, 12 mm high pipe with 1.6 mm substrate and four 0.2 mm radial shells. Current export has 56,988 interpreted moves and 27.7 minutes of requested motion. Synthetic calibration is labeled and is not retained as user setup. Studio was launched for the user and visually inspected at axial and circumferential portions and in both coordinate perspectives. No manufacturing approvals or hardware execution were performed.
- Verification: seven focused RC8 tests pass, including mesh/spline base-vase-cap-infill-drape composition, bounded wedge, native pipe on S5, full-turn source reconstruction, orientation preservation, radial order/ownership, cold reopen and synthetic approval/exact-byte delivery. The first broad regression attempt reported an MCP test failure and stalled; that test passed immediately in isolation. The complete rerun with concurrency 2 and a 120-second test timeout passed all 261 tests in 71.2 seconds; repository documentation checks also pass. No contributor consensus, staging, commit or publication is inferred.
## BR-034 — Shared Studio permissions for Codex and Claude Code

- Source: user requested repo-shared permission scope for agents to open, use and close their Studio instances without repeated prompts, then authorized implementation for Codex and Claude on 2026-09-10.
- Implemented: a trusted-project Codex rule and shared Claude Code Bash/PowerShell rules for `node studio/server.mjs`, with a matching Claude Bash sandbox exclusion. [Studio permissions](studio/README.md#studio-agent-permissions) owns setup, direct launch and instance closure.
- Scope: project trust and browser permissions remain client-owned; restrictive policies still apply. Rules trust the script and its imports and do not create an OS-level Studio-only boundary. Claude Desktop/web MCP setup and the three human manufacturing approvals remain separate.
- Verification: the installed Codex CLI accepts the rule's positive/negative examples, allows the Studio launch and leaves inline Node execution unmatched. Claude settings parse as JSON and use documented rule forms; Claude Code is not installed here, so live Claude behavior and browser permission persistence across ports are unverified.

## BR-035 — Studio movies, material rendering and color comparison

- Source: user requested offline movie export matching Studio's selected speed, camera, visibility, rotary view and fade, followed by viewer material and color refinements.
- Implemented: deterministic 30 fps WebM export without live playback; shaded oval current beads; completed layers retain source curves using cached instanced rectangular sweeps. Old layers retain 50% opacity with gentle color fading. Normal two-second fades shorten only when the next layer arrives sooner. Material estimates use the requested fixed 1.2 g/cm³ conversion to grams.
- Color comparison: lighter sky-blue body and six successive axial colors (sky blue, teal, lime, lavender, rose, silver), with orange circumferential layers. Named viewer buttons jump to each sample. At the user's request the local development pipe now has a 22.8 mm outside diameter, unchanged 16 mm bore and 12 mm height, 1 mm substrate, and twelve 0.2 mm outer shells (six axial and six circumferential).
- Verification: focused viewer/movie/material tests and repository checks pass; the updated pipe regenerates and reopens through the shared checked development lifecycle with 100,472 moves. Browser inspection verified the color sample controls and rendering. No manufacturing approvals, hardware execution or physical validation were performed.
- User color selection: sky blue (slightly darkened), orange, teal and lavender are recorded as the visually verified set, with other colors allowed when needed. Final assignments are sky-blue body, orange circumferential shells and teal axial shells. The current pipe has three body loops per layer (1.2 mm substrate), 23.2 mm outside diameter, unchanged bore/height and twelve outer shells. Full-fill's existing interior-stroke hook supports odd native-pipe loop counts when separate perimeter bands are disabled; positive perimeter settings retain the prior behavior. The remade export has 100,449 moves. Twenty focused RC8/viewer tests pass, including three-loop coverage through composition and actual source interpretation.
- Geometry-view follow-up: user requested all proposed visual improvements and assigned the skill fix to another task. Geometry now uses opaque shaded sky-blue surfaces, smooth curved normals with crisp corners, subtle ground shadow, quiet outlines and selective highlighting. The user then requested restoring the original grid contrast. Picking uses depth at the pointer, including open bores. Twenty focused geometry, camera, visibility and material tests pass. This follow-up does not change skills or regenerate the print.

## BR-036 — Closest-entry ordering for segmented fill

- Source: user, 2026-09-10, requested a simple closest-entry implementation and review on the flange before considering more complex routing. [D-026](DECISIONS.md#d-026--closest-region-entry-first-defer-heat-considerations) records the explicit deferral of heat considerations. Writing was authorized after the user's remote sync completed.
- Implemented: shared scanline cells retain their identity through full-fill, rectilinear/grid/triangle infill and draped-skin generation. Within each operation, the composer selects the closest endpoint of either end row (up to four entries), completes that cell, then repeats. Row order and stroke direction vary independently, preserving segment volumes/metadata. Stable ties retain producer order. Existing support/layer dependencies and travel checks remain in effect.
- Scope: straight-line XYZ distance only, without lookahead, travel-time scoring or heat balancing. No reordering across operations. Closed concentric/gyroid paths, the bounded wedge and oriented/continuous operations retain existing behavior. The shared lifecycle and machine exporters are unchanged.
- Flange comparison: the isolated `Prints/pipe-flange-closest-entry-review` uses the same plan and machine snapshot as `Prints/pipe-flange-speed-review`: 88.9 mm diameter, 25.4 mm height, 6.35 mm plate, four walls, 35% infill, 0.2 mm layers and five solid top/bottom layers. Current pre-change source was measured from Git HEAD through a scratch loader, without altering the checkout. Travel fell from 74,075.177 to 51,726.662 mm (30.2%); retractions fell from 1,888 to 1,587 (15.9%). Estimated export time fell from 377.3 to 366.7 minutes. Deposition length remains 386,043.527 mm and checked volume remains 30,883.482 mm³. Scratch measurements are in ignored `.local/closest-entry/`.
- Verification: 63 focused tests pass across scanline coverage/group integrity, closest entry, reversal of variable segment data, composer constraints, travel, mesh/spline skills, material-region stacks and S5/H2D/configured Dobot exports. The flange development export passes shared checks with 422,089 interpreted moves. No human job approvals, hardware execution, physical validation, staging, commit or publication were performed by this task.
- Correction evidence: the user's follow-up identified missed entries in playback near 5:08. The initial two-entry implementation coupled row order and stroke direction, leaving two valid starts unexamined. Regression tests cover the four-entry behavior above for odd/even row counts, unchanged geometric coverage, segment volumes/metadata and uninterrupted zigzags. Shared full-fill carries it into conventional/tree support fill and interfaces; concentric, gyroid, vase, rimming and bounded wedge ordering remain unchanged.
- Corrected flange: `Prints/pipe-flange-four-entry-review` retains byte-identical plan, machine snapshot and mesh inputs, with no approvals. Travel is 49,960.820 mm, retractions 1,437, estimated export time 364.0 minutes and interpreted moves 421,782. Deposition length and checked volume remain unchanged. All 71 focused tests pass, including support integration and the regional multi-machine/multi-backend stack; shared flange export checks pass.
- Jump investigation: in the earlier two-entry export, the jump near 12:55 starts at about 12:52.5 and travels 31.656 mm. Eight cells remain; the nearest of all four valid entries is still 28.028 mm away. The missing entries explain only part of this jump. Avoiding that late long transfer would require different earlier choices; lookahead remains deferred. These are straight-line entry distances, separate from the shared route/clearance handling.

## BR-037 — Bumpy spline substrate and surface cladding

- Requested: 2026-09-10, current user. Replace the proposed dogbone with a circular bore and a randomly bumpy 16-by-8 outer spline, approximately 2–8 mm full-fill thickness, three perimeters, and alternating horizontal/vertical normal-offset cladding including partial vertical passes.
- Boundary clarification: the latest request identifies the spline as the full-fill exterior. Cladding builds outward from that substrate. This supersedes the earlier dogbone discussion's finished-exterior/inward-reservation assumption for this demo.
- Implemented: native periodic cubic `spline-tube` geometry and rational circular bore; ordinary full-fill sections/perimeters; explicit native spline and mapped triangle-strip surface queries; shared normal-offset curve sampling; local arc-length cells with partial axial courses and circumferential helices. Existing composer, oriented travel, RC8 exporter/interpreter, bundles and Studio remain the workflow.
- Example: `Prints/development/denso-bumpy-spline`, 16 mm bore, 32 mm substrate height, sampled 2.00–7.99 mm radial thickness, three perimeters, six 0.2 mm cladding shells. First two body layers yield five perimeter loops each where opposing fronts meet locally. The first axial shell has 48 partial and 199 full-height passes. The geometry-only review copy is `Prints/development/denso-bumpy-spline-geometry`; approvals there are separate from the development bundle and are not copied.
- Supporting fixes: Studio obtains shaded bead normals from interpreted tool frames; its settings identify substrate versus finished-pipe boundaries. ZIP32 supports more than 64 source helpers. One streamed, revision-bound source inventory replaces per-helper archive reloads, retaining per-file browser hashes and exact-source interpretation. Chat adjustment can replace a null or differently typed surface selector through normal validation.
- Scope: one periodic rectangular surface chart and one full-fill substrate. Explicit mesh mapping is required. Automatic charting, arbitrary holes/multi-patch seams, inward volume reservations, general offset self-intersection resolution and robot feasibility remain unimplemented. Coverage and normal-field interpolation are experimental and documented in the cladding manual. No physical execution or manufacturing approval by the agent.
- Verification: full suite and focused surface/source/workflow checks; see the task report for final counts. No staging, commit or publication requested.

## BR-038 — General explicit STL self-intersection repair

- Source: user requested repair of a supplied spiral-vase STL before Bambu printing, confirmed millimeter units, and explicitly requested an original generalized mesh fixer rather than a vase-specific patch.
- Implemented: [explicit repair](core/geom/README.md#explicit-mesh-repair) through the shared print CLI. Original JavaScript winding-grid reconstruction and marching tetrahedra handle intersecting closed oriented surfaces, followed when needed by quadric simplification with local topology and spatial collision checks. Import remains strict. Repair preserves original bytes and records hashes, numerical settings, bounds, sampled shape changes and validation before the normal geometry review.
- Verification: 20 focused repair/mesh tests pass, including analytical union convergence and membership, folded connected surfaces, cavities, through-holes, disconnected components, thin material, exact cleanup, units, near-parallel adjacency, resource failures and unapproved S5/H2D imports. The supplied 8220-facet STL has 96 degenerate facets; the 2 mm trial produces 80000 triangles and passes shared mesh checks, additional adjacent-contact checks and exact-output STL reimport. It takes about 84.5 seconds in this checkout. Maximum sampled distances are 2.024 mm from source vertices to the result and 1.120 mm in the reverse direction; these are not certified surface bounds. A separate 2.2 mm trial without simplification passes at 86996 triangles in about 9.6 seconds, with larger sampled changes.
- Limits: approximate, resolution-dependent solid reconstruction, not exact triangle splitting or a universal guarantee. Thin features/gaps can change; winding determines material. Open, inconsistently oriented and nonmanifold-edge sources remain unsupported. Allocation/import limits and failed validation return no purported repaired artifact. Per-skill shape restrictions remain, including convex sections for vase-wall. No human manufacturing approval, machine execution, physical validation, staging, commit or publication by the agent.
- Follow-up: the finer 1.5 mm reconstruction passes at 100000 triangles; maximum sampled distances are 1.443 mm from source vertices to the result and 0.956 mm in reverse. The repair change passes all 310 repository tests. On 2026-09-11 the user explicitly authorized zero-infill support and ordinary planar printing after clarifying that the source defines a solid envelope. Planar infill now accepts zero alongside the existing positive range, preserving walls and full-fill's selected solid masks. The proposed H2D print uses two 0.4 mm walls, 0.2 mm layers, five bottom layers and no top layers. The existing three human reviews remain; no continuous vase-wall operation is selected.

## BR-039 — Remove repeated validation and make slicing progress truthful

- Source: user, 2026-09-11, reported minutes spent under approval-saving labels, cited an approximately eight-second Cura slice and set a 10–12 second target. Explicitly requested a delegated audit of all skills, durable guidance against unnecessary/repeated/misplaced checks, pan controls and developer awareness of avoidable travel. Travel awareness is guidance, not permission to add validation gates.
- Implemented: exact-content mesh validity reuse; workflow reuse of matching geometry/plan verification; approval writes return the updated verified state without another bundle load; planar slicing shares prepared mesh sections. H2D returns its already interpreted emitted body with the packaged bytes through the common export-and-interpret entry point and renders each thumbnail size once. Griffin removes the duplicate input-path pass; H2D removes a second per-move bounds pass already enforced by the shared interpreter. Dobot required setup validation no longer repeats its optional pass. Support/rim producers consume the validated plan; rimming native control-net validity is reused by content. New/changed geometry, plans and external exports still enter their owning validation boundaries.
- Guidance: [validation ownership](core/print/README.md#validate-at-the-boundary-that-owns-the-data) distinguishes input validity from conditions first knowable on a newly constructed section or machine command. [Travel guidance](core/path/README.md#whole-plan-travel-requirement) asks developers to consider endpoints, seams, wall/component order and short transitions while constructing paths, without quotas, rejection rules or another approval. Audit includes full-fill, planar-infill, drape, vase, supports, both rim modes, pipe/surface cladding and the bounded wedge.
- Initial measurement: the isolated old zero-infill recipe measured generation about 285 seconds before and 145 seconds after geometry/section reuse; Clipper offset/normalization remained a major cost. These measurements did not meet the requested 10–12 seconds. This initial change included no Clipper replacement or new seam algorithm; the later kernel migration is recorded in BR-041. The user subsequently changed the ordinary test print to 15% rectilinear infill with five top and bottom layers; prior recipe timings are not a benchmark of that new recipe.
- Viewer: the parent task adds pan, uses “Calculating toolpath” consistently, removes redundant status copy and keeps the busy spinner animated (with slower rotation for reduced-motion preference).
- Remaining audit work: direct shell/wedge generation still calls plan validation after workflow loading; expensive mesh validity is reused, but smaller settings checks can repeat. Spline placement rebuilds a shell and recomputes numerical closure under rigid translation, and selected surface construction repeats the selector's field validation. These remaining sites were identified but not changed during the already approved active generation. The audit must not be described as proof that all duplication is eliminated.
- Verification: 48 focused audit tests pass: 19 H2D/Griffin/modal/browser-source/wedge export checks and 29 support/rimming/Dobot/DENSO checks. Coverage includes fresh versus cold program equality, unchanged bytes, archive/setup tampering, changed control nets, caller mutation, skill composition and exact delivery. Repository documentation checks and whitespace checks pass. Parent workflow/mesh/section/viewer checks are reported separately with the task result. No agent-created manufacturing approval or hardware execution occurred.

## BR-040 — Dimension-aware precision audit and developer guidance

- Source: user, 2026-09-11, explicitly requested another audit agent to find inappropriate or mismatched precision throughout the project and write guidance preventing recurrence. The comparison target remains roughly 10 seconds in Cura, not simply fewer decimal characters in files.
- Guidance: [precision belongs to a quantity and an operation](core/geom/README.md#precision-belongs-to-a-quantity-and-an-operation) covers coordinate grids, curve deviation, spatial sampling, repair resolution, coincidence/topology predicates, area/volume, UV parameters, angular tolerances, independent XYZ/E/feed/time/pose rounding and visual approximation. It records primary-source Cura examples as distinct quantities, suggests process-aware experiments and requires measured cost alongside shape/volume effects. This adds no production verification pass or approval.
- Corrected: the level-set constructor no longer compares area in mm² against a linear chord tolerance or silently discards small nonzero material. PathBuilder preserves short XYZ motions that remain distinct at the actual coordinate rounding, including tiny grid-boundary crossings; this repairs the next variable-gap segment's length/volume correspondence exposed by the parent's coarser offset-grid experiment. The existing regional physical-volume assertion was retained unchanged. Tolerance-module commentary now distinguishes native parameter units from mm and avoids claiming machine accuracy from a chord target.
- Verification: 9 focused regional/modal/straight-motion checks passed, including six-stage variable-gap composition across S5/H2D/Dobot and mesh/spline backends. After adding dedicated regressions, 25 geometry/straight-motion/draped-skin checks passed. Separate parent offset experiments and performance measurements are reported by that task; this audit does not establish the requested slicing latency.
- Remaining priorities: polygon coordinate/vertex budgets; dimensionally inconsistent and scale-dependent determinant thresholds in repair/projectors; UV-to-physical error mapping; separate export field budgets and accumulated relative-E error; tiny-segment volume handling for actual coordinate collapse; oriented-motion small-move policy. These are concrete audit findings, not an assertion that every tolerance should be coarsened. No print approvals, server restart, hardware execution, staging or commit occurred.
- Export follow-up: profiling found repeated formatting and modal self-parsing in the shared G-code writer. XYZ/E now quantize once for text, state and flow calculations; changed XYZ/F fields are emitted directly. A captured pre-change fixture preserves exact absolute/relative-E bytes across rounding, negative zero, modal changes, retraction and flow limiting. Nine focused modal/H2D/large-export checks pass. An isolated 20000-move benchmark retains exact bytes and measures median absolute output 167.2→82.6 ms and relative output 172.0→54.4 ms. These bounded measurements are not an end-to-end job timing; interpreter and packaging costs remain separate.

## BR-041 — Complete shared Clipper2 integration

- Source: user, 2026-09-11, clarified that the prior instruction applied Clipper2 to all skills and requested a timing comparison on the current vase before further integration. Investigation found that general booleans used Clipper2 while offsets and their normalization still used Clipper 6 JavaScript.
- Implemented: one shared C++/WASM instance in `core/region/clipper2.mjs` now owns closed planar booleans, open-path clipping, polygon inflation and offset normalization. Bulk integer buffers cross the native boundary. All skill consumers use the shared adapters; experimental surface-offset swept-band cleanup does too. Clipper 6 is removed from runtime dependencies, with no fallback. Both shell and wedge bundle identities include the shared kernel and exact dependency JS/WASM bytes. The offset `1e-5` mm and boolean `1e-9` mm grids remain unchanged.
- Scope: full-fill/perimeters, all planar-infill patterns and masks, drape, vase, supports, wedge, pipe substrate, material regions and comb travel share these planar operations. Rimming and surface cladding retain their shared 3D differential-offset algorithms; mesh/spline sectioning retains native geometry queries. CLI/MCP commands, machine output selection and human reviews use the existing workflow.
- Independent reference: the new Clipper2 C# runner and 90-case fixture retain upstream source hashes, input hashes and construction options. Historical Clipper 6 reference data remains explicitly historical; it is not relabeled or regenerated from production WASM. Existing analytical, nesting, touching-junction, collapse, perimeter and surface-convergence cases remain relevant. Final migration test counts are reported with the implementation result.
- Measured before integration: identical plan/machine hashes for the 15% rectilinear vase produced 38.600 s generation plus 10.581 s checked export with the optimized Clipper 6 adapter (49.181 s), versus 30.128 s plus 13.038 s in the scratch Clipper2 comparison (43.166 s). The latter exercised 5810 native offsets. Move counts differed, 1147567 versus 1201157, so this is a same-input kernel comparison rather than byte-identical output.
- Integrated measurement: the same inputs produced 31.735 s generation plus 14.929 s export/interpretation, totaling 46.664 s after geometry load; the separate cold geometry/plan stage took 7.425 s and file reading/parsing took 0.142 s. The integrated and scratch Clipper2 runs produced the same 1201157 moves. These individual runs vary with machine load and do not establish a stable speedup percentage. None meets 10–12 seconds. The independent C# oracle matches all 90 offset cases exactly; focused offset/junction/vase tests pass after removing the redundant post-inflation union.
- Related performance work: operation material regions are computed when consumed, comb corners/indexes and constant clearance are reused, ZIP uses compression level 1, and the G-code writer avoids repeated formatting while preserving emitted command bytes. These changes retain the shared slicing/export pipeline. The opt-in [print benchmark](scripts/bench/README.md#slicing-speed-benchmarks) records stage timings and optional CPU profiles outside the print bundle, with no production timing gate or added approval. No physical print or hardware execution is established by these measurements.
