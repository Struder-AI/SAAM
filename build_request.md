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

### BR-057 — SAAMpath context labels on change, not on every action

- Status: open
- Contributor: `remettub`, inferred from the checkout's contributor branch and account; attribution unconfirmed.
- Authorization: human requested — "we need phase as an enclosing tag or equivalent, not an entry for every point … write it as a build request"; "timing doesn't need a separate data column, we just derive if we ever need"; "labels only when it changes is the general gist of the BR." Scope is the SAAMpath representation and its consumers; no change to deposition, ordering or exported machine behavior.
- Session: Claude Code, 2026-09-24 context-reduction session; exact chat title and ID unavailable.
- Source: current conversation, 2026-09-24, after measuring regenerated SAAMpath against Bambu G-code.
- Context: `core/path/planning.mjs` copies `phase`, `layer`, `operation` and the stroke's `region`, `role`, `connector` and gap diagnostics onto every action. On `bambu-x1-ams-white-grey-black-fast-01` (954 moves) SAAMpath is 261 KB against 41 KB of G-code: motion (`to`, volume, speed, kind) about 99 KB, repeated labels about 98 KB, gap diagnostics (`gapMm`, `lowerSurfaceGap*`, `sampledGapErrorMm`) about 60 KB. `layer` is the producer's own index, keyed with `phase`; exporters write both as program labels (`;SAAM_PHASE:`/`;LAYER:`, DENSO/Dobot labels), Bambu counts layers by them, and Studio colours and layer-steps playback from them. Pose moves (DENSO) also carry `durationSeconds`, computed from the flow-limited speed while `speedMmS` keeps the requested speed; ordinary moves store the limited speed and no duration.
- Remaining: Carry context as a change record, such as an enclosing span or a `context` action emitted only when phase, layer, operation, region, role or connector changes, and have every consumer (exporters, players, travel advisory, Studio, tests) read context from the current span. Drop per-action `durationSeconds`: derive time from length and effective speed where needed, keeping an explicit duration only for zero-length pose moves (reorientation in place), which speed cannot express; store the effective speed on pose moves as on others. Decide whether gap diagnostics stay on moves, move to a span, or leave SAAMpath for a diagnostic record.
- Completion: Exported machine programs are byte-identical before and after for the existing export tests; Studio playback, layer stepping and phase colours are unchanged; SAAMpath size on the measured part is reported before and after.

### BR-053 — Restart an agent-owned Studio on the same port

- Status: open
- Contributor: `remettub`, inferred from the checkout's contributor branch and account; attribution unconfirmed.
- Authorization: human requested — asked whether a Studio can be restarted on the same port and, if that is not supported, said it can go in a build request. Scope: let an agent restart its own Studio and keep its URL. Any related stale-source warning or onboarding guidance is a proposal and is not authorized here.
- Session: Claude Code session `01e30a9a-dde6-45f3-b8eb-5829055cdac7`; exact chat title unavailable.
- Source: current conversation, 2026-09-19: "Is it possible to restart and use the same port? If not supported currently, we can put that in a build request." The user had just asked why a second Studio instance was started; "We've been trying to reduce multiple studio instances."
- Context: During a builder task an edit to `machines/bambu-x1-carbon.json` left the live Studio running [older source than the files on disk](studio/README.md), so it had to be restarted. The toolkit launch path (`--toolkit create-preview|open-print|start-tour`) always listens on port 0 (`listenPreview` in [toolkit.mjs](core/agent/toolkit.mjs)), so the restart got a new URL and the person's tab had to be re-pointed. The plain launcher `node studio/server.mjs DIR` reads an undocumented `SAAM_STUDIO_PORT` variable, but it does not carry the agent owner, requests or events, so it is not a substitute.
- Remaining: Let the toolkit launch path bind a requested port (or reuse the previous instance's port when relaunching with `--agent-owner`), and fail clearly, naming the process holding it, when the port is busy. Document it where agents already read Studio restart guidance. Keep one Studio per agent by default.
- Completion: An agent stops its own Studio and relaunches on the same URL, and the person's open tab reconnects with the print and pending requests intact. A busy port gives an actionable error and never silently picks another. Covered by a test.

### BR-050 — Finish Studio coordination and read-path handoff

- Status: in progress
- Contributor: Current requester; account attribution unconfirmed.
- Authorization: human requested — “read handoff and get to work,” with decisions explained and questions only for genuine ambiguity; then “2. I don't think it's worth it but start the rest.” SQLite adoption is withdrawn. Brief browser disconnects retain a tour until exit/cancel or Studio shutdown.
- Session: Current Codex task; title and stable task ID unavailable in the supplied conversation.
- Source: 2026-09-15 instructions above; [implementation and decisions](DEVLOG.md#2026-09-15--file-compatible-handoff-work-after-sqlite-withdrawal), the earlier handoff in the same log, and the [live agent/Studio session follow-up](DEVLOG.md#2026-09-17--live-agentstudio-sessions-and-review-completion).
- Context: Request presentation, tour lifetime, operational polling and repeated source reads were identified in the Studio flow audit. Managed agent/Studio coordination now uses a live owner-scoped request store with explicit Studio instances; request files remain a recovery journal and external-writer compatibility path. Scoped activity, Studio-worker cancellation, review metadata updates and normal-shutdown tour cleanup are implemented. No database or runtime migration was performed.
- Remaining: Cross-process exclusive claims and atomic request/tour transitions; forced-process-death tour invalidation; a shared cancellation/supersession owner for CLI/MCP generation and edits queued behind generation; coordination of activity and cancellation writes across independent processes; concurrent verified-source reuse and remaining nested read/copy reductions. Complete the authorized audit for cold processes, large STL/native/source files, growing review history, worker costs, and simultaneous writers. Keep database adoption excluded unless separately authorized.
- Completion: Implement and exercise the remaining ownership/recovery behavior without introducing competing persistent stores; record the remaining audit measurements and their limitations. Preserve current-byte validation at approval/delivery boundaries and separate software evidence from physical results.

### BR-044 — Port a vetted material library

- Status: open
- Contributor: Unconfirmed for the approving speaker; `tkeller` is explicitly identified as the source of the withdrawn material-library concept, not as the approver of this deferred port.
- Authorization: human requested — commit to a future material-library port, explicitly defer implementation until the user starts it. This approves the concept, not the withdrawn implementation.
- Session: “tkeller integration + contributor policy” (`01a09bdb-b64f-7dd1-a361-cd38dea3d245`).
- Source: 2026-09-13T18:48:54Z: “mark material library as definitely we will port that over - but don't do it yet.” Same message identifies “tkeller's three conceptual intents”. [Withdrawal record](DECISIONS.md#d-029--withdraw-september-12-contributions-and-vet-readmission).
- Remaining: Port the material-library concept to the live shared architecture when the user explicitly starts this work. The user commits to doing it, but defers implementation; do not restore the withdrawn catalog or implement it during recovery.
- Completion: Review the selected data and interfaces against current material, machine, output and recipe consumers; preserve machine-owned compatibility and intentional process settings. Establish the concrete supported scope and relevant evidence before admitting the implementation. Catalog availability does not establish hardware or output support.
- Context: Four September 12 contributions were withdrawn to restore the agreed architecture. The user retained three concepts for selective review and singled out the material library as committed future work. [Current component contracts](core/README.md#interoperability-and-one-workflow), [minimal implementation guidance](BUILDERS.md#engineering-priorities).
