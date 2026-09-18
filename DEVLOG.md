# Development log

## 2026-09-17 — One worker supervisor for STL import and repair

Studio's STL import launcher (`importInWorker` plus `studio/import-worker.mjs`)
was a near copy of the core repair supervisor. The import-or-repair step moved
to core as `importOrRepairSTLBundle` in `core/print/import-stl.mjs`: like
`repairSTLFiles`, it runs `runRepairJob` (new mode `import`) on the main thread
and works inline in the shared `mesh-repair-worker.mjs`. It reports stage codes
(`import`, `repair` with the repair step, `import-repaired`); Studio maps them
to its progress labels and builds the repair summary afterwards. The repair
eligibility classifier moved with it, and the worker's error payload now carries
`meshDiagnostic`. `runRepairJob` now settles only after terminating its worker,
preserving the import transaction's "worker stopped before the reserved
directory is removed" order for every job. Studio's worker file and its
promise/terminate plumbing are gone.

Verification: studio-import and mesh-repair pass (17/17); mcp and studio-agent
show only the two known pre-existing MCP failures; `dev-map.mjs check --since
HEAD` passes.

## 2026-09-17 — Event-driven Studio revision checks

Every Studio tab ran `poll()` each second, and each poll computed two bundle
fingerprints plus tour info on the server, although the viewer stream already
pushed print and tour changes that triggered the same poll. The request feed also
pushed `requests` changes that the app listener discarded, so tour Next gating
from request activity was only picked up by the fixed poll. The app now checks
`/api/revision` on a pushed print or tour change, on a request change while a
tour is active, on viewer-stream error or reopen (new `saam-viewer-connection`
event from `viewer-session.mjs`; the first open is skipped), on the page becoming
visible and on a 15-second heartbeat. The heartbeat covers an unavailable
watcher, request lease expiry and missed pushes; a restarted server rejects the
old stream token, whose error triggers the check that reloads the page.

Verification: studio-reconnect, studio-visibility, studio-work and
studio-lifetime pass (26/26, lifetime now asserts the connection signal);
`dev-map.mjs check --since HEAD` passes. Not exercised in a live browser.

## 2026-09-17 — One final approval record

The lifecycle contract had retired geometry approval and kept plan approval only
"for record compatibility", yet `approve` still accepted a `stage`, wrote a
mirrored `approvals.plan` beside `approvals.toolpath` and recomputed three
booleans; the loader, Studio state/approval responses, CLI, agent toolkit and MCP
summaries all reported them, and `/api/approve` special-cased a geometry stage.
Now `approve({actor, revision})` writes one `review.approvals.toolpath` record
(export hash, plan hash, `['settings','toolpath']` scope) and `toolpathApproved`
is the only derived state. Every invalidation (plan, machine, upgrade,
regeneration) resets `review.approvals` to `{}`; per the current status note,
retired records get no compatibility handling. MCP/toolkit summaries report `toolpathApproved` in place
of their `approvals` objects; the Studio tour rejects `/api/approve` outright.
The Studio change-follow rule that switched to the toolpath tab on
`planApproved` now uses `toolpathApproved`. The repair report no longer claims
`geometryApproved:false`. Lifecycle, Studio and MCP contracts updated together.

Verification: workflow, chat-geometry-confirmation, studio-agent, studio-work and
studio-tour pass (41/41); the other 28 edited test files pass except the known
pre-existing MCP task-manual/transport-close and studio-view-readiness harness
failures and two plastic-weld overlap failures that also fail at `6004141`.
`dev-map.mjs check --since HEAD` passes.

## 2026-09-17 — Bring dev maps up to date with the Studio event and vase-wall work

A map review since `7f2d3a5` found the Studio event queue, listener ownership
and stage-tab behavior documented, but several contracts behind the code. The
`9_agent` page now maps `readStudioEvents` (9.7) and the shared owned-Studio
long-poll `pollStudio` (9.8), and 9.4 reads "wait for requests / events"; the
toolkit change contract describes event streaming, the owner-authenticated
cross-process read and wait, their rejections and the new toolkit cases. The
`7c_requests` page maps `activeEditStage` (7.4.7) and the request/presentation
contract states the pane-specific fade. The motion reference no longer claims a
vase point budget and names the fitted-sleeve path; the testing inventory lists
`studio-events`, `studio-print-name` and `studio-spinner` tests and the new
vase-wall regressions. Verification: `dev-map.mjs check` and the map/context
suites pass (43/43). Documentation only; no behavior change.

## 2026-09-17 — Studio event queue, owner-locked listeners and calculation progress

Studio now writes what the person does, and what its workers produce, to one
agent-owned **Studio event queue** (`studio/studio-events.mjs`), shared by that
agent's Studio instances. Held kinds (viewer connections, displayed views,
approvals, calculation start/finish, tour play/pause, import start, example
adoption, plan updates) wait for a read. Delivered kinds (tour start/lesson/exit/
finish, queued and presented requests, failed or cancelled calculations, imports,
opened prints, exports) push at once and carry every held event with them.
Pushes never drain the queue; reads do, so a client that never surfaces a push
still receives the batch on its next tool result, listener wait or explicit
read. Channels: MCP `get_studio_events`, `studioEvents` on every tool result,
`events` in `wait_for_studio_request` returns and `saam.studio` notifications;
toolkit `studio-events` stream lines plus stdin `read-studio-events` and
`wait-for-studio-request`; and the owner-authenticated
`GET /api/agent-events` long-poll on any owned Studio, wrapped by
`read-studio-events --studio URL --agent-owner ID` and
`wait-for-studio-request --studio URL --agent-owner ID`, so a client that cannot
write to the live session's stdin still receives pushes through its bounded
wait. Every read reports `generation`: status, trigger, elapsed time and worker
progress with a percentage for each owned instance still preparing or
generating; the passive queue holds only start and finish. This also makes the
tour's change-suggestion lesson (step 6) reach the agent as a `tour-lesson` event
with the lesson instruction, beside its existing guidance request.

Confirmed and closed a listener leak: an ownerless request store (the raw
`node studio/agent-requests.mjs wait` listener, or `wait-for-studio-request`
without `--agent-owner`) saw and could claim every queued request in the library,
including requests bound to other agents' Studio instances. A store with an
owner now sees its own and ownerless records; a store without an owner never
sees or claims Studio-bound records live and reads them only as explicit
diagnostic history (`list`/`history:true`). `lifetime.mjs` reports viewer-count
changes and the start of closing so long-polls end at shutdown.

Verification: new `studio-events.test.mjs` (delivery classes, flush, drain,
dedupe, bounds, waits); new cases in `studio-agent.test.mjs` (route events,
owner-authenticated long-poll, cursor, ownerless visibility and claim refusal,
viewer events, tour lesson events, mid-flight progress), `agent-toolkit.test.mjs`
(live push, HTTP fallback wait with claim, owner rejection, in-process read) and
`mcp.test.mjs` (read/drain, wait return, notification, tool-result piggyback,
history). Two existing cases now listen with the Studio's owner ID. Verified in a
clean HEAD worktree because the checkout's concurrent vase-wall work was mid-edit.
Software behavior only; no print or approval.

## 2026-09-17 — Exact vase wall cleans mesh seam steps before the inward offset

Follow-up to the fitted-sleeve fast path below, which recorded the exact
per-section wall aborting at Z≈24.66 mm on `Prints/rocket-nozzle` with a false
"inward offset is empty, split or collapsed" rejection. Reproduced with
`generatePath` at `sleeveToleranceMm: 0` (exact path) and inspected the section:
a single healthy convex loop, ~1169 mm² and ~38.6 mm across, no holes, no thin
features. The loop carries near-collinear seam steps (~0.0166 mm edges) where the
nozzle's ruled NURBS patches meet — a collinear split vertex on an otherwise
straight edge. Quantized to the 1e-5 mm offset grid, that vertex rounds a hair
off its edge into a microscopic inward reversal; the inward bead-half-width
(0.2 mm) round-join offset amplifies it into a degenerate sliver, so the inset
returns two loops (material 1144.6 mm² plus a −1.9e-7 mm² sliver) and the wall's
single-loop requirement rejects a valid section. The offset kernel is faithful —
the map forbids small-area pruning there — so the fix belongs in the caller.

The motif path already removed these seams before offsetting (`motifContour` →
`cleanPlanarLoop`), and its comment says mesh cuts need that cleanup, but the
condition gated it to `settings.pattern`, so the standard `pattern: null` mesh
wall passed the raw cut straight to the offset. `skills/vase-wall/scripts/vase.mjs`
`section()` now runs `cleanPlanarLoop` on raw mesh cuts (`!reference &&
shell.kind==='triangle-mesh'`) at the same seam tolerance the motif path uses;
fitted-sleeve and native-spline sections stay chord-controlled and keep their
exact contour. The whole rocket-nozzle exact wall now completes; across 1075
sampled heights the cleaned inward offset never splits and the cleaned-vs-raw
material area differs by at most 0.03 mm² (of ~1145 mm²).

Verification: `skills/vase-wall` suite passes (13/13), plus `core` offset and
`skills/thick-lip` suites. A new regression extrudes the captured seam-stepped
section as a closed prism and asserts the raw section really splits the offset
while the exact wall completes as one stroke within standoff tolerance; it throws
the original error with the fix reverted. Software generation only; no physical
print or manufacturing approval.

## 2026-09-17 — Fitted-sleeve fast path for standard vase walls on meshes

Standard continuous vase mode rebuilt an exact planar section, Clipper2 offset and
arc-length contour at every rising spiral sample. Because the per-height cache is
keyed by exact Z and the spiral rises continuously, a curved wall never reuses a
section, so cost grew with sample count rather than shape. Profiling the
`Prints/rocket-nozzle` bundle (8642-vertex mesh, 107 mm, 0.2 mm layers, ~539
turns) showed 51,265 section rebuilds over the first 91 turns and hotspots in
`cleanPlanarLoop`/`chain` (14%), the Clipper2 offset (~30% across wasm frames) and
`contourPath` (7%). The exact path also aborted at Z≈24.66 mm with a false
"inward offset collapsed" rejection, although that section is a single healthy
~38 mm loop with no thin feature — a numerical artifact of the polygon offset,
recorded separately as follow-up work.

Standard mesh walls now fit one periodic NURBS sleeve to the wall interval and
follow its loose horizontal surface offset (`skills/vase-wall/scripts/reference.mjs`,
`createStandardVaseSleeve`), evaluated analytically per point instead of a planar
re-cut. The new `sleeveToleranceMm` setting (default 0.08 mm) is a target that
scales the fit's control resolution and is reported as the achieved sampled
residual. The fit is accepted when its sampled deviation meets the tolerance, or
stays within it on average with only isolated near-crease points exceeding; a
globally poor fit, a section that is not a single sleeve, or a wall thinner than
the bead (validated by sampling the offset loop for collapse/self-intersection)
returns to the exact per-section wall. `sleeveToleranceMm: 0` forces the exact
wall. Spline geometry always uses the exact path. Plan schema, defaults, Studio
recipe display and the skill manual were updated together.

Measurements (uninstrumented, this machine): the rocket-nozzle wall now generates
a complete checked program in ~2.3 s after load (generate 1.56 s, checked export
0.76 s, 110,773 moves) at an achieved max residual of 0.083 mm (RMS 0.017 mm,
cc48×hc64). The exact path did not complete: it reached only ~25 mm in 8.8 s
before the false-collapse abort. Verification: `skills/vase-wall` suite passes
except two motif tests failing on the clean tree beforehand; a new test covers the
fitted-sleeve path, its bounded standoff and the thin-wall fallback. Software
generation and checked export only; no physical print or manufacturing approval.

## 2026-09-17 — Guided-tour review and request receipt state

Revised the guided tour after a live Studio walkthrough. The change-suggestion
lesson now teaches how toolpath/process choices affect strength, finish, time and
material use without proposing geometry; independently requested geometry remains
supported through the normal confirmation return. The STL lesson points out a
disabled importer and continues with the selected part, with an orange Continue
action and a pointer-hover handoff that retires the importer blink. Playback
unlocks Next on the first Play event. Tour and maker guidance, examples and the
Studio contract were updated together, and the lesson deck version advanced.

Collapsed request presentation matching into the pure `requestReceiptState`
classifier, returning activity, receipt and confirmation-wait state for request
coordination, UI presentation and tour gates. Updated `7c_requests` and `7d_tour`
to retain only evidenced call/value-flow edges. Studio shutdown now cancels tour
work before closing its owned request store. Active tours reject STL import while
ordinary Studio retains the normal import transaction.

Verification: 85 affected Studio request, readiness, import, lifetime, playback
and tour tests passed. Syntax checks and `git diff --check` passed apart from
line-ending notices. `dev-map check --since HEAD` passed; detailed evidence for
`7c_requests` and `7d_tour` contains only supported structural flows and declared
boundaries. The generated map viewer rebuilt to 81 pages. The live walkthrough
exercised the revised tour sequence; it was software review, not a physical print
or manufacturing approval.

## 2026-09-17 — Live agent/Studio sessions and review completion

Replaced managed agent/Studio directory polling with a live request channel. One
agent-owned request store can serve multiple Studio instances, each Studio instance
has exactly one owning agent, and explicit session tools list and close those
instances. Opening the same print in more than one owned Studio requires an
instance selection before work is begun. Print bundles remain the durable,
shareable interface between agents and Studios; request files are retained as a
recovery journal and as a compatibility path for independent external writers.

Studio toolpath review now presents the agent-suggested print name in an editable
field. A person can replace it before export while the server preserves validation,
sanitization and compound machine-program extensions. Presentation acknowledgement
continues after two animation frames in the application, but the pure geometry and
toolpath readiness predicate now lives in `studio/work-state.mjs`; presentation
receipts are scoped to the Studio instance that rendered the result.

The agent toolkit, persistent launcher and MCP adapter carry owner and instance
identity through request, response, activity and presentation operations. The
managed launcher accepts correlated live commands over its existing process stream,
and the MCP adapter exposes Studio-session inventory and closure. Updated the Studio,
agent and protocol maps and rebuilt the generated viewer.

Verification: 42 focused request-index, Studio, toolkit, naming, readiness and work
state tests passed. Four focused MCP notification/session tests passed, including
one agent owning multiple Studios and same-bundle disambiguation. `git diff --check`
passed apart from line-ending notices. The map viewer rebuilt to 81 pages and
`dev-map check --built --since 0b2e1f8` passed. These are software checks; no
machine execution, physical print result or manufacturing approval is established.

## 2026-09-17 — Map-owned core and Studio reference

Implemented the requested single technical documentation structure for core and
Studio. Migrated 21 component/verification manuals into region-owned references,
preserving old paths and heading links as compatibility routes. Added the Studio
state/worker protocol reference. The system map now routes responsibilities,
contracts and representative changes; 57 pages expose implementation entry points.
Every scanned core/Studio production JavaScript module has a mapped declaration.
This does not assert that every helper or dynamic relationship is explained.

`read-map` returns one page, with separate contract-section, node, resource-inventory
and detailed-evidence reads. The viewer embeds the same 23 reference sources.
Developer onboarding no longer preloads skill catalogs or a parallel component
manual hierarchy. Skill-only builders retain their authoring material and consume
shared API contracts without needing implementation maps. Makers need no dev maps;
builders changing core/Studio use the affected maps. Skills and adapters remain
outside implementation scope while contributing caller evidence.

The containment view labels and orders expectations: required implementation with
unassessed or missing representation first, other required implementation next,
then supporting references and verification, with out-of-scope files last.
Native implementation is required but not declaration-analyzed; assets and tests
need owning references/evidence, not production function boxes. Ownership does not
turn enclosed or unrepresented declarations into explained behavior. Inventories
include native source, HTML/CSS, assets, contracts and verification files; freshness
includes those resources and the separate guidance inventory.

Validation: focused map, reference, context/onboarding and manual-path-security
checks passed, including file ordering, contract section identity, fenced code,
legacy redirects, missing ownership, stale links and non-JavaScript freshness.
Repository link/metadata checks, map build and `check --since HEAD --built` passed.
Static SVG review found and fixed overlapping disconnected boxes after layout
clamping; a regression test covers that case. Browser policy blocked local-file
viewer access, so this task used static visual inspection and local rendering/
navigation tests, not a live browser verification. No manufacturing behavior or
hardware outcome is established by these documentation checks.

Completed the subsequent semantic completeness pass after the user identified
that consolidation alone was insufficient. Audited the production-file inventory
against responsibilities and existing contracts, and added 51 source-grounded
change contracts covering all 134 core/Studio implementation files. Each records
responsibility/invariants, failures and limits, coupled changes and focused
verification scenarios with source/test links. This includes native repair,
plan compatibility and regional publication, numerical/mesh/surface operations,
motion state, dialects/archives, machine models, Studio workers/imports/requests,
rendering/resources and agent context. Supporting native build inputs and browser
assets have explicit reference routes. Private declarations can remain enclosed
by their owning responsibility; inventory ownership is not semantic coverage.

Added exact-file responsibility declarations, agent indexes and per-file viewer
links. A new production file cannot inherit a change contract through a directory
scope. Missing contracts, stale sections/source/test links, duplicate assignments
and ownership mismatch fail validation. Change reports now include the relevant
contract read command. Expanded system-map change routes to fourteen concrete
development scenarios and traced their invariants/couplings/checks against source.
Corrected the distinction between explicit solid-modifier tessellation and viewer
proxies, and between recipe review formatting and persisted display settings.
Contract-section reads now return only that section's navigation links.

Verification for this pass: all 43 focused map/context tests passed; after the
section-navigation fix, the affected 10 reference/generation tests and manual-path
security case passed. The four maintenance tests and role-onboarding case passed
after their affected changes. These checks verify reference delivery, coverage
obligations and drift detection; the authored behavioral account was reviewed
against source rather than inferred from a green structural check.
Final artifact validation resolved all 134 containment-to-contract routes and
979 rendered reference links, and checked the requested containment ordering.
The rebuilt viewer contains 57 flow pages, 23 references and containment.
Repository checks passed for 107 Markdown documents and 1,448 local links;
`check --since HEAD --built` and the final build-freshness check passed.

## 2026-09-17 — Containment and change-focused map maintenance

Kept authored abstractions and contracts while generating a complete core/Studio
containment inventory in the existing viewer. Module bars show direct, enclosed
and unrepresented declarations as proportions of each module's total. Inventory
includes wholly unmapped modules; existing gaps are not an approved baseline.

Added `check --since REF` to focus review on changed modules, named callables,
mapped state and authored regions, including additions and removals. AST comparison
ignores formatting but preserves semantic line-break changes. Module-level code,
callbacks and contracts still require review. Added hashed build inputs and outputs,
cached unchanged builds, `check --built` freshness verification and a guard against
inputs changing during rendering. Agent guidance owns the required change review;
ordinary code edits do not require per-node tests or the extractor regression suite.

Validation: all 32 focused map tests passed, including containment, change review,
stale artifacts and concurrent input changes. Real build, cached rebuild and
`check --since HEAD --built` succeeded. Browser navigation verified inventory
links return to their mapped pages. This detects drift and reduces review scope;
it does not certify semantic contracts or infer every dynamic relationship.

## 2026-09-17 — Code-derived relationships drive developer maps

Integrated the code graph into `loadModel()`, the common source for the existing
human renderer, toolkit `read-map`, and onboarding maps. All 40 pages now use
generated internal relationships; authored internal arrows survive only as
explicit semantic claims in the Doc view and agent context. Grouping, hierarchy,
labels, full component contracts and external/boundary interactions remain
authored. The approved renderer, layout and viewer design were not changed.

Extended the earlier extractor with finite returned-object registry dispatch,
selection-aware value flow, local class methods, named message handlers and
lexical state dependencies. Added the Studio source worker handler and retained
program storage to the source page. Unknown alternatives remain reported beside
known targets; direct alias mutations invalidate literal-object resolution.
Calls, returned values, argument flow, state dependencies and possible worker
delivery retain separate kinds and source evidence. Authored claims cannot keep
a deleted call's wire visible. Shared red references still calculate all other
occurrences, including same-page uses; unmapped callers receive no invented index.

The build writes the viewer, SVGs, concise region context, full graph and coverage
evidence. The supporting evidence command now consumes that same generated
model. Current extraction scans 184 modules and projects 314 displayed internal
endpoint pairs across 342 nodes. Core/Studio inventory is 162 direct, 2,673
enclosed and 4,151 unrepresented declarations; the callable subset is 160 direct,
739 enclosed and 1,541 unrepresented. These counts do not imply full behavioral
coverage. There are 8,744 unresolved/partially resolved sites, including external
APIs, and 249 discovered caller sites without direct mapped nodes.

Validation: 28 focused tests passed across `dev-map.test.mjs`,
`dev-map-evidence.test.mjs` and `dev-map-generation.test.mjs`. The code-only
mutation fixture verifies changed SVG wiring and changed agent region output
without changing the authored map; it also checks visible stale claims,
unresolved calls and rendered same-page red references. Real toolkit CLI output
matches the model's output and worker regions. The selected agent-toolkit
onboarding-role integration test passed separately. Build/check resolved all
40 pages. Browser inspection covered the real overview and rendered output,
worker-state and shared-reference diagrams. User feedback accepted the visible
appearance while explicitly not claiming code-accuracy verification.

Remaining analysis limits are explicit in map context and the map guide:
arbitrary callback/mutable dispatch, escaped mutations, inheritance, dynamic
imports, native-thread worker channels and request/response correlation are not
fully resolved. No execution order is inferred from sibling call order. Enclosed
factory code is not individually explained; new functions enter inventory but
do not automatically become boxes. Projection through unmapped helpers is
bounded to six call/handoff steps. These are static software relationships,
not runtime observations or physical evidence.

## 2026-09-17 — Report-only code-derived developer-map pilot

Implemented lexical/import/alias resolution and exact source evidence in
`scripts/dev-map/graph.mjs`, with declaration containment, typed relationship
projection and shared-caller reports in `scripts/dev-map/evidence.mjs`.
`node scripts/dev-map-evidence.mjs` regenerates the ignored JSON graph, comparison
report and readable report. The existing viewer, region wiring, red-link behavior
and manufacturing implementation were left unchanged. The pilot operates in the
saved checkout alongside the separately maintained human context maps.

Measured 184 .mjs modules across core, Studio and inbound skill/adapter callers.
Core/Studio inventory: 160 directly mapped declarations, 2,666 merely enclosed,
and 4,160 unrepresented. The callable subset is 159 direct, 739 enclosed and
1,542 unrepresented; local variables and callbacks explain why these denominators
differ. Parameters/destructured bindings resolve scope but are excluded from the
inventory. No combined coverage percentage is claimed.

The graph derives 5,020 calls, 1,009 assigned/returned call results, 670 direct
argument value flows and six possible worker handoffs. Of 451 authored wires,
167 have structural endpoint evidence only, 187 are boundary claims, 93 have
unresolved source sites and four lack established support in this extractor.
There are 130 omitted typed page connections and 242 caller sites of mapped
components without direct map nodes. Of 6,705 derived relationships, 458 occur
in supporting endpoint paths and 6,247 are absent from the bounded comparisons;
4,895 have an unrepresented endpoint. These are distinct measurements, not counts
of proven runtime behaviors or declarations that require individual boxes.

The 9,122 unresolved call/constructor sites comprise 7,287 dynamic members,
942 external/unbound identifiers, 539 unresolved imports, 249 unresolved local
values, 87 parameter targets, 13 mutated bindings and five unsupported callee
expressions. External APIs and deliberate extractor limits contribute to this
count. Unresolved is not absent; unsupported is not disproven.

The 6_output pilot derives pipeline-to-outputAdapter and pipeline-to-advisory
calls plus the adapter result return, while leaving object-dispatched exporters
unresolved. The 7b_source pilot derives the fetch result supplied to decodeSource
and paths from sourceSession through the Worker handler to fetch/decode/bind.
Session-to-decode and session-to-bind endpoint paths are omitted from that page.
Mutable program state, response-ID routing and control sequence are not inferred.
The registry's interpretGriffin wrapper is an example of a discovered unmapped
caller, separate from the two existing calculated mapped occurrences.

Validation: 22 focused tests passed using
`node --test core/tests/dev-map-evidence.test.mjs core/tests/dev-map.test.mjs`.
They cover shadowing, aliases/imports/re-exports, mutation, default parameter
scope, anonymous functions, value-flow evidence, both worker directions,
reassigned workers, unsupported/unresolved/omitted cases, containment, all current
map anchors, same-page shared indexes and non-mutation of the map model.
Proposed relationship typing and evidence-backed authoring changes are reported
for review; broad replacement of the forty authored pages was not performed.

## 2026-09-17 — Documentation revamp audit

Audited the three-role restructure and the dev maps. Verified against source:
`dev-map check` reports the recorded 40 pages and 340 nodes; `check-repo` reports
only the six known issues; 24 focused map/role/manual-access tests pass;
onboarding context sets for maker, builder, builder `--area`, and developer
`--area` match their manuals exactly; `read-map` on a child returns its whole
owning region with shared contracts. 86 documents were link- and anchor-checked.

Context maps corrected against the toolkit. The user's point was that the maps
must reflect what onboarding actually returns. They did not. `builder-onboarding`
returns six documents and no maps, but the map drew only three as delivered and
showed MAKERS, print tools and skill authoring as merely mentioned; those three
wires are now the blue-dashed delivered set, so all six read as one call. A panel
now states the base set explicitly and tables every `--area` flag against the
contracts and region maps it adds, and nodes were added for the area contracts that
had none: MCP development, tests, machine models, plus benchmarks, the region
verification reference and the fourth skill `DEVELOP.md`. On the maker map the tour
path was invisible although it replaces onboarding and delivers a different set;
`start-tour` now shows as its own action delivering MAKERS with tour participation,
and the prose records that `begin-studio-work` returns no manuals at all.

[Context-map tests](core/tests/context-map.test.mjs) now assert the blue-dashed sets
equal the toolkit's maker and builder context sets exactly, that both return no maps,
that every `--area` contract has a node, and that no node links to a missing file.
Hand-drawn maps drifted twice; this makes the drift fail a check instead.

Corrections made. The user spotted the stale context maps: the maker map's four
slice tooltips still routed implementation content to the abolished developer bin
and to a `DEVELOPER-CONTEXT.md` section that moved into `maps/9_agent.md`, while
the same file's header prose had already been updated — they now name the owning
region maps and `scripts/bench/region-reference.md`. The builder map's two map
nodes had no wires at all, so nothing showed how a builder reaches them and hover
did nothing; they are now wired from `BUILDERS.md` with a `read-map` action, a
`maps/README.md` node was added because the map guide was unreachable, and the
generated viewer node says to build first. Its legend gained the blue-dashed
swatch its prose already promised.

`GLOSSARY.md` still defined two agent roles and none of the map vocabulary; it now
defines maker, builder and developer agents, keeps `development agent` as the
umbrella for the latter two, and adds dev map, region, map page, operation address,
shared component, shared-use reference and context map. Ownership entries were
added for the map guide, the region index and the two context maps, which had no
recorded owner. `dev-map.mjs read` was removed as a duplicate of `read-map`, and
`maps/0_system.md` now points agents at `read-map`; the viewer was rebuilt.

