# SAAM Studio

The [SAAM application](../core/application/README.md) owns Studio windows, attached
chats, jobs, prints and the release service. [MAKERS](../MAKERS.md) owns maker
interaction; the [print lifecycle](../core/print/README.md) owns validity and
confirmation. [RENDERING](RENDERING.md) owns display and playback;
[KINEMATICS](KINEMATICS.md) owns machine presentation.

## Studio agent permissions

Use `saam open`, `saam start-tour` and `saam call OP`; a checkout uses
`node scripts/saam.mjs` with the same arguments. The [installation guide](../packaging/INSTALL.md)
owns PATH, client discovery and scoped command allowances. Preserve unrelated
client settings and use its trust/permission flow when required. Browser site
permissions are independent; open the returned loopback URL in the client's
browser and retain that tab while the person reviews.

Closing tabs, ending a command, a chat pause and elapsed idle time do not shut down
SAAM or fail work. Quit or Update ends the application. Keep the print, Studio
instance and chat identity together; a chat may own several windows, each window
has at most one attached chat. Re-pair through the application, using the actual
bundle identity when capturing a detached window. Never borrow another chat's ID.

State responses identify their server instance. A restarted page reloads for new
credentials; old credentials cannot acknowledge a result. Restart source runs
after changing imported code so servers and workers use the same snapshot. A code
change alone does not invalidate confirmation of unchanged checked bytes.

For downloads, distinguish an HTTP response from a saved file. Use the browser's
supported download action, or return browser control for the person's click;
verify completion or saved bytes before reporting delivery.

## Studio feature references

