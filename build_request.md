# Build requests

Only outstanding or incomplete work belongs here. Work normally proceeds
build-first; completed work and dated evidence belong in [DEVLOG.md](DEVLOG.md).
Current component references and skill manuals own implemented behavior.
See [documentation maintenance](BUILDERS.md#documentation-maintenance) for
the closeout rules. An empty outstanding-work list is valid.

Every request must be explicitly human requested, or agent proposed and explicitly
human approved. Record the contributor account, the request/approval evidence,
the originating chat title when recoverable, and a brief explanation of what
prompted the work. An agent's recommendation, audit finding, missing test result,
commit authorship or silence does not establish a human request or approval.
See [request provenance](BUILDERS.md#build-request-provenance) for attribution and
scope rules.

Use a `### BR-NNN — Title` heading with these fields:

- `Status`: `open`, `in progress` or `blocked`.
- `Contributor`: requesting or approving account, with the basis for attribution.
- `Authorization`: `human requested` or `agent proposed, human approved`, followed
  by the authorized scope and any explicit deferral.
- `Session`: exact observed chat title and stable ID/link when available; otherwise
  state that it is unavailable. Distinguish an origin from a later follow-up.
- `Source`: dated request/approval excerpt or faithful summary and a retrievable
  reference. For an approved proposal, retain both the proposal and approval.
- `Context`: briefly explain the originating problem or discussion; link related
  records or contracts as useful context.
- `Remaining` and `Completion`: outstanding authorized work and what resolves it.

On completion, cancellation, supersession or discovery that an item was never
authorized, preserve its provenance and disposition in the devlog and remove it
from this queue. Update owning manuals and redirect links. Partial completion
leaves only the authorized remainder. Preserve IDs; do not reuse removed IDs.
A deferred idea belongs in a decision or labeled proposal until requested.

## Outstanding work

### BR-058 — Implement the Cloudflare relay alpha milestone

- Status: in progress
- Contributor: `remettub`, inferred from the checkout's contributor branch and account; attribution unconfirmed.
- Authorization: human requested — "Yup RELAY-PLAN.md is the one. We are going to get started on that now," after the agent noted that stage 1 is core work needing the developer role. Scope is the [relay plan](adapters/mcp/RELAY-PLAN.md) roadmap under [D-037](DECISIONS.md#d-037--cloudflare-relay-and-studio-driven-chat-sessions); production deployment, beta publication and hardware operation are not separately authorized.
- Session: Claude Code desktop, 2026-09-25; exact chat title and ID unavailable.
- Source: current conversation, 2026-09-25.
- Context: The D-024 temporary HTTP bridge was removed in `d686269`; only the stdio adapter remained. Stage 1 separated the operations into [the local runtime](adapters/mcp/src/runtime.mjs) from [MCP registration](adapters/mcp/src/server.mjs), and made the runtime outlive its sessions; per the user, ended sessions are not resumed.
- Remaining: Stage 2: deployment to the user's Cloudflare account (KV namespace, public origin) and real ChatGPT/Claude connection; device-registration abuse limits. Stages 3–6 of the plan's roadmap. Stage 1 is done; the user cut idempotency records, job receipts and the cursor/acknowledgement event protocol as overbuilt (2026-09-25).
- Completion: Alpha acceptance A1–A5 in the plan.

### BR-057 — SAAMpath context labels on change, not on every action

- Status: open
- Contributor: `remettub`, inferred from the checkout's contributor branch and account; attribution unconfirmed.
- Authorization: human requested — "we need phase as an enclosing tag or equivalent, not an entry for every point … write it as a build request"; "timing doesn't need a separate data column, we just derive if we ever need"; "labels only when it changes is the general gist of the BR." Scope is the SAAMpath representation and its consumers; no change to deposition, ordering or exported machine behavior.
- Session: Claude Code, 2026-09-24 context-reduction session; exact chat title and ID unavailable.
- Source: current conversation, 2026-09-24, after measuring regenerated SAAMpath against Bambu G-code.
- Context: `core/path/planning.mjs` copies `phase`, `layer`, `operation` and the stroke's `region`, `role`, `connector` and gap diagnostics onto every action. On `bambu-x1-ams-white-grey-black-fast-01` (954 moves) SAAMpath is 261 KB against 41 KB of G-code: motion (`to`, volume, speed, kind) about 99 KB, repeated labels about 98 KB, gap diagnostics (`gapMm`, `lowerSurfaceGap*`, `sampledGapErrorMm`) about 60 KB. `layer` is the producer's own index, keyed with `phase`; exporters write both as program labels (`;SAAM_PHASE:`/`;LAYER:`, DENSO/Dobot labels), Bambu counts layers by them, and Studio colours and layer-steps playback from them. Pose moves (DENSO) also carry `durationSeconds`, computed from the flow-limited speed while `speedMmS` keeps the requested speed; ordinary moves store the limited speed and no duration.
- Remaining: Carry context as a change record, such as an enclosing span or a `context` action emitted only when phase, layer, operation, region, role or connector changes, and have every consumer (exporters, players, travel advisory, Studio, tests) read context from the current span. Drop per-action `durationSeconds`: derive time from length and effective speed where needed, keeping an explicit duration only for zero-length pose moves (reorientation in place), which speed cannot express; store the effective speed on pose moves as on others. Decide whether gap diagnostics stay on moves, move to a span, or leave SAAMpath for a diagnostic record.
- Completion: Exported machine programs are byte-identical before and after for the existing export tests; Studio playback, layer stepping and phase colours are unchanged; SAAMpath size on the measured part is reported before and after.

### BR-055 — Extend Bambu hardware acceptance beyond the verified H2D installation

- Status: in progress; H2D two-colour and mixed-nozzle exporter/guidance work is complete for the physically tested installation.
- Contributor: current user; earlier attribution to `remettub` was inferred and remains unconfirmed.
- Authorization: user requested startup/nozzle/plate/AMS synchronization and support for any supported feed combination and machine (2026-09-21). The earlier AMS investigation originated in Claude Code session `1a69160c-5d8b-4d89-898f-cfcd81550fdb`; current session title/ID unavailable.
- Accepted H2D scope: ordinary generated v13 AMS-19 and DUAL-20 physically passed same-nozzle PLA colour changes and left 0.4/right 0.8/left nozzle changes with correct deposition heights. Both use fast startup, Textured PEI and right four-slot AMS; dual uses the left external spool. No reference project entry is substituted. Canonical settings, synchronized stored/executable sections, regression protection and maker workflows are implemented in [the Bambu contract](core/export/bambu.md).
- Remaining: X1 AMS switching failed its earlier test and X1 is unavailable; investigate and physically accept its package/USB mapping behavior when available. Validate other supported plate/nozzle/feed configurations as hardware becomes available, distinguishing implemented configuration support from physical evidence. No direct printer-dispatch adapter exists; user-confirmed mapping remains the current dispatch path.
- Completion: close each remaining machine/configuration with exact exported-file evidence and actual nozzle/filament/plate observations. H2D acceptance does not certify every Bambu installation. Historical diagnosis and completed BR-056 evidence are in [DEVLOG](DEVLOG.md#2026-09-21--generated-h2d-dual-20-passes-closing-dual-nozzle-exporter-work).

### BR-054 — A brim producer that does not need a modeled flange

- Status: open
- Contributor: `remettub`, inferred from the checkout's contributor branch and account; attribution unconfirmed.
- Authorization: human requested — after a physical bed-adhesion failure, asked for a brim on the current print and then: "you may want to escalate to builder and write the first draft of a bed adhesion skill, currently very small, only with one entry - brims." Scope covers the brim entry; a raft, a detached skirt and a removal gap are proposals, not authorized here.
- Session: Claude Code session `1a69160c-5d8b-4d89-898f-cfcd81550fdb`; exact chat title unavailable.
- Source: current conversation, 2026-09-19: "It didn't adhere to the print bed, can you give it a good solid brim to start out, maybe 8 layers on the outside before getting to the part, with full flow or maybe even a little more", clarified as "Just do the first layer and then vase on top of that".
- Context: [bed-adhesion](skills/bed-adhesion/SKILL.md) documents the brim that is achievable today: a flange modeled into the part's first layer height plus a first-layer region assigning `planar-infill` with `density: 0`, a `perimeters` count and a region `process` override for bead width and speed. Verified on the `chalice-drip` bundles — nine loops at the predicted radii, 3,111 mm of first-layer path at a measured 0.652 x 0.2 mm bead. Because the loops come from the region's own section, the brim width lives in the geometry, so an imported STL cannot take a brim without editing its mesh.
- Remaining: Derive the brim loops from the part's own first-layer section offset outward, rather than from a modeled flange, so brim width and loop count are ordinary recipe settings. Decide where the offset belongs relative to the existing shared section/offset components before adding a producer. Keep `density: 0` behaviour so an open-bottom part stays open.
- Completion: A brim is requested through recipe settings alone on any supported geometry, including an imported STL, with its loop placement visible in Studio's first layer. Covered by a test. No physical validation is implied.

### BR-053 — Restart an agent-owned Studio on the same port

- Status: open
- Contributor: `remettub`, inferred from the checkout's contributor branch and account; attribution unconfirmed.
- Authorization: human requested — asked whether a Studio can be restarted on the same port and, if that is not supported, said it can go in a build request. Scope: let an agent restart its own Studio and keep its URL. Any related stale-source warning or onboarding guidance is a proposal and is not authorized here.
- Session: Claude Code session `01e30a9a-dde6-45f3-b8eb-5829055cdac7`; exact chat title unavailable.
- Source: current conversation, 2026-09-19: "Is it possible to restart and use the same port? If not supported currently, we can put that in a build request." The user had just asked why a second Studio instance was started; "We've been trying to reduce multiple studio instances."
- Context: During a builder task an edit to `machines/bambu-x1-carbon.json` left the live Studio running [older source than the files on disk](studio/README.md), so it had to be restarted. The toolkit launch path (`--toolkit create-preview|open-print|start-tour`) always listens on port 0 (`listenPreview` in [toolkit.mjs](core/agent/toolkit.mjs)), so the restart got a new URL and the person's tab had to be re-pointed. The plain launcher `node studio/server.mjs DIR` reads an undocumented `SAAM_STUDIO_PORT` variable, but it does not carry the agent owner, requests or events, so it is not a substitute.
- Remaining: Let the toolkit launch path bind a requested port (or reuse the previous instance's port when relaunching with `--agent-owner`), and fail clearly, naming the process holding it, when the port is busy. Document it where agents already read Studio restart guidance. Keep one Studio per agent by default.
- Completion: An agent stops its own Studio and relaunches on the same URL, and the person's open tab reconnects with the print and pending requests intact. A busy port gives an actionable error and never silently picks another. Covered by a test.

### BR-052 — Complete the dev map against the 2026-09-21 intent

- Status: in progress
- Contributor: Project owner (remettub), attribution from the 2026-09-21 review session.
- Authorization: human requested — apply the reviewed Grasshopper-style code-and-map standard throughout core and Studio, eliminating unresolved and uncertain relationships through scanner improvements, sensible authored relationships or clearer code shapes; shortening diagnostic lists is not completion. On 2026-09-21 the owner settled the intent recorded in [D-038](DECISIONS.md#d-038--dev-map-intent-functional-tree-complete-leaf-context-findings-kept-code-shape-rules) and approved the remaining generator items listed in the handoff.
- Session: Origin: Codex task `01a0ba56-7b17-71e3-9219-4972a0bc5bfd`. Follow-up: the 2026-09-21 dev-map review session (title unavailable).
- Source: Origin: "Let's apply this to the whole core/studio codebase now" and "don't stop the team until the whole core/studio codebase is mapped". Follow-up: the owner's point-by-point approvals recorded in [D-038](DECISIONS.md#d-038--dev-map-intent-functional-tree-complete-leaf-context-findings-kept-code-shape-rules).
- Context: The 2026-09-21 DEVLOG entries record what landed: scope, collapse rule, nested homing, constructor fold, scanner resolution, active outside callers, scope-edge arrows, findings on drawn boxes, registry entries, two code-shape passes. The functional-tree reshape was in flight at the last checkpoint.
- Remaining: In order: (1) cluster entry points by links, visibility and saliency where a label helps (phase 1 awaiting review); (2) expression operators, platform producer boxes and branch joins for the value-origin findings (awaiting the owner's go); (3) the read fields, store, viewer and `flows/` in the [glossary](DEVELOPER-CONTEXT.md#dev-map-glossary) terms, each finding row carrying its class (awaiting the terms and the owner's go); (4) generator gaps: a leaf called twice on one map hangs its chain off the first box; 9 callables destructured from a parameter record; captures in anonymous nested callbacks; `Array.from(x, fn)`, `flat()` and throws inside entered callbacks; `Set`, `splice` and `get(k).push` collections, multi-path backedges and generators; per-site `calls` evidence and containment descriptors not yet drawn; (5) re-measure stranded and uncalled declarations. Open questions: the map-or-code wording (a data link on either called declaration, or between them); ubiquitous repeats (15 declarations make 1168, `requireThat` 682); whether `closure-capture`, `loop-exception-path` and platform `member-receiver-unresolved` rows are still problems; very deep chains (depth 13) and viewer spread (`RANK_SPREAD`, `ASPECT`, `LONG_DX/DY` in `leveled.py`). Done 2026-09-21 to 24: see DEVLOG.
- Completion: Every declaration page shows its callers, callees, state and consequences without a separate trace; no page draws one box or a floating box; findings remain visible at their nodes; the remaining unresolved rows are accepted scanner limits: `res.end`/`res.write` on node:http parameters, members on reassigned `let` receivers, a policy assembled by spread, `this` in object-literal methods, `now()` known only as a parameter default, and callbacks supplied only by unscanned callers (`onGeometry` in `runRepairJob`).

### BR-051 — Complete output for the three new printer profiles

- Status: open
- Contributor: Current requester; account attribution unconfirmed.
- Authorization: human requested — add Bambu X1 Carbon and Ultimaker 2/3 profiles, keep materials changeable, then correct the 2-series model to Ultimaker 2 Extended.
- Session: Current Codex task; exact title and stable task ID unavailable in supplied conversation.
- Source: 2026-09-16 messages: "We need to add a bambu x1 carbon profile", "We can change materials, though, right? That's just the default, right?", "We also need a profile for the ultimaker 2 and 3 (same?)", and "actually it says 'ultimaker 2 extended'". [Implemented definitions and verification](DEVLOG.md#2026-09-16--x1-carbon-ultimaker-2-extended-and-ultimaker-3-profile-definitions).
- Context: Machine definitions, material choices, catalog registration and geometry/setup persistence are implemented. The profiles explicitly declare output unavailable; no compatible startup handoff or full machine-program contract has been established for these models.
- Remaining: Establish X1-specific startup/shutdown and sliced-3MF metadata with material-correct settings; implement the original UM2 Extended's volumetric UltiGCode semantics and firmware-managed startup; establish UM3-specific Griffin startup/shutdown. Use representative vendor-sliced exports and owning firmware/slicer sources to resolve these contracts. Do not inherit H2D/S5 service routines by model-name substitution. Enable each output only with matching exporter/interpreter and shared lifecycle coverage.
- Completion: Each requested profile generates a machine-specific program that can be reopened, reviewed and delivered through the shared lifecycle, with material selection reflected consistently and software checks recorded separately from any physical trial. No hardware execution is authorized by this request.

### BR-050 — Finish Studio coordination and read-path handoff

- Status: in progress
- Contributor: Current requester; account attribution unconfirmed.
- Authorization: human requested — “read handoff and get to work,” with decisions explained and questions only for genuine ambiguity; then “2. I don't think it's worth it but start the rest.” SQLite adoption is withdrawn. Brief browser disconnects retain a tour until exit/cancel or Studio shutdown.
- Session: Current Codex task; title and stable task ID unavailable in the supplied conversation.
- Source: 2026-09-15 instructions above; [implementation and decisions](DEVLOG.md#2026-09-15--file-compatible-handoff-work-after-sqlite-withdrawal), the earlier handoff in the same log, and the [live agent/Studio session follow-up](DEVLOG.md#2026-09-17--live-agentstudio-sessions-and-review-completion).
- Context: Request presentation, tour lifetime, operational polling and repeated source reads were identified in the Studio flow audit. Managed agent/Studio coordination now uses a live owner-scoped request store with explicit Studio instances; request files remain a recovery journal and external-writer compatibility path. Scoped activity, Studio-worker cancellation, review metadata updates and normal-shutdown tour cleanup are implemented. No database or runtime migration was performed.
- Remaining: Cross-process exclusive claims and atomic request/tour transitions; forced-process-death tour invalidation; a shared cancellation/supersession owner for CLI/MCP generation and edits queued behind generation; coordination of activity and cancellation writes across independent processes; concurrent verified-source reuse and remaining nested read/copy reductions. Complete the authorized audit for cold processes, large STL/native/source files, growing review history, worker costs, and simultaneous writers. Keep database adoption excluded unless separately authorized.
- Completion: Implement and exercise the remaining ownership/recovery behavior without introducing competing persistent stores; record the remaining audit measurements and their limitations. Preserve current-byte validation at approval/delivery boundaries and separate software evidence from physical results.

### BR-049 — Improve generators identified by short-travel advisories

- Status: in progress
- Contributor: Current requester; account attribution unconfirmed. 2026-09-18 continuation by `remettub` as developer.
- Authorization: human requested — add an advisory for all Studio toolpaths and improve the responsible skills/functions “at some point”; on 2026-09-18, “fix ALL skills / toolpath generation so they are robust and the travel advisory essentially never triggers”, and have the agent always mention a finding.
- Session: Codex task `01a0a650-b120-7bd3-a9c7-93fbede5003b` (advisory); Claude Code session 2026-09-18 (generator work).
- Source: 2026-09-15 and 2026-09-18 requests above; [implementation record](DEVLOG.md#2026-09-18--nearby-strokes-connect-by-deposition-the-short-travel-advisory-reports-only-bad-paths).
- Context: Fill rows, wall loops, rings, skin rows, lip rings and axial cladding tracks now continue as [deposited connectors](core/path/README.md#whole-plan-travel-requirement); the [advisory](core/export/README.md#short-travel-advisory) exempts required transitions and agents report findings.
- Remaining: From the programs the test suites export (each 1–20 findings; every other program reports none): (1) Neighboring islands or walls closer than 2 mm across open air (raised letters, text, supports, two-component composition, a Bambu fixture) need a lifted travel and are reported with `lifted: true`; decide whether the advisory should exempt lifted travels or a producer should order around them. (2) Planar walls printed after a rim hop on every 0.4–0.6 mm wall step, because rimming publishes no material region and later operations fall back to the conservative `clearanceFor` comparison; give rims a material footprint. (3) Vase walls and mapped motifs whose thickness ramps from or to zero contain segments whose filament amount rounds to nothing mid-stroke and read as direct travels of up to 1 mm; only the level rim's final taper is trimmed. (4) A level vase rim followed by a cap starts the cap 0.2 mm away under the same layer label. (5) Line-network, wave-overhang, plastic-weld and segmented vase motifs keep authored gaps by design.
- Completion: Representative prints for every producing skill report no advisory, or each residual is an agreed exemption.

### BR-045 — Complete continuous wave-overhang paths around holes

- Status: open
- Contributor: `remettub`, explicitly identified in the originating conversation as the contributor on this machine.
- Authorization: human requested — generalize wave overhangs to curved bivariate spline slices, support holes as in the exemplar, and use unbroken continuous passes per layer. No exception allowing branch restarts or arbitrary extruded retracing has been approved.
- Session: “Add wave overhang spline skill” (`01a0a191-8027-7f13-bf42-7b88316cc5ed`).
- Source: current conversation, 2026-09-14: “Must always use unbroken continuous passes per layer in this type of geometry”; “If the exemplar supports holes, we can too”; supplied [Janis Andersons short](https://www.youtube.com/shorts/RxPW5A4__X4), and clarified that SAAM introduced the glue jogs without an established exemplar.
- Context: The first generator split fronts and inserted travels. The correction preserves complete fronts and accepts a slice only when short in-domain turns form one continuous stroke. The [reference findings](skills/wave-overhangs/BUILDER.md#research-and-license-findings) establish that the slicer exemplar permits branch restarts; they do not establish an uninterrupted whole-slice strategy for arbitrary holes. A clarification about that distinction is pending. The current no-hole diagnostic is not completion of hole support.
- Remaining: Resolve the continuity requirement against the intended exemplar and complete the corresponding hole-branch routing. Retain the strict continuity rejection until an explicit exception is authorized; do not add unreviewed glue/retrace strokes or silently remove holes. The original local hole recipe `Prints/wave-overhangs-preview-20260914` is preserved and presently requires five disconnected passes.
- Completion: Generate and review the intended curved hole example with the agreed continuity behavior, including support order, in-domain connections and exported movement checks. Update the [skill manual](skills/wave-overhangs/SKILL.md) and record software evidence separately from any physical trial.

### BR-044 — Port a vetted material library

- Status: open
- Contributor: Unconfirmed for the approving speaker; `tkeller` is explicitly identified as the source of the withdrawn material-library concept, not as the approver of this deferred port.
- Authorization: human requested — commit to a future material-library port, explicitly defer implementation until the user starts it. This approves the concept, not the withdrawn implementation.
- Session: “tkeller integration + contributor policy” (`01a09bdb-b64f-7dd1-a361-cd38dea3d245`).
- Source: 2026-09-13T18:48:54Z: “mark material library as definitely we will port that over - but don't do it yet.” Same message identifies “tkeller's three conceptual intents”. [Withdrawal record](DECISIONS.md#d-029--withdraw-september-12-contributions-and-vet-readmission).
- Remaining: Port the material-library concept to the live shared architecture when the user explicitly starts this work. The user commits to doing it, but defers implementation; do not restore the withdrawn catalog or implement it during recovery.
- Completion: Review the selected data and interfaces against current material, machine, output and recipe consumers; preserve machine-owned compatibility and intentional process settings. Establish the concrete supported scope and relevant evidence before admitting the implementation. Catalog availability does not establish hardware or output support.
- Context: Four September 12 contributions were withdrawn to restore the agreed architecture. The user retained three concepts for selective review and singled out the material library as committed future work. [Current component contracts](core/README.md#interoperability-and-one-workflow), [minimal implementation guidance](BUILDERS.md#engineering-priorities).