[D-033](DECISIONS.md#d-033--three-agent-roles) and
[D-034](DECISIONS.md#d-034--adopt-the-packit-region-map-contract-for-core-and-studio)
record the three-role split and the map-contract adoption, which had no decision
records. D-002 and D-013 are marked superseded with their original approval
metadata preserved. Both new records are retroactive summaries of DEVLOG-recorded
direction, not verbatim quotations.

Findings left open. `.github/workflows/test.yml` runs only `npm run setup:check`,
so the map checks and `check-repo` — the mechanical half of the maps' freshness
guarantee — are enforced only when a contributor runs them locally. `check-repo`
walks `*.md` only, so the two context-map HTML files are never link- or
coverage-checked; that is why the stale nodes survived. The viewer's Doc pane
renders region-prose Markdown links as literal text, because `md_to_html` in
`scripts/dev-map/viewer.py` handles code, bold and italic but not links, so the
routing half of the map contract does not reach people. The builder map still
omits nodes for the test reference, benchmarks, MCP development, machine models
and `skills/wave-overhangs/DEVELOP.md`. `--area path` returns `core/path/README.md`
without `2_generation`, whose caller contract is that same file. No skill has a
`DEVELOPER.md`, so `read-skill --developer` is a documented but empty tier.
Smaller text errors remain in `core/agent/README.md` ("both examples" for three
tour examples, a mislabeled `maps/9_agent.md` link, `record-request-activity`
absent from the command table) and in `core/region/README.md` (two links to the
benchmark reference labelled "developer maps"). No code or manufacturing behavior
changed; nothing physical was tested.

## 2026-09-17 — Core and Studio developer maps

Implemented 40 pages (340 nodes) from ten region Markdown sources, using the
PackIT leveled layout and viewer. The user reviewed offset/perimeter examples
and approved continuation. The system overview leads to lifecycle, generation,
geometry, regions, motion, output, Studio, machine presentation and agent tools.
Skill implementations and client adapters remain outside the mapped boundary.

The generator resolves named JavaScript declarations through Acorn, checks
hierarchy and boundary labels, rejects two-node pages and ambiguous/raw repeated
anchors, and calculates every other mapped occurrence for each shared component.
Human diagrams show those occurrences as red downward arrows and indexes;
agent packets expose the same references with the shared input/output contracts.
The viewer retains the exemplar layout and optional code/Doc interactions;
supporting prose stays behind Doc. Generated artifacts are ignored and rebuilt
from source, while agent reads resolve the current checkout without Python.

Added `read-map PAGE` and selected-area map packets to onboarding. Developers
receive the system overview; skill-only builders and makers receive no maps.
Repeated regions are deduplicated. Developer onboarding does not force maker
workflow or individual skill manuals. The implementation bin is absorbed into
region context, with numerical reference procedures under benchmark guidance.
Both role context viewers and owning manuals now point to these sources.

Tracing the maps corrected a draft travel sequence: recovery precedes combed
travel and follows clearance travel. No manufacturing implementation changed.
Maps and checks establish a structural account, not a proof of behavior or an
exhaustive inventory of every helper/caller.

Verification: all 40 pages built and passed declaration/boundary/shared-use
checks; 17 focused tests passed for map drift/reuse, role/context selection and
manual access. All 89 checked guidance links and headings resolved. Browser
review covered overview, offset/perimeter recovery, radial contact, travel and
Studio drawing layouts, navigation, declaration code and shared references.

## 2026-09-17 — Selective skill-role reads

`read-skill ID` now accepts independent `--maker`, `--builder` and `--developer`
flags, selecting package `SKILL.md`, optional `DEVELOP.md` and optional
`DEVELOPER.md`. No flags preserves the maker read. Combined flags return only
the selected source documents; missing optional roles are reported explicitly.
The existing file split is reused rather than duplicating manual content.
Builder guidance now requires maps for core/Studio changes or investigation of
their internals, not every skill-script change. Dev maps cover core and Studio.

Verification: focused CLI onboarding and role-selection tests passed (2 tests),
including combined reads, builder-only reads, source equality, absent optional
manuals and rejection of unknown skills. No manufacturing behavior changed.

## 2026-09-17 — Reconcile role context and the map contract

The user approved the documentation reconciliation after reviewing checkpoint
`04f66db`, with no temporary map-unavailability routing. [AGENTS.md](AGENTS.md)
and [BUILDERS.md](BUILDERS.md#maps-and-local-documentation) distinguish inherited
responsibilities from required reads. Builders read relevant maps for skill,
Studio and isolated core changes; reading an implementation reference does not
change their role. Caller-facing contracts remain available to the roles using
them instead of classifying whole mixed manuals as developer-only.

The map contract records one region source for agent text and human rendering,
shared components only under the same input/output semantics, and calculated
red vertical arrows listing every other map occurrence by node index. Both agent
and human views must expose these references. Structural checks do not establish
behavioral truth or caller completeness. Maps carry the structural account;
comments/docstrings assume the map has been read and require specific local
value. Concise useful rationale and contracts remain permitted. PackIT's region
source, vision and style were the reference; its strict documentation and
atomization policies were not adopted.

The [developer bin](DEVELOPER-CONTEXT.md) now contains the implementation slices
previously left in its manifest: region kernel/construction and verification
details, Studio request indexing/presentation, and output dispatch/validation
integration. Owning manuals retain caller behavior, limitations and links.
The scoped reference index includes machine presentation and distinguishes
contracts from internal mechanics. Developer onboarding reads only the bin's
orientation/index; implementation slices are separate existing `read-guidance`
section reads. Role labels and both documentation-navigation HTML maps were
reconciled. No code-anchored region maps or new skill-section flags were built.

Verification: the focused three-role CLI onboarding test passed, including exact
orientation text and a selected implementation-section read without neighboring
sections. `git diff --check` passed. `check-repo` reports only existing issues:
BR-045's `open.` status and five links to removed `build_request.md#br-*` anchors.
No printing or physical behavior changed or was tested.

## 2026-09-16 — Three agent roles and documentation restructure

The current user directed a move from two agent contexts (maker, developer) to
three: **maker** (uses skills, makes parts, gives printing advice, operates
Studio; changes no shared code), **builder** (changes skills, extends Studio,
makes isolated local core changes, makes test parts), and **developer** (works on
core and across components; maps-native). The agent determines its role from the
initial prompt, defaults to maker when unclear, escalates maker→builder on any
build request (announced, then `builder-onboarding`), and reaches developer only
on the person's explicit request or an accepted proposal for major core work.
Maker and builder agents suggest a fresh session past ~250k tokens on an
unrelated pivot; developers are exempt.

Structure changes: [AGENTS.md](AGENTS.md) now routes by role, escalation and
session-switch. `DEVELOP.md` moved to [BUILDERS.md](BUILDERS.md) (builder
orientation, includes maker context) with its externally-referenced anchors
preserved; all root `DEVELOP.md` links were repointed there (component
`DEVELOP.md` files untouched). A new transitional [DEVELOPER-CONTEXT.md](DEVELOPER-CONTEXT.md)
is the developer handoff: it holds the developer-only sections physically lifted
from `core/agent/README.md` (implementation and verification),
`core/export/README.md` (stationary-extrusion motion writer) and
`studio/README.md` (historical toolpath inspection), plus a dev-bin manifest
that catalogues, with anchors, the interwoven dev-only material still living in
the region READMEs (Clipper2 kernel, export interoperability internals, Studio
request-index/work-state internals) for the dev maps to absorb, and an index of
the wholesale developer-only documents.

Onboarding now takes roles maker/builder/developer
([core/agent/toolkit.mjs](core/agent/toolkit.mjs), [scripts/agent-toolkit.mjs](scripts/agent-toolkit.mjs));
`developer-onboarding` was renamed to `builder-onboarding` and a new
`developer-onboarding` added. [manuals.mjs](core/agent/manuals.mjs) admits the new
root docs and aliases. The [agent toolkit manual](core/agent/README.md) documents
all three. The [maker](maker-context-map.html) and [builder](builder-context-map.html)
context maps were updated to the new state (the developer context map became the
builder map); the code-anchored developer region maps are the next phase.

Judgement call on the reorg depth: cleanly-detachable dev-only sections were
physically moved to the handoff; large interwoven ones were catalogued in place
with precise anchors rather than butchered, since the dev maps are meant to
re-own that content and most of the handoff is expected to disappear once they
exist. Verified: `agent-toolkit` (three-role onboarding) and `mcp` tests pass;
`check-repo` shows only pre-existing `build_request.md#br-*` anchor issues. The
prior working tree was checkpointed first (commit before this work).

## 2026-09-16 — X1 Carbon, Ultimaker 2 Extended and Ultimaker 3 profile definitions

The current user requested an X1 Carbon profile, confirmed the standard hardened
0.4 mm nozzle with PLA, and clarified that materials must remain changeable.
They also requested Ultimaker 2/3 profiles, correcting the installed 2-series
model to the original "ultimaker 2 extended" after initially choosing 2+.
The resulting IDs are `bambu-x1-carbon`, `ultimaker-2-extended` and `ultimaker-3`.

The profiles declare hardware/coordinate bounds, conservative rectangular tool
areas outside cutter/clip regions, temperature/feed limits, installed nozzle
assumptions and editable PLA defaults. X1 also declares PETG, ABS, ASA, PC and
95A-class TPU; both UltiMakers also declare ABS. These are bounded starting
settings, not a general material-library port or physical calibration.
Official Cura/Bambu profiles and manufacturer documents are linked in the files.
Shell defaults now enable drape only for a machine declaring nonplanar support.

The definitions are usable for geometry/setup review and remembered settings.
All three explicitly declare unavailable output, and the shared lifecycle now
reports the output reason before path generation. H2D firmware routines are not
reused on X1; S5 startup is not reused on UM3; UM2 Extended's volumetric UltiGCode
is not treated as filament-length Griffin. No startup position was invented.
The remaining output work is [BR-051](build_request.md#br-051--complete-output-for-the-three-new-printer-profiles).

Verification: all 9 tests in `printer-profiles.test.mjs` and
`interoperability.test.mjs` passed, plus the focused MCP SDK catalog/persistence
test. This covers material/temperature changes, remembered setup, tool-bound
rejection, core/tool selection, planar defaults, early unavailable-output errors,
and catalog discovery. Existing S5/H2D default and H2D export checks pass.
No physical printing or new machine output was tested. Changes are uncommitted.

## 2026-09-16 — S5 sacrificial priming before shell prints

The user reported missing priming on the desktop `stress-mesh-hi-fi-20260916.gcode`.
Inspection read only the first 3,072 and last 2,048 bytes of the 98,930,655-byte
file, as requested. It starts with `G92 E0` and a stationary `G1 E6.5 F1500`
before the first model wall; its last E move withdraws 6.5 mm. Thus that file
already matches the configured terminal retraction, but has no sacrificial
priming strokes. This does not establish any additional firmware withdrawal
or the physical reason for failed initial extrusion.

S5 profile revision 7 supplies two connected 100 mm passes to shell generation.
The shared path helper places them outside geometry and generated stroke bounds,
including supports, with 4 mm clearance and bead-width allowance at the bed edge.
It uses locked first-layer settings and normal flow caps, restores the initial
retraction at the prime, then retracts/lifts before entering the model. Ordinary
SAAMpath/export interpretation includes prime material, timing, bounds and Studio
playback. Insufficient space is reported rather than silently omitting priming.
The bounded wedge retains its existing prime line; older snapshots and other
profiles retain their startup. The desktop export was not modified or regenerated.

All 26 selected tests passed across priming, pipeline, export, modal emission,
travel and source playback. Coverage includes both S5 nozzles, zero/6.5 mm
retraction, support extents, bed-edge fallback, no-space rejection, snapshot
compatibility and exact-source Studio playback. No physical print was performed.

## 2026-09-16 — Shared Thingi10K search and download

The user requested built-in mesh retrieval for descriptive searches such as
"fetch me a bunny", plus mirror lookup for supplied Thingiverse links and a
manual-download fallback when absent. The existing preference for tailored
geometry remains in MAKERS, clarified to apply when making it is attractive.
Every downloaded mesh now returns a brief source notice and its license link;
the maker guidance and [task manual](skills/thingi10k/SKILL.md) require that link
in chat even when strict mesh import fails. The mirror provides unversioned
per-file license labels, so the link goes to the original model's license section
and no exact legal version is inferred.

The shared skill implements keyword/name/tag/filename search, per-file selection,
Thingiverse thing lookup, bounded individual HTTPS downloads and cached metadata
from Hugging Face revision `2d5d3b2f3cd3711028ad75b12788c13b25559ec6`.
CLI and MCP use the same library and STL importer. Downloads retain source bytes,
hash and attribution; successful imports carry attribution in the saved source
record and delivery copies it beside the reviewed machine program. Failed import
retains the original for explicit preparation. No new dependency, remote scraping,
automatic repair or manufacturing approval was introduced.

Six skill tests and four existing MCP-access tests passed. Coverage includes
quoted CSV names, keyword and Thingiverse/file identity, pagination, persisted
cache reuse, incomplete metadata, network errors, redirects, download limits,
interrupted streams, failed-import recovery, and the SDK MCP search/import/Studio
review route. Synthetic fixture delivery preserved exact reviewed bytes and
source attribution through unit correction. Live CLI checks found 67 bunny files,
resolved Thingiverse thing 151081 to file 293137, and returned the user-download
fallback for an absent thing. One upstream file (68807) lacks contextual metadata;
it remains discoverable with an explicit missing-creator indication.

The live import downloaded Low Poly Stanford Bunny by johnny6, listed as
[CC BY-SA at its source](https://www.thingiverse.com/thing:151081#license), into an
isolated unapproved local test bundle. Source SHA-256 was
`4a222346223cf2c207c34d7a3d4e8ea297b004ff862b06b6e4c7c2eeac9f761a`.
This establishes software download/import behavior, not physical printability.
The refreshed capability digest and new manual links passed their relevant
checks; the repository-wide documentation check still reports the pre-existing
BR-045 status and stale backlog anchors for BR-005, BR-018, BR-023 and BR-039.

## 2026-09-16 — Stress mesh hi-fi completion and separate vase manuals

The user established **stress mesh** as the term for the local Spiral Vase input
and requested the single hi-fi alias for full mesh fidelity. They also explicitly
chose separate standard/advanced vase manuals and separate skill-digest entries,
clarifying that the distinction is in discovery and documentation. Standard
`vase-wall` and `advanced-vase-wall` now have separate manuals/catalog entries
while retaining the same `skills.vase-wall` recipe and generation implementation.
[D-032](DECISIONS.md#d-032--separate-standard-and-advanced-vase-mode-manuals) records
that instruction; the glossary identifies the stress mesh and both modes.

The latest saved recipe from the previous evening was
`.local/motif-speed/worktree/Prints/development/correct-cgal-medium-fidelity`.
It retained the repaired 8,076-triangle stress mesh, the 33-point motif with
4.8 mm depth, 36 cells per turn and 579 body courses plus two flat ends.
The motif hash is `734d7f601aadcdebdb4f1b5d7d92f07d4ef9142b69f5ee2ad3c61bd2e90fc99b`.
Only `meshSleeve.fidelity` changed from 0.5 to 1; the latest recipe's independent
0.2 mm detail tolerance, loose offsets, Bambu H2D and PLA settings were retained.
The prior 0.1 mm contact-detail rejection therefore does not describe this recipe.

Public bundle initialization preserved source bytes and left the old print intact.
Development generation at `Prints/development/stress-mesh-hi-fi-20260916`
completed all 581 courses at 125.242 s, composition at 127.726 s, and checked
export/persistence at 143.475 s. It produced 2,163,709 checked moves, with export
SHA-256 `b6caeff64020e151a3e5497748f1cfd221c6c88ca78b4133349698092059d285`.
The complete observed slicing time was 2 minutes 23 seconds; no remaining-time
extrapolation was needed when completion was reported. This is a development
preview with no new human approvals or physical print result. Progress and the
result record are under `.local/vase-speed-20260916/stress-hifi-*`.

The three skill-digest tests passed, and the regenerated digest includes both
manuals. The repository documentation check reported no errors for the new
manuals/catalog or relocated references; it still reported unrelated existing
backlog status and stale backlog-anchor errors.

## 2026-09-16 — Vase contact speed and local loose-offset curvature limiting

The user requested a bounded high-fidelity motif-vase timing run, followed by
slicer speed improvements, then requested over-curvature handling that preserves
one smooth sleeve by limiting offsets locally. The shared manuals define motif
mapping and numeric fidelity, but do not identify a named “gauntlet” example or
“hi-fi” preset. The diagnostic therefore used the saved repaired stress-vase
candidate at `.local/motif-speed/worktree/Prints/development/correct-cgal-full-fidelity`;
that identification remains provisional. Its source is the 8,076-triangle CGAL
repair `aec0bf6018d998ce743c2c4cdb4158e47c37caca7ae20a60d8fb803b46ecd0db`,
with fidelity 1, 0.1 mm contact detail, 36 cells per turn and 581 total courses.

On Node v24.19.0 / Intel i7-9750H, the initial generation rejected a source-contour
fold at Z 27.565625 mm after 108.210 s; a repeated baseline reached the same
rejection in 89.344 s. Early throughput suggested approximately 5–10 minutes for
a complete job if subsequent geometry were accepted, but the actual rejection
precludes a completion estimate for that unchanged recipe. A separate bounded
CPU profile attributed roughly half its sampled time to triangle-distance
arithmetic and temporary vectors during mesh-ledge validation. Scalar arithmetic
replaced those vector allocations without changing the distance method or budgets.
The same full-height input then reached the identical rejection in 46.088 s.

A separate 26.8 mm / 131-course fixture retained the source, motif, fidelity and
tolerances for a completed-output comparison. Generation changed from 75.052 s
to 43.767 s, and checked export from 4.017 s to 4.095 s: 79.069 s versus 47.862 s
after geometry load (1.65× faster). Plan/machine hashes matched between trials,
as did all 564,318 checked moves, travel metrics and the 9,156,497-byte export:
`53f4112814c63f5f353280fedc710e7708f2b3fe4a6444a65c0fd7f6a14e7a3e`.
The final trial includes the curvature limiter. These are individual local
measurements, not a statistical hardware comparison or a full-height success.
Evidence and original module snapshots are under `.local/vase-speed-20260916`.

The loose-offset implementation now reduces local control depths when its sampled
Jacobian would fold, preserving the same NURBS control layout and periodic seam.
It checks the displacement path as well as its endpoint, retains ordinary offsets,
and reports reductions. This is separate from source-mesh contact; it does not
resolve the source-contour rejection above or certify global self-intersections.
The shared geometry manual owns the algorithm and limits. All 27 selected distance,
contact, loose-offset, sleeve, vase, cladding and rimming tests passed, including
deep over-curvature, local retention, seam/weight preservation and checked export.
The benchmark now retains progress, errors and CPU profiles after cooperative
time-budget interruption. No saved print approvals or source bundles were changed,
and no machine execution or physical validation occurred.

## 2026-09-15 — Browser control and download completion

The inherited download investigation reproduced canceled ordinary agent clicks
for both the small text control and the streamed medium-vase package. Installed
Codex desktop 26.908.4834.0 cancels ordinary downloads during agent browser
control unless its supported download action has registered the download. That
action reached save-path assignment but reported a local-policy block in this
session. No security settings were changed.

After browser control returned to the person, the same streamed package saved
successfully to the configured Desktop folder without Save As. The browser
record reports completion and 31,991,449 bytes; the saved file SHA-256 matches
the approved package:
`0c24656319d52d7e064c0cf4e94565bd59046c93f7eca9987ba4deace3cb7310`.
This establishes successful large-file delivery and a control-state failure
in the automated reproduction. It does not establish the cause of every earlier
human-click failure or retest Studio's final confirmation button. The working
procedure is documented at Studio's client guidance; no further download code
change was required for this successful transfer.

## 2026-09-15 — Shared checkpoint and publication

The user requested committing and pushing the checkout's pending work on
`codex/provisional-goalpost`. Existing geometry and workflow verification above
was reused. Focused Studio material, settings and movie checks passed (19 tests)
for the pending playback changes; the diff whitespace check passed. Large-file
browser download completion remains unresolved as described below.

## 2026-09-15 — Loose spline mapping and full-height dense vase preview

The approved extension to pipe cladding and both rimming skills is integrated.
Their default remains exact-distance offsetting; explicit spline references can
choose the loose/exact continuum. Independent review fixed an ownership guard
that had skipped the cladding option during normal generation, and retained
planar rimming's projected full-normal direction on rising-U charts. Mesh strips
and circular pipe behavior remain unchanged. Root integration checks cover
these cases, nominal material rims, composition, plan settings and checked
mesh-motif export. A prior rim test assumed exact bead-width separation at the
new loose default; it now checks the intended side/footprint contract, while
the dedicated exact-offset tests retain distance assertions.

The same-size Greville direction control field replaced repeated polygon offsets
for fitted mesh sleeves. Its loose endpoint preserves spline degrees, knots,
weights and all 90 stored controls (72 independent); intermediate offset
tightness blends toward exact unit reference normals at query time. Mesh contact
fidelity remains a separate parameter. The five-course reproduction near course
465 completed in 2.327 seconds total, including 0.0734 seconds mapping, with
7,651 output points. Loose distance is approximate and reported as such.

The complete 117 mm preview then generated successfully at zero mesh fidelity.
The user accepted it and requested three times the circumferential loop density.
Changing 12 to 36 cells per course retained the motif, 581 courses, flat ends,
height and tolerances. Normal Studio generation took 27.092 seconds on S5,
producing 1,242,934 mapped points and 1,248,514 checked moves. Switching the same
recipe to Bambu H2D completed in 28.378 seconds. These timings include the
normal generation request, not browser rendering or download time.

The user approved both exports in Studio, but reported failed browser downloads.
Server delivery files existed: the S5 file was 57,394,818 bytes and the H2D
package was 20,680,260 bytes, each matching its approved SHA-256 exactly. The
browser used a temporary blob URL and marked export complete when its synthetic
anchor click returned; that does not establish a successful host download.
The approved H2D delivery file was supplied as a local link while the handoff
was investigated. No new physical print result was reported.

The current CGAL-repaired source was then evaluated separately, preserving the
approved old-source print. Strict full fidelity with 0.1 mm contact detail failed
on a local unfolding limit at Z 27.565625 mm after 91 seconds. The medium
candidate used fidelity 0.5 and 0.2 mm contact detail and completed the entire
581-course, 36-cell, flat-ended Bambu job in 250.469 seconds. It produced
1,959,821 checked moves and a 31,991,449-byte package, SHA-256
`0c24656319d52d7e064c0cf4e94565bd59046c93f7eca9987ba4deace3cb7310`.
The source remains the current CGAL repair `aec0bf6018d998ce743c2c4cdb4158e47c37caca7ae20a60d8fb803b46ecd0db`.
There were 2,638 contact profiles and 13 sampled 3D ledge transitions; maximum
sampled combined profile error was 0.199711 mm and maximum sampled mesh distance
on ledge checks was 0.072739 mm. These are sampled numerical checks, not a global
mesh-error or physical-clearance guarantee. The completed preview was displayed
in Studio, then accepted by the user and promoted to production without changing
the export bytes. The user subsequently confirmed settings and toolpath in
Studio; normal delivery succeeded. The exact approved package was also copied
to the requested local Downloads folder and its hash verified. Its 758
short-travel advisories remain recorded; no automatic geometry or process change
was made. No physical result was reported.

Contact preparation now permits bounded unfolding of section folds and deducts
the measured profile certificate from the interpolation allowance. Narrow ledge
transitions use sampled distance checks against the original triangles. Larger
folds still reject; the medium result does not establish that every mesh or the
strict full-fidelity setting is supported. Current contracts live in the
[advanced vase manual](skills/advanced-vase-wall/SKILL.md) and
[prepared contact reference](core/geom/README.md#prepared-mesh-contact).

Browser delivery remains unresolved. User-clicked 1 KB text saved, while both
the approved 20.7 MB package and an independent 32 MB plain-text response showed
“Stopped,” including on a fresh Studio instance. The HTTP attachment/retry path
and compound filename fix are implemented and covered by focused checks, but
are not evidence that the host saved a large file. A chunked-transfer diagnostic
was prepared but no user result was obtained. On September 15 the user ended
this task's download investigation and assigned further debugging and eventual
commit/publication to other tasks; this team retains vase documentation work.
The intended browser behavior remains one click to the default download folder.

The vase manual was condensed and checked against the implemented settings. It
includes a mesh preparation example, motif authoring and density, flat ends,
separate fitting/contact/offset controls, composition and numerical limits.
Shared lifecycle links and the discovery digest were updated; manual links,
public anchors, example JSON and skill metadata checks passed. No runtime change
or further generation was required for this documentation pass.

## 2026-09-15 — Motif mapping performance, fitted mesh sleeves and artifact provenance

After checkpoint `7638383`, the user requested a composable skill, flat motif
courses at both ends, faster generation, and mesh inputs with a smooth fitted
reference plus continuous one-sided conformance. Development was isolated under
ignored `.local/motif-speed/worktree`; the downloaded irregular vase program
was not edited. The owning vase, geometry and region manuals describe current
settings and limits.

The original 30 mm irregular-mesh recipe measured 239.773 seconds generation
plus 1.195 seconds checked export. Exact mesh connectivity reuse and cheaper
contour cleanup retained its program bytes. Prepared height/offset mapping then
measured 43.263 seconds generation plus 1.383 seconds checked export with the
same saved plan/machine inputs, using CPU profiling in both reported trials.
Moves changed from 208,414 to 237,423 because the remaining chord budget caused
more subdivision. Path length changed from 97,302.331 to 97,308.939 mm (0.00679%).
No courses were trimmed or tolerances relaxed. A separate 10,000-point comparison
against exact queries on the actual mesh measured 0.001196 mm maximum and
0.0000587 mm RMS mapping discrepancy, within the reserved 0.0025 mm allowance.
These are sampled comparisons, not global error certificates. Earlier faster
experiments lacked the retained numerical margin and are not the final timing.

The fitted mesh reference uses 12 periodic circumferential by 6 height controls
by default: 72 independent controls, with three repeated seam columns. On the
local 100,000-face stress artifact, isolated fitting took about 0.2 seconds after
roughly 1.8 seconds loading/validation. The ordinary plan and imported-bundle
tests exercise continuous fidelity, flat ends, source preservation, regional
composition and checked machine output. At this stage, directional contact
required a star-shaped contour about the fitted center; source folds failed explicitly.
Full fidelity on the local legacy stress artifact fails this requirement at
several sampled heights. Zero-fidelity fitting remains independent of that
contact limitation. No physical mesh-motif print result was supplied.

During preview review the user identified the selected stress artifact as the
output of a purged repair. The source had been read from the older local SAAM
checkout's ignored `prints/spiral-vase-h2d/geometry/source.stl`, not repaired in
this task. Its repair report identifies `winding-grid-marching-tetrahedra/1`
followed by `quadric-edge-collapse/1`; its SHA-256 is
`39b8a8d0019d625833c92b31ab39a14ee61d6f9ad1b4136e08617720d25091c8`, identical
to the retained preview source. Saved review history dates it to September 11,
before the September 14 removal. Commit `c545d8f` removed `reconstructMesh` and
the dependent simplifier; active source in both current checkouts contains no
restored implementation or new repair calls. The separate root STL removal was
`45d788f`; voxel authoring removal was `d686269`. Selecting the artifact without
checking its repair provenance was an agent error. The user acknowledged the
distinction and authorized continuing the preview with that artifact.

The full 117 mm, 581-course zero-conformance preview exposed a downstream stall
within course 186. The initial mesh fit was fast; a three-course CPU profile
instead counted 12,771 polygon offsets. A shifted reproduction isolated the
per-height simplification of the already smooth fitted sections as a source of
repeated preparation. Removing that redundant simplification reduced a shifted
three-course reproduction from 19.18 to 0.78 seconds of mapping, with 6,717 mapped
points in both runs and unchanged tolerances. Offset preparations fell from
11,708 to 550. A geometric regression compares the flat fitted ring to its
independently constructed inset and detects the previous simplification error.
The full preview retry is separate from the original-recipe benchmark above.

That retry passed course 186 but slowed again around course 320. A bounded
five-course shadow profile exceeded 45 seconds after only three courses.
The fitted spline's own per-height adaptive tessellation still changed vertex
selection. A shared U grid, sized from the periodic polynomial spline's global
second-derivative bound, completed all five in 6.503 seconds (3.448 seconds of
mapping), with 396 section segments and a 0.002473 mm chord bound against the
0.0025 mm target. Fit coefficients and sampled residuals were unchanged. The
bound was independently reviewed and tested across held-out heights and U
positions. These shadow profiles ran alongside the preview and do not establish
an isolated full-job speed ratio.

The fixed-grid full run later slowed near course 465. A continuous offset-row
atlas prototype exposed a 0.00128 mm projected-seam shift over a 0.000098 mm
offset interval even though the corresponding contours retained 396 vertices
and smoothly changing lengths. Thus repeated grid-rounded polygon offsets and
seam reprojection still disrupted the reference correspondence. The user then
explicitly required loose offsets with no growth in control-point count. The
unfinished tight-offset run was cancelled through Studio's normal cancellation
API. The replacement mapping must retain the fitted spline's control structure
and U/Z correspondence; these cancelled runs are not completed preview results.

The current CGAL patch repair was also rerun on the preserved original stress
mesh in an isolated output directory. It reproduced the previously recorded
8,076-face output SHA-256
`aec0bf6018d998ce743c2c4cdb4158e47c37caca7ae20a60d8fb803b46ecd0db` in 1.90 seconds,
with no holes filled. Its sleeve detector retained the full 0–117 mm interval.
Directional-contact probes passed at four heights but rejected folds at three
others, so the conformance limitation also affects the correctly repaired mesh.

The user also reported a stationary Studio spinner. Live computed styles showed
`prefers-reduced-motion: reduce`, `animation-name: none` and zero duration. The
spinner now retains slow 2.4-second rotation in that mode, compared with its
ordinary 0.8-second rotation. A focused regression and live computed-style
inspection confirmed the fix; other motion preferences remain unchanged.

## 2026-09-15 — Irregular broad-loop example and pre-performance checkpoint

The user requested a wider motif on an irregular sleeve, accepted the displayed
result and requested a checkpoint before investigating generation speed. The
reusable vase-wall irregular demo now contains the exact demonstrated host and
motif recipe: a waisted, leaning oval solid, 20 connected cells per course and
145 full courses. The owning skill manual includes the command, adjustment
entry point, progress, mapping limits and duplicate-generation guidance.

The saved print generated 207,671 mapped motif points and 208,414 checked machine
moves; the actual motif Z interval is 0.8–29.940035 mm. All shared generation
checks passed. The 287 short-travel advisories were retained as nonblocking
evidence in the private print. Geometry was confirmed by the human in Studio.
The user intends to print; no physical result is yet recorded. An earlier host
with rotating and changing-aspect oval sections failed the contour subdivision
check near Z 2.23 mm; that trial generated no complete path. The displayed host
retains oval aspect ratio while its section size and center change. No contour
tolerance was relaxed and no course was trimmed.

The checkpoint includes concurrent Studio coordination work as required by the
repository's checkpoint policy; it is not a claim that all carried work is
complete. Previous focused test evidence remains applicable. Performance work
and any measurements begin after this checkpoint.

## 2026-09-15 — File-compatible handoff work after SQLite withdrawal

The user briefly approved SQLite while asking about update/version risks, then
withdrew that option: **"2. I don't think it's worth it but start the rest."**
Removed the partial database implementation before it was executed. No database,
data migration, package dependency or Node engine change occurred. The existing
JSON files and Node >=22 requirement remain. The earlier approved tour-disconnect
policy remains in effect. Continued on the existing contributor branch without
staging, committing or publishing, preserving concurrent skill/generator edits.

### Implemented choices

| Choice | Reason and boundary |
|---|---|
| Rebuildable request index in memory | Avoid migration and a second persistent authority. Normal queries retain unfinished work, undisplayed completed results and the latest edit outcome per print; full diagnostic history remains explicit. Watch hints plus five-second metadata reconciliation cover external changes. Cold scans and memory still scale with history; this does not provide cross-process transactions. |
| Real request-specific activity | MCP print tools accept explicit `requestIds` and renew owned working requests at tool entry/exit. CLI agents can report actual work through `record-request-activity`. Waiting/listener helpers never renew leases; activity preserves pause, baseline and target. Long work with no observable contact may still expire. |
| Cancel Studio calculation before saving | An authenticated cancel route bypasses the mutation queue and arbitrates with the worker using a shared atomic flag. If cancellation wins, the worker stops; if saving wins, its write sequence finishes. Cancellation does not queue generator repair or immediately auto-retry. Explicit retry works. Input-change notifications cancel obsolete Studio calculations. Direct CLI/MCP generation still needs a shared owner. |
| Separate review updates from displayed-source identity | Approval, delivery history and generation-mode changes update controls after fresh validation. Compact updates omit accumulated history and retain playback/source state; input/export and other generation-identity changes still reload. Full approval/delivery byte checks remain. |
| Reject late tour start-layer choices | MCP supplies the original run/lesson identities to the tour mutation. An ended or replaced lesson cannot accept that background choice. File-based cross-process read/modify/write races remain. |
| Retry Windows file sharing conflicts | Browser verification reproduced EPERM while replacing review.json during generation. Shared single-file replacement now uses unique temporary names and bounded Windows EPERM/EACCES/EBUSY retries, preserving prior complete contents on failure. This is not a multi-file transaction. |

### Verification and findings

With 1,000 historical JSON requests, five warm operational queries performed zero
file reads and zero directory scans. Explicit history remains complete, and the
tests retain waiting requests and undisplayed results. Found and fixed a watcher
startup gap (files created before attaching) and released idle watches for
short-lived callers. Browser snapshots retire omitted resolved work while
retaining updates that arrived after an older poll began.

Selected software tests cover request discovery/activity, real SDK ownership and
listeners, CLI participation, tour lifecycle, scoped stale choices, cancellation
and retry, commit arbitration, exact-byte delivery, compact review updates,
playback preservation, source invalidation, Windows retry/permanent failure and
concurrent temporary-file isolation. The browser Cancel calculation action worked
on an isolated synthetic 80 mm box. After the Windows fix and server restart,
retry produced the playable toolpath and normal review controls. Browser warning
and error logs were empty; the audit tab and its server were closed. No real
manufacturing approval, hardware operation or physical print was performed.

One earlier import/generation run reported a prepared-runtime mismatch while
generator source was also changing in this shared checkout; subsequent stable
runs passed. Reconnect test harnesses required the browser's URLSearchParams
global after the poll URL gained a fingerprint parameter. These observations are
not evidence of transactional safety. The documentation checker retains the six
pre-existing status/link diagnostics. Remaining authorized ownership and broad
read-audit work is tracked in [BR-050](build_request.md#br-050--finish-studio-coordination-and-read-path-handoff).

## 2026-09-15 — Single-motif vase tiling made explicit

The user specified one selected motif, mandatory cell endpoint connections,
optional transverse tilt, upward repetition on a regular parameter strip, and
mapping to the actual sleeve. They confirmed the displayed overlapping loops
and authorized resolving either missing implementation or documentation. Session:
`01a0a731-c52c-7f81-b60e-c20895d6661f`.

Existing sleeve mapping and advanced repeated paths already supported the
geometry. The loop demo authored a whole course, however, and saved no separate
cell/layout recipe. Vase-wall now accepts one motif plus cells per turn, course
rise, course count and tilt, expanding through the existing mapper. Cell joins
are explicit and mandatory; course grouping retains cooling and layer identity.
The loop demo uses that form. Normal recipe changes can switch authoring forms,
and Studio reviews the cell layout. Skill discovery, the owning manual and the
glossary describe the workflow and its actual-section mapping limits.

Generation now reports completed motif courses through the existing progress
callback, including regional work, instead of retaining the preceding base-fill
stage. This adds progress visibility, not a slicing-performance claim.

All 23 selected motif, mapped-path and Studio-settings tests passed. Coverage
includes independently authored course equivalence, tilt, rejected gaps,
inside/outside loop placement, changing hosts, persistence, form changes and
S5/H2D/configured Dobot command interpretation. A saved development print retained
one 17-point motif, tiled eight times per course across two courses, generated
372 checked moves, and reported progress 0/2, 1/2 and 2/2. It had no human
approvals. No physical printing or clearance validation is claimed.

The repository-wide documentation scan reported an unrelated completed BR-045
status and existing links to removed backlog headings BR-005, BR-018, BR-023 and
BR-039. It reported no motif documentation or capability-digest errors.

## 2026-09-15 — Tour disconnect policy approved and implemented

The user answered **"1. yes"** to keeping a tour through brief browser disconnects
and ending it on exit or Studio shutdown. For **"2. what is the case for it"**, the
agent explained the proposed SQLite scope, atomic claims/indexed queries, the
coordinator and file-lock alternatives, and schema/migration/runtime costs.
That question is not approval to adopt SQLite or change the Node minimum.

Studio now associates a live tour with its owning instance. The existing browser
grace period retains that run across reconnection; owner shutdown clears it and
cancels its pending work after accepted operations drain. Closing an observer or
an older owner cannot end a later run owned by another Studio. Saved example
prints remain, and opening one after shutdown does not restore the tour. Startup
through the toolkit attaches the run created before server launch. New tours
started through Studio record their owner directly.

All 20 selected lifetime, reconnect, toolkit and tour-lifetime tests passed,
including end-of-grace shutdown and cross-instance isolation. This implements
normal shutdown and browser-disconnect behavior. Forced process death, atomic
claims and cross-process mutation races remain part of coordination-store work;
the file-backed owner field does not establish transactional ownership.

## 2026-09-15 — Handoff implementation: tour scope and read boundaries

The user asked to read the handoff, start work, explain decisions and ask about
genuine ambiguity. Continued on the existing contributor branch and preserved
the preceding uncommitted flow-audit work. This entry records the implemented
portion; the broader coordination/read-path work remains in progress.

### Choices implemented and their reasons

| Choice | Alternatives considered and reason |
|---|---|
| Remove tour resume and identify runs/lesson visits. | Hiding the button alone would retain the API and obsolete teaching. Exit/cancel now clears an unfinished run; fresh starts create new example copies and a run ID. Leaving a lesson cancels scoped teaching, and revisiting creates a new lesson ID. Existing print copies remain saved. Individual edit cancellation does not end the tour. |
| Select MCP read scope by operation. | Loading a full program and then shortening its response retains unnecessary decoding/copying. Discovery now returns names/machines/timestamps with unchecked export status. Checked summaries use the existing metadata-only program contract; edit dispatch omits old exports. Check/approval/delivery still verify bytes. |
| Use catalog membership for selected manual reads. | Scanning every manual to establish a known ID adds no validity guarantee. A shared skill read now reads one manual; unknown IDs can consult the local extension. |
| Retain the fresh mutation-boundary read. | Passing an earlier mutable snapshot into a writer without checking current inputs could accept stale edits. Adjustment now reuses updatePlan's returned state, while updatePlan retains its fresh revision check. Further snapshot reuse needs an owning concurrency contract. |
| Separate geometry fingerprint scope from export scope. | A blanket cache bypass would repeat unrelated reads. Geometry fingerprints now omit exports while retaining original-STL integrity. Review and delivery still read current bytes. |
| Share bounded file-digest reuse with machine studies. | Rehashing the motion source on every idle poll adds no new change information. Studies reuse metadata-bound digests and omit motion decoding for geometry-only reads; changed bytes still invalidate checked source. |
| Report lease expiry as lost contact. | A helper heartbeat proves helper survival, not continued agent reasoning. No helper heartbeat was added. Ten-minute request leases remain; confirmed transport closure remains a distinct signal. |

Also added direct request-ID lookup and malformed-JSON isolation, reused supplied
plans for print names, shared a request snapshot within a tour state response,
restricted the tour picker to its known example directories, removed duplicate
signature reads, and stopped request-only events from scheduling generic revision
polls (target publication still schedules needed generation). Runtime provenance
keeps its manifest entries/order but reads repeated file paths once.

### Additional read-path evidence

The ignored `.local/read-path-followup.mjs` probe created its own small synthetic
box, 1,000 historical requests and 21 ordinary prints. Its JSON report is
`.local/read-path-followup-results.json`; results do not depend on private data.
The application filesystem instrumentation records returned bytes, parsing,
cloning and response sizes, not physical disk traffic or end-to-end user latency.
Module/runtime caches were warmed by fixture construction. Concurrent filesystem
notifications can contribute background reads; per-operation timings are not
isolated microbenchmarks. Streams and worker processes are excluded.

| Measured path | Result and disposition |
|---|---|
| Selected MCP `text` manual | One manual instead of the previously observed 17 reads. The manual response is about 30 KB; that is requested context, not a hidden full-catalog read. |
| One/21-print discovery | 2/42 plan-and-machine content reads; no native geometry or exports. Responses approximately 120/2,600 bytes. Recursive link confinement remains and contributes metadata calls. |
| Checked MCP summary | No motion arrays cloned; current program checks remain. |
| Direct lookup with 1,000 historical requests | One record read, no directory scan. |
| Operational request polling at that size | Approximately 534 KB response; full-history scanning and overlapping notification work remain. |
| Tour geometry state | One request-directory scan shared by the state and lesson gate, but that scan still reads all history. The tour picker likewise still incurs gate-related request reads despite enumerating only its known prints. |
| State → sources → view-ready | Approximately 88/88/101 KB read in this small fixture; source/geometry rereads remain across independently fresh boundaries. A shared verified-source handle remains a proposal. |
| No-op/settings/geometry MCP edits | Old export reads removed. Nested geometry/recipe reads remain (19/23/23 readFile calls including metadata/notifications); eliminating them safely needs the mutation owner. |
| Two simultaneous viewer state requests | Both perform their own reads; shared concurrent read work remains unimplemented. |

The dedicated audit is **not complete**: fresh-process cold paths, large STL and
native/source assets, growing review history, worker-side parsing/hashing/copies,
generation cancellation/recovery, approval/delivery measurement and simultaneous
agent-process ownership still need measurement. Existing software tests cover
integrity and delivery, but are not latency measurements for those workloads.

### Decisions awaiting clarification and remaining implementation

1. **Disconnect policy:** asked whether a live tour should survive a brief browser
   disconnect until explicit exit/cancel or Studio shutdown (recommended), or end
   on browser disconnect. Shutdown/crash invalidation is not implemented in this
   tranche; transient progress is still file-backed and can be observed by another
   process. No resume UI/API remains, but that alone does not complete run lifetime.
2. **Transactional storage compatibility:** compared an authoritative service
   (requires discovery/startup and a standalone-CLI lifecycle), filesystem locks
   (stale-lock ownership and crash recovery), and SQLite (atomic claims/indexed
   queries with independent CLI operation). Recommended SQLite and asked whether
   the minimum Node version may rise from 22 to 22.13 for its built-in module.
   [Node's version history](https://nodejs.org/api/sqlite.html) records removal of
   the startup flag in 22.13; the API remains experimental in that release.
   No dependency or engine requirement has changed pending that answer.
3. Indexed operational queries, atomic request/tour transitions, request-scoped
   renewal from real tool activity, generation cancellation/supersession and compact
   review updates remain. Implementing separate indexes or heartbeat helpers on the
   existing nontransactional files would add a second consistency problem. These
   should follow the chosen owner, retaining explicit history diagnostics and
   completed work awaiting presentation. Late start-layer writes also need scope
   validation at that owner, beyond cancellation of their guidance request.

### Verification

Targeted Studio tour/UI/import/agent tests, MCP tests, shared program-cache tests,
machine-study tests, toolkit, geometry confirmation, work state, opening,
reconnect and view-readiness tests passed across the relevant runs. New
`read-scope.test.mjs` assertions cover scoped reads/copies, malformed request
isolation, machine-study invalidation and altered-export rejection. An early MCP
run hit an intermittent Windows EPERM replacing a request JSON file while a
listener was active; the affected suite passed subsequently. This is further
evidence for storage ownership, not evidence that the race is fixed.

An isolated browser tour verified lesson-one geometry, absence of Resume, exit
restoring ordinary controls, and Tour starting a fresh `handle-2` at lesson one.
Browser warning/error logs were empty. Closed only the audit tab and managed
server. All fixtures and approvals used here were synthetic software exercises;
no physical print, hardware action or real manufacturing approval was performed.

## 2026-09-15 — Studio flow audit and preview readiness

Audited the user/agent/Studio boundary across startup, edits, guidance, imports,
geometry confirmation, generation, playback, saved-print selection, export,
tour navigation, failures, interruption and reconnect. The user's reported
inconsistency had concrete sources: request completion, displayed-result
identity, browser loading and lesson gating used different rules. The dots and
dimmed viewport are now called **Updating preview**; the user rejected "print
activity" because it sounds like exporting. Normal capabilities remain available
from any view, subject to their actual inputs and human confirmation dependencies.
Only the tour's teaching path narrows requests, with a gentle redirect and an
explicit exit to ordinary work.

### Findings addressed

| Finding | Change and owning boundary |
|---|---|
| A single request could finish visually after any changed input, including an intermediate save or unchanged geometry after a settings change. | Every new edit requires a saved result target. The shared [work state](studio/work-state.mjs) matches the target's inputs and geometry/toolpath stage. Legacy inference is conservative. |
| Waiting for one shape confirmation suppressed unrelated active edits; pausing and claiming work discarded its original baseline and target. | Waiting applies only to the matching prepared target. [Request persistence](studio/agent-requests.mjs) retains identity through pause/resume. |
| Browser polling could replace newer request state with an older response, and targets published after rendering lacked a persisted display receipt. | [Agent UI](studio/agent-ui.mjs) merges by update time and asks the existing view-ready path to acknowledge already displayed targets without reloading. Presentation and disconnect writes advance update time. |
| Early completion could leave an absent toolpath busy indefinitely; CLI begin-work could not reclaim a failed request. | Pending presentation has the request lease, and failed/expired work can be reclaimed. Successful presentation remains independent of final chat bookkeeping. |
| Guidance dimmed usable geometry, and tour gates separately treated queued edits and advisories as blockers. | Guidance/advisories stay visually quiet. Tour gates consume the same request-activity function as the viewport; only active unfinished edit work blocks a delivered edit lesson. |
| Ordinary geometry review started speculative workers; production generation could perform preparation before rejecting missing confirmation. | Ordinary state reads do not slice. Studio checks geometry confirmation before starting production work. Tour speculation is confined to the selected confirmed part in the import lesson. |
| Tour auto-generation could slice intermediate saves while the agent was still assembling an edit. Geometry-only reads could also prepare an already generated part. | Automatic tour generation waits for active edits' published input targets. A matching stored generation suppresses speculation; later review still checks its bytes. |
| Starting an edit checked the old export even though the agent was about to invalidate it. | [CLI begin-work](core/agent/toolkit.mjs) returns recipe/revision/geometry context without old-program validation and labels the unperformed check explicitly. It also returns the geometry hash. |
| Lesson gates and late start-layer choices changed the full-view fingerprint, stopping playback and entering the loading state. | [Studio revision responses](studio/server.mjs) separate tour metadata from bundle/data-mode identity. [Browser polling](studio/app.mjs) updates metadata without source loading. Unchanged activity polls no longer rerender lesson guidance. Compact approval responses use that same fingerprint. |
| Imported-model guidance could change settings and regenerate merely to find an infill layer; a now-invalid explicit layer could strand playback readiness. | Start-layer selection is quiet guidance over existing output. Missing or unavailable layers use deposited-layer fallback. It never requires a recipe change or reslice. |
| Download progress implied preview work, and manuals mixed geometry completion, generation, chat replies and listener waits. | Downloads use their own progress state. [MAKERS](MAKERS.md#existing-studio-work) now owns an explicit situation/action table; toolkit, MCP and tour guidance point to compatible result-publication and response rules. |

### Verification and limits of evidence

All 81 selected software tests passed across `studio-work`, `studio-agent-ui`,
`studio-view-readiness`, `studio-tour-ui`, `studio-tour`, `studio-agent`,
`studio-open`, `studio-reconnect`, `agent-toolkit`, `mcp` and
`chat-geometry-confirmation`. Coverage includes ordinary and tour edits,
overlapping work, stale responses, same-lesson geometry recovery, worker failures,
approval preservation, source reuse, S5/H2D/Dobot adapter paths and exact-byte
delivery. After the final activity/receipt changes, their 52 affected
Studio tests passed again. `git diff --check` passed.
The repository documentation check reported the same six pre-existing diagnostics
recorded in publication preparation below: BR-045 status punctuation and five
links to removed backlog headings. It found no new link diagnostics for this work.

An isolated browser run under ignored `Prints/studio-flow-audit-20260915` verified
initial geometry, visible edit activity, an intermediate save remaining active,
target publication clearing the indicator and unlocking Next before final agent
completion, saved selection and generated playback. Changing the tour's start
layer while playing preserved Pause, continued the timeline, and showed no busy
indicator. Exiting restored ordinary geometry/toolpath, open, import and export
controls. Browser error/warning logs were empty. Only the audit's tab and managed
server were closed. These were synthetic software exercises, with no final
manufacturing approval or physical print. No end-to-end latency benchmark or
new evidence for the deposition algorithms was claimed.

### Remaining structural findings and recommendations

These are audit findings and proposals, not implemented capabilities or newly
commissioned backlog work:

1. **Shared storage has no transactional owner across processes.** Request and
   tour files use atomic replacement, but read/modify/write transitions and claims
   are not cross-process transactions. CLI, Studio and MCP can race; tour playback
   writes can race a CLI start-layer change. Removing overlap rewrites and merging
   browser responses reduces exposure but does not solve storage ownership.
   Consolidating mutations behind one authoritative coordinator or transactional
   store should precede claims of exclusive handling or simultaneous agents on
   one part. The coordinator should own legal transitions and result receipts.
2. **Generation is serialized but not user-cancellable.** Request/progress reads
   stay responsive, while ordinary mutations queue behind a running generation
   and the browser disables navigation. A changed recipe cannot receive an old
   candidate, but obsolete computation may continue until that check. An explicit
   cancellation/supersession contract at the generation owner would let a new
   intent release obsolete work without restarting Studio. This needs coherent
   CLI/MCP/Studio ownership, not a new lesson-specific exception.
3. **The indicator observes request leases, not host reasoning.** A dead host
   turn need not close MCP; conversely a live long edit can exceed the ten-minute
   lease without renewing it. Geometry approval waits are now explicit, and the
   maker guidance names renewal, but reliable host cancellation/heartbeat events
   require client integration. An open viewer must not manufacture evidence that
   its agent is still working.
4. **Request history is scanned as a whole.** `list()` reads every saved record,
   and UI polling returns the library's history. One malformed JSON record can
   fail the batch. Bounded queries and per-record failure isolation belong with
   the storage owner; no growth benchmark was performed in this audit.
5. **Queued teaching can outlive its lesson.** Exit cancels tour work, but moving
   back within a tour does not scope every queued signal to a live lesson. The
   manual now tells agents to cancel obsolete guidance. Explicit event scope and
   cancellation at the coordinator would make this independent of agent memory.
6. **Review metadata and scene identity are still partly coupled.** Tour-only
   metadata no longer causes reloads, and normal approval responses reconcile
   their fingerprint. Tour export still changes review data and removes a marker,
   so subsequent bundle polling can enter refresh, although matching source and
   material buffers are reused. A shared compact review-state transition would
   remove that remaining presentation detour without another export-only flag.

### Follow-up handoff: tour lifetime, activity signals and design options

The user specified the following tour intent after reviewing finding 5:
**do not save tours for later resumption or expose resume in the UI.** Exiting
or cancelling a tour ends that run; the next tour starts again from the beginning.
Agent-mediated recovery on a specific user request remains a possibility to
consider, not an approved exception or a required capability. This is recorded
intent for follow-up implementation; the audit changes above do not implement it.

Transient coordination state may still be needed while a tour is running; it
must not become an implicit saved session. A recommended implementation is a
unique run identity with lesson-scoped requests. Exit/cancellation invalidates
that run and its pending teaching; starting again creates a new identity. Lesson
changes must also invalidate obsolete teaching within a live run, so removing
resume alone does not fully address finding 5. Whether a brief browser disconnect
ends the run, and the exact treatment of unexpected host loss, remain unspecified.
Cancelling an individual edit must remain distinct from cancelling the whole tour.

For finding 3, the user proposed a cleanup listener launched with Studio and
expressed a preference toward a heartbeat as the simpler approach. Neither is
implemented by this handoff. A launcher-side listener can observe its own process
and Studio work, but needs explicit host lifecycle events to know whether the
agent's turn is active or cancelled. A heartbeat from a surviving helper proves
only that helper is alive. The recommended portable fallback is request-scoped
lease renewal on actual agent/tool activity, with expiration reported as lost
contact rather than proof of model inactivity. Studio-owned workers can report
their own liveness independently; geometry approval waits remain explicit states.
A host adapter could add prompt cancellation signals without making host
integration a prerequisite for ordinary use.

The user found the remaining directions reasonable and asked to retain them as
**suggestions, with explicit consideration of other options**. A follow-up
implementer should compare alternatives against actual consumers, ownership,
failure recovery and complexity before selecting a design. These suggestions
are not fixed architecture decisions or a claim that the work is implemented:

- **Storage ownership (1):** consider one authoritative coordinator for request
  transitions and presentation receipts. Compare a coordinator process with
  transactional storage, including CLI-only operation and process failure; do
  not add both without a concrete need.
- **Generation cancellation (2):** consider a shared cancellation/supersession
  contract. The suggested product policy is that a newer edit supersedes obsolete
  generation for the same print, while merely changing views does not cancel it.
  Evaluate explicit cancellation and reuse of still-valid computation before
  choosing worker and queue behavior.
- **Agent liveness (3):** consider request leases as the portable baseline and
  host lifecycle events as an optional improvement. Compare renewal sources and
  timeout behavior; a helper's survival must not renew an agent request forever.
  Tune expiration against observed workloads and distinguish lost contact from
  confirmed cancellation, worker execution and waiting for a person.
- **Request retrieval (4):** consider direct ID lookup, bounded operational
  queries, change notifications and per-record failure isolation. Paginated
  history is useful only where an actual diagnostic consumer needs it; do not
  build a history feature merely to repair an inefficient active-request query.
  Compare indexed storage with a bounded active set and optional archive.
- **Tour scope (5):** apply the user's no-resume intent above. Run and lesson
  identities are suggested mechanisms, not prescribed storage formats. Evaluate
  brief-disconnect and host-loss behavior separately from explicit tour exit.
- **Review updates (6):** consider updating review metadata independently of
  geometry/toolpath loading through the shared state contract. Compare compact
  updates with separated revision identities; avoid another export-only flag.

#### Why history is currently read

This is request-record history under `.studio-requests`, not chat transcripts or
manufacturing review history. `list()` currently reads/parses every request file
and normalizes lease expiration before consumers filter the returned records:

| Consumer | Actual information needed |
|---|---|
| Studio browser polling (every 750 ms), state responses and disconnect notifications | Relevant request activity, pending presentation and failure notices. The server currently sends the library-wide list. |
| CLI/MCP request wait loop (75 ms delay between scans while waiting), MCP queued-request notifications and queued-request checks | Queued requests; no completed history is needed for dispatch. |
| CLI/MCP begin-work with a request ID | One request and its print identity; direct lookup would suffice. |
| Presentation acknowledgements, owner disconnect cleanup and print cancellation | Unpresented work or cancellable requests for the relevant print/owner. A completed request awaiting presentation still belongs in the operational set. |
| Tour lesson gating and edit evidence | Current work and qualifying edits within the lesson, including completed edits. Current code also collects prior IDs and recovers older saved-lesson baselines; those resume paths should be reconsidered under the new tour intent. |
| Explicit failure inspection and MCP/CLI request listing | Selected historical records for diagnosis; explicit listing currently permits the full library history. |

No recurring operational consumer inherently needs to scan all historical
requests. Some need recently resolved records or current-lesson evidence, so
filtering solely to `status === 'working'` would be incorrect. Preserve those
semantics and explicit diagnostic access while avoiding full-history reads on
the live path. This trace establishes unnecessary read scope, not a measured
latency regression; no history-growth benchmark was run.

### Follow-up: unnecessary reads and dedicated read-path audit

The user challenged whether fixing request-history retrieval was enough. A
follow-up source trace and isolated read-count probe found additional unnecessary
scope and repeated work. The user then asked to adopt all findings/directions
and recommend a dedicated read-path audit in this handoff. Carry the items below
forward as accepted audit concerns and starting recommendations; compare other
solutions before choosing implementation. This follow-up records evidence and
intent, not implementation of these additional fixes. The earlier flow audit
was broad behavioral coverage, not an exhaustive inventory of reads.

#### Confirmed findings and suggested direction

| Finding | Evidence and suggested direction |
|---|---|
| Request retrieval reads the whole library repeatedly. | The consumer trace above still applies. The probe observed five full scans in a 300 ms listener wait with existing IDs excluded, and two scans within one tour geometry state response. Use scoped operational queries/direct lookup and shared snapshots or notifications; retain pending-presentation and lesson evidence. |
| MCP uses full bundle/program reads for operations that do not need the old toolpath. | `adapters/mcp/src/server.mjs` routes `adjust_print`, text/insert edits, machine changes, `check_path`, `remember_setup` and geometry confirmation through `read()`, which calls `loadBundle()` with full program decoding enabled. The owning operations then read their inputs again. Select read scope by operation; do not check/decode a soon-to-be-invalidated export merely to dispatch an edit. |
| MCP listing and summaries load more than they return. | `list_prints` first enumerates summaries, then fully validates every bundle, including available programs. `get_print` also loads full motion even though its response omits motion arrays. Separate discovery/recipe metadata from explicitly requested validated export status, label unchecked fields, and use metadata-only checked program results where sufficient. Preserve the guarantees of explicit check/approval tools. |
| Reading one MCP skill reads every skill first. | `read_skill` calls `skills()` to establish membership, which reads all 16 shared manuals, then reads the selected manual again. The probe confirmed 17 manual reads for one `text` request. Use the existing shared catalog for known IDs and a scoped local-extension lookup; listing metadata and reading a selected manual should not require the same full-manual scan. |
| Nested workflow functions multiply input loads. | Even a no-op MCP recipe patch read native geometry, geometry descriptor, machine and review four times each; plan five times, plus the existing export once. `adjustBundle -> updatePlan -> loadBundle`, optional `rememberSetup`, and final summaries introduce separate loads. Evaluate one validated operation snapshot and reuse of returned results, retaining a fresh concurrency check at the actual mutation boundary. |
| Preview preparation, transfer and acknowledgment repeat bundle reads. | A normal `/api/state -> /api/sources -> /api/view-ready` sequence rereads the native geometry and export at every endpoint. CLI preview launch also performs an initial geometry read and then a checked summary read for non-tour opens before the browser performs its own load. Consider a bounded verified snapshot/source handle shared by consumers, with explicit invalidation and freshness checks. Do not remove exact-byte protection across independently mutable files. |
| Geometry-only reads can still discover/read export bytes through fingerprinting. | `readStableBundle(..., {program:false})` still calls the broad `bundleFingerprint()`, which includes the export and original STL. Thus omitting program loading does not ensure an export-free cold read. A cold revision probe read the saved export; the warm shared-workflow probe correctly reused its digest. Evaluate separate change identities/read scopes rather than a blanket cache bypass. |
| Tour/library reads have excessive scope and duplicate derivation. | `tour.info()` reads persisted progress and resolves the saved selection even outside an active tour; active edit lessons also query requests and may reread the recipe for gate signatures. POST dispatch obtains progress before handlers that obtain it again. `/api/prints` scans all prints before filtering to known tour choices; `printName()` rereads a plan already read by listing/state code. Reuse per-operation inputs and list the known tour choices directly. The no-resume direction should remove inactive saved-tour dependencies. |
| Polling and change notifications overlap. | Agent UI polls at 750 ms, revision polling at one second, request waits rescan after 75 ms, and generic Studio change events also schedule revision polling, including request-only changes. Playback adds its own tour updates. Evaluate one scoped notification/snapshot path with bounded fallback polling and no overlapping in-flight work; account for missed filesystem events and multiple processes. |
| The machine-study adapter rereads the entire motion source on revision polls. | Its `bundleFingerprint()` reads plan, machine and `motion.json` contents each time, unlike the shared print workflow's metadata-assisted digest reuse. `loadBundle({program:false})` also reads/interprets motion to construct study metadata. Apply an equivalent change-detection contract and determine which study metadata truly requires decoding. This was source-traced, not measured in the probe. |

Additional lower-priority evidence: the first shared-workflow state read hashes
the broad runtime manifest, including unused skill dependencies, and overlapping
manifest entries read some files twice. The probe's cold state read included 118
`readFile` calls and about 2.51 MB total, including runtime identity inputs. This
does not mean all 118 reads are unnecessary: runtime provenance is intentional
and cached per adapter. Deduplicate identical entries and evaluate reuse across
processes/adapters only with a sound code-change invalidation contract; do not
silently narrow the generator identity to improve a benchmark.

#### Probe evidence and limits

An ignored local probe at `Prints/studio-read-audit-20260915/probe.mjs` copied the
previous synthetic tour fixture into an isolated library and instrumented Node
filesystem promise calls. Detailed counts are in that directory's `results.json`;
these local artifacts are not required to read this handoff. Selected results:

| Operation | Observed reads |
|---|---|
| Warm ordinary revision | Two `readFile` attempts (tour progress and absent tour marker), ten `stat` calls; no geometry/export content reread. |
| Idle request listener, 300 ms, three existing IDs excluded | Five directory scans, 15 request-file reads. |
| Tour geometry state | Two request-directory scans, each reading the same three records. |
| MCP read `text` skill | All 16 distinct shared manuals, with `text` read a second time, plus one request scan. |
| MCP list two prints | Each plan read four times; both native geometries and the one available export read. |
| MCP no-op recipe edit | Four native-geometry reads, four descriptor/machine/review reads each, five plan reads, one existing-export read. |

The generated handle's program was available with no program error. The probe
used ordinary state/source/view-ready endpoints, tour geometry metadata/listing,
an in-memory MCP client, and a no-op recipe patch. All owned servers/transports
were closed. It performed no new generation, manufacturing approval, delivery
or physical action. Counts are application filesystem calls and returned bytes,
not physical disk traffic, CPU cost or end-to-end user latency; OS caching may
serve reads. Instrumentation excludes module-loader internals, stream reads
(including original-STL hashing), and separate worker processes. Shared process
caches were warm for the later MCP probes, so these are not cold-client timings.

#### Recommended dedicated audit still outstanding

This follow-up is a partial read-path audit, **not completion of the dedicated
audit**. Trace reads, parsing, hashing, decoding, copying and response payloads
across CLI, MCP, Studio server, workers and browser. For each consumer record
the minimum data, required freshness, purpose, trigger frequency and owner.
Measure cold/warm startup, unchanged idle, geometry-only edits, settings-only
edits, source loading, generation, approval/delivery, recovery and tour exit.
Include large STL/native/source files, growing request/review history, many
prints, machine studies, multiple viewers and simultaneous agent processes.
Measure agent-facing payload/context size as well as runtime I/O: shorter output
alone can hide expensive reads and decoding behind the summary.

Distinguish unnecessary reads, repeated reads within one logical operation,
premature reads that will be invalidated, and necessary freshness/approval checks.
Protect original-STL integrity, exact reviewed export bytes, stale-revision
rejection and path/link confinement. Compare scoped queries, shared operation
snapshots, versioned source handles and event-driven invalidation; choose the
simplest design that meets those contracts. Verify improvements against the
measured paths and add targeted regressions for the specific repeated/unrelated
reads removed. Do not treat fixing request-history access alone as completion.

## 2026-09-15 — Publication preparation

Prepared the shared Studio, text-material and travel changes for the user's
requested commit and push on `codex/provisional-goalpost`. The remote branch
had been deleted after PR #10; its merge on main introduced no further file
changes, so the local branch fast-forwarded to that base. Generated .NET
benchmark `obj` files are removed from tracking and retained locally; `obj`
and `bin` output directories are now ignored.

Reused the focused software and browser verification recorded below, with no
implementation changes during preparation. `git diff --check HEAD` passed.
The repository documentation check found and prompted correction of BR-049's
status punctuation and work-record field. Six pre-existing diagnostics remain:
BR-045 status punctuation and five stale links to removed BR-005, BR-018,
BR-023 and BR-039 headings. These do not represent software test failures.
The other generator improvements in BR-049 remain explicitly deferred.

## 2026-09-15 — Local material clearance and curved comb routing

The user authorized a general shared repair after the wavy roof with draped
lettering exposed 1,281 locally permitted short connections blocked by the
highest prior planar layer, regardless of its footprint. The implementation
keeps planar footprints and heights in shared material queries and adds a
height-field surface policy reusable by producers. Drape supplies its allowed
footprint and each skin's own height. Shared combing samples curved edges,
checks every emitted segment against completed operations, and routes within
the endpoints' connected component. Global lifted clearance is unchanged;
policies without local material geometry retain conservative legacy checks.

Nine new analytical regressions cover holes/islands, collinear contact, narrow
obstacles, large translations, descending crossings, surface heights, curved
detours, blocked route edges, disconnected components and legacy policies.
All 68 selected tests passed across those checks, existing travel/composition,
straight moves, reservations, spacing, full-fill, planar-infill, draped-skin
and curved text. The surface adapter uses the producer's sampling step and sag
limit; this remains a nominal material-region model, with sampled surface
limits rather than a full swept-head or physical clearance validation.

The exact local wavy-roof/lettering fixture was regenerated before and after
the shared changes (`Prints/development/text-material-demo-verification`, plan
SHA-256 `e4338e63f3e0a2e2761af5ad6ac20295993f6e94a058b1a427efa5da82e06744`).
The same recipe, placement and deposition ordering were used for both runs.

| Measurement | Before | After |
|---|---:|---:|
| Whole-print retract/lift cycles | 3,144 | 1,332 |
| Whole-print travel, mm | 96,156.585 | 72,158.716 |
| Lettering retract/lift cycles | 1,428 | 60 |
| Lettering cycles with endpoints within 1 mm | 1,290 | 6 |
| Lettering travel, mm | 19,864.000 | 1,859.840 |

All 2,257,835 depositing moves retained identical start/end coordinates,
speed, volume and metadata: SHA-256
`28272dd558f605a5ee6e3eefad4be98238db024d293280ac2c7bb316fd0fda47`.
Total deposited volume stayed 33,105.96831755667 mm³. A flat 12 × 10 × 2 mm
box retained its entire path object, including all travel, exactly. These
comparisons are software evidence, not a physical print. Single generation
measurements were 331.8 seconds before and 654.8 seconds after, taken alongside
other local diagnostic/test work; they are not a controlled performance benchmark.
The local comparison scripts and compact measurements are retained under
`.local/travel-*`. Other advisory-identified generator cases remain deferred in
BR-049; the advisory continues to report without blocking or repairing exports.

## 2026-09-15 — Advisory for travel endpoints within 2 mm

The user explicitly authorized a runtime toolpath check despite the normal
guidance against additional check burden: report bad paths to the agent, without
blocking or repairing them. The implementation uses an inclusive 2 mm XYZ
endpoint threshold on complete non-depositing trips, including lifts/detours and
robot sampling. Shared machine interpretation and Studio machine studies return
bounded source examples and operation counts; cached source metadata retains the
result. Matching displayed exports notify the agent once through an advisory
request, preserving evidence without busy dots or timeout errors. Generation,
approval and exact-byte delivery retain their existing behavior.

Generator improvements requested “at some point” remain deferred in BR-049.
All 47 selected software tests passed across `travel-advisory`, `program-cache`,
`studio-open`, `machine-study`, `studio-work` and `mcp`. These cover analytical
endpoint cases, S5/H2D source parity,
warm/cold reuse, advisory listener delivery/deduplication and approval/delivery
with findings. No physical print or generator repair was performed.

## 2026-09-15 — Lettering material interoperability

The user redirected a wavy-roof lettering experiment to improving the text skill
across applicable printing patterns. Text compilation now retains separately
selectable base and raised-feature material with one merged review solid.
Earlier material owns overlaps; later engraving cuts all affected partitions.
Regional plans resolve those selections with assembly placement and detect
whole/partition ownership conflicts. Changing the deposition pattern preserves
geometry approval. Legacy records remain readable and gain partitions on rebuild.
Standalone text retains its original surface as an unprinted guide through edits.
Feature removal can replace dependent regions in the same validated operation.

Draped-only regions consume finished lower surfaces using their actual first-bead
gap, including curved glyphs above a native roof. Removed planar start-height and
nominal-reserve restrictions that incorrectly rejected those skins; missing
support and nonpositive deposited gaps still fail. Lettering selections preserve
heat-set reinforcement metadata and its planar-owner validation, while standalone
reference bodies contribute no reinforcement. Other skills' selection interfaces
were not broadened.

Focused checks passed: the text suite (13 tests), interoperability suite (6),
curved-text suite (2), existing regional suite (5), and heat-set suite (7), using
reused results where inputs were unchanged. Checks cover holes/disconnected
glyphs, four curved layers, measured first-bead gaps, operation order and exported
curved moves; disjoint volumes/sections; translated assembly; retained approvals;
atomic edits; imported references/source hashes; legacy records; side lettering;
and preserved insert loops/fins. The public draped example created an unapproved
`remettub` plan using native `top` and `base` / `text/label` selections. These are
software results; no physical print or nozzle-clearance validation was performed.

A side-letter O trial with continuous vase-wall generation failed at contour
subdivision; planar side lettering passes. Pattern limits remain explicit. The
user-requested read-only subagent sweep identified independent follow-up candidates
in Gridfinity construction partitions, heat-set feature selection, wave surface
publication and thick-lip continuation. They were handed off as findings, not
added as authorized implementation work or represented as reproduced failures.

## 2026-09-15 — Tour cues, repaired STL review and playback reuse

Approved follow-ups add one temporary geometry review within any toolpath lesson.
The selected print and lesson stay fixed; explicit geometry confirmation returns
to that lesson. Generic navigation grants no approval. The import lesson's
explicit continue/confirm action now checks the displayed revision and geometry
hash before approving. Both ordinary Studio and the tour also accept explicit
human chat geometry confirmation through a narrow shared CLI/MCP operation,
retaining the statement and chat reference against the current revision/hash.
Final settings/exact-toolpath approval remains in Studio; MCP tour generation
cannot bypass geometry confirmation through development mode.

The chat-edit lesson accepts geometry or settings changes after their confirmed
current toolpath is displayed. Existing request baselines distinguish participant
edits from unchanged/automatic work and survive temporary review and resume.
Queued guidance does not block a completed edit; pending edits still do. New
geometry awaiting human confirmation clears work fading while keeping a requested
toolpath pending. Browser checks exercised button and chat recovery in an isolated
synthetic library. Focused tests cover stale confirmations, CLI/MCP scope, every
toolpath lesson's review UI, same-lesson generation, early-tour preservation,
request correlation, import review and ordinary readiness/cache behavior.

The user requested eight tour-focused fixes and investigations, then added the
ordinary geometry-confirmation acknowledgement bug and approved automatic STL
repair followed by explicit geometry review. They also requested layer 2 as a
fallback when the agent supplies no playback layer.

Tour-only changes: Next highlights after displayed edits on the first two
geometry lessons; the optional roof lesson locks Next with active-work dots and
fading. Removed the preparation sentence from the optional STL lesson. Play's
highlight stops on first use. Missing agent layer selection uses the second
deposited layer (or the only layer), counts normal viewing time and does not
reposition an already-started playback when late guidance arrives. Model selection
does not depend on a playback layer. A repaired import stays on the geometry
lesson until **Confirm repaired geometry & continue**; switching away and back
does not bypass that review. Successful generation recovery queues a missing
start-layer request.

General Studio changes: ordinary geometry confirmation renders the toolpath
before sending its view receipt, clearing activity after successful loading.
One current-print playback cache reuses source decoding and material scenes on
same-print reopening and tour Back/Continue, with plan/export/print invalidation.
Same-directory reopening retains preparation. A completed speculative diagnostic
is surfaced once without repeating its calculation; crashed workers and explicit
retries remain recoverable. Visible loading/saving copy no longer calls the
toolpath "checked". Choosing an STL stops the previous selection's speculation.

STL import now runs off the server event loop. It first validates normally, then
automatically applies the existing exact-cleanup/native repair operation to
recognized mesh defects. No hole filling is enabled. Original/repaired STLs and
the existing repair report remain in the print; repair results are unapproved
geometry in both modes. Progress names checking, repair and opening; failed
imports clean only their reserved destination. CLI/MCP import remains strict.
Real native self-intersection repair ran successfully in the focused tests.
The participant's exact original failing STL was not supplied, so that particular
file is not claimed as reproduced.

The surprise-slide investigation found an agent-initiated process change in the
local Claude transcript: it disabled draped skin after requested roof lettering,
created another edit request to keep the part generatable, and explained the
workaround afterward. Geometry approval remained valid. A later lettering move
was explicitly requested. No evidence showed a Studio geometry mutation on
entering the saved-print lesson. The proposed guidance correction—ask before a
compatibility workaround changes the intended shape/process, and use read-only
status for revision retrieval—was left awaiting the user's requested approval.
Private transcript content was not copied into shared files.

Verification used the focused Studio tour, agent, import, opening, readiness,
playback-cache and program-cache suites. The latest affected-server/tour/import
run passed 35 tests; browser readiness/cache tests and unchanged-byte lifecycle
checks also passed. Browser checks on an isolated library verified both edit
cues, roof locking/fade, Play/Pause highlighting, Back/Continue, import loading,
failed-import selection preservation, repaired-geometry confirmation, and layer-2
playback completing without an agent layer. The final browser had no warning/error
logs. These are software results, not physical-print evidence. Test viewers and
their owned server sessions were closed.

The prework audit confirmed that worker checking and generation share their
candidate, and current development-to-production promotion/export do not reslice.
The remaining priority gap is cross-process: separate Studio/CLI/MCP jobs have no
shared computation coordinator. Proposed follow-up: one bounded, cancellable
speculative job that foreground work can adopt or preempt, before starting earlier
or alternative-choice preparation. Another optional improvement is a before/after
repair comparison view. These are proposals, not newly authorized backlog work.

## 2026-09-14 — Goalpost setup fix and removal of extra mesh CI

The user confirmed the intended branch rule as "at most one active pending
branch per account" and requested removal of the added mesh CI job. Applied
that wording to existing agent guidance and removed `mesh-repair.yml`; broader
policy rewrites were discarded. The existing runtime setup workflow and local
regression tests remain unchanged.

The GitHub runtime setup failure reproduced locally: Studio's activity metadata
required the temporary setup print to belong to the configured Prints library,
so `/api/state` returned 400. External saved prints now load without library
request records, and their view receipts skip that ledger. Starting agent edit
requests still requires a print inside the configured library. The setup
assertion now includes the server's error message when state loading fails.

The existing setup check passed after the fix, as did 15 existing Studio opening
and agent-request tests. Those results were reused after the documentation-only
follow-up. No test or CI job was added, and the user will handle GitHub review
and merging without an additional agent verification run there.

## 2026-09-14 — Branch repair and recipe-only tour packages

The user identified Timothy Keller's direct main commit `164d3e5` as work that
belonged on its own branch. Preserved it on `codex/tkeller-vase-wall` and applied
the authorized revert `93d2a2a` to main. The revert tree exactly matches its
pre-change parent `21f8cf4`; shared main history was not rewritten. Development
guidance now defaults to contributor branches and PR integration.
Reapplied Timothy's change as `989bf64` on top of repaired main on his branch,
preserving authorship and making it independently reviewable in a new PR.

The provisional checkpoint's unpublished parents included an approximately
99 MB display cache and 80 MB machine program for the wavy roof. The user chose
to keep the current handle/fin block and wavy-roof recipes, initialize both through
the shared bundle lifecycle, and generate toolpaths when the tour needs them.
Removed tracked prepared packages and their retired cache loader/packaging tool;
optional Nudge Cup and DENSO source recipes remain. Earlier local generated data
stays ignored. The original checkpoint is preserved locally on
`codex/provisional-goalpost-original`; the replacement publication omits its
unpublished binary history.
After publication, the user clarified one active development branch per developer
account. Removed the temporary repair branch, repair worktree and local safety
branch, and made that branch-reuse rule explicit in the owning guidance.

Verification: all 13 focused tour, agent-toolkit and demo tests passed, including
current roof geometry, no inherited generation, fresh copies, preserved edits,
HTTP startup and toolpath preparation after selection. Browser application and
source-worker syntax checks passed. No new browser or physical trial was run;
milestone acceptance remains provisional.

## 2026-09-14 — Provisional goalpost checkpoint

The user requested a checkpoint of all current shared work as the provisional
goalpost for the first milestone, published on an agent branch for a web PR and
human merge. If the implemented behavior holds up under further testing, this
state meets the first milestone target; milestone acceptance remains provisional.

The checkpoint includes the accumulated local development and the latest agent
toolkit, onboarding, Studio tour/activity, plastic-weld and heat-set gusset work.
The entries below retain the actual focused software checks and browser evidence.
No additional software or physical tests were run for this checkpoint. Further
testing remains necessary; this record does not establish physical print results.

## 2026-09-14 — Direct startup and ordered context reads

The user reported that tour agents still read MAKERS and other references before
launching the bundled command, then requested a trace of ordinary maker and
developer entry paths. The entry table still required manual reads first, and
the MCP initialization guidance independently repeated that routing. AGENTS now
puts the exact tour launch command first, followed by opening its returned URL
and consuming the returned context/listener. MAKERS, the toolkit manual, tour
manual and MCP guidance agree on this ordering. The CLI readiness/result messages
also state the next action at each stage.

Ordinary new-part and developer entry routes now call their onboarding command
only for missing context, use its returned documents directly, and choose
individual follow-up reads. Existing-print requests begin/claim work before
loading missing context; their common instructions now have their own MAKERS
section. Developer onboarding no longer returns the already-loaded AGENTS.
All routes reuse current context and setup; linked documents already supplied
by onboarding do not create repeated reads. The toolkit manual records these
four request flows in a read-order table.

Two focused checks passed: both-role context coverage and deduplication, and the
actual CLI tour launch with Studio readiness before participation context. The
MCP entry module also passed its syntax check. These checks establish command
and context behavior; no new-agent timing measurement was performed.

## 2026-09-14 — Remove the Studio tour welcome pane

The user reported the Welcome to SAAM pane on port 52107 and required tours to
start in the handle part view. Browser inspection confirmed the inactive-tour
fallback over the saved handle's toolpath view. Removed the welcome markup and
its rendering branch. The header's Tour button starts a fresh tour directly;
Resume tour is a separate header control for paused progress. Active Tour toggles
lesson guidance, and completion uses a dedicated congratulations panel.

Removed the delayed Exit handler's visibility assignment so an old exit cannot
hide a subsequent lesson. Four focused tour UI tests and the existing fresh-copy,
resume and exit integration test passed. Browser checks on port 52107 confirmed
direct handle startup and ordinary geometry after exit without an introductory
pane. The saved edited handle and its delivered program were preserved; fresh
local tour copies were created for the browser checks. No print approvals or
hardware actions were performed during this development follow-up.

## 2026-09-14 — Onboarding leaves skill selection to the agent

The user clarified that both onboarding paths should include the complete skill
digest while skill manuals remain individual follow-up reads, chosen by the
agent's judgment for the task. Both paths now return the existing digest and
explicit follow-up guidance. Removed onboarding's manual-bundling options and
added `read-skill` and `read-guidance` for one chosen manual or section at a time.
Failure inspection returns skill references instead of full manuals; tour
participation guidance remains bundled. The user rejected an added catalog
label, so existing skill descriptions and catalog presentation are preserved.
All seven toolkit tests passed, including complete catalog links in both roles,
separate manual reads, reference-only failure inspection and tour startup.

## 2026-09-14 — Tour cues and shared Studio activity (BR-048 completed)

The current user requested that live tour reports be banked without fixes, then
released the hold: “Okay tour is done, you are go to make changes.” Contributor
account, exact conversation title and stable session reference are unavailable.
The same conversation requested step-3 geometry fading, two step-4 arrows,
an audit of dots missing during rebuilds or lingering after results arrive, and
viewport fading during shared Studio activity. Later requests added Exit tour
on Congratulations, “request any other change”, and equal colors and blinking
for Continue with this part and Import STL.

Completed all four reports. The tour alone dims geometry at its saved-print
lesson and gives both step-4 choices large arrows and matching slate-blue
highlights. Congratulations offers Exit tour and stays dismissed after exit.
Shared Studio dots and the 28% viewport opacity now use one work state. Requests
record their input baseline and optional prepared-result target; visible result
receipts stop activity independently of delayed agent acknowledgements. Viewer
loading also contributes activity. Source inspection established that the old
request ledger and viewer readiness could disagree; the exact cause in the
original live run was not recorded.

The user clarified that waiting for an answer is idle and intermediate display
is optional. Other active edits may keep activity visible after an intermediate
result lands; pauses, errors, interruption and supersession do not obligate the
agent to deliver abandoned edits or intermediate previews. The tour manual
summarizes this in one sentence; Studio owns the coordination details.

Verification: 26 focused Studio work, UI, tour and agent tests passed, plus three
focused MCP checks. The completion integration check passed again after marking
the closing message as guidance. Browser checks showed equal step-4 choices,
the requested fade, activity stopping at playable-result readiness while its
request still said working, and dismissal of the Congratulations panel through
Exit tour. Fixtures used isolated libraries and synthetic approvals/completion
receipts; this is software evidence, with no hardware trial. Removed resolved
BR-048 from the outstanding queue.

## 2026-09-14 — Bundled agent CLI operations

The user requested the proposed onboarding, tour, preview, work-context,
wait/claim and failure-inspection bundles as a CLI toolkit, with a breakdown of
each command. Added `scripts/agent-toolkit.mjs` over shared exported APIs and the
`npm run agent` alias. Studio commands also run through the existing
`node studio/server.mjs --toolkit` launcher, emit the URL before the remaining
context, and retain the managed process. Onboarding reads the current owning
manuals and selected references; it observes dependency availability without
running setup or regression checks. Later failures report retained bundles and
close the call's own server. The [toolkit manual](core/agent/README.md) records
each command's contents and limits.

Moved the published-manual reader behind a CLI/MCP shared owner, retaining the
adapter import path, and shared the existing browser opener. The shared request
wait accepts optional claiming, including through MCP. Toolkit request responses
also pass through the current prepared-result and guidance semantics. Updated an
older STL-access regression to reflect the existing documented automatic-units
default rather than expecting mandatory explicit units.

Verification: all 36 selected tests in `agent-toolkit.test.mjs`,
`mcp-access.test.mjs`, `mcp.test.mjs` and `studio-agent.test.mjs` passed. A subsequent
focused SDK check of the added `claim:true` route also passed. Fixtures use
isolated temporary libraries and synthetic approvals; coverage includes fresh
tour geometry over HTTP, the actual CLI launcher, preserved approved export
bytes on reopening, STL bytes/units, request correlation and partial failure.
This establishes software behavior, not browser-render timing or physical print
results. No end-to-end time/token savings were measured.

## 2026-09-14 — New tours begin at the first lesson

The user required new tours to begin at the beginning. The Studio launcher
without a print path now starts a fresh tour instead of resuming saved progress.
Start and restart reset to lesson one, retain earlier saved parts, and clear the
old model's playback layer; a launcher-supplied layer is applied to the new tour.
Explicit resume retains the saved lesson. Four focused state and UI checks pass,
including restart from a later lesson and separate start/resume button actions.

The user clarified that both examples must be pristine bundled versions and
reported 75 seconds of orientation before launch. Fresh start now creates both
copies immediately. The extended restart regression edits both old copies and
checks the new plans against their original bundled sources, including the roof
manifest, while retaining previous edits. It passes. A single isolated startup
measurement took 1,410 ms: module imports 378 ms, fresh copies/start layer 805 ms,
and server plus first geometry response 226 ms. This excludes agent orientation,
browser rendering and the CLI's preliminary bundle read; it does not attribute
the reported 75 seconds. The entry-point guidance now routes tour requests through
a short launch section, defers skill reads until edits and loads participation
guidance while lesson one is visible. No end-to-end latency claim is established.

## 2026-09-14 — Experimental plastic-weld skill

The user requested injected plastic rivets: blind shafts with wider bottom
basins, individual reinforcement sites and staggered overlapping heights. They
emphasized reuse of the shared core and interoperability, then explicitly
accepted sparse hosts when each cavity has a sealed envelope. Added adjustable
1.2 mm shafts, 3 mm tapered basins and a 4 mm example depth, with metered volume,
flow, nozzle seating, hold and optional operation temperature. These are trial
values, not physically established settings.

Shared planar reservations leave cavities empty; existing complementary
full-fill masks enclose them in sparse interiors. The shared composer orders
stationary injection before cover layers and carries normal travel and cooling.
Regional surface publication can expose a completed mouth with its injection
dependency. Added shared stationary extrusion and nozzle-temperature actions,
S5/H2D E-only output and source interpretation, and Studio injection markers.
Relay robot output and nonplanar deposition through a cavity fail explicitly.

Verification covers an independently calculated stepped cavity volume,
solid/sparse ownership, staggered heights, flat region boundaries, completed
surface consumption, translated mesh/vase composition, temperature restoration,
source playback and exact-byte delivery with synthetic test approvals. Focused
composition, modal export, pipeline, regional workflow and infill regressions
pass. The unapproved CLI coupon in `Prints/plastic-weld-trial-20260915` generates
9,950 moves with two approximately 8.18 mm³ injections. Browser inspection shows
the first injection's fixed position, volume and temperature in Studio. No
hardware ran; pressure sealing, fusion, strength and thermal behavior need
physical tests.

Source-player, skill-digest and material rendering checks pass, including the
updated expectation that stationary deposition uses an event marker. The broad
documentation check reports unrelated existing backlog statuses/anchors
(BR-045 and references to BR-005, BR-018, BR-023 and BR-039); no weld manual link
failure is reported. Whitespace checks pass.

## 2026-09-14 — Tapered heat-set gussets

The user revised the heat-set fins to brace the sleeve/front-face joint with
approximately double root thickness, taper and a triangular vertical profile.
Radial reach now grows linearly from the blind-hole floor to the full length at
the insertion face. Thickness tapers from twice the nominal fin width at the
sleeve to nominal at the outer tip. Shared scanline fill supplies each trapezoid
layer and the existing material reservations keep ordinary fill out of it.
Targeted tests verify the diagonal boundary, 1.6 mm nominal roots for 0.8 mm fins,
actual joint bead coverage, six unchanged loops, and composition without duplicate
fins. The existing development example is regenerated; physical behavior remains
unmeasured.

## 2026-09-14 — Heat-set inserts and standard parameter policy

The user requested catalog-specific receiving holes, exactly six local loops,
and fins joining the sleeve to the front insertion face, then confirmed radial
fins and authorized selecting one initial manufacturer. Added 60 SPIROL Series
19/29 metric/imperial variants with primary-source dimensions. The named standard
parameter policy now has one owner in MAKERS.md, referenced by the shared tools,
Studio and skill-author guidance. Reuse remains distinct from job approval.

The feature compiles through the shared solid kernel and adds local deposition
details to the shared planar producer, preserving full-fill, sparse/solid masks,
assembly placement, material regions, text, normal export and Studio review.
Initial holes are blind with flat Z-normal insertion faces; other axes require
part reorientation. Catalog dimensions, loop counts, material exclusion, edits,
regional composition and MCP routing have software coverage. The development
example is a 54 × 32 × 12 mm block with M3-long and 4-40-short bores; no physical
fit, strength or manufacturing approval is claimed.

Date entries by the work or observation when evidence supports it; cite the
dated source or commit and distinguish request, checkpoint and completion dates.
Preserve explicit follow-up dates and timezones. If the work date is unknown,
say so and record the recording or migration date separately; never infer it from
file modification time. Record actual verification scope, without copying entire
contracts or turning test counts into claims of physical success. New entries
need no build-request ID; preserve an existing ID when moving its work record.

## 2026-09-14 — Timed tour pass and approved speed fixes

The participant used Adam for the maker role while developer commentary tracked
the tour. The pass ran on September 15 UTC (September 14 Pacific). Source fixes
waited until the participant completed the tour and received the timing workbook;
the subsequent audit preceded the approved performance implementation. Gyroid
contour optimization was explicitly deferred to a later session, with the user
carrying that request.

Observed baseline boundaries, including agent/tool orchestration where stated:

| Operation | Observed time |
|---|---:|
| Adam on base: request to resolution / text command | 27.205 s / 0.934 s |
| Adam on roof: request to resolution / text and adjustment commands | 52.264 s / 10.926 s |
| First roof: entering toolpath lesson to saved generation | 36.296 s |
| Infill edit: request to resolution | 184.706 s |
| Avoidable wait before starting infill generation | approximately 113 s |
| Bambu edit: request to saved generation | 44.293 s |
| Completion event to agent claim | 19.558 s |
| Isolated final-roof generation, 799,015 moves | 14.152 s |

Request durations include orchestration and are not pure model CPU time. The
tour's final-lesson-to-download interval included human dwell and cannot measure
export latency alone. Ignored `.local/tour-speed-20260915/` holds observer events,
the timing workbook, audit, profiles and replay scripts. The workbook separates
operation boundaries, command times and unattributed remainder.

Implemented: selected-part preparation during step 4; automatic generation after
tour process/machine edits; current checked development-to-production reuse;
compact CLI adjustment output; scratch-row material construction; and completion
rendering without a full source reload. The CLI listener can claim in its wait
call, and maker guidance prioritizes ordinary completion chat over bookkeeping.
Step 4 now explains preservation of saved copies and labels its keep route.
The viewport shows a spinner with actual stage percentages through generation
and loading, including printer-change generation. Notification errors no longer
mask the originating generation error.
Viewer labels also refresh when the printer, name or generation mode changes
without replacing the displayed motion buffers.

The same isolated Bambu export changed to production mode in **0.172 s**, with
identical bytes/hash and no toolpath approval. This measures a warm checked-source
transition, not a full cold opening. A same-process material comparison, with
before/after order reversed on the second pair, measured old construction at
18.835/23.080 s and new construction at 10.105/11.667 s: **48.1% lower mean**.
Machine load varied substantially, so these absolute durations are not a promise
of browser latency. Both versions retained all 799,015 moves and 240 material
groups. The earlier profiled baseline was 6.955 s for material construction;
do not compare it directly with the later contended run.

Verification: targeted program-cache, source-player, Studio opening, tour,
tour-UI, material, agent-request and reconnect checks passed after correcting
outdated completion expectations and a progress fixture. Coverage includes stale
bytes/recipes, geometry and final-review gates, worker retry, stage counts,
single-call request claim and identical material buffers across chunk boundaries.
Browser inspection of a separate audit print verified the centered loading card,
live percentage/progress bar and completed toolpath view. No second maker tour
has yet measured total interaction time, and these software checks establish no
physical printing result. Concurrent mesh/text work was preserved separately.

## 2026-09-14 — Shared CGAL mesh repair and larger STL handling

Nave requested replacement of the rejected repair implementation and removal of
its code and documentation. Shared core now owns exact cleanup, CGAL 6.2.1 patch
repair, explicitly bounded hole filling, shape-change reporting and source/output
validation. Smoothing is disabled. The retired implementation, its dependent
simplifier and their tests/instructions were removed at the user's request.
Current behavior is in the [geometry reference](core/geom/README.md#explicit-mesh-repair).

The supplied 8,220-face vase passes the shared file repair entry, exact STL
reimport and full-fill/planar-infill slicing. Cleanup removes 96 degenerate faces;
CGAL replaces 75 cleaned source faces with 27 faces, retaining 8,049 original
faces geometrically unchanged. Output has 8,076 faces. The measured file repair
trial took 2.891 seconds, including checks and serialization; its CGAL step took
0.472 seconds. Sampled distances reached 0.816 mm source-to-result and 0.622 mm
result-to-source. Samples include vertices and face centroids, and do not certify
a continuous error bound. The software slicing result contains 427,200 moves.
Temporary models and bundles were deleted; the supplied original was preserved
and the accepted review retained in RAM. This is not a physical print result.

The CGAL patch function is distinct from experimental self-union, which fails on
this vase. Local probing also found that snap-rounded autorefinement followed by
self-union retains that exception, while autorefinement followed by patch repair
fails validation. Those chains were not adopted as automatic fallbacks. Broader
exact Boolean repair remains a potential evaluation of established kernels,
including [libigl arrangements](https://libigl.github.io/tutorial/#boolean-operations-on-meshes),
not an implemented capability or a new deferred request.

STL paths now stream through import and repair, source hashing and output writing.
Validation uses packed edge incidence, an AABB hierarchy, compact cached normals
and fixed-size content hashes, with 32 MiB of retained derived cache data. A
configurable working-set estimate replaces the fixed face-count gate. Repair
runs off the caller's main thread. Accepted geometry is emitted in full-quality
chunks with stage percentages and consumer backpressure; native patch progress
is indeterminate. No Studio source was edited by this task. Indexed meshes,
CGAL and downstream bundle serialization still require memory; this does not
establish unlimited or fully disk-backed mesh handling.

Verification: focused tests exercise cleanup/stitching, a penetrating-fold repair,
unchanged remote facets, hole limits, orientation repair, timeout/cancellation,
shape-change rejection, source preservation, exact geometry chunks and S5/H2D
unapproved import. A 196,608-face ASCII fixture streamed, validated and sectioned
without simplification; its complete test took 10.75 seconds in the measured run.
Existing mesh slicing/lifecycle tests passed. Native compilation was tested on
Windows; a separate Linux CI workflow builds pinned CGAL before these tests.
Native repair has its own [build and license notice](core/geom/native/README.md).

## 2026-09-14 — Mesh compatibility, memory work and experiment boundary

Nave clarified in “Find permitted 3D model sources” (session
`01a0a26a-f0d5-7dc2-976f-bdc942252d21`) that production mesh import, repair, memory
handling and geometry progress are shared core work intended for remote
contribution. Test runners, downloaded evaluation dependencies, profiles, raw
research and reports remain ignored under `.local`. The scope audit found no
unresolved category ambiguity. Core has no runtime dependency on the experiment
directories. No publication was performed by this task.

Cura research examined pinned upstream development revisions on September 14.
[Uranium's STL reader](https://github.com/Ultimaker/Uranium/blob/94404148091d157b29ba080acd47b5949c9d0bb8/plugins/FileHandlers/STLReader/STLReader.py)
sets a 100-million-facet parsing ceiling; this is not a demonstrated memory
capacity. Its mesh arrays use compact NumPy storage. CuraEngine retains mesh
data during sectioning, releases mesh data after cross-sections, and advances
through a bounded layer-plan buffer; it is not wholly out-of-core. Relevant
sources are [mesh storage](https://github.com/Ultimaker/CuraEngine/blob/5abf5ec15b4d9f57b45a71401bd7d5f4fb1db20c/include/mesh.h),
[stage lifetime](https://github.com/Ultimaker/CuraEngine/blob/5abf5ec15b4d9f57b45a71401bd7d5f4fb1db20c/src/FffPolygonGenerator.cpp)
and [layer buffering](https://github.com/Ultimaker/CuraEngine/blob/5abf5ec15b4d9f57b45a71401bd7d5f4fb1db20c/include/LayerPlanBuffer.h).
The applicable direction is compact storage and deliberate intermediate lifetimes,
measured before increasing SAAM's limits. Raw source copies and revision manifests
remain in `.local/cura-research`; no upstream algorithm was ported by this audit.

## 2026-09-14 — Shared circular text and tour failure recovery

The participant requested a checkpoint before touring, then raised “groucho”
lettering on the fin and in a circle on the wavy roof. The initial full-circle
spacing was too wide; the participant accepted the closer upper arc and requested
that surface support be generalized into core. Local checkpoint `ec697ac` saved
all pre-tour non-ignored work. Subsequent development remains uncommitted.

Shared text layout now supports an explicit circular baseline alongside the
existing straight and Bezier layouts. A `top` reference reuses spline/mesh height
and normal queries in physical XY, replacing the example-specific sampled guide.
Existing UV and independent references remain supported. Public editable recipes
retain the original body, font and features. The same wavy-roof geometry was
rebuilt in `Prints/development/groucho-core-top` with the new concise recipe,
without altering the tour participant's geometry during playback.

The participant reported geometry remaining visible at the playback lesson,
missing dots/toolpaths, and a later reconnect failure. Toolpath lessons now select
the toolpath view before a program exists and show preparation status. Failed
transitions refresh the saved lesson before reporting the error, so later refreshes
do not erase it. Ready programs clear old preparation text. Explicit generation
failures queue the exact cause to the maker agent; guidance requires diagnosis
and appropriate corrections before regeneration, followed by visible verification.
Repeated identical failures for the same plan reuse the request.

The lettered roof's draped-skin generation failed on discontinuous glyph roofs.
The agent explained the switch to planar printing, generated its preview, then
applied the participant's concentric infill choice. A server running earlier code
initially rejected the new output as stale. Restarting without refreshing the page
also left obsolete session credentials, causing repeated acknowledgement failures.
Server instance identities now trigger a browser reload before new requests;
obsolete session tokens remain rejected. The live tour recovered after reload.

Verification: existing text tests plus analytical circle direction/arc-length and
spline-height/normal checks, mesh top references, and a public circular-lettering
regression all passed. The latter verifies deposition above an analytical wavy
roof for every letter of “groucho”. Studio tests cover pre-program tab selection,
ready seeking, retained errors, correlated failure requests, corrected generation,
actual browser polling after restart, changed server identities and old-token
rejection. An isolated browser also recovered automatically after a real
server restart, returning to usable controls without manual reload. The live concentric toolpath and the isolated core-top geometry were visually
inspected. The repository documentation check still reports unrelated backlog
status and missing backlog-anchor issues; the text manual’s existing underside
anchor is preserved. No physical print result
or manufacturing approval was supplied by the agent.

## 2026-09-14 — Prompt tour updates, listener delivery and completion panel

The participant reported stationary dots/highlights, late geometry unlocking and
chat messages, a missed infill request, early toolpath loading, and one transient
saved-print load failure. Selected simple bold tour copy for every lesson and
requested a finished panel plus prompt chat congratulations, printing help and
a next-project invitation. These changes preserve the Studio-first introduction.

Removed the reduced-motion rule that disabled these two animations; both now use
opacity/color changes without movement. Tour highlights use a simple slate-blue
outline. Library file events notify Studio immediately, with polling retained as
fallback. The geometry-edit gate opens on the exact rendered update, independently
of the agent's later acknowledgement. Toolpath state, decoding and speculative
generation stay absent until the optional STL lesson is completed. Import-layer
requests are queued after generation, so the requested toolpath exists when the
agent receives them. Reads spanning plan/geometry replacement retry briefly;
persistent validation errors still fail. The participant's original one-off load
error did not reproduce during this check.

MCP begin/respond/wait calls no longer wait behind other tool calls. Pending
Studio requests produce standard MCP logging notifications and appear in ordinary
object-valued tool results, supplementing the authoritative wait/list endpoint.
Guidance requires begin-work before acknowledgement and sends edit responses in
commentary before waiting. CLI guidance now explains that a returned running
session ID must be followed until its JSON event arrives; starting a background
listener and ending the turn loses that delivery. Notifications cannot guarantee
that an ended host turn wakes. Completion guidance explicitly offers help with
difficulties printing the downloaded file. The panel shows congratulations and
invites the next project; stale lesson-status text clears on transition.

Targeted tests covered nonblocking waits/status updates, pushed MCP notifications,
independent disk writers (51 ms in the notification test), geometry unlocking with
an outstanding request, both STL-lesson exits, preserved approval/export behavior,
transient-read retry and completion guidance. Browser inspection confirmed changing
dot opacity, active outline blinking, uniform bold copy, geometry-only step 4,
toolpath after Next, and the finished panel. Isolated test prints were removed;
the live Studio was refreshed with the participant's completed tour preserved.
These checks establish software behavior, not physical printing results.

## 2026-09-14 — STL flow, geometry selection and agent connection closure

The participant approved the panel expansion/hiding and tour locks, replaced the
STL units popup with a size-based assumption across ordinary and tour imports,
and clarified that selecting the print is geometry confirmation before toolpath.
The shared importer now records assumed units and supports later correction of
plain imported meshes without losing mesh edits or settings. [D-030](DECISIONS.md#d-030--provisional-stl-units-assumption)
records the deliberately provisional policy. Studio records the chosen geometry
before preparing its tour toolpath; final export confirms settings/toolpath.
Normal fresh imports remain in geometry review.

The participant kept the ten-minute request timeout and requested a connection
close handler. MCP ownership follows requests created or claimed by that adapter
and requests queued by its Studio servers. Transport close fails its unfinished
requests and pushes a viewer event before server shutdown. The indicator replaces
dots with italic “(connection closed)” or “(request timed out)”; other active
requests retain dots. The client also evaluates cached expiry if polling fails.
An ended chat turn need not close MCP, and abrupt process death may skip cleanup.

Targeted request/tour, STL, MCP and Studio open/lifetime checks passed, including
an actual SDK transport close with independent outstanding work and an SSE viewer.
Two test expectations were corrected during verification: floating-point scaling
uses a tolerance, and the EventSource stub now supports event listeners. An
isolated browser showed the italic close message replacing dots beside the logo
before its server disappeared. Test bundles were removed. Studio was restarted
on its existing port and refreshed at lesson 1 with progress preserved and no
unsolicited maker-chat prompt. These are software checks, not physical prints.

## 2026-09-14 — Preserve Studio-first tour guidance

The participant corrected the unsolicited first-task chat prompt: the tour's
early guidance belongs in Studio, with proactive chat teaching introduced later
at the designated infill lesson. Removed the first-task invitation and post-import
Play invitation from agent guidance, and distinguished silent start-layer
preparation from chat teaching in the maker, tour and MCP instructions. The tour
was not advanced or restarted during this audit. Other discretionary flow choices
were disclosed for review rather than changed as part of this correction.

## 2026-09-14 — Stitch collapsed-face seams during mesh cleanup

The disposable Thingi10K test exposed incomplete cleanup: removing four collinear
triangles from file 63535 left one long edge opposite five shorter edges. Cleanup
now splits the surviving face at existing vertices when a complete, oppositely
directed collinear boundary chain is available. This retains coordinates and
winding. Shared Studio files were not edited.

All 12 mesh-repair tests passed, including a subdivided tetrahedron with unchanged
analytical volume, rotated/translated coordinates, source preservation,
idempotence, public repair/reimport and rejection of an actual missing face.
Thingi10K 63535 then repaired and sliced successfully: four collapsed faces
removed, one edge stitched, four triangles added, 1680 output triangles, unchanged
bounds and zero sampled vertex distance in both directions. Its checked toolpath
was opened through the local in-memory Studio inspection adapter; downloaded and
generated files were deleted. This is software evidence, not a physical print.

## 2026-09-14 — Tour feedback, STL lesson and agent coordination

Completed BR-046 after the participant explicitly released the earlier deferral
in task 01a0a19d-25eb-7fa3-9e55-d1b97ee544fc (exact title unavailable; participant
addressed as Nave, contributor account unconfirmed). The pass requested flashing
highlights, recognizable filenames, immediate advancement on file selection,
automatic maker guidance and Next remaining locked until updated output is shown.
Later messages added global dots beside the logo, an optional STL lesson, eight
different copy treatments, and required downloading to complete the tour.

Studio now uses eight lessons. Existing seven-lesson progress migrates without
discarding edits. Print selection advances directly to optional STL import;
Next retains the selected part, while importing a valid model advances to
playback and requests an explicit infill layer from the maker agent. The ordinary
Import STL button uses the shared importer, explicit units and retained source
bytes, opening unapproved geometry. UI names and downloads describe the part.

Edit gates require an acknowledgement of the current rendered revision/export;
outstanding agent requests also keep them locked. Correlated persistent requests
cover ordinary Studio work and tour events, with bounded MCP/CLI waits and
ten-minute leases. Only three animated dots appear beside the logo while requests
are pending. Maker guidance requires immediate begin/claim and matching response,
and active waits between lessons. The transport reaches an active connected
agent; no idle-host wakeup or disconnected-chat delivery is claimed.

The final confirmation prepares production output, checks it against the displayed
export, downloads the same bytes and completes the tour. There is no Finish tour
button; Exit restores normal controls without completion. A browser test exposed
a worker-cloning failure when approvals changed but source bytes did not; rebinding
now uses the fresh source metadata before reusing the decoded move store.

Software evidence: targeted Studio tour/request and MCP integration checks passed,
including ordinary overlapping requests, import success/failure and units, both
import-lesson routes, stale preview rejection and exact-byte tour export. Browser
checks used an isolated synthetic handle for file selection, five seconds of
playback, guidance dots, generated gyroid/four-wall update, printer/material and
download completion. These are software checks, not physical print evidence.
Repository documentation validation also reported pre-existing missing backlog
anchors and an unrelated BR-045 status-format issue; these were not changed here.
The edge-selection follow-up was held until the next pass was launched, then
completed as recorded below.

## 2026-09-14 — Edge names after launching the next tour pass

Completed BR-047 after its explicit deferral condition was met: the new eight-step
tour was opened on its first lesson at the same Studio URL before implementation.
The participant (addressed as Nave, account unconfirmed) requested “edge select in
the geometry preview, like the current surface select ... (to see names)” in task
01a0a19d-25eb-7fa3-9e55-d1b97ee544fc; exact task title unavailable.

Geometry preview now picks visible boundaries/creases within six screen pixels,
highlights the chosen edge in orange and shows adjacent feature names plus its
edge number. Surface-interior picking is preserved. Chains join curved rims but
split at junctions; hidden edges, holes and triangulation diagonals do not become
false hits. These are revision-scoped display identifiers; no source geometry or
manufacturing approvals changed. Eleven geometry/visibility tests passed, and
the live tour handle showed “Fin/front / Fin/top · edge 1” with its orange highlight.

## 2026-09-14 — Combined confirmation and interactive maker tour

The user expanded the Studio/tour scope in this task: remove standalone settings
confirmation and teach geometry edits, saved-print switching, playback, chat-led
toolpath changes, printer/material choices and export.

- Studio now has geometry confirmation followed by a combined settings/toolpath
  confirmation. The latter binds both hashes in one human event and preserves
  the existing persisted plan fields for compatibility. Full settings are
  expandable in toolpath view. Production generation requires geometry approval;
  delivery retains exact-export approval and byte-identity checks.
- Added a raised-fin starter and seven lessons with geometry, file-selection,
  five-second visible-playback and settings-change gates. Agent-selected sparse
  infill start positions leave the speed and timeline controls free. Exit and
  finish restore normal controls; edits and saved copies survive navigation.
- Added tour progress/chat instructions, bounded MCP progress waiting, explicit
  start-layer control and printer changes through shared tools. Maker guidance
  now establishes known last-used printer/material choices, or asks when unknown,
  before toolpath view, and retains chat adjustments afterward. Completion
  guidance asks the maker agent to congratulate the participant and invite her
  next creation. Export guidance explains USB transfer directly to the printer.
- Verified workflow, cache, Studio opening, MCP, tour gates and affected machine/
  skill lifecycle tests. Updated obsolete three-confirmation test expectations;
  focused reruns passed. Walked all seven lessons in an isolated browser tour,
  including edited-copy selection, layer-13 infill start, free scrubbing/speed,
  playback unlock, changed infill, printer highlight, export and completion.
  Restarted the user's tour at the unchanged starter with Next locked.
- The repository documentation checker reported concurrent backlog status/link
  issues (BR-005, BR-018, BR-023, BR-039 and BR-045), outside this tour change.
  No manufacturing approval or hardware action was performed.

## 2026-09-14 — Large wavy canopy on all four box sides

`remettub`, in “Add wave overhang spline skill”
(`01a0a191-8027-7f13-bf42-7b88316cc5ed`), requested a much bigger wavy spline
surface projecting beyond all four sides of the box.

- Added the reproducible `canopy-example.mjs` recipe: a C2 bicubic surface
  with a 24 mm flat seed aligned with the top perimeter centerline of a
  24.4 × 24.4 × 10 mm box. Its rounded outline follows about 33 mm of surface
  growth on every side. The manual links the preparation and preview commands.
- The larger example exposed thin residual strips from constrained polygon
  construction at the rim. Terminal handling now tests whole-residual
  containment in a small expansion of reached material, scaled by sampled
  native derivatives and the existing physical tolerance, before extracting
  another front. Residuals stay explicit; this does not add deposition or relax
  the single-pass requirement. Earlier fixed-grid and sub-tolerance closures
  passed a small fixture but failed the full placed example and were replaced.
- Verification: 12 focused wave and public-workflow checks passed, including
  a canopy-rim regression at original and translated coordinates. The actual
  `Prints/wave-overhangs-four-sided-20260914` bundle generated in 57.6 seconds:
  110 fronts in one pass, 34,665 interpreted wave movements, all extruding,
  with no internal rapid move or dwell. Its wave extent is 89.78 × 89.79 mm,
  Z=8.334–11.666 mm. The report retains 129 thin residual regions with a
  derivative-scaled UV band of 0.0000412924; their long diameters are not
  mislabeled as sub-tolerance lengths. Inspected partial/live playback and the
  completed canopy in Studio with travel visible. This remains a development preview,
  without physical printing evidence or manufacturing approval.

## 2026-09-14 — Wave continuity correction; hole case remains incomplete

`remettub`, in “Add wave overhang spline skill”
(`01a0a191-8027-7f13-bf42-7b88316cc5ed`), reported broken loops and travels and
required unbroken continuous passes per layer. The user then supplied
[Janis Andersons's short](https://www.youtube.com/shorts/RxPW5A4__X4) and clarified
that the perpendicular glue jogs came from SAAM, not a requested exemplar.

- Removed coincident-outline clipping that discarded front segments, and removed
  stationary perimeter tails from the extrusion paths. Constrained offset
  cleanup now uses Clipper2 simplification with native derivative scaling,
  preserves boundary contacts, treats small boundary-tangent drift, samples
  obstacle tangents and refines boundary interactions more closely. Collapsed
  contours remain as explicit sampled-width diagnostics rather than bead loops.
- Accepted slices use one atomic operation/stroke with short in-domain surface
  turns. Travel, retract and cooling are absent between their fronts. Separate
  passes cause a generation error; the earlier hole recipe is now refused.
- Inspected the supplied short's visible frames and linked explanation/description,
  and the slicer fork's settings/traversal source. Its Zig Zag mode permits branch
  restarts. No special glue-jog method or universal single-pass guarantee was
  established. No research/slicer source or asset was copied into SAAM. The
  published paper and dataset version 2 were located; full paper text and video
  transcript remained unavailable.
- Verification: 33 selected wave, public workflow, surface-offset and shared
  boolean/offset checks passed. The export continuity assertion also passed
  after strengthening it to inspect actual G-code lines. The new local
  `Prints/wave-overhangs-continuous-20260914` diagnostic example intentionally has
  no hole: 16 fronts, one operation, 271 interpreted wave movements, all extruding.
  Generation took about 1.2 seconds locally. Studio partial and live playback
  were inspected with travel visible. No physical print or approval occurred.
- The original hole recipe is preserved and fails with five required passes.
  Matching reference-style branch restarts versus enforcing a whole-slice
  continuous path remains a pending human clarification. Whole-slice continuity
  remains enforced; no exception is inferred. The new example does not establish
  completion of the requested hole capability; see BR-045 in
  [outstanding work](build_request.md#outstanding-work).

## 2026-09-14 — Tour continuity and a stronger opening roof

- Applied the collected tour feedback: wavy roof, Nudge Cup, then DENSO;
  sequential Next/Back navigation; personal-print choices after completion.
- Separated tour membership from packaged-preview validity. Chat adjustments
  retain the current step and edited copy across navigation and reopening.
  Changed toolpaths use the shared generation worker in development mode,
  without granting human approvals.
- Replaced the opening roof with a 100 × 60 mm wave surface and a 6 mm fall
  toward one edge. Generated and packaged its current source and display.
  The generation check reports a 14.574° maximum roof slope and zero excluded
  roof area; drainage and physical printing remain untested.
- Eight focused checks cover navigation, finish gating, edit persistence,
  development generation after edits, cache handling and downhill roof geometry.
  Inspected the restarted first screen with its disabled early-exit controls.

## 2026-09-14 — Wave overhangs on bivariate spline slices

- Contributor: `remettub`, explicitly identified in this conversation.
- Authorization: human requested — identify the wave-overhang technique seen in
  a YouTube short, check applicable licenses, and build it generalized to SAAM's
  bivariate spline slices. Clarification explicitly selected curved spline
  surfaces with flat slices as a special case.
- Session: “Add wave overhang spline skill”
  (`01a0a191-8027-7f13-bf42-7b88316cc5ed`).
- Source: current conversation, 2026-09-14: “We need that capability, but
  generalized to our bivariate spline slices … then build that skill”. The
  user also reported X-wise artifacts during playback and confirmed Grasshopper
  is available as an optional reference host; no Grasshopper execution was needed.
- Context: match the published laterally attached expanding-wave technique,
  retaining native spline geometry and the existing review/delivery workflow.
- Implementation: [wave-overhangs](skills/wave-overhangs/SKILL.md) uses original
  SAAM constrained geodesic growth, explicit seeds and component dependencies,
  shared operations/export and catalog/Studio integration. The research dataset
  is CC BY 4.0; the Prusa/Orca integrations are AGPL-3.0. No third-party algorithm
  source or research assets were incorporated. Provenance and numerical limits
  are at the [implementation owner](skills/wave-overhangs/BUILDER.md).
- Software evidence: physical-spacing checks on inclined/rescaled planes and
  an independently unrolled rational cylinder; doubly curved native surface,
  hole splitting/rejoining, disconnected seeds, budgets, component/slice ordering,
  shared export and public CLI/MCP-manual/Studio settings checks. All 49 selected
  numerical, pipeline, workflow, ordering and Studio checks passed across the
  relevant runs. The skill validator and catalog/manual digest check also passed.
- Playback correction: tiny rounded E increments divided by very short Y moves
  produced spurious X-wise bead widths (one 0.00001 mm move displayed as a
  31.897 mm bead). Wave output has no retained across-path surface normal, so
  Studio uses its existing curved-surface centerline display. The machine program
  is unchanged by this display fix; partial and live browser playback were checked.
- Reproducible development example: a 5 × 5 × 1 mm box anchors a saddle surface
  extending 5 mm around a hole. With 0.3 mm front/propagation spacing it generated
  18 fronts, 2719 sampled points and 249425 surface evaluations; its two retained
  corner residuals have a maximum sampled diameter of 0.005647 mm. Local public
  bundle generation took approximately 2.7 seconds in this session. The finer
  0.1 mm propagation experiment exhausted the 2000000-evaluation budget; this is
  recorded performance behavior, not evidence that finer settings always cost more.
- Physical evidence: none. The local preview is unapproved development output;
  no printer execution, job approval, checkpoint or publication is implied.

## 2026-09-14 — Build-request provenance audit

Follow-up correction from `remettub` in the same conversation: the initial guidance
caused agents to ask for contributor identity during ordinary builds and appeared
to require creating a request for each task. Removed the instruction to ask for
identity and the extension of backlog metadata requirements to ordinary devlog
entries. Current work proceeds directly; the queue preserves deferred/incomplete
work beyond the active task or explicitly requested backlog entries. Missing
metadata remains labeled without prompting or historical investigation during
ordinary work. The provenance audit below records the earlier findings; its
unresolved attribution does not require other tasks to ask the user again.

- Contributor: `remettub`, explicitly confirmed in this conversation.
- Authorization: human requested — recover contributor accounts, session titles
  and originating context for existing requests; check completion/applicability;
  require explicit human requests or human-approved agent proposals going forward.
- Session: “Audit build request provenance”
  (`01a0a188-d7e2-7020-8927-966a5cc4c146`).
- Source: current request, 2026-09-14: “We need provenance for all build requests”
  and “All build requests should be explicit human requested or agent proposed and
  human approved”. This authorizes the audit and guidance, not the underlying work.
- Context: The queue contained eight remainders whose generic “user” attribution
  and links to checkpoint records obscured who requested them and whether later
  acceptance work had actually been commissioned.

Reviewed the eight entries at `d686269`, their introducing/history commits, current
owning sources and available local Codex conversations from September 8–14.
Recovered human messages from primary sessions, including archived continuations;
subagent prompts were not used as human authorization. Session titles are the
exact titles in the local session index as observed on the audit date; they can
have been renamed since the original request. UTC timestamps below come from the
message records, and can fall on the day after an older local-date devlog entry.
This was a documentation/status audit, with no new printing, benchmark or live
Claude Code experiment. Private transcripts remain local and untracked.

Account attribution is the remaining evidence gap. “SAAM reset”
(`01a08244-f5ff-79b2-a3ab-869b8a2fd04b`), at 2026-09-08T20:07:35Z and its
20:25:19Z continuation, explicitly says “tkeller, and remettub (us)”. That
establishes `remettub` for that session. This audit's speaker also confirmed
`remettub`. The other originating sessions do not explicitly name their speaker;
same-computer continuity and Evan Buttemer/remettub Git authorship suggest an
attribution but do not confirm it. Their Contributor fields remain unconfirmed
pending the requested historical-account clarification. `tkeller` being the author
of an old material-library concept does not identify the human approving BR-044.

| Prior request | Disposition and evidence |
|---|---|
| BR-005 | Narrowed to the explicitly requested S5 wedge print. “Build Ultimaker S5 wedge demo” and “Fix S5 export and wedge extrusion” contain direct implementation/print requests; the source excerpts and IDs are in the surviving request. Software and partial physical reports exist, but no recovered complete outcome for the corrected startup. The broader evaluation extends the agent's first-proof recommendation in “SAAM reset” and the comparative proposal preserved by `e87477a`; no explicit approval of a novice/comparative study was recovered. It remains a labeled proposal, outside this request. |
| BR-018 | Retained. Human requested H2D support, reported layer-two over-extrusion, then said to remove H10 and try that revision. The current Bambu contract still uses v2 and calls for physical testing. No corrected physical result or independent program-viewer acceptance was recovered; model-import rejection is a different check. |
| BR-023 | Retained with later partial evidence. “Benchmark spline slicing speed” explicitly requested Cura/Bambu and Studio comparisons. “Speed up studio confirmations” later records a human Cura result of 7.2 seconds and agent-reported SAAM timings, but no recovered controlled Bambu comparison or full matching profiles/repeats across clients. |
| BR-034 | Retained as unfinished acceptance of approved implementation. In “Scope agent Studio permissions”, the agent proposed repository launcher rules at 2026-09-10T16:26:59Z; the human approved and added Claude at 16:27:53Z. The implementation report states that Claude Code was absent. No later live Claude permission result was recovered. This does not expand into a new permission feature. |
| BR-039 | Retained. The human explicitly requested the 10–12 second target and cross-skill validation cleanup, then renewed the speed overhaul. Later measurements still miss that target. Current `generatePath` in core/print/generate.mjs and skills/wedge-demo/scripts/path.mjs calls plan validation; `translateShell` rebuilds via `makeShell`, which computes closure; surfaceRegion and plan validation (through validateCladding) both call validateSurfaceSelection. These observations support rechecking those boundaries; they do not prove each call is unnecessary. |
| BR-040 | Removed from the queue: the requested audit and guidance were delivered. The former queue entry converted the agent's remaining priorities into a blanket obligation to resolve every finding; no approval for that expanded program was recovered. Findings remain in the original BR-040 history as proposals for consideration within future authorized work. Specific speed/validation fixes remain covered by BR-039's own human instructions. |
| BR-043 | Diagnosis/research completed in the originating conversation; the “file unidentified” remainder was stale. The requested startup-retraction software fix was also implemented. Missing physical confirmation is retained once under BR-005; it does not reopen the diagnosis or authorize firmware modification. See the recovered BR-043 record below. |
| BR-044 | Retained with its explicit deferral. The human committed to a future material-library port while withdrawing four contributions; the request approves selective conceptual adoption, not restoring the previous implementation. No port is present in the shared scope reviewed here. |

BR-040 source: contributor unconfirmed; session “Repair mesh for Bambu print”
(`01a08f18-9d61-7d90-b3c0-2c9088c6cefc`), 2026-09-11T07:38:28Z:
“We need another audit agent looking for inappropriate or mismatched precision
issues project wide” and “and guidance so it doesn't happen again”. This arose
while diagnosing the repaired vase mesh's slicing latency. The
[original audit](#br-040--dimension-aware-precision-audit-and-developer-guidance)
records findings, guidance, corrections and verification. Removing the expanded
request does not claim every numerical issue is fixed or justified.

The later “Speed up studio confirmations” record, at 2026-09-12T00:06:49Z,
reports 25.8→17.0 seconds for generation plus checked export of the repaired mesh,
about 23.5 seconds after an immediate Generate click, and about 1.3 seconds when
preparation had already finished during review. The human's 7.2-second Cura result
is at 2026-09-11T23:15:41Z. Output move counts and precision changed during that
work; these are historical task-reported results, not newly reproduced timings,
unchanged-setting comparisons or proof of the 10–12 second target. The queue's
earlier Clipper2-only context was incomplete.

Guidance now requires Contributor, Authorization, Session, Source and explanatory
Context in addition to status/remainder/completion. Completed or removed records
retain provenance and disposition. The existing optional repository checker checks
field presence and authorization vocabulary; it cannot verify human identity,
approval scope or factual completion.

Verification: the repository checker passed for 61 documents and 703 local links;
whitespace checks passed. Targeted checker probes rejected missing provenance
fields and an unapproved agent proposal while accepting the revised queue. No
manufacturing regression suite was needed for these documentation/metadata edits.

## BR-043 — S5 startup diagnosis

- Work date: 2026-09-10 for the file investigation and firmware research; recovered
  and removed from the queue on 2026-09-14. The startup retraction fix was separately
  requested at 2026-09-11T04:50:40Z.
- Contributor: Unconfirmed; neither source session explicitly names its speaker.
- Authorization: human requested — investigate observed S5 startup, verify the USB
  export, research skipping bed leveling, and fix startup retraction. No printer
  firmware modification was authorized or performed in the recovered record.
- Session: “Remove bed leveling startup”
  (`01a08c8f-9e65-71c0-8712-c73f53c0f5be`); retraction follow-up in
  “Review full repository code” (`01a08eb4-4fa4-7dc0-bfff-827d989d6192`).
- Source: 2026-09-10T18:34:07Z requests verification of `flange.gcode` on USB;
  18:45:51Z: “Confirmed that we are still doing bed leveling, even with that exact
  file you just verified.” The 18:46:46Z reply clarifies “skip bed leveling”.
- Context: Observed S5 startup contradicted the agent's inference that omitting
  explicit leveling commands would skip leveling.
- Result: At 18:35:51Z the agent reported `D:\flange.gcode` byte-identical to the
  local `pipe-flange-five-bolt-taller` export, with S5 profile revision 5 header,
  startup and shutdown, Griffin 4.4.0 compatibility, right nozzle at 215°C and bed
  at 60°C, and no explicit leveling/unused-heater commands. The human then confirmed
  leveling with that checked file. This is recovered task evidence; the file was
  not freshly read during this audit.
- Research result: At 18:48:01Z the agent corrected its earlier inference, citing
  the S5 manual's automatic active leveling. It reported an UltiTuner firmware-side
  option, with compatibility limitations and no verified per-file bypass. That
  completed the requested research; no installation, firmware change or successful
  bypass is claimed. The agent asked for firmware information and no further
  response was recovered in that session.
- Disposition: Remove stale BR-043 diagnosis from the queue. The shared first-move
  recovery correction is implemented as described in the
  [S5 observations](#2026-09-08-to-2026-09-10--s5-startup-observations);
  its unreported physical outcome is part of the
  [S5 print record](#br-005--first-complete-print).

## 2026-09-14 — Ready examples and guided Studio tour

Built the tour in SAAM_tkeller. The normal bare Studio launcher opens packaged
examples, saves copies in ignored Prints/tour, and remembers tour progress. Nine
steps cover the user’s selected rolling-hills bivariate roof, wavy DENSO cladding
and Nudge Cup. The welcome and first step explain that the agent operates SAAM
while the person guides the design through conversation and reviews the result.

Prepared snapshots and display caches use the existing source interpreter,
material renderer and machine presentation. Opening a demo needs no slicing or
extraction command. Geometry appears before the saved toolpath finishes loading.
Reference previews grant no manufacturing approvals; source/delivery and review
mutations require returning to the ordinary workflow. Changed copies use live
validation, and revisiting the tour preserves them by creating a fresh example.

Verified all nine steps in the browser, including settings without approval,
playback, DENSO Machine view, completion and reopening saved examples. Focused
tour, source-player, Studio opening and instance-lifetime checks passed 22 tests.
These are software previews, not physical print or calibration evidence.
Runtime packaging remains on the separate first-run-bundle branch.

## 2026-09-14 — Remove voxel authoring and experimental web connections

Applied the user's revised scope: removed voxel field authoring, refinement,
extraction, geometry records, CLI/MCP entry points and Studio-specific labels,
plus their dedicated tests and manuals. Removed the experimental HTTP/OAuth
bridge, tunnel launcher, Claude web-plugin packager and web-runtime probes,
including their tests, setup guidance and deferred acceptance request BR-026.
Historical records remain; the removed field manual's historical link points to
its unchanged source commit.

Text, specialized rimming, Gridfinity, ordinary stdio MCP and local-extension
hooks remain. Manifold and fontkit remain required by retained text/Gridfinity
work. Removed the direct Express dependency and refreshed the lockfile offline;
Express remains transitively required by the MCP SDK. Removed the solid helper
whose only production consumer was voxel extraction.

Verification: the complete ordinary suite passed all 425 tests with no failures
or skips in 91.8 seconds, including retained text, rimming and Gridfinity coverage.
Repository checks passed for 61 documents, 695 local links and 29 decisions; the
whitespace check passed. Existing voxel geometry is no longer a supported input;
use supported mesh geometry for further slicing. These checks establish software
behavior, not physical print success. No Git staging, commit or push was performed.

## 2026-09-14 — Remove Splitty and add three shared demos

At the user's request, removed the remaining Splitty model/profile, variants,
research lab, simulation dialect, npm launchers and associated coverage. Removed
the lab's separate Dobot viewer as explicitly requested: Studio remains the single
viewer for S5, H2D, Dobot and DENSO. Generic machine-study creation, source playback,
manual posing and the newer Euler-interpolation test remain. Adapted the fixed-rail
regression to the S5 instead of deleting that generic check.

Added the surface-drape, wavy-DENSO and Nudge Cup recipes, creation command and
individual guides, with discovery from README, maker/developer guidance and the
relevant skill manuals. Generated all three as unapproved development workspaces
under Prints/tour. The command refuses existing destinations. No private setup,
saved approvals or experimental-fork changes were copied.

Verification: all 27 selected tests passed across machine presentation, studies,
Studio kinematics, jogging, Dobot kinematics/playback and demo lifecycle. All three
demo generations passed. Repository checks passed for 64 documents, 733 local links
and 29 decision records; the whitespace check passed. An active-source scan found
no remaining Splitty registration, dialect, launch command or separate machine
viewer. These are software checks, not physical print results.

Preserved the existing SETUP.md withdrawal and DEVLOG edits, current source-time
behavior, thick-lip finishing, branding and layer controls. The broader feature
reduction remains pending user review; other skills and bridge interfaces are
unchanged. No manufacturing approval, Git staging, commit or push was performed.

## 2026-09-14 — Withdraw Windows setup guidance

Removed the Windows checkout ownership section from SETUP.md at the user's
request. The local permission repair remains in place; its historical record
below is retained. No software behavior changed.

## 2026-09-14 — Remove obsolete root files

Removed `CONTRIBUTORS.txt` and `sotvl_Spiral-Vase_repaired.stl` at the user's
request. A checkout search found no references to either filename. Current
contributor guidance remains in DEVELOP.md and CONTRIBUTING-AGENTS.md. No
software tests were needed for removing these unreferenced files.

## 2026-09-14 — Windows checkout ownership recovery

Diagnosed shell and Node REPL startup failures in a copied Windows checkout.
The Codex sandbox log showed `SetNamedSecurityInfoW` error 5 while applying a
protective deny access rule to `.git`; its owner was `CodexSandboxOffline`.
Git also rejected the checkout as owned by another account. The system and
bundled Node executables ran successfully outside the sandbox.

Restored the user's ownership of `.git` and its contents and granted that user
Full Control through an administrator-approved repair, preserving existing
access rules. Ownership repair processed 124 entries without failures. Normal
sandboxed shell execution and a minimal Node REPL call then succeeded; Git
status also succeeded under the user's account. Added prevention and diagnostic
guidance to SETUP.md. No source, remote, or runtime installation change was
needed, and no application regression tests were run for this permissions and
documentation work.

## 2026-09-14 — Remove private machine integration

Removed the private machine profile, model, study tools, associated coverage and
documentation from the shared project at the user's request. Studio retains the
shared machine viewer and supported public-machine studies.

Verification: checkout setup passed. All 27 selected tests pass across machine
presentation, constrained jogging, study transport, Studio kinematics and source
playback. Repository checks passed for 61 documents, 724 local links and 29
decision records. A current-tree scan found no remaining private-machine names
or mechanism-specific references. Git history is unchanged.

## 2026-09-13 — Publication review before fork transition

Reconciled GitHub's PR #4 merge through local merge `f4ea2d8`; its tree and
the existing uncommitted diff were unchanged. Reused the focused verification
recorded below; the whitespace diff check passed without another software run.
The user requested publication before creating a fork. Review observations
remain unresolved: tracked .NET build artifacts in `scripts/bench/obj/`, an
apparently unreferenced repaired STL at the root.

At the user's subsequent request, `npm test` passed all 465 ordinary software
tests in 72 seconds with no failures or skips. Stress tests remain separate.

## 2026-09-13 — Human contributor rules and agent guidance placement

At the user's direction in the contributor-guidance conversation, CONTRIBUTING
became human-facing and left the default agent reading path. Setup and test
references moved to focused owners. DEVELOP retained the during-work context,
selective-adoption, shared-edit, durable-knowledge and anti-check-spiral rules;
checkpoint and remote guidance moved to CONTRIBUTING-AGENTS for reading at that
stage. Blanket preliminary checkpoints, an assumed Git coordinator and mandatory
human PR review were removed. Existing authorization remained applicable.

The user's follow-up established whole-checkout commits as the default for an
authorized checkpoint: all non-ignored work, including concurrent contributions
and unfinished increments, unless explicitly excluded. Recording shared state
did not establish completion, review or selective-adoption approval.

The user also distinguished local checkpoints from remote publication: the
pre-push guidance favored a complete result at the outgoing branch head while
allowing intentional work-in-progress pushes with their purpose and remaining
work stated. This added no hard gate, approval requirement or verification pass.

The verification wording reused valid evidence instead of triggering new checks
at publication or from skill manuals. The repository document check passed for
60 documents, 725 local links and 29 decision records, including open requests
and skill metadata. This guidance edit changed no software behavior and ran no
software tests; concurrent implementation work retained its own work records.

## 2026-09-13 — Retain the assembly during manual pose requests

Fixed manual-slider blinking by retaining the last complete model pose at the
frozen source time while a new worker request is pending or unsuccessful. The
exact request cache remains separate, so drawing the retained assembly does not
suppress the new solve or claim its requested coordinates were reached. Source
and model changes clear the retained state. The focused Studio kinematics checks
pass, including retained geometry during a pending request and disposal cleanup.

The user clarified that used rail length belongs to the machine definition and
slider spans should cover the machine's motion independently of the source.
Removed source-dependent rail cropping and its snapshot field. The existing
working rail endpoints now drive both geometry and limits. Slider spans derive
conservative bounds from mechanism dimensions and installation transforms.

Implemented local constrained jogging: prioritize the selected coordinate,
project corrections against model-owned signed boundary margins, and stop at a
valid local boundary. Returned slider values follow the accepted pose. Splitty
and Dobot expose their existing numeric limits. DENSO uses nominal wrist reach plus its seeded IK
acceptance. Cartesian sliders enforce axis travel, with the bed rail geometry
aligned to that travel. Missing physical socket/collision limits remain missing.
This does not claim global reach optimization or hardware motion validation.

Regression evidence includes analytical curved-boundary coupling, fixed rails
independent of source, source/override cache separation and Cartesian end stops.

## 2026-09-13 — Manual machine positioning and used rail travel

Added model-owned tool-position controls to Studio Machine view: XYZ for all
aligned models, Dobot yaw and Splitty/DENSO Euler
orientation. Slider input pauses playback and invokes the same model solver in
the source worker. Manual/source requests have distinct cache identity; obsolete
requests cannot replace the displayed pose. Play, seeking, return-to-playback,
mode/stage/source changes and movie export clear temporary manual posing.
No source bytes, job approvals or hardware commands are changed.

Rails now display sampled source carriage travel plus the exact current pose,
with 10 mm end clearance. Optional normalized line spans crop the existing
primitive geometry; rods retain their configured lengths. Source sampling is
bounded, is only for display, and retains no viewing-history dependency.
Machine fit uses the cropped assembly.

Focused provider, study, session/renderer and movie checks pass. Regressions
cover manual source preservation, model control sets, manual/source cache
separation, rail cropping/extension/reset and fixed rod length. This is software
simulation evidence, not hardware motion validation.

## 2026-09-13 — Studio machine ghost and Machine view

Implemented the complete Studio consumer of the [v1 presentation contract](studio/KINEMATICS.md):
simple links, rails, carriages, joints, bed and tool; neutral ghost composition;
Machine view with independent saved camera; shared reference-frame transforms;
worker sampling, unavailable-model fallback, stale-response rejection and movie
parity. Existing material geometry, operation colors and part-fit detail remain
the baseline. Provider geometry and kinematic equations remain in the separate
shared-model implementation. This work followed the updated AGENTS/D-029 context
boundary and fresh Studio sessions.

Verification: 31 selected tests pass across Studio kinematics, cameras, material,
movie export and source transport. These cover nonzero-placement/moving-bed
contact, invalid/stale/partial poses, worker failure/disposal, camera restoration,
projected machine fitting and asynchronous pose-before-video capture. Fresh
browser inspection covers the actual 8,343-move development S5 wedge, DENSO
study, and 48,430-move development pipe. No manufacturing approvals were created.

Paired browser measurements at 848 × 404 compare real WebGL material rendering,
Canvas composition and a forced pixel readback, with 60 frame pairs after 10
warmups and alternating order. Wedge baseline/ghost median: 5.3/6.1 ms; p95:
10.3/9.5 ms. Pipe baseline/ghost median: 4.5/5.2 ms; p95: 6.2/6.5 ms. These
measure drawing at source time 1190 with varying orbit, excluding source decode
and worker transport; they are not end-to-end interactive FPS guarantees. No
toolpath simplification or detail reduction was added. The ignored local harness
and screenshots are under `.local/studio-machine-presentation/`. Repository
document/link checks pass. Model poses and previews remain nominal software
evidence; collision, installation calibration and physical results are unverified.

## 2026-09-13 — Shared machine providers and mechanism studies

The user authorized implementation after the contract review and minimal-core
guidance and requested a checkpoint. Commit
`cf6856f` checkpoints the shared checkout before this implementation; generated
benchmark caches and the loose STL are excluded. Reoriented to D-029 and the
updated entry point before editing; no withdrawn component is restored.

Implemented [machine providers](core/machine/README.md) for the current catalog,
sharing source-time evaluation with Studio. S5/H2D use schematic XY
carriage/Z-bed motion; Splitty reuses its reference model; MG400 reuses nominal
FK/IK with explicit alignment. The new VP-6242 model uses DENSO's dimension
drawing and explicit seeded model angles, without claiming RC8 encoder/FIG
parity. Dobot's standalone sampler reuses the shared acceleration
evaluator instead of maintaining a second timing equation.

Added [read-only Studio studies](tools/kinematics/README.md), including unchanged
original Splitty `.sdgcode` input.
These use the shared viewer and hashed source transport, with no manufacturing
approval, generation or delivery. Default robot studies explicitly use synthetic
nominal floor installations. The separate Studio task owns consumer rendering,
camera behavior, worker lifecycle and visual verification.

Verification: independent DENSO drawing poses, complete deterministic provider
samples, source-hash invalidation, manufacturing-operation refusal and Splitty
source/timing parity
pass. Existing Dobot, source-player, split-delta and DENSO export/lifecycle checks
pass. A 0.1-second sampling sweep of each 24-second Splitty and DENSO study
returns complete poses throughout; this is sampled nominal software evidence,
not continuous reach, collision, calibration or physical printing evidence.

## 2026-09-13 — Withdraw September 12 contributions and establish context boundary

- The user reports that the originating agent context combined a pre-GitHub repository with modern SAAM and explicitly authorizes withdrawal of e3dc134, f2a97d8, 6e11afd and ce61c69. The old repository and transcripts are unavailable; no claim is made that every changed line was copied from them. The material-intent addition and revert cancel exactly.
- Withdraws the net incoming setup/tour, material catalog, nozzle-selection UI, generic compatibility/default changes, expanded H2D output and related portability changes. Retains the independently authored lightweight setup check, shared geometry/skills, kinematics, local-extension boundary, Studio lifetime work, test-worthiness changes and September 13 minimal-core guidance. No repository reset, history rewrite or blanket file restoration is used.
- Resolves the 44-path incoming footprint in an isolated copy of 357 tracked/nonignored working paths. Seven incoming-only files are removed; the independent setup-check implementation is retained. Existing missing tracked files remain missing. The recovery directory under ignored .local/contribution-withdrawal-20260913 contains the source snapshot, original working patch, path dispositions and verification record; ignored personal experiments, Prints and installed dependencies remain in place.
- Entry and contribution guidance require reorientation to live contracts when arriving from superseded repositories or transcripts, and explicit selective adoption before old components or methods enter the ecosystem. Routine authorized development gains no additional approval or test gate. [D-029](DECISIONS.md#d-029--withdraw-september-12-contributions-and-vet-readmission) records three conceptual intents; [BR-044](build_request.md#br-044--port-a-vetted-material-library) records the committed but explicitly deferred material-library port. No port is implemented.
- Verification: the recovered candidate passes the lightweight runtime/geometry/Studio setup check and all 72 selected tests covering shared lifecycle, both recipe adapters, S5/H2D/configured-Dobot MCP workflows, actual-source review/delivery, setup persistence, malformed outputs, Studio lifetime and independent intersection references. The first candidate run failed because its explicit dependency-hash paths lacked node_modules; linking the installed dependencies resolved that isolated-environment problem. These are software checks, not physical printing evidence.

## 2026-09-13 — Studio and kinematic-model presentation contract

The user selected a machine ghost plus Machine view toggle, retaining manual
zoom and Studio's simple lines/shapes/cones with careful visual hierarchy.
They clarified that Studio needs the complete links/rails/print-carriage
presentation integrated with its existing bed/tool; only the model builder
works incrementally. Recorded the direction in D-028 and authored the shared
[integration contract](studio/KINEMATICS.md), reachable from Studio, rendering,
core architecture and machine references.

The contract specifies primitive geometry, component roles, resolved frames,
source-time poses, identity, partial/unavailable data, asynchronous responses,
camera/visibility behavior, movie parity and task ownership. It preserves the
existing toolpath renderer and exact-source review boundary. Synthetic providers
support complete Studio development while actual model components arrive.
The earlier generated-image concepts are presentation illustrations, not graphics
requirements. No runtime integration, new model or machine execution is included
in this documentation work. Verification is source/document inspection and
focused local-link checking; no software regressions are needed for these edits.

## 2026-09-12 — Fixed150 mm rods, maximize unchanged wavy-part scale

The user replaced the rod-minimization objective with fixed150 mm rods and maximum
part size. First showed a normalized regular six-anchor plate at the previous
66.7 mm pivot diameter. Then searched other physical dimensions with paired-edge
ordering enforced and the existing source unchanged except uniform XYZ scale.
Rail placement is free within the recorded symmetric-family bounds. Neutral
feasible mutations can replace equal-score candidates so geometry can change before
scale improves. Two2200-candidate passes found scale2.107361: diameter51.419 mm,
top Z63.221 mm, tool offset55.550 mm, paired plate center radius32.547 mm and pair
spacing16 mm. Operating rail travel is152.419 mm; minimum sampled assembly surface
gap3.365 mm. The standalone and machine profile revision5 show this candidate.

Evidence:64,833 operating samples pass modeled assembly and progressive rod/part
checks;45,225 cladding endpoints pass rod/plate checks;70 operating poses plus1820
raw angular probes pass kinematics. Rods remain exactly150 mm, paired-edge ordering
passes, and non-XYZ source words are identical. Results and search bounds are in
`Prints/development/splitty-fixed-150-rods/search.json`. This is the best found by a
bounded search, not proof of a global maximum. Previous unmodeled-body and physical
validation limitations remain.


## 2026-09-12 — Reject interleaved Splitty plate attachments

The user identified that the optimized plate had collapsed toward a triangle. Its perimeter order was C1,B2,A1,C2,B1,A2, violating the intended three paired edges. Added a design-family constraint requiring each pair to stay in its tower sector and a convex A1,A2,B1,B2,C1,C2 perimeter. The optimizer rejects this layout; the viewer flags it instead of falsely saying all pairs occupy their own edges. Three focused analytical/layout tests pass. The recorded full-rod and half-rod comparisons retain this rejected plate arrangement; no replacement physical search has been performed after this correction.

## 2026-09-12 — Splitty assembly clearance and angular-margin correction

- Corrected double application of the angular reserve: operating tilt stays 40 degrees; rod/joint margins apply once at operating poses, and separate probes test raw kinematic boundaries without another margin or collision requirement. Operating motion determines rail travel. Cylinder assessment follows the same distinction; finite probe directions do not prove distance to every parallel singularity.
- Added finite-segment rod/rail and rod/rod checks, rod/bed and physical rail/rail clearance. Rails retain their full configured extent for checks and the objective. The assumed physical rail bodies are 20 mm diameter with spherical pivots on 25 mm inward mounts; entire rods are checked against their own rails. No near-joint rod segment is exempted. Mount brackets, carriage/joint bodies, frame beams and drives remain unmodeled; nozzle is excluded by user direction.
- Reused the fixed source with XYZ scaling only. Rod/part travel checks use progressively deposited height; startup is not compared against a finished part. Plate/part checks remain at cladding endpoints. The earlier skinny candidate is superseded because it omitted rod/rail collision checks.
- Selected the candidate in `Prints/development/splitty-assembly-search/search.json`: scale 5.23524, deposited centerline diameter 127.739 mm, top Z157.057 mm, rods544.502 mm, tool107.118 mm, frame height958.720 mm, average physical envelope diameter285.904 mm. Operating carriage interval589.471–851.661 mm, travel262.189 mm. Updated the standalone and machine profile revision4; no Studio integration or hardware program was built.
- Evidence: 81,453 operating interpolation samples pass modeled assembly and progressive rod/part checks; minimum assembly surface gap1.777 mm. All45,225 cladding endpoints pass rod/plate checks. Angular checks cover70 operating poses and1,820 raw limit probes. Source non-XYZ words are identical. Nineteen focused kinematics/interpreter tests and two analytical assembly-clearance tests pass. These are sampled geometry results, not full mechanical certification or a global optimum.


## 2026-09-12 — Splitty standalone kinematics and profile clearance

- Added shared six-carriage fixed-rod inverse/seeded-forward kinematics, nominal Dobot MG400 kinematics and standalone source playback. DENSO joint modeling remains deferred at the user’s direction. No Studio integration or hardware firmware was built. The preview interpreter samples TCP/Euler motion before IK and does not produce steps or thermal/IO control.
- Adapted the local wavy DENSO source to a stationary bed with an explicit tilt cap. Added a Dobot vase-wall simulation with synthetic placement. The user selected 40° head tilt, at most two joint layers with one effective pivot center, and a 4° angular reserve.
- Explored smaller plate/nozzle dimensions and outward rail inclinations. Then fixed the top endpoints and widened the base for inward 5° rails: top radius 180 mm at Z=900 mm, base radius 258.7398 mm, rail coordinate 903.4379 mm. Selected plate pair-center radius 34 mm, pair spacing 86 mm, rods 450 mm, tool offset 64 mm.
- Built the requested lightweight part-profile check: 41 circular profiles, analytical rod/frustum intersections and plate horizontal cuts. On the 235.2 mm wavy path, full-height cladding collides. The unchanged approach passes at 61.5 mm diameter / 75.6 mm height at all 45,225 source cladding endpoints. Rods alone limit the coarse study to about 64.3 mm diameter. Constant radial 40° approach gives about 63.2 mm; ±15°/30° side approaches slightly reduce capacity.
- The 235.2 mm path passes the same endpoint/profile check with hypothetical 50 or 60 mm build/clad stages; 70 mm stages fail. Stage ordering and between-stage transitions have not been generated. The standalone now displays the smaller full-height cladding example, with the machine dimensions retained.
- Evidence: 23 focused kinematics/interpreter tests passed before the profile collision addition; five direct analytical collision cases passed for rod intersections, stage clipping, plate intersections and separated bodies. The full selected operating preview was sampled once; finite 4° reserve directions were checked separately. Collision assumptions are 6 mm rods, 1 mm clearance, 5 mm plate rim, 6 mm plate thickness and all-shell radial inflation. Hotend checking is intentionally excluded. These are mathematical/sampled studies, not physical printing evidence or a continuously certified collision envelope.

## 2026-09-12 — Reconcile shared branches and restore normal PR checks

Integrated the new remote nozzle/material selection work with the pending shared
geometry, skill and Studio changes, preserving both sides of overlapping imports,
routes and documentation. The six older local tasks share one recorded branch;
they do not own six separate feature branches. Contributor guidance permits tasks
to share a commit while coordinating changes to shared lines and Git operations.
The normal pull-request `test` job checks fresh-runner setup using read-only source
permissions; no commit-status write permission is added. Local setup passed in
0.27 seconds; the combined source passed all 434 regression tests.


Completed work, development checkpoints, measurements and scoped observations.
[Build requests](build_request.md#outstanding-work) contains only outstanding or
incomplete work; component references and skill manuals describe present behavior.
[Decisions](DECISIONS.md) preserves contributor direction and approval provenance.

## 2026-09-12 — Sweep test worthiness and establish useful examples

- The user requested evaluating the existing suite as an example for future
  builders. Surveyed the 74 test files present at the start, including two files
  from concurrent kinematics work that were left unchanged. Retained analytical
  geometry, upstream references, malformed-program cases, changed-input cache
  behavior, and distinct transport/output boundaries.
- Removed 15 tests or repeated matrix cases: tour wording and repeated setup,
  a retired command, copied camera and former offset implementations, function
  alias identity, duplicated bundle and viewer lifecycles, a generic boolean case
  in the infill suite, a recursive live-document crawl, and three repeated MCP
  vase lifecycles. Removed incidental wording, markup and cosmetic assertions.
  Input preservation remains in the independent offset-reference test; bounded
  synthetic fixtures cover the manual reader's relative links and private paths.
- Moved four real size-boundary regressions to `core/tests/stress/`, selected by
  `npm run test:stress`: 200,000 moves, Griffin/H2D bodies above 25 MB and a ZIP
  member above 64 MB. The stress command runs them sequentially to limit concurrent
  large allocations. Ordinary chunk-boundary and invalid-command tests remain
  in `npm test`. This preserves defect coverage without paying its cost routinely.
- Strengthened two approval-invalidation tests to start from an approved plan.
  Fixed source-player teardown to shut down Studio before deleting its temporary
  bundle. Added [test-worthiness guidance and examples](core/tests/README.md#worthwhile-tests)
  and updated the test registry; no additional mandatory gate was introduced.
- The initial full-suite run reported 446 passes and two failures. A source-player
  cleanup failed with Windows `EBUSY` and left a worker stalled; the audit's worker
  was stopped after identifying it. The document crawl also found the concurrent
  split-delta link in `core/export/README.md` outside the MCP reader's allowed
  documentation roots. Removing the crawl does not make that link available through
  MCP; the unrelated manual-access issue was left unchanged. The stalled run is
  not a useful performance baseline.
- Verification after edits: 105 focused ordinary tests passed, including all 12
  MCP tests, and all four stress cases passed across the stress run and a focused
  rerun. The first stress run exposed an erroneous corruption offset introduced
  while moving the ZIP case; restored corruption of the compressed payload and
  reran that case successfully. No full-suite speedup is claimed. Changes remain
  local and uncommitted.

## 2026-09-12 — Remove blanket agent verification gates

- The user authorized removing purposeless and repeated agent checks, keeping
  first-use environment checks and locally resolving checks required for publication.
- Live GitHub inspection found main protected by the GitHub Actions `test` status;
  the connected account had write access but no admin access. Remote main still
  ran the full suite on pushes and pull requests, despite local guidance claiming
  the status was not required. Sources: [main branch metadata](https://api.github.com/repos/Struder-AI/SAAM/branches/main)
  and [remote workflow at the inspected main commit](https://github.com/Struder-AI/SAAM/blob/6e11afd8718182ebecadc4373e226ae4378c9d50/.github/workflows/test.yml).
- Changed the local workflow to preserve `test` and run the existing runtime
  setup smoke check on fresh pull-request runners, with optional manual dispatch
  and no duplicate push run. This edits the check's implementation without
  altering branch protection. These changes have not been published.
- Removed full-suite requirements for commits, checkpoints and skill edits,
  the task-completion documentation gate, and the document-check prefix from
  `npm test`. Setup results carry across agent tasks. Focused verification follows
  relevant changes and concrete failure cases; the full suite and document checker
  remain available when useful. Removed the redundant print-check command from
  the setup example.
- Verification: the replacement CI command, `npm run setup:check`, passed locally
  on Windows in 0.40 seconds for dependency entry points, geometry kernels and an
  unapproved Studio preview. Reviewed the workflow and affected guidance. No full
  regression suite, documentation checker or physical test was run for these edits;
  the Linux runner result remains for publication.

## 2026-09-12 — Consolidate shared work toward main

- The user requested frequent returns to main, at most one active pending branch
  per account, and discussion when an unmentioned merge has no clear answer;
  purpose-saved side branches are exempt. Added one line at the contribution owner.
- Removed the checkout's uncommitted Codex approval override as requested.
  Shared MCP tests distinguish installed local extensions from cataloged manuals
  and exercise viewer reconnection plus adapter-owned shutdown under the longer
  Studio grace period. All 427 tests passed before the shared-work checkpoint.
- Integrated the existing local main setup work while preserving its local-test
  policy. Saved experiments and generated local artifacts stay outside publication.
- Combined remote main's cached first-run command, Node 26 test compatibility
  and geometry material-intent display with the shared text and field workflows.
  Kept the faster dependency-entry checks and installed Manifold smoke check;
  the MCP guidance reader exposes both the devlog and first-use guide.

## 2026-09-12 — Preserve Studio sessions across task switches

- Extended the default last-viewer disconnect grace from three seconds to
  30 minutes. First viewing still has no deadline, connected viewers have no
  idle deadline, and reconnecting resets the disconnect grace. Explicit owner
  shutdown remains immediate and drains accepted work.
- Shared one default between the server and lifetime helper, updated the CLI
  startup message and Studio/MCP guidance. This addresses users returning to
  previews several minutes after switching tasks or replacing browser tabs.
- All nine focused `studio-lifetime.test.mjs` tests pass, including mocked-time
  coverage of the full grace period, reconnection and connected-viewer lifetime.
  No npm test was run under the user's session restriction.

## 2026-09-12 — Expanding vase contour reference

- Source: the user requested fixing the subdivision error encountered while
  reopening Nudge Cup's toolpath. Reproduced it on the saved cup component at
  Z 3.119693 mm: the fixed first-section seam lies inside the expanding inset,
  and its nearest projection switches between the two edges beside a corner.
  The approximately 0.020 mm phase jump cannot converge through subdivision.
  This differs from the earlier patterned-wall triangle-seam cleanup below.
- The vase mapper projects a fixed reference outside the geometry's maximum X
  onto later sections. It preserves the first maximum-X seam and requested
  settings while preventing that interior-reference switch. Pattern offsets
  translate the same reference. Existing topology, boundary, angle and point
  budget checks remain in place; no tolerance was relaxed.
- Added a 120-sided expanding-frustum regression at the origin and translated
  to the saved print placement. It checks complete turns, monotone progression,
  maximum segment length, level ending and endpoint/midpoint distance from an
  independently constructed polygonal boundary. The complete saved spiral also
  generated 84 turns through Z 17.8 mm with 16010 points.
- Verification: all 31 selected vase, motif, finished-cladding and regional
  workflow tests passed, along with documentation and diff checks. The public
  development workflow generated the full cup in
  `Prints/development/nudge-cup-contour-fix`: 104593 interpreted moves, 83.1
  estimated minutes, and passing export checks. Reopened the checked source in
  Studio's toolpath viewer. Original print approvals remain unchanged. These
  are software results, not physical print evidence.

## 2026-09-12 — Lightweight first-use setup

- The user rejected duplicate local/GitHub full-suite runs and clarified that
  checks belong locally, where failures can be fixed before committing. Kept
  the local pre-commit full-suite requirement and made the GitHub workflow
  manual-only. The user explicitly authorized removing main's remote `test`
  requirement. First-use maker setup remains the lightweight smoke check.
- Replaced mandatory onboarding regression tests with `npm run setup:check`.
  It resolves declared dependency entry points, exercises Rhino, Clipper and installed
  Manifold WASM, creates a temporary unapproved wedge and checks its geometry
  through Studio HTTP. It needs no Git metadata or slicing and removes its
  temporary print. Full checks remain a contributor and release responsibility.
- The user authorized fast-forwarding remote main to the shared-code head and
  adding this setup improvement there; full packaging stays on a separate branch.
- On Windows x64 / Node 24.19.0, the main check took 0.58 seconds before the
  shared-code update and 3.52 seconds with its additional dependencies after a
  fresh install. These are software timings, not clean-machine download or
  desktop client permission measurements. No real job approvals were created.

## 2026-09-12 — Shared geometry and local extension partition

- The user requested keeping private experimental code, manuals, tests and UI in
  ignored local storage while sharing spline-field geometry and the text skill.
  Added a minimal conditional onboarding note and generic local MCP/Studio hooks;
  ordinary checkouts advertise only their installed shared capabilities.
- Shared scalar fields retain native storage, rational evaluation, sparse local
  refinement, mesh extraction, slicing and Studio review. Text tools and their
  manuals remain in the shared skill catalog.
- The user requested immediate commit and push with checks skipped. No checks
  were run for this partition. The public commit excludes private history.

## 2026-09-12 — Wider overlapping motifs on a wavy guide

- Source: the user accepted the motif-only preview and requested wider motifs
  that overlap, mapped onto a wavy surface. Generated the private
  `Prints/development/wavy-overlapping-motif-vase` with 8 mm nominal motif width
  (previously 5.6 mm), 4.8 mm depth straddling the guide, 20 motifs per course,
  36 courses and two axial waves with 0.6 mm radial variation. Adjacent motifs
  have two crossings in the unwrapped pattern; no exact contact was inferred.
- The larger inward offsets exposed unstable contour correspondence caused by
  simplifying from an arbitrary moving triangle seam. Patterned contour cleanup
  now starts at a consistent geometric extreme. Added a regression covering the
  failing wavy section and updated the vase-wall manual.
- Public export check reported 46083 moves, 46080 extrusion moves, about 10.5
  minutes, no program error and all human approvals false. Inspected the overlap
  in Studio's top view and the stacked pattern in 3D; left the preview open.
- Full suite: 443 of 444 tests passed, including all vase tests. The unrelated
  evolution stop/cleanup test failed with Windows EBUSY removing a temporary
  candidate file; all six evolution-workflow tests passed on focused retry.
  Documentation and whitespace checks passed. No physical print, manufacturing
  approval, staging, commit or publication occurred.

## 2026-09-12 — Patterned vase deposits only its motif

- Source: the user clarified that the wall is only a reference guiding the motif,
  not an additional wall to print. This supersedes the connecting-stroke approach
  in the preceding scalloped examples.
- Removed implicit foundation and lead-in strokes from patterned vase generation.
  Only supplied motif paths deposit, with nominal requested bead heights. Plain
  spiral mode retains its existing behavior. The loop example now advances within
  the looping curve itself, without separate guide-ring connectors; its signed
  depth straddles the reference to leave both edges scalloped.
- Stabilized patterned contour cleanup within the configured tolerance budget
  before and after offset-grid rounding, and retained outer offset boundaries
  when tracing the guide. Regression coverage includes motif-only deposition,
  an entirely offset motif, continuous looping and changing wavy solid guides.
- Updated the vase-wall manual, shared path reference and Studio settings text
  to identify the host surface as a reference only. All 441 tests passed, as did
  repository documentation and whitespace checks.
- Generated `Prints/development/motif-only-loop-vase`; its public check reported
  30723 moves (30720 extrusion moves), about 5.8 minutes, no program error and
  all human approvals false. Relaunched its Studio server at the user's request.
  Browser automatic approval review timed out on opening the new preview and its
  permitted retry, so this version has no completed visual inspection. These are
  software checks, not evidence of physical contact or strength. No manufacturing
  approval, staging, commit or publication occurred.

## 2026-09-12 — Motif with scalloped inner and outer edges

- Source: the user requested a motif leaving both the outside and inside bumpy.
- Added the `both-scalloped` loop example: loops straddle the guide by 2.4 mm in
  either direction and connect at their tangential tips through the middle of
  the wall. The same pattern mapper and continuous extrusion workflow are used;
  neither exposed boundary has a smooth circular connecting stroke.
- Generated `Prints/development/both-scalloped-loop-vase` and inspected both
  scalloped edges in Studio's top view. The public check reported 34843 moves,
  about 7.2 minutes, no program error and all human approvals false. Documentation
  and whitespace checks passed. This is recipe/export/visual evidence; physical
  contact and strength are not established. No core generator change or new
  manufacturing approval was made.

## 2026-09-12 — Scalloped motifs on solid and wavy vase guides

- Source: the user accepted the tilted-loop appearance, chose the term motif,
  requested a visibly bumpy exterior and asked about changing host curvature.
  They clarified that an ordinary solid is the standard vase-mode input and
  that exact registration with the previous course is unnecessary.
- Extended the loop example with an outward/scalloped arrangement, configurable
  motif size and a wavy solid guide. It uses the existing signed-offset mapping;
  no new generator, automatic resizing, contact solver or registration gate was
  added. Demo inputs are capped solids without a bore. The manual distinguishes
  normalized perimeter mapping and horizontal contour depth from 3D normal
  projection, and describes the effects of changing circumference and radius.
- Put solid-input guidance in [vase-wall](skills/vase-wall/SKILL.md#input-geometry-normally-a-solid),
  with a maker-entry pointer. Added the accepted term to [GLOSSARY](GLOSSARY.md).
  The user confirmed the preceding example's appearance; that is visual evidence,
  not a physical strength result.
- Generated and inspected `Prints/development/scalloped-loop-vase` in top view
  (34842 checked moves, 7.7 minutes) and `Prints/development/wavy-scalloped-loop-vase`
  in 3D (51544 moves, 9.7 minutes). The latter uses 0.6 mm radial waves and smaller
  3.2 mm wide / 2.4 mm deep motifs, 32 per course over 36 courses. Both public
  checks reported no program error and all human approvals false.
- Added regression coverage for outward lobes, a solid input section and radial
  movement between courses on a wavy host; all 24 focused vase/settings tests and
  repository documentation/whitespace checks passed. The full-suite run reported unrelated
  evolution-worker tests returning interrupted rather than completed, including
  an optional local experiment test; that implementation was unchanged.
  Manufacturing contact and strength remain unvalidated. No staging, commit,
  publication or human manufacturing approval occurred.

## 2026-09-12 — Overlapping tilted loops on the vase spiral

- Source: the user clarified that the intended pattern adds small overlapping,
  nearly flat circles to the ordinary rising vase path, warped around the host.
  The outer envelope should follow the original geometry. Pattern tilt and
  inter-course overlap remain judgments, not new numerical acceptance gates.
- Added signed per-point contour offsets to sleeve motifs, continuous rising
  lead-ins for raised first motifs, offset-aware endpoint matching and Studio
  offset summaries. Pattern slope is reported without a tilt gate. The plain
  spiral retains its existing angle behavior. The [manual](skills/advanced-vase-wall/SKILL.md#sleeve-patterns)
  owns the current mapping and extrusion conventions.
- The full example exposed false offset micro-holes from triangle seams and
  unbounded retention of section/offset curves. Pattern contours now remove
  sub-grid seams on the shared offset grid, and both caches have bounded size.
  The ordinary spiral's contour preparation remains unchanged.
- Opened and visually inspected `Prints/development/tilted-loop-vase` in Studio's
  top view: 20 overlapping loops per revolution, 24 courses, 4.8 mm inward depth,
  28 mm outside diameter and approximately 5.46 mm overall height. Checked export:
  34842 moves, about 6.7 minutes, no program error and all human approvals false.
- Verification: 23 focused vase/settings checks passed. A full run passed 429
  of 430 tests; its only failure was a temporary-file EBUSY during cleanup in
  program-cache tests, whose six tests subsequently passed. An earlier full run
  exposed the missing DEVLOG entry in the connector's published-document list;
  that entry was added and all four access tests passed. Documentation and
  whitespace checks passed. Physical contact/strength remain unvalidated; no
  manufacturing approvals, staging, commit or publication occurred.

## 2026-09-11 — gridfinity

[gridfinity](skills/gridfinity/references/development-record.md)

## 2026-09-11 — Volumetric field geometry and Studio slicing

Implemented scalar voxel fields and trivariate rational B-spline control fields
in `core/geom/voxel.mjs`, reusing the existing basis evaluator. Added physical
gradients and control-value influences, explicit Manifold 3.5.3 level-set
extraction with exact domain clipping, and a persisted source/mesh record.
Connected the record to shared plan validation, mesh queries, mixed assemblies,
native-file checks, approval invalidation and exact-byte delivery. Added CLI and
MCP creation/editing, the voxel task manual, and sampling facts in Studio.

The first focused run passed 36 tests across voxel, mesh, MCP and skill-digest
coverage. A subsequent run passed 17 tests across expanded voxel coverage and
Studio geometry/settings, including an enclosed cavity and CLI request updates.
Analytical checks covered affine gradients, a quadratic cylinder and section-area
convergence; rational gradients matched finite differences. Repository link/digest
checks and `git diff --check` passed. These were focused checks, not a full-suite
or physical print run.

Generated `Prints/voxel-field-demo` through the public task demo and development
bundle workflow: a cubic-XY field in a 24 × 24 × 4.8 mm domain, sampled at 0.6 mm,
with a roughly 20.5 mm outer footprint and lobed through-hole. The checked S5
export contained 12117 moves over 24 planar layers. Visually inspected the
geometry and toolpath in Studio. No approvals, solver results or physical
validation were created. The future solver requirements and extraction limits
are documented in [the field reference](https://github.com/Struder-AI/SAAM/blob/ddb704a70d022a1810c8db52a2ac3d44a55aacf1/core/geom/VOXEL.md).

## Dates and historical scope

This log consolidates existing records on 2026-09-12 UTC (2026-09-11 in
America/Los_Angeles). Work dates below come from the original dated requests and
observations, supplemented by the first committed record where available.
A request date or commit checkpoint is not proof of the exact completion time.
Original dates retain their stated convention; undated source dates have no
invented timezone. Explicit later follow-ups keep their own dates. Undated work
is marked as such instead of being assigned the migration date as its work date.

The migrated BR identifiers and headings remain stable for evidence links; new
completed work needs a dated descriptive entry, not a build-request number.
The records preserve checkpoint wording, including then-current status, proposals,
test counts and limitations. They are historical snapshots, not current guidance
or fresh verification. Later entries can supersede their technical details.
Only the build-request list identifies work that is still open; a historical
limitation does not create a new implementation commitment. Software checks,
visual feedback and physical observations retain their distinct evidence scope.

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

- Work date: 2026-09-08. First committed record: `3cffb22` (2026-09-08T15:59:08-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: complete locally
- Requested by: remettub, 2026-09-08, restart conversation R3
- Result: ignored `.local/architecture-map/`, with maker/project views, 16 source anchors, selection/navigation, search/focus, themes and persistent dragged positions checked locally. No legacy runtime adopted.

## BR-002 — Simplify restart terminology and guidance

- Work date: 2026-09-08. First committed record: `3cffb22` (2026-09-08T15:59:08-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: complete
- Requested by: remettub, 2026-09-08, restart conversation R3
- Build: Maker-agent vocabulary, glossary, three approvals, direct generation from the locked plan, skill packages, local Prints, and concise developer documentation.
- Verify: Consistent current documents; superseded decisions preserved in the log.

## Initial foundation verification — historical snapshot

- Work date: 2026-09-08, initial refresh context.

All 114 archived files were checked against their original SHA-256 hashes.
Initial checks covered document links, decision metadata and private-file
exclusions; they did not validate manufacturing behavior. Current checks are
described in the [check policy](BUILDERS.md#avoid-check-spirals).

## BR-003 — Resolve native path versus machine file

- Work date: 2026-09-08 (initial request/resolution context; not a completion date). First committed record: `3cffb22` (2026-09-08T15:59:08-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: resolved
- Source: R3 refers to both a native-format path and an output toolpath in a print.
- Result: R4/R5 establish SAAMpath as the internal representation, with a separate export using an output option in the machine file. Encoding and bundle layout were open at this point; see DEVELOP.md for the implemented formats.

## BR-004 — Rhino geometry integration

- Work date: 2026-09-08 (initial request/resolution context; not a completion date). First committed record: `3cffb22` (2026-09-08T15:59:08-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: wedge integration implemented; general integration deferred
- Historical direction: remettub selected Rhino/3DM; later mesh/direct-spline direction is recorded in [D-021](DECISIONS.md#d-021--native-mesh-geometry).
- Result needed: Choose and test the Rhino integration method, preserve spline surfaces and feature references, and establish runtime/install/licensing requirements.
- Wedge result: pinned rhino3dm creates a capped extrusion and six named NURBS reference surfaces; 3DM round-trip tests pass. General spline intersections and edited-file import remain deferred.

## BR-005 — First complete print

- Work date: 2026-09-08 (initial request/resolution context; not a completion date). First committed record: `3cffb22` (2026-09-08T15:59:08-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: software demo implemented; physical print pending
- Result needed: One specified printer/material/nozzle, geometry edit, three approvals, direct generation, automated checks, same-file preview/delivery, and save/reopen of the print bundle.
- Depends on: BR-003, BR-004, and selection of the first printer/setup.
- Current implementation: BR-007 supplies the S5 wedge workflow. Each job requires three actual print approvals; software tests do not complete a physical print. Standard S5 startup is assumed without requiring firmware identification.

## BR-006 — SAAM Studio interaction and export interpretation

- Work date: 2026-09-08 (initial request/resolution context; not a completion date). First committed record: `3cffb22` (2026-09-08T15:59:08-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: bounded S5 demo implemented; general interpreter deferred
- Result needed: Shared geometry references and a viewer that interprets the actual export, including its helper files and declared machine state. Detect unsupported behavior before review; tie approval to the reviewed version and invalidate affected approvals after changes.
- Proposed interaction: Click-to-select geometry with shared labels; compare a feature tree and screenshot markup during usability testing. See [developer proposals](studio/README.md#studio-feature-references).
- Verify: A novice can identify a feature, request an edit, approve the three stages, and reopen the print. The delivered export is byte-identical to the reviewed export.
- Current result: named face selection, geometry/process editing, three version-bound approvals, exact Griffin export playback, save/reopen, and byte-identical delivery tests. Novice usability and physical validation remain pending.

## BR-007 — S5 inclined-wedge demo

- Work date: 2026-09-08. First committed record: `43c6635` (2026-09-08T17:52:22-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: implemented locally; physical validation pending
- Source: user in the S5 wedge conversation, 2026-09-08: "looks good, go ahead". Setup clarified as AA 0.4, right nozzle #2, PLA at 215°C.
- Result: the initial Rhino/S5 wedge demonstrated horizontal body fill, inclined skin and the shared review/export workflow. [BR-020](#br-020--eight-point-wedge-with-a-planar-roof) records its replacement with the bounded native-mesh geometry.
- Clearance scope: user explicitly said "Don't worry about clearance for this one. I'll make sure it clears." Physical head collision checking is deferred for this demo; bounds, motion and extrusion checks remain.
- Software checks covered geometry, generation, interpreted export and the three-approval/exact-delivery lifecycle. The [wedge manual](skills/wedge-demo/SKILL.md) owns current setup and checks.

## BR-008 — Root developer and maker guidance

- Work date: 2026-09-08. First committed record: `43c6635` (2026-09-08T17:52:22-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: complete locally
- Source: user correction during the S5 wedge conversation, 2026-09-08.
- Historical result: consolidate developer rules and development notes into root DEVELOP.md; move maker guidance to root MAKERS.md; remove docs/ and update active references. The instruction at this checkpoint defaulted unspecified agents to developer and required every developer to read both root files. Current context selection is in [AGENTS.md](AGENTS.md#choose-your-role) and the [builder orientation](BUILDERS.md).
- Approval scope: this records the user's development instruction, not an inferred contributor decision approval.

## BR-009 — Accessible chat-driven review and wedge refinement

- Work date: 2026-09-08. First committed record: `43c6635` (2026-09-08T17:52:22-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: implemented locally; physical validation remains pending.
- Source: user in the S5 wedge conversation, 2026-09-08.
- Result: concise geometry → settings → toolpath review, chat-only recipe edits with automatic viewer updates, playback speed selector, adjustable sloped-layer count, 0.2 mm nominal layers, alternating sloped strokes and alternating flat-layer traversal.
- Historical travel policy: every horizontal move lifted to the full part maximum plus 2 mm. Later wedge work added direct nearby travel; the current manual owns that behavior.
- Setup: remove installed-firmware approval requirement; assume standard S5 startup, resolve concrete questions in chat, and remember setup locally for later prints.
- Guidance: MAKERS.md owns the review/revision flow and setup conversation; DEVELOP.md documents implementation and setup persistence; the wedge manual documents adjustment tools.

## BR-010 — Split the wedge patterns into general skills

- Work date: 2026-09-08. First committed record: `bb17774` (2026-09-08T19:01:00-07:00); this is a checkpoint, not an exact completion timestamp.

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

- Work date: 2026-09-08. First committed record: `f7881ac` (2026-09-08T20:59:38-07:00); this is a checkpoint, not an exact completion timestamp.

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

- Work date: 2026-09-08. First committed record: `f7881ac` (2026-09-08T20:59:38-07:00); this is a checkpoint, not an exact completion timestamp.

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

- Work date: 2026-09-08. First committed record: `f7881ac` (2026-09-08T20:59:38-07:00); this is a checkpoint, not an exact completion timestamp.

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

- Work date: 2026-09-08. First committed record: `f7881ac` (2026-09-08T20:59:38-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: implemented locally; untested beyond software checks
- Requested by: maker, 2026-09-08: test a 45° draped-skin path without changing
  the S5 machine file's declared 15° limit.
- Build: `maxAngleDegOverride` is an explicit draped-skin plan setting. It
  changes only that print's effective survey/generation limit, while checks and
  Studio show both the 15° profile declaration and the experimental override.
- Boundary: it creates no approval, delivery or machine action, and does not
  establish physical clearance or deposition behavior at the override angle.

## BR-015 — Consolidation, interoperability and general operation weaving

- Work date: 2026-09-08. First committed record: `e87477a` (2026-09-09T09:19:20-07:00); this is a checkpoint, not an exact completion timestamp.

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

## 2026-09-08 to 2026-09-10 — S5 startup observations

- Date basis: Explicit observation dates; the intervening first-recovery correction is undated and is present by d8ed7a9 (2026-09-11T17:36:21-07:00).
- Original owner: [core/export/griffin.md](core/export/griffin.md). Preserved observation/checkpoint wording follows.

On 2026-09-08 the user reported that the **last wedge change** achieved no routine
bed leveling and no heating of the unused nozzle. The reported envelope used
Griffin compatibility `4.4.0`, SAAM's own version field, build date, material GUID,
build-volume metadata, active-tool temperature commands, no G280, and shutdown.
The default recipe uses nozzle #2/T1. Earlier that day the user reported initial
under-extrusion; the wedge recipe then accounted for its terminal retraction on
the next start. These observations apply to that export revision, not every S5 run.

The user subsequently reported having to push filament to compensate on every
start. The shell generator had treated the S5 handoff as unretracted, leaving
the preceding job's withdrawal outstanding after its initial retract/recover
pair. Shell and wedge generation now share the interpreter's S5 startup-state
rule: recover the configured retraction once at the first deposition location,
without another initial withdrawal. H2D retains its unretracted handoff; zero
retraction and relay output add no recovery. The emitted commands are corrected;
physical startup with the correction has not yet been reported.

On 2026-09-10 the user reported that their observed S5 startup differs from the
listed template behavior; the exact file and extra actions are not yet identified.
Absence of explicit leveling or unused-heater commands does not establish that
Griffin firmware skips those actions. Retained snapshots and delivered bytes can
predate the current profile. Diagnose the actual file and printer behavior before
applying the earlier observation. Complete physical print validation remains open.

## 2026-09-08 — S5 metadata and firmware acceptance

- Date basis: Explicit date in the original user observations; committed in 191af69 (2026-09-08T19:00:39-07:00).
- Original owner: [skills/wedge-demo/references/s5-export.md](skills/wedge-demo/references/s5-export.md). Preserved observation/checkpoint wording follows.

On 2026-09-08 the user reported firmware 8.3.1 rejecting the 0.2.0 file while
selecting it from USB. That export omitted the required build date. Version
0.2.1 adds it without changing executable commands. Reader compatibility checks
do not establish acceptance by that physical printer or successful printing.
The public libCharon reader was run locally against both files: it rejected
the original with `GENERATOR.BUILD_DATE must be set` and accepted the correction.
All bytes after `END_OF_HEADER` matched the previously reviewed export.
At the user's explicit request, the corrected file was copied to the S5
removable drive and its SHA-256 verified. The printer then reported "does not
contain the necessary data" for the corrected file. Passing libCharon alone is
therefore insufficient to establish S5 firmware 8.3.1 compatibility.

The user's Cura 4.12.0 reference (`wedge.ufp`, also supplied as
`wedgeCURA.gcode`) contains `BUILD_VOLUME.TEMPERATURE:28` and Generic PLA's
material GUID; both were missing from 0.2.1. Version 0.2.2 adds these to the
locked setup and export, and checks their presence. All reference header keys
are now present for the active tool. The reference uses both extruders; this
demo still declares only the requested right nozzle. No slice UUID was present
in that reference, so one was not invented to address this error. The user
subsequently confirmed that firmware 8.3.1 accepted the 0.2.2 file. That result
applies to the then-current command body, not the later no-routine-leveling
startup or Griffin-4.4 compatibility declaration. Those changes have software
checks only and do not establish a completed physical print. Brief guidance is
recorded in the S5 machine file.

## What should earn adoption next

- Date: initial evaluation proposal, recorded by `e87477a` (2026-09-09T09:19:20-07:00); not a completed evaluation. The [provenance audit](#2026-09-14--build-request-provenance-audit) recovered no explicit approval of the comparative novice study, so it is excluded from the outstanding-work queue.

Recommend proving one complete print before adding a catalog of operations.
The value to test is whether SAAM reduces setup, clarification and recovery work
compared with the same agent using existing CAD and slicing tools. Extra agent
instructions alone are not enough. Test repeatable generation, useful machine
checks, shared geometry references, and review of the exact delivered program.
This is a proposed evaluation direction, not a claim of implemented advantage.

## BR-016 — Printing and geometry design for review

- Work date: 2026-09-09. First committed record: `d2a1214` (2026-09-09T09:38:15-07:00); this is a checkpoint, not an exact completion timestamp.

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
- Design: [geometry](core/geom/README.md#geometry-interoperability-for-skill-authors), [travel](core/path/README.md#whole-plan-travel-requirement), [planar-infill](skills/planar-infill/BUILDER.md#planar-infill-design), [machines](core/export/README.md#machine-interoperability-design).
- Approval scope: records requested work, not contributor consensus or manufacturing-job approval. Existing runtime remains unchanged.

## BR-017 — Implement interoperability first, then planar infill and import

- Work date: 2026-09-09. First committed record: `48e4e8c` (2026-09-09T10:22:54-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: geometry/skill/machine interfaces, planar-infill and STL import implemented; H2D output completed as experimental software in BR-018.
- Source: user, 2026-09-09, this task: “the interoperability work should come first” and “finish out the task list”. User confirmed both geometry backends, H2D left 0.4 mm nozzle/PLA, and experimental 15° draping.
- Completed: shared mesh/spline queries, native mesh storage and ASCII/binary STL import with explicit units/source hash; geometry validation and mixed assemblies; machine-owned defaults/capabilities and separate remembered setups; selected-tool bounds and machine-independent SAAMpath checks; H2D profile with official source references; output-adapter dispatch with explicit unsupported-output rejection.
- Completed: whole-plan lifted travel and cooling, bounded comb routes around holes; planar-infill with walls/density; full-fill solid-surface masks and single wall ownership; local top/bottom regions, drape reservation and dependencies; common booleans handle coincident boundaries and close level sets at their domain boundary.
- Completed at this checkpoint: README/charter consolidation, skill manuals and shared authoring guidance; Studio shows machine, mesh dimensions, sparse/solid settings and unavailable output status. Later H2D wedge support is in BR-019.
- Software verification: both backends × S5/H2D × full-fill/drape/planar-infill, material/setup rejection, wedge exception, mesh holes/islands/invalid input, changed STL source, mixed assemblies, whole-plan clearance/cooling, comb routing, sparse density/solid-layer ownership, S5 native mesh review/delivery and preservation of the prior S5 envelope. Tests create no real approvals or hardware actions.
- Remaining at this checkpoint: H2D exporter/interpreter plus sliced-3MF packaging; addressed in BR-018 using the supplied reference exports. A profile/SAAMpath pass alone does not claim output compatibility.
- Physical validation remains open. Trimmed CAD import, rotary/tool-changing extensions, automatic supports and bridge optimization were outside this request; subsequent requests and current manuals own their present scope.

## BR-018 — H2D output from the supplied nozzle references

- Work date: 2026-09-09. First committed record: `e04d1d6` (2026-09-09T11:13:25-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user-supplied right-nozzle `example.gcode.3mf` and left-nozzle `wedge.gcode.3mf`, 2026-09-09; this continues BR-017. Checkpoint `48e4e8c` preserves the earlier implementation before this work.
- Status: experimental H2D output implemented through the shared lifecycle. One selected 0.4 mm nozzle, PLA, Textured PEI and no chamber heat; left remains default, with both nozzle maps covered by software tests.
- Completed: pinned firmware start/end contract, explicit print-body handoff, whole-plan shutdown clearance, shared modal interpretation, deterministic sliced-3MF packaging with fresh metadata/thumbnails/checksums, binary artifact hashing/reopening, Studio review and exact-byte delivery. No reference object or private project is copied into generated files or Git.
- Verification: 89 passing software tests; both nozzle maps, three skills and mesh/spline paths, invalid temperatures/tool bounds, corrupt ZIP, altered envelope/metadata/body, synthetic approvals and HTTP archive delivery. Independent Python ZIP/CRC, XML, JSON and MD5 checks passed. Existing S5 behavior is retained. Bambu Studio's CLI model-import check rejected both sliced reference and generated files with -6; program-viewer import acceptance is unconfirmed.
- Boundary: firmware service routines are matched to a fixed contract, not simulated. Print-body time/material excludes those routines. No physical validation or hardware execution. See the [H2D contract](core/export/bambu.md#h2d-output-contract) for exact scope and remaining validation.

## BR-019 — H2D wedge and Studio reopen/activity

- Work date: 2026-09-09. First committed record: `8158312` (2026-09-09T18:41:35-07:00); this is a checkpoint, not an exact completion timestamp.

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

- Work date: 2026-09-09. First committed record: `8158312` (2026-09-09T18:41:35-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-09, this task: generalize to any eight-point set with an axis-aligned rectangular base and vertical corner pairs; use mesh and “limit to a flat roof”. Follow-up requests Studio with the original H2D wedge, tall side left, six skins and doubled printing speeds.
- Implemented: unordered point input, base translation, coplanarity and total-slope validation; native eight-vertex/twelve-triangle mesh with named faces; body half-plane clipping and roof rastering for either axis, diagonals and level roofs through the existing wedge generator and shared export/review lifecycle.
- Printing-speed targets use machine XY limits rather than the former demo-only caps, with material-flow and Z-speed limits still applied to actual moves. Doubling deposition targets gives 40/20/24 mm/s for flat/skin/first-layer; travel and other process settings remain separate.
- Explicit older-bundle upgrade verifies native geometry, converts to eight-point mesh and requires fresh geometry review; old native, export and delivery bytes are retained. New mesh bundles do not require Rhino computation or 3DM storage.
- Verification covers all slope quadrants, level roofs, six parallel skins, volume, travel height, mesh identity, malformed inputs, explicit migration and S5/H2D export round trips. No contributor consensus, job approval or physical print validation is implied.

## BR-021 — Selective local MCP, Dobot and vase-wall adoption

- Work date: 2026-09-09. First committed record: `8158312` (2026-09-09T18:41:35-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-09, legacy-adoption session. Authorized restoration of MCP access, Dobot machine/Lua support and vase-wall through the reset's interoperable shared workflow. The subsequent single-location clarification defers automatic discovery; see [D-022](DECISIONS.md#d-022--defer-automatic-capability-discovery).
- Implemented: a local SDK stdio MCP adapter with fixed known profiles/manuals, persistent named Prints, revision-checked adjustments, shared checks and Studio review, fresh approval status, approved generation and exact-byte delivery. It has no approval tool, alternate compiler/review server or global plan overwrite. Local client setup is documented; arbitrary browser-chat access and automatic client configuration are not implemented.
- Implemented: Dobot profile and bounded Lua export/interpreter using the same SAAMpath, native geometry, three human approvals and delivery. Installation defaults remain unconfigured. The selected CP=0 relay policy stops at each segment and reports estimated material separately from intended bead volume. Delivered ZIP packages source files; vendor project import, controller execution and physical behavior are unverified. See [Dobot scope](core/export/dobot.md#dobot-output-contract).
- Implemented: [vase-wall](skills/vase-wall/SKILL.md) queries actual changing-Z sections on supported mesh/untrimmed spline geometry, optionally above a full-fill base, through the common composer and export lifecycle. It requires one supported convex outer section without holes/islands and enforces bounded standoff, overlap, angle and sampling checks. Other unsupported topology and trimmed CAD remain outside its scope.
- Verification: final `npm test` passed all 131 software tests and repository checks. Coverage includes Lua semantics/rejection, shared skills and bounded wedge, both geometry backends, S5/H2D/configured Dobot paths, actual SDK subprocess clients, current approval binding, stale revisions/artifacts and exact reviewed-byte delivery. All approval/calibration fixtures are explicitly synthetic in temporary bundles; no physical validation is claimed.
- Follow-up source clue: the other developer suggested “textured or patterned wall”. Searches for those terms in messages, historical diffs and archives found no implemented match. `f015cf1:ROADMAP.md` calls vase/spiral-wall strategies the private source project's most-developed pattern family, strengthening that source lead; this does not identify either sample or establish that its source was lost.
- Approval scope: this records authorized work and implementation status, not either contributor's unstated agreement or a real manufacturing-job approval. Further legacy adoption still requires specific authorization.

## BR-022 — Same-part skill composition correction

- Work date: 2026-09-09. First committed record: `8158312` (2026-09-09T18:41:35-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, this legacy-adoption session: full interoperability between ecosystem components wherever possible, including same-part skill composition. Acceptance example: flat base/vase wall, flat cap, normal walls/infill to a wavy roof, drape, then full fill above the drape with a wavy bottom. User confirmed that final fill uses horizontal layers.
- Implemented: shared material-region assignments, per-region skill settings, component layer grids, material ownership/dependencies, level vase ending with tapering final-turn deposition, and producer-bound lower surfaces for subsequent horizontal fill. The existing skill generators, geometry, SAAMpath, exporter and three-approval lifecycle remain shared.
- Corrected audit findings: spatial roof reservation no longer truncates unrelated taller components; first drape gap uses actual supporting layers including translated geometry; numerical mesh-top roundoff no longer drops a valid final layer. Consumed surfaces and their coverage/order are checked instead of inferring compatibility from skill names. Fully reserved bodies are rejected, and inward offsets collapse thin remnants instead of allowing acute miters to escape the source material.
- Corrected workflow gaps: shared remembered-default/STL-import helpers, MCP import/upgrade/setup/path-check/guidance tools, safe nested print names matching Studio, geometry bounds in MCP summaries, CLI revision guards and consistent geometry-only checks. Studio shows effective regional settings, surface references, support choices, pattern settings, dependencies and robot calibration/workspace parameters.
- Verification: final `npm test` passes all 156 software tests and repository checks. Includes the requested stack across S5/H2D/configured Dobot and mesh/spline geometry, per-move exported coordinates/material, the complete regional spline/S5 synthetic approval/Studio/exact-delivery workflow, spatial reservations, offset remnants, surface coverage and access parity. Studio's regional settings were also checked in the browser with a software-only fixture. The full suite took about six minutes; the user deferred broader speed work to the next cycle.
- Remaining boundaries: supported height-field surfaces, bounded numerical section/gap sampling, vase convex sections and continuous-stroke chronology, explicit experimental bridging, and actual machine output constraints. Dobot's fixed-rate relay cannot meter arbitrary variable bead volumes; commanded intent and modeled relay output remain separate. No blanket assertion that every physical combination is printable, no automated support/collision proof, and no physical validation is implied.

## BR-023 — Slicing performance baseline

- Work date: 2026-09-09. First committed record: `d7acfc3` (2026-09-09T22:47:54-07:00); this is a checkpoint, not an exact completion timestamp.

- Requested by: user, 2026-09-09. Start the speed cycle with equivalent spline/mesh tests, use a twisted box and multiple slicing skills, compare planar slicing with Cura/Bambu Studio, and recommend subsequent optimizations/diagnostics.
- Implemented: opt-in reproducible developer benchmarks over shared geometry queries, full-fill, planar-infill, draped-skin, composition, machine checks and export/interpretation; analytical fixture checks, Rhino 6 exchange files, sampled mesh convergence, STL precision diagnostic, serial repeats and phase/failure reporting. Commands, boundaries and findings are in [slicing speed benchmarks](scripts/bench/README.md#slicing-speed-benchmarks).
- User reference: standard Rhino-exported STL (1078 triangles); Cura 4.12 reported 14 seconds to load and 2.3 seconds to slice with two walls and 100% infill. Loading and slicing are separate, and non-planar work is excluded from the Cura comparison.
- Findings: direct spline section/height queries are slower than modest meshes, but complete planar full-fill can be faster because mesh contours amplify downstream region work. The supplied mesh reveals an offset/index memory blow-up and a solid-mask boolean failure. Keep failures separate from successful timings; the test does not justify switching native geometry architecture.
- Boundary: developer measurements do not add a public twisted-box shape, create job approvals, demonstrate physical prints, or establish a controlled overall speed ranking against external slicers. Bambu Studio timing and matched public-workflow load/check/generation measurements remain next-stage work. Existing production geometry, skills and review semantics are unchanged by the benchmark additions.

## BR-024 — Remove vase heuristics and bridge permission policy

- Work date: 2026-09-09. First committed record: `d7acfc3` (2026-09-09T22:47:54-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-09, explicitly in developer mode. Remove the turn-overlap gate unless evidence establishes recurring slicing defects it catches; make compute-budget exhaustion obvious and easy to raise; explain tolerance coupling; treat level-ending selection and bridge feasibility as maker guidance. The earlier maker's bridge comment did not authorize changing skill policy.
- Implemented: removed the per-point previous-turn section/radial-overlap calculation and regional bridge-permission gates, including foundation-ring support coverage. Older `supportPolicy` fields are inert compatibility data. New recipes and Studio omit the policy. This supersedes BR-021's overlap gate and BR-022's experimental bridging restriction.
- Implemented: vase point budgets retain a 100000 default with no preset 200000 ceiling; exhaustion identifies usage, region, height and the setting to raise without degrading contour quality. Contour subdivision and numerical boundary allowances are separate settings; older recipes normalize their prior boundary allowances explicitly.
- Guidance: choose a level ending for a flat cap while proposing the recipe. Developer checks must justify their compute cost and false rejections with concrete failure evidence. Ask the user when a gate's value is ambiguous in toolpathing, geometry, extrusion or 3D printing; this reflects their stated expertise, not a blanket requirement to ask about every software check.
- Scope: shared region, skill, review and export pipeline; no new approvals, changed real-job geometry, physical validation or machine execution.
- Verification: all 165 repository software tests pass. The public path check also passes for a development copy of the full twisted house at 0.2 mm pitch, 0.02 mm contour tolerance and three cap layers, with 241074 wall points under a 400000 allowance and no bridge policy.

## BR-025 — Shared Clipper and surface offsets

- Work date: 2026-09-09. First committed record: `d7acfc3` (2026-09-09T22:47:54-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, this offset-function task. Adopt the trusted `ClipperComponents 0.3.2.0` offset identified in `offset.ghx`; keep the general intersection-engine decision separate. Build shared planar and surface offsets, migrate existing skill offsets, avoid repeated inverse mapping, and guide authors toward robust established algorithms with measured performance. Development checks were authorized with the existing cost guidance retained.
- Implemented: pinned Clipper 6.4.2 JavaScript port behind `core/region/offset.mjs`; upstream construction, winding/union cleanup and topology reused. Material-region semantics deliberately use closed polygons rather than the Grasshopper wrapper's closed-line band mode. Input normalization and Clipper's simple-loop cleanup handle nesting and point-touching components. Removed the previous offset/pruning/splitting implementation; compatibility export aliases the shared function.
- Integrated: full-fill, planar-infill, draped-skin's existing projected footprint, vase-wall, shared combing/rim coverage and the bounded wedge's section/roof insets. The wedge remains its eight-point generator. Runtime identity includes the adapter and installed Clipper source/lockfile. General intersection functions were not replaced.
- Implemented experimentally: `offsetSurfaceRegion` generates distance-based geodesic strips/round joins from a native spline patch, then uses actual Clipper union/difference/winding code for material topology. UV and cached XYZ correspondences stay attached; no inverse mapping or global flatten/warp round trips. Surface-distance code is new SAAM implementation, not a copy of Rhino's unavailable native routine. Single regular C2 patch, closed UV loops and bounded domain are the current scope; no skill silently adopts it.
- Evidence: the JavaScript adapter exactly matches every coordinate and loop in 90 cases generated by the unmodified plugin C# Clipper 6.4.2 kernel using the same material-region adapter options. Surface tests include analytic derivatives, flat nesting/collapse, inclined-plane UV rescaling, independent cylinder unrolling, and convergence of nested regions on a doubly curved patch. No Rhino surface-output comparison or physical validation has been performed.
- Diagnostic: the supplied 1078-triangle Rhino STL passes every full-fill layer in the offset diagnostic. Its separate solid-mask intersection still produces an open contour; that known failure is not hidden or fixed by adopting the offset.
- Guidance and measurements: [shared numerical foundations](core/geom/README.md#shared-numerical-foundations) and [offset contracts](core/region/README.md#shared-offset-functions) record provenance, precision, limits, reference reproduction and opt-in timing. Baseline `npm test` passed 170 tests; final `npm test` passes all 180 tests and repository checks, including mesh/spline, S5/H2D/configured Dobot, public workflow and exact export/delivery regressions. The documented .NET reference project also builds successfully. No contributor consensus, human manufacturing approval, commit or publication is inferred.

## BR-026 — Temporary web-chat connection

- Work date: 2026-09-09. First committed record: `d7acfc3` (2026-09-09T22:47:54-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-09 local time, requested immediate ChatGPT and Claude web access to the existing implementation and a temporary locally run relay. See [D-024](DECISIONS.md#d-024--temporary-web-chat-access-to-the-existing-local-workflow); packaged applications remain deferred.
- Implemented: a Streamable HTTP/JSON bridge forwarding the existing MCP tools to one local adapter, OAuth SDK routes with local pairing, client-bound PKCE grants, expiring tokens/refresh rotation/revocation, and a launcher for an outbound temporary HTTPS tunnel. Studio, its approval routes and print files remain local.
- Verification: 180-test baseline passed; the final full run passes 182 tests. One existing stdio workflow test failed and the first full run stalled; that failure did not reproduce in its targeted rerun or the full rerun. SDK HTTP/OAuth tests exercise unauthorized access, origins/redirects, PKCE/replay/resource checks, rotation/revocation/expiry, two clients sharing state, retained Studio lifetime, approval gates with isolated synthetic fixtures, and exact-byte delivery.
- Public connection check: verified a temporary Cloudflare endpoint with OAuth/PKCE, 18-tool discovery and read-only maker guidance; unauthenticated MCP was rejected and the Studio approval route returned 404. No real print was changed. The user is driving their external browser; Claude reached the pairing page but reported "Invalid origin". Actual vendor connection acceptance remains pending.
- Browser pairing correction: reproduced the native form's `Origin: null` under `Referrer-Policy: no-referrer`. Switched to `same-origin` and allowed the SDK-validated callback origin in the authorization page's form policy, which Chromium also applies to the OAuth redirect. A disposable browser fixture now completes the form and cross-origin callback; absent, null and foreign origins remain rejected.
- Alpha onboarding follow-up: user chose an uploadable Claude plugin, prioritizing onboarding over ChatGPT's developer-mode connection test. The launcher now builds a ZIP containing the connector address and a maker skill that reads current guidance through MCP. The package excludes local credentials and files and does not install or start SAAM. Claude upload acceptance and actual tool use are still the user's external-browser test; a stable shared alpha service is not implemented.
- Follow-up verification: `npm test` passed before the pairing/plugin edits (191 tests) and afterward (195 tests in the concurrent working tree). The plugin CLI/archive regression, independent Python ZIP check and skill validation passed. Restarted the temporary bridge and verified public OAuth/PKCE, 18-tool discovery and read-only maker guidance again. The browser fixture completed a native form submission and cross-origin callback; real Claude plugin upload remains the next user-driven check.
- Limits: single installation, temporary credentials/URLs, same-computer Studio review and delivery, and tunnel/client timeouts for long calls. No packaged app, multi-user hosted service, automatic connector installation, hardware action or physical validation.

## BR-027 — Minimal shared Clipper2 intersection tool

- Work date: 2026-09-09. First committed record: `d7acfc3` (2026-09-09T22:47:54-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-09 local time, authorized building/testing a Clipper2-based tool, replacing existing skill operations when tests pass, and updating documentation. Scope shared components to current needs and extend them when necessary; consider CGAL only if the Clipper2 tests are insufficient.
- Implemented: closed planar material-region intersection, union and difference behind one small adapter to pinned `clipper2-wasm@0.4.0` (upstream C++ Clipper2 2.0.1). Existing shared imports route full-fill, planar-infill, draped reservations and regional composition through it. The handwritten general booleans were removed; established offset kernels and sampled section/level-set constructors retain their scope. No open-path, 3D, CAD, UV intersection API or alternative backend was added.
- Integration correction: accurate booleans exposed artificial corner gaps from coarse bead-coverage arc approximation. Coverage expansion now uses the existing 0.001 mm chord target instead of hiding gaps with area pruning. Runtime identity hashes the actual JS/WASM bytes. Tests compare decoded numeric areas within declared precision while retaining exact upstream reference comparisons.
- Evidence: 138 cases match unmodified upstream C# results exactly, including coordinates and topology; analytic/adversarial tests and 200 seeded rectangle-set cases pass. The original 1078-triangle Rhino STL passes every offset/solid-mask diagnostic layer. Full, planar and draped benchmark modes pass for both spline and that STL. The actual public STL importer, adjustment, development generation/export and cold CLI reopen also pass, with no human approvals or delivery.
- Guidance: [minimal component scope](core/README.md#interoperability-and-one-workflow) and [intersection contract, provenance and reference reproduction](core/region/README.md#shared-planar-intersections). No CGAL was needed, and no physical validation or contributor consensus is inferred.
- Verification: baseline `npm test` passed 182 tests; the final suite passes all 195 tests and repository checks. Includes S5/H2D/configured Dobot, both geometry backends, same-part skill composition, MCP/Studio synthetic approval workflows and exact-byte delivery. Development source changes remain uncommitted.

## BR-028 — Travel above deposited material

- Work date: 2026-09-09. First committed record: `d7acfc3` (2026-09-09T22:47:54-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, this travel task: use the current highest thing on the bed plus clearance; allow zero and default to 1 mm.
- Implemented: one shared `PathBuilder.travelTo` for full-fill, planar-infill, draped-skin, vase-wall and the bounded wedge. The wedge retains its eight-point geometry and nearby-start policy; shared motion replaces its duplicate travel/retraction implementation.
- Height follows both endpoints of each emitted positive-volume segment across the print, including prime lines and sloped strokes. Lifted travel, cooling and final SAAMpath parking use deposited maximum plus `process.liftMm`, floored at departure/destination height. Future strokes, unselected geometry and non-depositing lifts do not increase material height. New recipes default to 1 mm; existing explicit settings remain locked values.
- Updated skill/developer manuals, wedge runtime identity and H2D context validation so actual print-body height may be below unprinted geometry. H2D firmware service/shutdown heights retain their fixed export contract. Existing direct/combed policies remain; no fixture sensing or swept-head collision model is added.
- Verification: baseline `npm test` passed 195 tests; final suite passes 199 tests and repository checks. Regression coverage includes rising/falling strokes, within-operation chronology, taller-to-lower transitions, repeated cooling/parking, zero-clearance S5/H2D shell and wedge export round trips, unselected tall geometry, and the existing configured Dobot/public workflow checks. No physical validation or human manufacturing approval is implied.

## 2026-09-09 — Initial slicing benchmark findings

- Date basis: Explicit run date in the original report.
- Original owner: [scripts/bench/README.md](scripts/bench/README.md). Preserved observation/checkpoint wording follows.

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

## 2026-09-09 — Clipper 6 and surface-offset measurements

- Date basis: BR-025 context; first committed record d7acfc3 (2026-09-09T22:47:54-07:00).
- Original owner: [core/region/README.md](core/region/README.md). Preserved observation/checkpoint wording follows.

Historical Clipper 6 Windows/Node 24 measurements were about **0.67 ms** warm median for
the 16-vertex nested planar case, **35 ms** for all 90 planar cases, and **18 ms**
for the four-vertex cylinder offset at 0.005 mm tolerance (1287 evaluations,
zero inverse mappings). The runner reports cold time, three warm samples,
source/output hashes and usage. These small fixtures establish local costs,
not a general speed ranking; complex surface offsets remain more expensive.
The original Rhino STL now passes all full-fill layers in the offset diagnostic;
its separate solid-mask intersection failure was subsequently resolved by the
shared Clipper2 tool below.

## 2026-09-09 — Intersection and twisted-fixture measurements

- Date basis: BR-027 context; first committed record d7acfc3 (2026-09-09T22:47:54-07:00).
- Original owner: [core/region/README.md](core/region/README.md). Preserved observation/checkpoint wording follows.

A historical initial Windows/Node 24 run took about 15 ms to import/initialize the adapter,
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

## 2026-09-09 to 2026-09-10 — H2D reference and startup checks

- Date basis: explicit dates in core/export/bambu.md; BR-018 and BR-019 preserve
  the implementation and physical report.
- The user supplied Bambu Studio 02.08.02.61 right/left sliced exports on
  2026-09-09. Only envelope and format facts informed the implementation.
- The installed Bambu Studio CLI model-import (`--info`) check reported -6,
  "The input model file to the slicer can not be parsed," for the reference and
  generated archive, including a retry outside the sandbox. This did not test
  the program-viewer route or execute a printer. Independent viewer acceptance
  remained unconfirmed.
- On 2026-09-09 the first physical attempt reached the part, but the user reported
  severe over-extrusion on flat layer two. The delivered body used cumulative
  `M82` instead of the reference's relative `M83`. The exporter correction and
  second-layer regression did not establish a successful physical retest.
- On 2026-09-10 the user requested removal of startup triage item H10: initial X
  homing, early wiping-area moves, `M972 S24` and the `M1009`-bracketed
  Z-clearance/center-positioning/Z-homing sequence. Revision 4/v2 omitted those
  13 lines; adjacent object/bin checks and later probing/calibration/priming
  remained. Physical testing of that revision was still required.

## 2026-09-09 — Intersection construction correction

- Date basis: BR-027 context and checkpoint `d7acfc3`
  (2026-09-09T22:47:54-07:00); preserved from core/region/README.md.
- Full-fill's former 0.02 mm bead-coverage chords left four artificial corner
  gaps totaling about 0.000252 mm² in a rectangular solid top. The handwritten
  boolean's area pruning hid them. The construction used the existing 0.001 mm
  chord target to resolve the gaps without deleting material or changing
  deposition strokes.

## BR-029 — Flange toolpath size, ordering and Studio visibility

- Work date: 2026-09-10. First committed record: `f52c524` (2026-09-10T00:39:19-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user switched this flange task to development and requested removal of the arbitrary file-size cutoff, shared region ordering around holes, straight-line compaction in all skills, nearby-stroke travel reduction, and clearer geometry/toolpath views.
- Implemented: incremental text/chunk parsing in the common Griffin/H2D modal reader; removed the 25 MB G-code and 64 MB ZIP policies while preserving command, archive-integrity and actual ZIP32 representation checks. Bundle/playback objects still scale with job size in memory; this is not fully streamed artifact storage or paged browser playback.
- Shared scanline ordering now completes uninterrupted row cells on each side of holes/concavities as well as disconnected islands. PathBuilder compacts compatible collinear commands for every skill and uses direct non-extruding repositioning for permitted gaps within 1 mm. Hole, surface, previous-operation, process and flow boundaries remain meaningful.
- Studio hides mesh edges below a 3-degree crease angle, shows no part geometry in toolpath view, and emphasizes the current layer over faded previous layers. Changes use the same Studio/export/review lifecycle.
- Baseline: 199 tests passed. The original full-size flange generated 37,843,427 G-code bytes, 15,389 retractions and 547,974 mm of travel. Ordering alone reduced this to 1,888 retractions and 73,837 mm of travel without changing deposition strokes. Development reproduction retains the original dimensions in an isolated local print, without human job approvals or physical validation.
- Verification: all 211 tests and repository checks pass, including files over 25 MB, an archive member over 64 MB, chunk-boundary/modal/error handling, scanline coverage and S5/H2D round trips, straight-run semantics and nearby travel. The final original-size flange passes public development generation/export checks: 28,360,548 bytes, 596,728 interpreted moves, 1,884 retractions and 73,829 mm of travel. Studio was restarted on the isolated development bundle and visually checked in geometry and toolpath views. No real job approval, delivery, machine execution or physical validation was performed.

## BR-030 — Export-only bundles and measured flange speed

- Work date: 2026-09-10. First committed record: `f52c524` (2026-09-10T00:39:19-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-10, requested implementing the Cura comparison findings and remeasuring the same flange. Scope includes shared contour cleanup, modal G-code output, removal of mandatory saved SAAMpath and regeneration on Studio reopen, and applicability across skills. [D-027](DECISIONS.md#d-027--export-only-print-persistence) records the persistence direction and its approval boundary.
- Implemented: mesh sections remove numerical triangle seams before offsets with the existing 0.0000001 mm plane tolerance. Full-fill/planar-infill reuse that helper on offset deposition contours; closed-region boolean results retain the original Clipper contract. Corners, reversals, narrow features and cumulative curvature are covered by regression tests. No curve-resolution, offset precision, geometry dimension or locked process setting was relaxed.
- Shared S5/H2D motion output omits unchanged XYZ/feed fields and retains explicit extrusion values and mode. Bounds/feed/flow checks run on interpreted export commands, including selected-tool bounds. Exporter round-trip comparisons remain regression tests. Dobot checks reconstructed Lua commands through the shared machine checker.
- Bundles save the export, check report and small generation summary, with transient motion objects retained only while generating. No new SAAMpath file/hash is written; regeneration removes a legacy intermediate. Cold opening interprets the saved export without invoking the generator or exporter. Playback and delivery use that export. Plan/export identity still controls stale approvals; editable local hashes are not authenticated provenance signatures. A complete replacement of transient motion objects with G-code, streaming generation and paged playback are not implemented.
- Measurement fixture: original 88.9 mm diameter, 25.4 mm tall flange, 6.35 mm plate, four walls, 35% infill, 0.2 mm layers and five top/bottom layers. The isolated `Prints/pipe-flange-speed-review` copies the exact plan, machine and geometry from the previous flange bundle, with no human approvals. Cura's supplied four-wall/35% file is 4,879,289 bytes and uses two top/bottom layers, so it is a comparison rather than an identical process plan.
- Final export is 15,551,433 bytes and 422,708 interpreted moves, versus 28,360,548 bytes and 596,728 moves before this change. The previous 183,926,147-byte intermediate is absent. A serial same-input generation/export/interpretation benchmark measured 91.27 seconds before and 41.06 seconds after (55% less time); the isolated baseline loader reproduced the old export byte-for-byte. Generation alone measured 80.03 versus 33.31 seconds. Separate final bundle generation/check/save trials took 43.94 and 51.89 seconds; cold Studio state requests took 12.92 and 13.32 seconds, including interpretation, serialization, HTTP transfer and JSON parsing, but excluding browser painting. Timings varied with machine load. The response still contains about 123 MB of interpreted move objects, and the 15.55 MB export still exceeds Cura's 4.88 MB; this is an improvement, not performance parity. Raw scripts/results are in ignored `.local/flange-dev/`.
- Verification: final `npm test` passes all 214 tests and repository checks. Coverage includes all skill families, S5/H2D/configured Dobot output, numerical seams and curvature, modal fields and extrusion round trips, cold/warm reopening without generation, legacy intermediate removal, edited exports, synthetic approval invalidation and exact-byte delivery. The new development bundle passes export checks and retains byte-identical plan/native geometry inputs. No human approvals or machine execution were added.

## BR-031 — Studio plays machine source in the browser

- Work date: 2026-09-10. First committed record: `f667205` (2026-09-10T02:51:13-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user requested replacing expanded motion JSON transport with a G-code player without breaking Studio, and clarified that Dobot must play the actual Lua that will run. Existing work was checkpointed first as requested.
- Implemented: a small state response plus exact checked source downloads. S5 sends its G-code; H2D sends the unchanged G-code member of the checked 3MF; Dobot sends each unchanged Lua file from the checked ZIP. Print/revision/export identity and per-source hashes bind loading to review. Archive validation and byte-identical delivery remain in the common workflow.
- Browser workers use the same G-code/Lua interpreters as export checks, with compact chunked numeric storage for local drawing/timing. No move/event JSON crosses the server/browser boundary, and no replacement path file is saved. H2D firmware routines remain outside simulated playback; Dobot retains actual Lua execution and modeled Cartesian acceleration. Geometry, settings, approvals, travel visibility, layer emphasis and the renderer remain shared. Full paged playback and replacement of transient generation SAAMpath remain outside this change.

## BR-032 — Infill choices and judgment-assigned supports

- Work date: 2026-09-10. First committed record: `f667205` (2026-09-10T02:51:13-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user requested four additional infill choices, standard and tree supports, and two rimming skills comparing horizontal versus surface-normal offsets of an assigned bivariate spline surface. [D-025](DECISIONS.md#d-025--support-areas-assigned-through-judgment) records the explicit prohibition on automatic whole-part angle-based support assignment.
- Implemented: grid, triangles, concentric and gyroid alongside existing rectilinear infill, using shared material regions, offsets, Clipper2 open clipping and full-fill stroke generation. Gyroid field-contour assembly reuses spatial endpoint buckets; an isolated 16-phase 48 mm square measurement fell from 24.604 s to 1.175 s without changing measured average density. Pattern manuals describe tradeoffs and numerical limits.
- Implemented: explicitly assigned standard footprints and authored tree skeletons with shared wall/interface ownership. Trees are an initial SAAM branch producer, not Bambu's automatic router. No upstream slicer source or skill prose was copied.
- Implemented experimentally: rimming-planar and rimming-normal share spline sectioning and adaptive section offsets at 0.5 and 1.5 line widths. Bed/edge bases, curved boundaries and outward lean are supported within the manuals' control-net limits; 45 degrees is guidance only. No conventional top gap is introduced. Normal offsets report height shifts; automatic endpoint correction and physical bead/contact validation remain open.
- Ordering clarification: both rim skills wait for the entire base edge, and the entire rim finishes before any supported feature starts. The shared composer favors similar actual deposition heights among ready operations, subject to dependencies and selected batching. Rim pairs still use increasing original horizontal intersection height. Atomic operations remain intact; component bindings conservatively approximate edge ownership and do not infer arbitrary CAD edge matches.
- Integration: common plan, regional composition, fixed MCP manuals, Studio settings, transient motion, machine exporters and export-only bundle lifecycle. Development comparison bundles exercise both offset metrics without manufacturing approvals. Final focused verification passes 102 software tests, including sloping-edge completion and physical-height scheduling regressions; repository documentation checks also pass. No physical print, machine execution, contributor consensus, commit or publication is inferred.

## BR-033 — DENSO RC8 rotary pipe demo

- Work date: 2026-09-10. First committed record: `8b147cb` (2026-09-10T12:03:01-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user requested a transferable robot/rotary pipe demo through the existing ecosystem, then selected the DENSO VP-6242 and confirmed RC8. Ceiling mounting with robot base axis coaxial with the rotary is provisional. User authorized implementation and explicitly deferred robot reach, IK solving in SAAM, joint/motion-limit checks and collision avoidance.
- Implemented: native annular mesh recipe; full-fill concentric substrate using shared sections, offsets and Clipper2; alternating axial/helical radial shells with inward/downward 45-degree nozzle orientation. The shared composer retains its scheduler and explicit dependencies; point-aligned poses and unwrapped rotary angles extend its existing stroke/motion boundary. Ordinary fixed-axis skill paths continue through the same writer and output registry.
- Implemented experimentally: VP-6242 / RC8 profile, literal PacScript source ZIP, bounded interpreter of actual T/EX/TIME/IO commands, and part/room coordinate transforms. Studio plays those exact sources with a rotating bed or Follow build plate view and nozzle direction, without invented arm joint animation. Setup identity, checks, MCP catalog, approvals, cold reopening and exact-byte delivery use the existing lifecycle.
- Limits: actual rotary interface/calibration and controller source compilation remain unverified. The development fixture explicitly assumes RC8 relative EX extended-joint control; a separately controlled rotary needs an execution adapter. Nominal timing assumes external speed 100% and synchronized linear command progress; @0 endpoint stops, acceleration, IO and relay deposition are not physically established. Constant relay rate and commanded bead-volume intent remain distinct. General cylindrical CAD recognition, radial material-region assignments and arbitrary oriented stroke reordering are unimplemented.
- Development result: `Prints/development/denso-rc8-pipe` contains a 16 mm bore, 20.8 mm outside diameter, 12 mm high pipe with 1.6 mm substrate and four 0.2 mm radial shells. Current export has 56,988 interpreted moves and 27.7 minutes of requested motion. Synthetic calibration is labeled and is not retained as user setup. Studio was launched for the user and visually inspected at axial and circumferential portions and in both coordinate perspectives. No manufacturing approvals or hardware execution were performed.
- Verification: seven focused RC8 tests pass, including mesh/spline base-vase-cap-infill-drape composition, bounded wedge, native pipe on S5, full-turn source reconstruction, orientation preservation, radial order/ownership, cold reopen and synthetic approval/exact-byte delivery. The first broad regression attempt reported an MCP test failure and stalled; that test passed immediately in isolation. The complete rerun with concurrency 2 and a 120-second test timeout passed all 261 tests in 71.2 seconds; repository documentation checks also pass. No contributor consensus, staging, commit or publication is inferred.

## BR-034 — Shared Studio permissions for Codex and Claude Code

- Work date: 2026-09-10. First committed record: `8b147cb` (2026-09-10T12:03:01-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user requested repo-shared permission scope for agents to open, use and close their Studio instances without repeated prompts, then authorized implementation for Codex and Claude on 2026-09-10.
- Implemented: a trusted-project Codex rule and shared Claude Code Bash/PowerShell rules for `node studio/server.mjs`, with a matching Claude Bash sandbox exclusion. [Studio permissions](studio/README.md#studio-agent-permissions) owns setup, direct launch and instance closure.
- Scope: project trust and browser permissions remain client-owned; restrictive policies still apply. Rules trust the script and its imports and do not create an OS-level Studio-only boundary. Claude Desktop/web MCP setup and the three human manufacturing approvals remain separate.
- Verification: the installed Codex CLI accepts the rule's positive/negative examples, allows the Studio launch and leaves inline Node execution unmatched. Claude settings parse as JSON and use documented rule forms; Claude Code is not installed here, so live Claude behavior and browser permission persistence across ports are unverified.

## BR-035 — Studio movies, material rendering and color comparison

- Work date: 2026-09-10. First committed record: `8b147cb` (2026-09-10T12:03:01-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user requested offline movie export matching Studio's selected speed, camera, visibility, rotary view and fade, followed by viewer material and color refinements.
- Implemented: deterministic 30 fps WebM export without live playback; shaded oval current beads; completed layers retain source curves using cached instanced rectangular sweeps. Old layers retain 50% opacity with gentle color fading. Normal two-second fades shorten only when the next layer arrives sooner. Material estimates use the requested fixed 1.2 g/cm³ conversion to grams.
- Color comparison: lighter sky-blue body and six successive axial colors (sky blue, teal, lime, lavender, rose, silver), with orange circumferential layers. Named viewer buttons jump to each sample. At the user's request the local development pipe now has a 22.8 mm outside diameter, unchanged 16 mm bore and 12 mm height, 1 mm substrate, and twelve 0.2 mm outer shells (six axial and six circumferential).
- Verification: focused viewer/movie/material tests and repository checks pass; the updated pipe regenerates and reopens through the shared checked development lifecycle with 100,472 moves. Browser inspection verified the color sample controls and rendering. No manufacturing approvals, hardware execution or physical validation were performed.
- User color selection: sky blue (slightly darkened), orange, teal and lavender are recorded as the visually verified set, with other colors allowed when needed. Final assignments are sky-blue body, orange circumferential shells and teal axial shells. The current pipe has three body loops per layer (1.2 mm substrate), 23.2 mm outside diameter, unchanged bore/height and twelve outer shells. Full-fill's existing interior-stroke hook supports odd native-pipe loop counts when separate perimeter bands are disabled; positive perimeter settings retain the prior behavior. The remade export has 100,449 moves. Twenty focused RC8/viewer tests pass, including three-loop coverage through composition and actual source interpretation.
- Geometry-view follow-up: user requested all proposed visual improvements and assigned the skill fix to another task. Geometry now uses opaque shaded sky-blue surfaces, smooth curved normals with crisp corners, subtle ground shadow, quiet outlines and selective highlighting. The user then requested restoring the original grid contrast. Picking uses depth at the pointer, including open bores. Twenty focused geometry, camera, visibility and material tests pass. This follow-up does not change skills or regenerate the print.

## BR-036 — Closest-entry ordering for segmented fill

- Work date: 2026-09-10. First committed record: `6b9ebdb` (2026-09-10T14:53:09-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-10, requested a simple closest-entry implementation and review on the flange before considering more complex routing. [D-026](DECISIONS.md#d-026--closest-region-entry-first-defer-heat-considerations) records the explicit deferral of heat considerations. Writing was authorized after the user's remote sync completed.
- Implemented: shared scanline cells retain their identity through full-fill, rectilinear/grid/triangle infill and draped-skin generation. Within each operation, the composer selects the closest endpoint of either end row (up to four entries), completes that cell, then repeats. Row order and stroke direction vary independently, preserving segment volumes/metadata. Stable ties retain producer order. Existing support/layer dependencies and travel checks remain in effect.
- Scope: straight-line XYZ distance only, without lookahead, travel-time scoring or heat balancing. No reordering across operations. Closed concentric/gyroid paths, the bounded wedge and oriented/continuous operations retain existing behavior. The shared lifecycle and machine exporters are unchanged.
- Flange comparison: the isolated `Prints/pipe-flange-closest-entry-review` uses the same plan and machine snapshot as `Prints/pipe-flange-speed-review`: 88.9 mm diameter, 25.4 mm height, 6.35 mm plate, four walls, 35% infill, 0.2 mm layers and five solid top/bottom layers. Current pre-change source was measured from Git HEAD through a scratch loader, without altering the checkout. Travel fell from 74,075.177 to 51,726.662 mm (30.2%); retractions fell from 1,888 to 1,587 (15.9%). Estimated export time fell from 377.3 to 366.7 minutes. Deposition length remains 386,043.527 mm and checked volume remains 30,883.482 mm³. Scratch measurements are in ignored `.local/closest-entry/`.
- Verification: 63 focused tests pass across scanline coverage/group integrity, closest entry, reversal of variable segment data, composer constraints, travel, mesh/spline skills, material-region stacks and S5/H2D/configured Dobot exports. The flange development export passes shared checks with 422,089 interpreted moves. No human job approvals, hardware execution, physical validation, staging, commit or publication were performed by this task.
- Correction evidence: the user's follow-up identified missed entries in playback near 5:08. The initial two-entry implementation coupled row order and stroke direction, leaving two valid starts unexamined. Regression tests cover the four-entry behavior above for odd/even row counts, unchanged geometric coverage, segment volumes/metadata and uninterrupted zigzags. Shared full-fill carries it into conventional/tree support fill and interfaces; concentric, gyroid, vase, rimming and bounded wedge ordering remain unchanged.
- Corrected flange: `Prints/pipe-flange-four-entry-review` retains byte-identical plan, machine snapshot and mesh inputs, with no approvals. Travel is 49,960.820 mm, retractions 1,437, estimated export time 364.0 minutes and interpreted moves 421,782. Deposition length and checked volume remain unchanged. All 71 focused tests pass, including support integration and the regional multi-machine/multi-backend stack; shared flange export checks pass.
- Jump investigation: in the earlier two-entry export, the jump near 12:55 starts at about 12:52.5 and travels 31.656 mm. Eight cells remain; the nearest of all four valid entries is still 28.028 mm away. The missing entries explain only part of this jump. Avoiding that late long transfer would require different earlier choices; lookahead remains deferred. These are straight-line entry distances, separate from the shared route/clearance handling.

## BR-037 — Bumpy spline substrate and surface cladding

- Work date: 2026-09-10. First committed record: `6b9ebdb` (2026-09-10T14:53:09-07:00); this is a checkpoint, not an exact completion timestamp.

- Requested: 2026-09-10, current user. Replace the proposed dogbone with a circular bore and a randomly bumpy 16-by-8 outer spline, approximately 2–8 mm full-fill thickness, three perimeters, and alternating horizontal/vertical normal-offset cladding including partial vertical passes.
- Boundary clarification: the latest request identifies the spline as the full-fill exterior. Cladding builds outward from that substrate. This supersedes the earlier dogbone discussion's finished-exterior/inward-reservation assumption for this demo.
- Implemented: native periodic cubic `spline-tube` geometry and rational circular bore; ordinary full-fill sections/perimeters; explicit native spline and mapped triangle-strip surface queries; shared normal-offset curve sampling; local arc-length cells with partial axial courses and circumferential helices. Existing composer, oriented travel, RC8 exporter/interpreter, bundles and Studio remain the workflow.
- Example: `Prints/development/denso-bumpy-spline`, 16 mm bore, 32 mm substrate height, sampled 2.00–7.99 mm radial thickness, three perimeters, six 0.2 mm cladding shells. First two body layers yield five perimeter loops each where opposing fronts meet locally. The first axial shell has 48 partial and 199 full-height passes. The geometry-only review copy is `Prints/development/denso-bumpy-spline-geometry`; approvals there are separate from the development bundle and are not copied.
- Supporting fixes: Studio obtains shaded bead normals from interpreted tool frames; its settings identify substrate versus finished-pipe boundaries. ZIP32 supports more than 64 source helpers. One streamed, revision-bound source inventory replaces per-helper archive reloads, retaining per-file browser hashes and exact-source interpretation. Chat adjustment can replace a null or differently typed surface selector through normal validation.
- Scope: one periodic rectangular surface chart and one full-fill substrate. Explicit mesh mapping is required. Automatic charting, arbitrary holes/multi-patch seams, inward volume reservations, general offset self-intersection resolution and robot feasibility remain unimplemented. Coverage and normal-field interpolation are experimental and documented in the cladding manual. No physical execution or manufacturing approval by the agent.
- Verification: full suite and focused surface/source/workflow checks; see the task report for final counts. No staging, commit or publication requested.

## 2026-09-10 — Gyroid contour construction measurement

- Date basis: BR-032 checkpoint f667205 (2026-09-10T02:51:13-07:00); exact run time is not recorded.
- Original owner: [skills/planar-infill/BUILDER.md](skills/planar-infill/BUILDER.md). Preserved observation/checkpoint wording follows.

A 48 mm square gyroid construction over 16 phases at 0.2 mm sampling and
0.4 mm line width measured 24.60 s
before and 1.18 s after in this checkout; mean line-volume fraction was identical
(20.52% for requested 20%). This measures contour construction/clipping only,
not full bundle generation, export or Studio. The manual owns pattern limits.

## 2026-09-10 — Studio color review

- Date basis: explicit date in studio/RENDERING.md and BR-035.
- The user verified sky blue, orange, teal and lavender as visibly distinct with
  Studio's shaded beads. Sky blue was reviewed at `#62a9df`; the requested slight
  darkening became `#5b9fd3`. This was visual feedback, not physical validation
  or contributor consensus.

## 2026-09-10 — Rimming specification clarifications

- Date basis: dated user specification in skills/rimming-planar/DEVELOP.md and
  D-025; related implementation is BR-032.
- The user requested comparison of horizontal and normal offsets on an assigned
  bivariate support surface. The agent's phrase “reference slice” meant a
  horizontal intersection curve on the original surface, not a new geometry
  object. Choosing that starting family was an implementation choice, not a
  requirement in the user's original definition.
- Subsequent instructions required the entire base edge before either rim and
  the entire rim before any supported feature, with similar printing heights
  among ready operations across skills. Physical contact was not established.

## BR-038 — General explicit STL self-intersection repair

- Work date: 2026-09-11. First committed record: `d8ed7a9` (2026-09-11T17:36:21-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user requested repair of a supplied spiral-vase STL before Bambu printing, confirmed millimeter units, and explicitly requested an original generalized mesh fixer rather than a vase-specific patch.
- Current implementation is documented at [explicit mesh repair](core/geom/README.md#explicit-mesh-repair). Obsolete implementation details and measurements were removed at Nave's request on September 14.
- Follow-up: On 2026-09-11 the user explicitly authorized zero-infill support and ordinary planar printing after clarifying that the source defines a solid envelope. Planar infill now accepts zero alongside the existing positive range, preserving walls and full-fill's selected solid masks. The proposed H2D print uses two 0.4 mm walls, 0.2 mm layers, five bottom layers and no top layers. The existing three human reviews remain; no continuous vase-wall operation is selected.

## BR-039 — Remove repeated validation and make slicing progress truthful

- Work date: 2026-09-11. First committed record: `d8ed7a9` (2026-09-11T17:36:21-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-11, reported minutes spent under approval-saving labels, cited an approximately eight-second Cura slice and set a 10–12 second target. Explicitly requested a delegated audit of all skills, durable guidance against unnecessary/repeated/misplaced checks, pan controls and developer awareness of avoidable travel. Travel awareness is guidance, not permission to add validation gates.
- Implemented: exact-content mesh validity reuse; workflow reuse of matching geometry/plan verification; approval writes return the updated verified state without another bundle load; planar slicing shares prepared mesh sections. H2D returns its already interpreted emitted body with the packaged bytes through the common export-and-interpret entry point and renders each thumbnail size once. Griffin removes the duplicate input-path pass; H2D removes a second per-move bounds pass already enforced by the shared interpreter. Dobot required setup validation no longer repeats its optional pass. Support/rim producers consume the validated plan; rimming native control-net validity is reused by content. New/changed geometry, plans and external exports still enter their owning validation boundaries.
- Guidance: [validation ownership](core/print/README.md#validate-at-the-boundary-that-owns-the-data) distinguishes input validity from conditions first knowable on a newly constructed section or machine command. [Travel guidance](core/path/README.md#whole-plan-travel-requirement) asks developers to consider endpoints, seams, wall/component order and short transitions while constructing paths, without quotas, rejection rules or another approval. Audit includes full-fill, planar-infill, drape, vase, supports, both rim modes, pipe/surface cladding and the bounded wedge.
- Initial measurement: the isolated old zero-infill recipe measured generation about 285 seconds before and 145 seconds after geometry/section reuse; Clipper offset/normalization remained a major cost. These measurements did not meet the requested 10–12 seconds. This initial change included no Clipper replacement or new seam algorithm; the later kernel migration is recorded in BR-041. The user subsequently changed the ordinary test print to 15% rectilinear infill with five top and bottom layers; prior recipe timings are not a benchmark of that new recipe.
- Viewer: the parent task adds pan, uses “Calculating toolpath” consistently, removes redundant status copy and keeps the busy spinner animated (with slower rotation for reduced-motion preference).
- Remaining audit work: direct shell/wedge generation still calls plan validation after workflow loading; expensive mesh validity is reused, but smaller settings checks can repeat. Spline placement rebuilds a shell and recomputes numerical closure under rigid translation, and selected surface construction repeats the selector's field validation. These remaining sites were identified but not changed during the already approved active generation. The audit must not be described as proof that all duplication is eliminated.
- Verification: 48 focused audit tests pass: 19 H2D/Griffin/modal/browser-source/wedge export checks and 29 support/rimming/Dobot/DENSO checks. Coverage includes fresh versus cold program equality, unchanged bytes, archive/setup tampering, changed control nets, caller mutation, skill composition and exact delivery. Repository documentation checks and whitespace checks pass. Parent workflow/mesh/section/viewer checks are reported separately with the task result. No agent-created manufacturing approval or hardware execution occurred.

## BR-040 — Dimension-aware precision audit and developer guidance

- Work date: 2026-09-11. First committed record: `d8ed7a9` (2026-09-11T17:36:21-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-11, explicitly requested another audit agent to find inappropriate or mismatched precision throughout the project and write guidance preventing recurrence. The comparison target remains roughly 10 seconds in Cura, not simply fewer decimal characters in files.
- Guidance: [precision belongs to a quantity and an operation](core/geom/README.md#precision-belongs-to-a-quantity-and-an-operation) covers coordinate grids, curve deviation, spatial sampling, repair resolution, coincidence/topology predicates, area/volume, UV parameters, angular tolerances, independent XYZ/E/feed/time/pose rounding and visual approximation. It records primary-source Cura examples as distinct quantities, suggests process-aware experiments and requires measured cost alongside shape/volume effects. This adds no production verification pass or approval.
- Corrected: the level-set constructor no longer compares area in mm² against a linear chord tolerance or silently discards small nonzero material. PathBuilder preserves short XYZ motions that remain distinct at the actual coordinate rounding, including tiny grid-boundary crossings; this repairs the next variable-gap segment's length/volume correspondence exposed by the parent's coarser offset-grid experiment. The existing regional physical-volume assertion was retained unchanged. Tolerance-module commentary now distinguishes native parameter units from mm and avoids claiming machine accuracy from a chord target.
- Verification: 9 focused regional/modal/straight-motion checks passed, including six-stage variable-gap composition across S5/H2D/Dobot and mesh/spline backends. After adding dedicated regressions, 25 geometry/straight-motion/draped-skin checks passed. Separate parent offset experiments and performance measurements are reported by that task; this audit does not establish the requested slicing latency.
- Remaining priorities: polygon coordinate/vertex budgets; dimensionally inconsistent and scale-dependent determinant thresholds in repair/projectors; UV-to-physical error mapping; separate export field budgets and accumulated relative-E error; tiny-segment volume handling for actual coordinate collapse; oriented-motion small-move policy. These are concrete audit findings, not an assertion that every tolerance should be coarsened. No print approvals, server restart, hardware execution, staging or commit occurred.
- Export follow-up: profiling found repeated formatting and modal self-parsing in the shared G-code writer. XYZ/E now quantize once for text, state and flow calculations; changed XYZ/F fields are emitted directly. A captured pre-change fixture preserves exact absolute/relative-E bytes across rounding, negative zero, modal changes, retraction and flow limiting. Nine focused modal/H2D/large-export checks pass. An isolated 20000-move benchmark retains exact bytes and measures median absolute output 167.2→82.6 ms and relative output 172.0→54.4 ms. These bounded measurements are not an end-to-end job timing; interpreter and packaging costs remain separate.

## BR-041 — Complete shared Clipper2 integration

- Work date: 2026-09-11. First committed record: `d8ed7a9` (2026-09-11T17:36:21-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-11, clarified that the prior instruction applied Clipper2 to all skills and requested a timing comparison on the current vase before further integration. Investigation found that general booleans used Clipper2 while offsets and their normalization still used Clipper 6 JavaScript.
- Implemented: one shared C++/WASM instance in `core/region/clipper2.mjs` now owns closed planar booleans, open-path clipping, polygon inflation and offset normalization. Bulk integer buffers cross the native boundary. All skill consumers use the shared adapters; experimental surface-offset swept-band cleanup does too. Clipper 6 is removed from runtime dependencies, with no fallback. Both shell and wedge bundle identities include the shared kernel and exact dependency JS/WASM bytes. The offset `1e-5` mm and boolean `1e-9` mm grids remain unchanged.
- Scope: full-fill/perimeters, all planar-infill patterns and masks, drape, vase, supports, wedge, pipe substrate, material regions and comb travel share these planar operations. Rimming and surface cladding retain their shared 3D differential-offset algorithms; mesh/spline sectioning retains native geometry queries. CLI/MCP commands, machine output selection and human reviews use the existing workflow.
- Independent reference: the new Clipper2 C# runner and 90-case fixture retain upstream source hashes, input hashes and construction options. Historical Clipper 6 reference data remains explicitly historical; it is not relabeled or regenerated from production WASM. Existing analytical, nesting, touching-junction, collapse, perimeter and surface-convergence cases remain relevant. Final migration test counts are reported with the implementation result.
- Measured before integration: identical plan/machine hashes for the 15% rectilinear vase produced 38.600 s generation plus 10.581 s checked export with the optimized Clipper 6 adapter (49.181 s), versus 30.128 s plus 13.038 s in the scratch Clipper2 comparison (43.166 s). The latter exercised 5810 native offsets. Move counts differed, 1147567 versus 1201157, so this is a same-input kernel comparison rather than byte-identical output.
- Integrated measurement: the same inputs produced 31.735 s generation plus 14.929 s export/interpretation, totaling 46.664 s after geometry load; the separate cold geometry/plan stage took 7.425 s and file reading/parsing took 0.142 s. The integrated and scratch Clipper2 runs produced the same 1201157 moves. These individual runs vary with machine load and do not establish a stable speedup percentage. None meets 10–12 seconds. The independent C# oracle matches all 90 offset cases exactly; focused offset/junction/vase tests pass after removing the redundant post-inflation union.
- Related performance work: operation material regions are computed when consumed, comb corners/indexes and constant clearance are reused, ZIP uses compression level 1, and the G-code writer avoids repeated formatting while preserving emitted command bytes. These changes retain the shared slicing/export pipeline. The opt-in [print benchmark](scripts/bench/README.md#slicing-speed-benchmarks) records stage timings and optional CPU profiles outside the print bundle, with no production timing gate or added approval. No physical print or hardware execution is established by these measurements.

## Independent spacing and finished-surface cladding — 2026-09-11

- Source: user requested independent line spacing behind one setting, brief discovery in the capability digest, alternating helix winding, and cladding over a wavy vase wall with ten times tighter spacing. Implementation was authorized on the condition that this task leave vase mode itself unchanged.
- Implemented: the shared [spacing contract](core/path/README.md#line-spacing) covers seven patterns without requiring matched pitch and bead-width parameters. Explicit cladding consumes a [published finished boundary](core/path/README.md#finished-surfaces) and its source dependencies instead of requiring full-fill. Shared adapters publish fill, infill, automatic vase sides and draped roofs, including regional and selected assembly components. The existing vase generator is unchanged by this work; authored paths retain their no-implicit-surface contract.
- Preview: `Prints/development/wavy-vase-crossed-helices` has a 30 mm hollow wavy vase wall and four alternating helical shells. Spacing factor 3 replaces 30: nominal 1.2 mm instead of 12 mm with the same nominal 0.4 mm bead width. The checked development export has 61,488 interpreted moves and about 29.6 minutes nominal motion. The user confirmed the Studio result working and looking correct.
- Evidence: all 395 tests passed at the implementation checkpoint. Dedicated spacing, crossed-cladding and finished-cladding tests cover deposition volume, unchanged vase paths, producer dependencies, published extents, regional/assembly selection, source playback and checked reopening. This is software and visual evidence; no physical print or manufacturing approval is recorded.
- Scope: explicit cladding still requires a supported rectangular periodic mesh or spline chart. Nominal finished boundaries do not establish continuous coverage or physical contact; arbitrary chart unwrapping, open patches and offset self-intersection resolution remain outside this change. The legacy circular recipe retains its full-fill reserved-band adapter.

## 2026-09-11 — External precision reference inspection

- Date basis: explicit inspection date in core/geom/README.md; related work is BR-040.
- The CuraEngine coordinate reference described integer micrometres. The Cura
  base definition inspection found separate defaults of 0.5 mm segment resolution,
  0.025 mm maximum deviation and 50000 µm² (0.05 mm²) extrusion-area deviation.
  Machine/quality overrides and the user's effective settings were not established.
  These were examples of different precision quantities, not a SAAM speed guarantee.
- Sources: [coordinate concepts](https://github.com/Ultimaker/CuraEngine/wiki/Concepts)
  and [base settings](https://github.com/Ultimaker/Cura/blob/main/resources/definitions/fdmprinter.def.json).

## Text geometry — 2026-09-12

- Source: user requested raised/recessed text in supplied fonts, shaped on a part's spline surface or an independent reference, and accepted flat construction followed by surface warping.
- Implemented: [text task skill](skills/text/SKILL.md), CLI `text` and MCP `apply_text`; saved fonts, layout/variation controls, Bezier baseline, rigid or bent glyphs, normal relief, independent rational spline/plane references and named original-part patches. Text modifies selected assembly components or becomes standalone geometry. Edits rebuild from the retained original part.
- Geometry: existing planar Clipper2 union owns outline normalization; pinned Fontkit supplies shaped outlines and Manifold supplies shared 3D solid union/subtraction. Text-modified spline targets are explicitly tessellated; their recipes are retained. The actual resulting mesh is shared by Studio and slicing, with normal review invalidation and original STL integrity checks.
- Evidence: analytical volume/section checks, glyph counters, curved spline convergence, cylindrical and doubly curved references, baseline/mirror/normal direction, persistent edits, CLI/MCP and shared generation tests. Twelve text tests pass at this checkpoint, including a regression that checks deposition above the curved roof for every letter. The saved G-code was independently interpreted to verify those deposition moves; this is software evidence, not a physical print result.
- Correction and user confirmation: the user reported that the curved-roof example's visible text was not reproduced by its toolpath. The 6 mm Abel font lost narrow C/U strokes with the selected 0.4 mm bead. Explicit `outlineOffsetMm: 0.15` expands each stroke boundary before layout and warping; the revised saved export contains deposition for all five letters of CURVE, reaching approximately 0.77 mm above the roof for the requested 0.8 mm relief. After inspecting the updated Studio result, the user confirmed it working. This records visual/toolpath confirmation; no physical print outcome is claimed. Reproduction commands are in the [text manual](skills/text/SKILL.md#reproduce-the-development-examples).
- Limits: current font/geometry/precision boundaries are owned by the [manual](skills/text/SKILL.md#supported-scope-and-quality) and [geometry reference](core/geom/README.md#text-and-solid-modifiers). Automatic mixed-script paragraph layout, arbitrary trimmed CAD surfaces and a certified global surface-error bound are not implemented.

## 2026-09-12 — Separate current documentation from work history

- Work date: 2026-09-12 UTC / 2026-09-11 America/Los_Angeles.
- Source: the user required build requests to contain only outstanding or
  incomplete work, requested a backdated devlog sweep, and specified present
  tense for current documents.
- Moved all 42 numbered request checkpoints and the spacing/cladding and text
  work records into this log. Also moved dated benchmarks, S5/H2D observations,
  color-review evidence and implementation explanations out of current manuals.
  Original dates and commit checkpoints supplied the dating evidence; unknown
  work dates stayed unknown. Historical status and test counts retained their scope.
- Reduced build requests to eight unresolved follow-ups: complete-print/novice
  evaluation, H2D acceptance/retest, matched slicer timing, actual web-client/plugin
  acceptance, live Claude Code permissions, slicing latency/validation duplication,
  precision follow-through and the existing S5 startup discrepancy. Current
  limitations and deferred proposals did not become new implementation requests.
- Updated the entry point, developer orientation and contribution rules for
  build-first work, current-tense ownership and devlog closeout. Decision provenance,
  exact quotations and license/source/fixture notices retained narrow exceptions.
  The repository check gained open-request structure and devlog-presence checks.
- Corrected the wedge export reference's stale regeneration-on-reopen claim to
  match saved-export interpretation and the planar-infill reference's stale
  description of vase convexity. These were documentation corrections.
- Verification: repository checks passed for 49 Markdown documents and 579 local
  links; 11 isolated guard fixtures covered valid/empty queues, Windows line
  endings, completed/conflicting statuses, historical headings/fields, duplicate
  requests and missing fields. All 42 historical BR identifiers and both newer
  work records were present. No manufacturing tests or physical runs were part
  of this documentation sweep.

## 2026-09-12 — Map vase motifs around a required solid or sleeve

- Source: the user corrected the standalone-path interpretation: vase mode
  requires a solid or closed sleeve, with a pattern mapped iteratively around it.
  Open zigzags are valid motifs; continuous extrusion defines vase mode, while
  explicit segmented paths permit travel.
- Replaced XYZ paths with repeatable perimeter/height motifs in the existing
  vase-wall skill. Each mapped point uses the host's actual-Z inset contour;
  endpoint matching includes periodic seams and repetition boundaries. Solid
  and single-bore sleeve hosts share the same mesh/spline query path. Old XYZ
  recipes fail explicitly rather than silently acquiring different geometry.
  The [manual](skills/advanced-vase-wall/SKILL.md#sleeve-patterns) owns the coordinate,
  extrusion-height, sampling and endpoint conventions.
- Verified all 406 tests at the implementation checkpoint, then all 18 focused
  vase tests after adding an explicitly tapered-host fixture. Coverage includes
  concavity, sleeve bores, continuous joins, segmented travel, volume integration,
  source round trips on S5/H2D/Dobot and synthetic exact-byte delivery.
- Opened and visually inspected `Prints/development/continuous-sleeve-zigzag`
  in Studio: 50 repetitions around a 28 mm diameter closed sleeve, 7143 checked
  machine moves and about 5.2 minutes estimated motion. The public check reported
  no program error and all three human approvals false. This supersedes the
  standalone examples in BR-042; contact, physical strength and printing remain
  unvalidated. No commit or publication occurred.

## BR-042 — Generalize vase traversal and distinguish segmented paths

- Work date: not recorded; present in the working tree at migration on 2026-09-12 UTC. No committed record is available for dating this work.

Historical initial implementation; standalone paths below were corrected by the
sleeve-pattern follow-up. They are no longer the current skill contract.

- Source: current user selected vase-wall generalization, proposed tilted overlapping loops, then clarified that paths may instead be open noncrossing zigzags or other shapes, with an agent-chosen endpoint/travel convention. Follow-up explicitly requires vase mode to retain continuous extrusion and a separate name when travel is needed.
- Implemented: [arc-length contour traversal](core/geom/contour-path.mjs) replaces the fixed interior polar origin for automatic walls, supporting concave mesh/spline sections while their inset remains one outer loop. The first seam is selected geometrically and projected onto subsequent contours. Existing actual-Z queries, offsets, boundary sampling, volume ramps, level ending, operation composition and exporters remain shared.
- Authored paths: the existing skill accepts ordered XYZ polylines and constant or pointwise bead heights through `paths`. `pathMode: continuous` requires consecutive shared endpoints; `segmented` is presented as **segmented paths** and permits the shared composer to travel across gaps. All segments inside a path deposit; closure is explicit; no automatic closure, reversal or hidden travel is added. Shared deposition construction integrates linear bead height. Both positive and negative slopes respect the machine limit. Plan/regional validation, source identity, CLI/MCP adjustment, Studio labels and review/delivery use the current lifecycle.
- Limits: automatic section splits, islands and holes remain unsupported. Arc-length correspondence is not arbitrary feature tracking or topology matching. Authored paths are explicit approximating polylines, not an automatic contact/overlap or structural-strength solver; they publish no fictitious area or rim support. The [manual](skills/advanced-vase-wall/SKILL.md#sleeve-patterns) owns coordinates, height and continuity conventions.
- Development examples: `Prints/development/continuous-zigzag` uses tapered alternating open passes; `Prints/development/segmented-zigzag` uses level passes with shared travel. Both reach 3.2 mm and use an S5 reference box. Checked exports have 5740 and 160 interpreted moves respectively; counts differ because tapered volumes retain subdivisions and constant-volume collinear paths compact. Both reopen through the public CLI with all approvals false. Studio source playback and travel visibility were inspected.
- Verification: all 389 tests passed in the full suite. After final Studio label changes, 20 focused path/settings/material tests passed. Coverage includes concave mesh/spline geometry, cyclic contour ordering, open endpoints, continuous joins, segmented travel, variable-volume integrals, descent limits, translated regions, S5/H2D/configured Dobot source round trips and synthetic exact-byte delivery. Repository documentation/whitespace checks pass. No human print approvals, hardware execution, physical strength validation, staging, commit or publication.

## Undated — Studio browser cap measurements

- Date basis: Original run is undated; preserved by d8ed7a9 (2026-09-11T17:36:21-07:00).
- Original owner: [studio/RENDERING.md](studio/RENDERING.md). Preserved observation/checkpoint wording follows.

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

## 2026-09-12 — Skill audit for assumptions hidden in first demos

- Source: user requested an audit of every skill for knowledge available only to
  its first maker agent, authorizing workflow or concise manual fixes. Follow-up
  excludes vase-wall edits while another task works there.
- Audited all 13 cataloged manuals against their entry points, defaults, demo
  preparation and relevant input requirements. Added guidance for complete shell
  recipe creation, inherited draped-skin selection, assembly roof selection,
  wedge nozzle/material restrictions and the text example's packaged font.
- Documented existing reusable DENSO and Dobot synthetic setup helpers for new
  provisional shapes, plus spline-tube control heights, angular/bore constraints,
  actual UV domains and native mesh-strip indexing. No new machine requirement,
  production validator or manufacturing approval stage was introduced.
- Shell and wedge CLI status now expose the existing output-availability and
  missing-configuration result before generation. Added CLI integration coverage
  for unconfigured DENSO/Dobot on both adapters. Contribution guidance now makes
  a demo's reusable preparation discoverable from its skill manual.
- Verification: five MCP/CLI access tests pass, including four fresh robot
  adapter combinations. Fresh temporary box bundles generate checked development
  output on S5, DENSO and Dobot without approvals. A new 12-column/6-control spline
  tube and its non-demo UV domain pass construction and surface selection.
  Repository documentation and whitespace checks pass; no physical test occurred.
- Vase-wall audit only: its motif demos initialize a non-null pattern directly,
  whereas adding a pattern to a fresh bundle through `adjustBundle` fails with
  `Cannot convert undefined or null to object` in the shared merge of a null
  setting. Its simple recipe also leaves disabling the template's draped skin
  implicit. These findings are reported to the user; this task makes no vase-wall
  edits. Supports, both rimming skills, mesh-tools, voxel-tools and Gridfinity
  have no additional hidden prerequisite identified in this audit.

## 2026-09-17 — Vase walls take the points their geometry requires

- Source: user, as builder work on the vase-wall skill: a fixed point budget
  that fails is unacceptable in vase mode; if a memory limit were real, the
  work would have to be segmented rather than fail.
- Measured before the change: an ordinary 100 mm diameter, 250 mm tall vase at
  0.2 mm pitch needs 640513 wall points, over six times the former 100000
  default, so the default cap rejected everyday parts. With the cap lifted, a
  2560001-point wall (0.1 mm pitch, 0.5 mm step) generated in 10.6 s and
  exported a 120 MB program in 7.5 s within 578 MiB of heap on a 4.3 GB Node
  heap, about 0.2 KB per point end to end. No vase-level memory limit is
  warranted; the only bound is the Node heap shared by every skill's program.
- Implemented: removed the vase-wall point and section-query budgets from the
  plain spiral, the mapped-pattern path and motif tiling. Every loop is finite
  (turns, authored courses, bounded subdivision depth), so the wall takes the
  points its geometry, pitch and tolerances require. `maxPoints` left
  `VASE_WALL_DEFAULTS`, plan validation and the mesh-vase preparer; older
  recipes and region overrides carrying any value are read and the field
  dropped, never enforced. Reports no longer carry `maxPoints` or
  `maxSectionQueries`. The exact per-section cache now keeps a 256-height
  window in every mode, so a curved exact wall no longer retains every section
  and its offsets for the entire print. Manuals and the nudge-cup example
  updated; other skills' budgets are untouched.
- Verification: the vase-wall suites and affected core suites pass, except
  three region-composition failures that already fail on a clean checkout of
  `e783862` and are unrelated to this change. A new regression generates a
  wall above 100000 points on the exact path and reads old budgets as inert.