Geometry review, settings/toolpath review and confirm/export follow the
[maker flow](../MAKERS.md#maker-interaction-flow). Recipe adjustments happen in
chat. Camera, scrubbing, playback speed and travel visibility are viewer controls.
The toolpath pane presents printer/material choices and expandable settings;
there is no separate settings confirmation.

The viewer stream sends ordered changes and progress. State changes coalesce
into one conditional `/api/state` read of a coherent bundle snapshot; worker
progress updates current controls directly. A matching fingerprint returns no
body. Tags include request, tour, import-repair, generation failure and
cancellation metadata. While connected there is no state/progress poll. Stream
failure enables fallback polling (state every 15 seconds); reconnect and page
visibility recover missed state. Disposal cancels queued refreshes and listeners.
Progress must match the current instance, print and generation.

Machine view fits the available rails, links, carriages, bed and tool; returning
to part view restores its camera. Follow build plate selects the reference frame.
Tool position sliders pause playback and pose supported axes within modeled
reach. Play, the timeline or Return to playback restores source motion. These
controls do not change the print or command hardware. Machine model describes
basis and limits; missing model data does not suppress source playback.

### Historical toolpath inspection

A developer may explicitly supply a scratch adapter resolver to
[server.mjs](server.mjs) for a historical toolpath. It is a source inspection
affordance, not a separate maker launcher.

### Remembered printer setup

[Shared print tools](../core/print/USAGE.md#remember-machine-setup) own persistence;
[machine contracts](../core/export/README.md) own installation requirements.
Studio displays setup assumptions and verification metadata. Use the
[parameter policy](../MAKERS.md#standard-parameter-policy); changes invalidate the
combined settings/toolpath confirmation.

### Geometry and program views

Selection identifies the current geometry revision and native object or mesh
face. Edge names describe adjacent surfaces/components and connected edges;
geometry changes clear these display identities. Generic geometry editing is
deferred.

A matching toolpath view queues one [short-travel advisory](../core/export/README.md#short-travel-advisory)
per export. Acknowledge it and describe the findings; it neither blocks review
nor requests repair. Reopening an acknowledged export does not resend it.

Production review requires the selected export interpreter and installation
state. Unsupported commands or missing helpers remain errors. The S5 interpreter
checks actual bytes; external Griffin startup motions are not simulated. Unknown
firmware version uses the displayed standard-profile assumption. Development
preview supplies no confirmation or authority to deliver.

## Opening local prints in Studio

Open lists the SAAM home's saved bundles (three directory levels), or accepts a
bundle folder, `plan.json` or a file inside it. Standalone machine-program import
is not implemented. One Studio owns each open bundle. Changing the selected
bundle changes all tabs of that Studio; mutation requests carry print identity
so an old tab cannot approve or deliver a newly selected print.

Opening checks saved artifacts without regenerating current files. A current
saved SAAMpath with no checked machine program is labeled as neutral source and
cannot export. A tour starts with geometry and generates when its toolpath
lesson opens. Outside tours, a fresh bundle starts in geometry view.

An obsolete calculation is cancelled when its inputs change. While replacing a
toolpath, the previous source remains faded; when none exists, faded part
geometry occupies the pane. Failed generation remains actionable until inputs
change or an explicit retry succeeds. Ordinary reads never start speculative
slicing. A preparation candidate is reused only for its matching input identity.

Tour Next unlocks from exact displayed result evidence: changed geometry, Play,
and the participant-requested printing change at their respective lessons.
Automatic generation and earlier lesson work cannot satisfy an edit gate.
Settings/toolpath lessons accept requested geometry edits as well as process
edits once the current result is rendered. Another unfinished edit can hold Next.
Exit retains the print; a fresh tour creates a fresh copy. Resuming saved lessons
uses current request authority. [Tour participation](../examples/prints/README.md#maker-agent-participation)
owns when the maker offers guidance.

## Agent request coordination

One app retains chat identities and each chat's requests/events across command
processes. Requests are journaled under the SAAM home's `state/`, outside the
replaceable app. Records carry request, print and Studio instance IDs, instruction,
source, kind, status, baseline, result target and presentation receipt.
`queued`, `working`, `waiting`, `completed`, `failed` and `cancelled` describe
explicit transitions. There is no activity lease, idle-work expiration or
chat-disconnect failure. Actual activity may record evidence without claiming,
resuming, completing or replacing the result target.

Work and display are distinct: saving and generation alone cannot establish
presentation. Begin records the input baseline. Publish a `geometry` or
`toolpath` target when saved inputs are ready, including every request in a
combined result. `/api/view-ready` acknowledges the exact rendered inputs;
request completion alone does not unlock a tour gate. Waiting preserves targets
and receipts, and resuming preserves the original baseline. Obsolete replies
cannot restore completed UI activity.

Updating preview dots and the 28% fade show active edits and pending display,
scoped to the affected pane. Guidance, advisories, queued work and waiting for a
choice stay quiet. The indicators clear when the exact requested result is ready;
a later chat acknowledgement does not extend them. Downloads have separate
progress. Work on another bundle does not fade this viewport.

### Carrying a maker request

Call `saam call begin_studio_work` before editing an existing Studio bundle or
reporting its result. Acknowledge the person first if useful. Claim Studio work
with `requestId` and its instruction; use `bundleId`/`studioInstanceId` when the
active selection is ambiguous. Carry the returned current recipe and revision.
An unchecked program summary is not a failed check.

| Situation | Action |
|---|---|
| Editing inputs | Keep the request working; combine related edits before publishing a result. |
| Saved inputs ready | `respond_to_studio_request` with `status: working` and `resultStage: geometry` or `toolpath`. |
| Geometry-only result | Show geometry; no generation is needed solely to complete work. |
| Toolpath result | Generate once and check the current displayed result; tour toolpath lessons generate in Studio. |
| Choice or confirmation needed | Explain what is ready; set `waiting`, then resume the same request. |
| Advice | Answer in chat and complete the claimed guidance request. |
| Finished, failed or superseded | Give the outcome, then resolve that ID as completed, failed or cancelled. |

Use `saam wait` between requests after acknowledging completed work. Each bounded
wait ends normally and may be repeated; it does not detach the chat. Client wakeup
support and identity fallback are described in [application commands](../core/application/README.md).
A generation failure supplies exact error/input evidence; claim it, fix the cause
within maker scope and show the corrected result. Do not retry unchanged inputs
without addressing the failure.

## Studio event queue

Each chat owns an ordered event queue shared by its Studio windows. Events carry
sequence, time, kind, delivery class, instance and print. Held events wait for a
read; delivered events wake waits and include the held remainder. Reading drains
the queue; notifications alone do not. `get_studio_events`, operation responses
and `saam wait` carry observations plus live job progress. Act on the latest
state and use sequence numbers to recognize repeats.

| Delivered | Held |
|---|---|
| Tour start/lesson/exit/finish; request queued/presented | Viewer opened/closed; exact view presented |
| Generation failed/cancelled; import completed/failed/repair-started/cancelled | Generation started/finished; import started |
| Print opened; export delivered | Confirmation; tour playback; example adoption; plan update |

Camera, scrubbing, manual machine positioning, movie export and request
bookkeeping are not person-action events. Elapsed job time is available during
reads; no reliable repair ETA is inferred.

## Importing an STL in Studio

Import uses the [shared lifecycle](../core/print/USAGE.md#import-an-stl) and current
printer/setup. Browser uploads have a 64 MiB HTTP input boundary; local paths
stream. Finish or exit the tour before another import. A worker validates,
repairs recognized defects and creates unapproved geometry, retaining repair
evidence. Cancel interrupts it and cleans only the incomplete new bundle.

Read `get_studio_events`, then pass the observed job identity to
`cancel_studio_calculation`. Cancellation bypasses the mutation queue. Shutdown
cancels import before draining writes; the supervisor owns native child/scratch
cleanup even if a worker crashes. Calculation continues until completion, a real
failure or explicit cancellation.

## Studio state and worker protocols

### Source session and stale replies

[machine-session.mjs](machine-session.mjs) owns its browser worker, pending RPCs
and epoch. IDs settle only matching pending calls; abort removes their consumer.
Error/disposal rejects calls and terminates the worker. Source binding identifies
print/revision/export; pose caching adds time/manual coordinates. A retained
successful pose does not prove a later solve succeeded. Rebinding clears it.
Missing model data may stop its worker while source motion remains available.

### Preparation, generation and cancellation

[server.mjs](server.mjs) owns the prepared job's directory and generation hash.
It uses the shared [prepare/commit lifecycle](../core/print/README.md#generation-and-review),
never a second persistence path. Explicit generate permits commit. Obsolete
workers cannot publish through stale attachments.

[generation-control.mjs](../core/print/generation-control.mjs) arbitrates working,
cancelled and committing with one shared atomic integer. Cancellation before
commit prevents saving; once commit wins, immutable output and atomic manifest
replacement finish. [program-handoff.mjs](../core/print/program-handoff.mjs) accepts
only the prepared worker's matching checked result and opaque single-use ticket.
Reuse still hashes actual current bytes; caller-supplied payloads cannot donate
checked output. Resource cleanup remains distinct from job duration policy.

### Request completion and display

[work-state.mjs](work-state.mjs) derives activity, matching receipts and confirmation
waiting from one normalized view/request context. [agent-ui.mjs](agent-ui.mjs)
orders snapshots so stale replies cannot revive completed work. Journal records
are durable; event queues are retained by the running app. Neither channel
substitutes for a matching presentation receipt.

Export captures the exact displayed checked program. It does not regenerate,
promote approval or reinterpret current files; later edits cannot change captured
download bytes. Reopening separately validates stored artifacts.

### Playback storage and movie resources

[move-store.mjs](move-store.mjs) owns Float64 numeric chunks and interned categories.
`at()` returns an independent row; `reader()` reuses scratch values which must be
copied if retained. Snapshots are transport storage, not manufacturing data.
[playback.mjs](playback.mjs) closes encoded frames, uses deterministic 30 fps source
time with a final hold, bounds encoder backlog and supports cancellation. Its
WebM writer has one VP8/VP9 track without audio.

### Serving, page assets and lifetime

[index.html](index.html) owns controls; [style.css](style.css) owns layout and
visibility. Inspect selectors, handlers and accessibility when changing IDs.
[viewer-session.mjs](viewer-session.mjs) owns reconnects;
[lifetime.mjs](lifetime.mjs) tracks viewers/sockets and explicit shutdown. Viewer
counts do not trigger app expiration. Shutdown stops new requests, closes idle
sockets and finishes accepted writes. [changes.mjs](changes.mjs) supplies
notifications; current valid state still comes from its owning bundle boundary.
