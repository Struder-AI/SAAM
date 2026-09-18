# Studio state and worker protocols

This reference belongs to `7_studio`. The source page `7b_source`, generation
page `7g_generation`, request page `7c_requests` and playback page `7j_playback`
are its implementation entry points. [Lifecycle](lifecycle.md) owns approval
and content identity; [presentation](presentation.md) owns the provider interface.

## Source session and stale replies

[`sourceSession`](../../studio/machine-session.mjs) owns one browser worker,
pending RPCs and a model epoch. Each request receives a monotonically increasing
ID. A reply settles only the pending entry with that ID; abort removes that entry,
so a late reply has no consumer. A worker error rejects outstanding calls and
terminates the worker. Disposal rejects pending calls, advances the epoch and
clears both the current and retained pose.

Source binding uses print ID, revision and export hash. Pose caching additionally
uses source seconds, manual coordinates and jog intent. A different pending pose
is aborted; repeated requests for the same key share its promise. A result may
become current only while the session is open and its captured epoch still matches.
A successful ready pose may be retained at the same source time while a manual
solve is pending or fails. Retained geometry does not represent successful
execution of the new request. Rebinding clears it.

The worker retains its decoded program for model rebinding. The browser receives
compact move columns for playback. A missing model can terminate the model worker
without making decoded source motion unavailable. Do not equate display availability,
model availability and approval. Inspect the worker handler as well as the RPC
factory when adding a message; generated worker arrows do not verify this protocol.

Verification: [Studio kinematics](../../core/tests/studio-kinematics.test.mjs),
[playback cache](../../core/tests/studio-playback-cache.test.mjs), and
[view readiness](../../core/tests/studio-view-readiness.test.mjs).

## Preparation, generation and cancellation

[`server.mjs`](../../studio/server.mjs) owns the preparation worker and its target
directory and plan hash. Preparation checks a candidate in memory. Only an explicit
`generate` message permits persistence. The worker reads the plan hash before
preparation and again before generation; the lifecycle checks identity at commit.
An obsolete or discarded worker cannot donate checked source through an old
attachment. Preparation errors remain generation errors for that candidate.

[`generationControl`](../../core/print/generation-control.mjs) uses a shared atomic
integer: 0 is working, 1 is cancelled and 2 is committing. Cancellation and
`beforeCommit` compete to change 0. If cancellation wins, commit throws
`GENERATION_CANCELLED`. Once commit wins, cancellation returns false and the short
write sequence finishes. This is not a multi-file transaction. The cancellation
API checks the current print and requested plan hash; UI progress also checks its
captured target before updating controls.

[`attachCheckedProgramWorker`](../../core/print/program-handoff.mjs) accepts only
an actual server-created Node Worker. Successful generated messages must match
the expected plan hash and the check record's plan/export hashes. The handoff
retains metadata and source strings, excludes moves/events, and returns defensive
copies. It is process-local reuse of an owning check, not an API for trusting a
caller's assertion of validity.

Verification: [generation control](../../core/tests/studio-generation-control.test.mjs) and
[workflow](../../core/tests/workflow.test.mjs).

## Request completion and display

