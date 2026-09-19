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
- Context: Fill rows, wall loops, rings, skin rows, lip rings and axial cladding tracks now continue as [deposited connectors](maps/reference/motion.md#whole-plan-travel-requirement); the [advisory](maps/reference/output.md#short-travel-advisory) exempts required transitions and agents report findings.
- Remaining, from the programs the test suites export (each 1–20 findings; every other program reports none): (1) Neighboring islands or walls closer than 2 mm across open air (raised letters, text, supports, two-component composition, a Bambu fixture) need a lifted travel and are reported with `lifted: true`; decide whether the advisory should exempt lifted travels or a producer should order around them. (2) Planar walls printed after a rim hop on every 0.4–0.6 mm wall step, because rimming publishes no material region and later operations fall back to the conservative `clearanceFor` comparison; give rims a material footprint. (3) Vase walls and mapped motifs whose thickness ramps from or to zero contain segments whose filament amount rounds to nothing mid-stroke and read as direct travels of up to 1 mm; only the level rim's final taper is trimmed. (4) A level vase rim followed by a cap starts the cap 0.2 mm away under the same layer label. (5) Line-network, wave-overhang, plastic-weld and segmented vase motifs keep authored gaps by design.
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