Request records and their state transitions are defined by the
[agent coordination contract](studio.md#agent-request-coordination). The shared
agent-owned store is the live operational channel; JSON records are its durable
recovery journal and the index reconciles independent processes. Request completion
does not establish that the requested geometry or toolpath has been displayed.
`work-state.mjs` classifies activity, receipt matching and confirmation waiting
from one normalized geometry/toolpath view and request context;
`agent-ui.mjs` orders snapshots by update time so an older response cannot revive
completed activity. Library-wide agent listeners and the currently selected
browser print intentionally have different selection scopes.

Verification: [request coordination](../../core/tests/studio-work.test.mjs),
[readiness](../../core/tests/studio-view-readiness.test.mjs), and
[activity display](../../core/tests/studio-spinner.test.mjs).

## Playback storage and movie resources

[`moveStore`](../../studio/move-store.mjs) stores numeric columns in Float64 chunks
and interns categorical values. `at()` returns an independent row; `reader(names)`
reuses one scratch row and its vectors. Copy values that must survive the next
read. `snapshot()` exposes storage for transport; it is not a manufacturing format.
Source line offsets apply at read time. Consumers must preserve the difference
between source precision and display buffer precision.

[`exportMovie`](../../studio/playback.mjs) owns its encoder and closes each
VideoFrame after encoding. It uses a deterministic 30 fps source timeline, a final
two-second hold, bounded encoder backlog and explicit cancellation. Encoding speed
does not set video time. The draw callback receives explicit time/canvas state;
it must not advance live playback. This WebM writer handles one VP8/VP9 track,
without audio. [Rendering](rendering.md) owns bead appearance and line fallbacks.

Verification: [source player and compact moves](../../core/tests/source-player.test.mjs) and
[movie export](../../core/tests/studio-movie.test.mjs).

## Serving, page assets and lifetime

[index.html](../../studio/index.html) owns DOM controls consumed by `app.mjs`, settings and tour UI.
[style.css](../../studio/style.css) owns their layout and visibility; the
[logo](../../studio/struder-logo.png) is a presentation asset.
These resources belong to this region even though the JavaScript extractor
does not inspect them. When changing an element ID or its lifecycle, inspect its
selectors, handlers, accessibility state and associated tests together.

`viewer-session.mjs` owns the page's connection/reconnection; `lifetime.mjs` owns
one server's viewers and sockets. The first viewer has no opening deadline. The
last viewer's departure starts a grace period, and reconnection cancels it.
Shutdown stops new requests, closes idle sockets, and lets accepted writes finish.
`changes.mjs` supplies change notifications, not a replacement for reading valid
current state. `browser.mjs` is the host-specific opener; its failure is distinct
from server startup failure. `machine-study.mjs` supplies explicitly scoped study
inputs through the existing source presentation boundary.

Verification: [lifetime](../../core/tests/studio-lifetime.test.mjs),
[reconnect](../../core/tests/studio-reconnect.test.mjs),
[settings](../../core/tests/studio-settings.test.mjs), and
[tour UI](../../core/tests/studio-tour-ui.test.mjs).


## Changing cancellation and checked-source reuse

Sources: [generation-control.mjs](../../core/print/generation-control.mjs), [program-handoff.mjs](../../core/print/program-handoff.mjs).

**Contract.** The [preparation protocol](#preparation-generation-and-cancellation) owns the worker sequence. Atomic state 0 means working, 1 cancelled and 2 committing; cancellation and beforeCommit compete for the transition from 0. Checked-source reuse is process-local and accepts an actual attached Node Worker with matching expected plan identity and checked export hashes. Metadata/source are copied across the trust boundary; movement arrays are not donated as independently validated truth.

**Failures.** Cancellation that wins before commit prevents writes. Cancellation after commit begins returns false. Detached, obsolete or mismatched worker messages cannot seed a trusted source result; preparation errors are retained for the matching candidate. This does not implement cross-process cancellation or atomic multi-file storage.

**Change together.** Trace Studio preparation attachment/disposal, worker generated messages, workflow commit ordering and source-only readers together. Never broaden the handoff to accept arbitrary caller-provided checked flags.

**Verification.** Exercise cancellation before and after commit, replacement by another candidate, malformed/wrong-hash handoffs and cold reads after worker reuse is unavailable. Checks: [studio-generation-control.test.mjs](../../core/tests/studio-generation-control.test.mjs).


## Changing Studio HTTP and change notifications

Sources: [server.mjs](../../studio/server.mjs), [changes.mjs](../../studio/changes.mjs).

**Contract.** The local server binds a print/study session, serves an explicit asset/module allowlist and routes read/write APIs. Mutations use the session origin and token; source endpoints bind print/revision/export identity. A write queue serializes ordinary mutations while cancellation remains responsive outside generation waits. Filesystem notifications are debounced hints; reconnect/read paths recover authoritative state. The protocol sections above specify approval and source handoff.

**Failures.** Reject unauthorized origins/tokens, path escapes, oversized/invalid bodies and stale identities. Watcher errors fall back to reconciliation rather than declaring a print changed successfully. A generation failure cannot block cancellation or silently install partial output.

**Change together.** Review browser client endpoints, worker messages, workflow identity, request state, study adapters and server lifetime together. Adding a served module needs an explicit allowlist entry; adding a mutation needs the appropriate validation/queue semantics.

**Verification.** Test origin/token failures, stale revisions, concurrent generation/cancellation, change notifications, reconnect and exact source installation. Checks: [studio-agent.test.mjs](../../core/tests/studio-agent.test.mjs), [studio-work.test.mjs](../../core/tests/studio-work.test.mjs), [studio-reconnect.test.mjs](../../core/tests/studio-reconnect.test.mjs), [studio-generation-control.test.mjs](../../core/tests/studio-generation-control.test.mjs).


## Changing agent request state and presentation

Sources: [agent-requests.mjs](../../studio/agent-requests.mjs), [request-index.mjs](../../studio/request-index.mjs), [agent-ui.mjs](../../studio/agent-ui.mjs), [work-state.mjs](../../studio/work-state.mjs).

**Contract.** Request records coordinate agent work with the exact Studio instance, print, revision and stage target. One agent-owned request store may serve multiple Studio instances; each instance has one immutable owner and carries its ID on Studio-originated work. Direct subscribers and event-driven waits receive live changes from that store. The index accepts valid request IDs, caches by file identity/size/timestamps, batches reads and periodically reconciles watcher hints for restart and independent-process recovery. Work-state owns one pure classifier returning activity, receipt and confirmation-wait state from a request and normalized displayed view. Agent completion and actual display of the requested result are separate transitions; advisory/guidance activity is not an edit.

**Failures.** Malformed records become diagnostic failure state; missing directories are handled distinctly from parse errors. A Studio request cannot be claimed through another agent owner's live session. Stale, other-instance or other-print presentation cannot complete the current request. Compatibility matching without an explicit target is limited to older records, not a bypass for requiresTarget.

**Change together.** Coordinate toolkit streaming/control, MCP session management, server events, request schema, instance/print identity and browser presentation receipts. The index is a recovery/read cache, not the live transport, a lock or authority to overwrite agent work.

**Verification.** Test live wakeup without timed polling, file replacement, malformed IDs/JSON, reconciliation, multiple agents/instances/prints, completed-but-unpresented work and exact-target receipt matching. Checks: [request-index.test.mjs](../../core/tests/request-index.test.mjs), [studio-agent.test.mjs](../../core/tests/studio-agent.test.mjs), [studio-agent-ui.test.mjs](../../core/tests/studio-agent-ui.test.mjs), [studio-work.test.mjs](../../core/tests/studio-work.test.mjs), [agent-toolkit.test.mjs](../../core/tests/agent-toolkit.test.mjs), [mcp.test.mjs](../../core/tests/mcp.test.mjs).


## Changing generation workers

Sources: [prepared-generation-job.mjs](../../studio/prepared-generation-job.mjs), [generation-worker.mjs](../../studio/generation-worker.mjs).

**Contract.** `PreparedGenerationJob` owns the preparing, ready, generating, failed and disposed transitions, pending request settlement, worker disposal and checked-source attachment. A worker prepares the selected plan and checks its hash, then generates only on the explicit message. The post-generation identity is checked again before the attached source is returned. The shared cancellation word follows the 0/1/2 protocol above; a checked handoff is tied to the current worker and exact plan/source.

**Failures.** Preparation errors are retained for the generate request, stale plan hashes reject and cancelled/failed jobs cannot publish output. A message from another worker or a detached lifecycle cannot substitute for current checked evidence.

**Change together.** Keep lifecycle generation-control/program-handoff, server queue/cancellation, bundle caching and source receipt fields aligned.

**Verification.** Exercise cancellation before/during/after work, plan changes between preparation and execution, stale worker messages and checked-source reuse without a second interpretation. Checks: [studio-generation-control.test.mjs](../../core/tests/studio-generation-control.test.mjs).


## Changing source workers and machine sessions

Sources: [source-player.mjs](../../studio/source-player.mjs), [source-worker.mjs](../../studio/source-worker.mjs), [machine-session.mjs](../../studio/machine-session.mjs).

**Contract.** Source loading checks exact file hashes and strict UTF-8/stream framing before dispatching to the same dialect interpreters used by export. Compact move storage replaces retained source/code when no longer needed. Worker request IDs, epochs and provider identity bind asynchronous loads/samples to the current machine session. Rebinding disposes the old provider; unavailable machine presentation does not invalidate otherwise valid source.

**Failures.** Reject missing/duplicate/unexpected source members, hash mismatches and malformed stream records. Cancel/release readers on all exits. Do not transfer/detach move buffers while a retained provider still needs them; stale sample results must be ignored.

**Change together.** Coordinate server source receipts, all dialect readers, compact move fields, provider snapshots and application load state. Preserve source identity across fallback per-file fetching and streamed loading.

**Verification.** Test corrupt/truncated streams, fallback loading, stale load/sample replies, provider rebinding/disposal and buffer ownership with/without a machine model. Checks: [source-player.test.mjs](../../core/tests/source-player.test.mjs), [studio-kinematics.test.mjs](../../core/tests/studio-kinematics.test.mjs), [studio-generation-control.test.mjs](../../core/tests/studio-generation-control.test.mjs).


## Changing compact moves and playback caches

Sources: [move-store.mjs](../../studio/move-store.mjs), [playback.mjs](../../studio/playback.mjs).

**Contract.** Compact moves preserve interpreted position, timing, volume, operation and optional pose metadata in typed storage. Playback indexes source time for interactive and movie frames; static geometry and reusable caches avoid rebuilding unchanged material at every frame. Cache identity follows the source and view configuration, and replaced movie/frame resources are released.

**Failures.** Do not drop stationary events, round away meaningful short moves or reuse caches across different source/configuration identities. Cancelled movies and superseded builds cannot publish late frames or retain unbounded resources.

**Change together.** Update source-worker transfer ownership, source-time lookup, renderers and movie export whenever compact fields or playback indexing change.

**Verification.** Check compact/full equivalence, event/time boundaries, cache invalidation, repeated frames, cancellation and resource disposal. Checks: [studio-movie.test.mjs](../../core/tests/studio-movie.test.mjs), [studio-playback-cache.test.mjs](../../core/tests/studio-playback-cache.test.mjs), [source-player.test.mjs](../../core/tests/source-player.test.mjs).
