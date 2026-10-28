# SAAM Studio

The [SAAM application](../core/application/README.md) owns Studio windows, attached
chats, jobs, prints and the release service. [MAKERS](../MAKERS.md) owns maker
interaction; the [print lifecycle](../core/print/README.md) owns validity and
confirmation. [RENDERING](RENDERING.md) owns display and playback;
[KINEMATICS](KINEMATICS.md) owns machine presentation.

`agent-operations.mjs` owns agent review selection and tour control. Runtime admits
chat/window identities and provides server lifetime, display and image capture;
the controller selects/reuses the window, checks ownership and chooses the shown
stage. Bundle values and their summary enter through the shared CLI query port.
Tour participation manuals and notes are assembled by Context after tour startup.

Phase-colour choices normalize in Studio and use a named shared CLI part-command
route for Bundle's revision-checked metadata save. Changing a palette preserves
the raw recipe and existing geometry, work, schedule and output identities.

`get_tour` repeats pure saved-progress/request snapshots during its bounded wait.
Stale display gates are derived without saving progress or creating a lesson
baseline. Explicit Studio actions and view acknowledgements own those transitions.
Legacy command replies still include associated tour/review views; extracting their
owner does not claim those replies have been normalized to outcome-only contracts.

## Studio agent permissions

Use `saam open`, `saam start-tour` and `saam call OP`; a checkout uses
`node scripts/saam.mjs` with the same arguments. The [installation guide](../packaging/INSTALL.md)
owns PATH, client discovery and scoped command allowances. Preserve unrelated
client settings and use its trust/permission flow when required. Browser site
permissions are independent; open the returned loopback URL in the client's
browser and retain that tab while the person reviews.

Closing tabs, ending a command, a chat pause and elapsed idle time do not shut down
SAAM or fail work. Tray Quit or Update ends the application; Studio's Quit stops its
window's runtime, or SAAM when no other runtime runs. Keep the print, Studio
instance and chat identity together; a chat may own several windows, each window
has at most one attached chat. Mention SAAM in your chat client; name the bundle
when attaching or using `capture_bundle`. Never borrow another chat's ID.

State responses identify their server instance. A restarted page reloads for new
credentials; old credentials cannot acknowledge a result. Restart source runs
after changing imported code so servers and workers use the same snapshot. A code
change alone does not remove the saved toolpath.

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
progress updates current controls directly. A matching state tag returns no
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

Selection identifies the current revision and native object or mesh face; geometry changes clear these identities.
Native previews retain face IDs and evaluated corner normals for shading and crease detection.
Edge names describe adjacent surfaces/components and connected edges. Generic geometry editing is deferred.

A matching toolpath view queues one [short-travel advisory](../core/export/README.md#short-travel-advisory)
per export. Acknowledge it and describe the findings; it neither blocks review
nor requests repair. Reopening an acknowledged export does not resend it.

The toolpath view draws the SAAMpath, the completed output's or else the saved one, at its
placement, with neutral path estimates and captured settings. Next generates without
a machine; Export requires a selected printer and checks its writer/installation
then. Development previews remain review-only.

## Opening local prints in Studio

Open lists the SAAM home's saved bundles (three directory levels), or accepts a
bundle folder, `plan.json` or a file inside it. Standalone machine-program import
is not implemented. One Studio owns each open bundle. Changing the selected
bundle changes all tabs of that Studio; mutation requests carry print identity
so an old tab cannot export a newly selected print.

Opening checks saved artifacts without regenerating current files. A saved
SAAMpath remains viewable without any machine program; Export creates one from
the reviewed path and selected settings. A tour starts with geometry and generates when its toolpath
lesson opens. Outside tours, a fresh bundle starts in geometry view.

An obsolete calculation is cancelled when its inputs change. While replacing a
toolpath, the previous source remains faded; when none exists, faded part
geometry occupies the pane. Failed generation remains actionable until inputs
change or an explicit retry succeeds. Ordinary reads never start slicing.

Tour Next unlocks from exact displayed result evidence: changed geometry, Play,
and the participant-requested printing change at their respective lessons.
Automatic generation and earlier lesson work cannot satisfy an edit gate.
Settings/toolpath lessons accept requested geometry edits as well as process
edits once the current result is rendered. Another unfinished edit can hold Next.
Exit retains the print; opening or importing another print in the tour's Studio exits first, and other Studios stay ordinary. A fresh tour creates a fresh copy. Resuming saved lessons
uses current request authority. [Tour participation](../examples/prints/README.md#maker-agent-participation)
owns when the maker offers guidance.

## Agent request coordination

One app journals chat requests under the SAAM home's `state/`. The first
result-changing operation establishes work for its bundle and owner. Each saved,
renderable revision reaches Studio immediately; neither checks nor further edits
require withholding it. Working dots and the affected view's 28% fade persist
through the agent's uninterrupted editing sequence, including between commands.

Hand-back covers underway and queued calls, then presents the saved revision in
the requested usable pane; missing output shows geometry and the failure. Cancellation
and restart settle the same ledger. Presentation survives busy views and retries
transport failures. Later work has a new identity; idle time never completes it.

Inspection receipts record the actual view. A server-verified newer saved view can
settle a superseded inspection, preserving the original delivery target and tour gates.

### Carrying a maker request

Carry the expected Studio/bundle association and originating `requestIds` on
the first needed operation ([target validation](../core/application/README.md#client-queue-monitoring)). The operation returns
`workRequest`; retain its identity for hand-back. `begin_studio_work` remains
available to explicit callers but is not a prerequisite. Carry current edit
identity with edits; an unchecked program summary is not a failed check.

| Situation | Action |
|---|---|
| Editing/checking/revising | Save usable revisions and continue; no intermediate completion or permission question. |
| Finished | `respond_to_studio_request` with `requestId: workRequest.id` and `status: completed`. |
| Discussion needed or user interjects | Hand back with `status: waiting`; handle the message before further autonomous edits. |
| Failed or cancelled | Hand back with that status and explain the outcome. |
| Geometry-only work | No generation solely to finish or undim. |
| Tour toolpath lesson | Generate in Studio; retain the lesson's exact-result requirement. |

Omit `resultStage` unless a particular view is required. [Native client events](../core/application/README.md#client-queue-monitoring)
hand work back on turn end, interjection, input or closure, without command-hook trust.

Follow [client queue monitoring](../core/application/README.md#client-queue-monitoring)
after acknowledging completed work; quiet expiry preserves attachment and work.
A generation failure supplies exact error/input evidence; claim it, fix the cause
within maker scope or leave out only what cannot be made, saying so, and show the
result. Unchanged inputs fail again.

## Studio event queue

Each chat owns an ordered event queue shared by its Studio windows. Events carry
sequence, time, kind, delivery class, instance and print. Held events wait for a
read; delivered events wake waits and include the held remainder. Reading drains
the queue; notifications alone do not. `get_studio_events`, operation responses
and `saam wait` carry observations plus live job progress. Act on the latest
state and stable event IDs to recognize repeats.

| Delivered | Held |
|---|---|
| Tour start/lesson/exit/finish; request queued/presented | Viewer opened/closed; exact view presented |
| Generation failed/cancelled; import completed/failed/repair-started/cancelled | Generation started/finished; import started |
| Print opened; export ready | Confirmation; tour playback; example adoption; plan update |

Camera, scrubbing, manual machine positioning, movie export and request
bookkeeping are not person-action events. Elapsed job time is available during
reads; no reliable repair ETA is inferred.

## Inspect a contract wire value

Ask an agent, for example, “What is x.x.x → y.y currently?” The agent resolves
those map addresses to the canonical wire, reads `read_contract_observations`
metadata and selects the occurrence for the requested part and run. Textual data
is explained in chat; graphical data is selected with
`request_review({bundleId, inspection:{observationId}})` in the part's Studio.
The map viewer itself has no live-data Peek.

Studio pins the exact retained occurrence and identifies its producer inputs;
ordinary part changes do not replace it. Missing captures remain unavailable,
and an older run is not presented as current. Supported Geometry, Paath and Slice
values use shared Studio graphics; unsupported graphics retain complete data
access with an explicit availability finding. Omit `inspection` from
`request_review` to return to normal part review.

## Importing an STL in Studio

Import uses the [shared lifecycle](../core/print/USAGE.md#import-an-stl) and current
printer/setup. Browser uploads have a 64 MiB HTTP input boundary; local paths
stream. An agent import waits for the tour to end. A worker validates,
repairs recognized defects and creates geometry, retaining repair
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
Without a machine model, the worker remains available for canonical source queries.
A compatibility path with no canonical source releases that worker after decoding.

[paath-view.mjs](paath-view.mjs) owns Paath presentation, source/playback controls
and complete-data access for both ordinary review and retained selections. It uses
[paath-queries.mjs](paath-queries.mjs) for finite selectors and local parameter/entity
readouts. Opening the panel loads its selectors; changing source or closing the
session cancels its pending query consumers. Diagnostic selection supplies provenance
and a guarded value URL to this same view and source session. It has no Paath worker,
schedule action or numerical controls of its own. An exact matching schedule opens
ordinary playback; a source without one opens unordered source drawing.

The worker owns the decoded source and optional schedule. The main page receives
finite drawing frames, operation/course selector pages and requested local values.
Curve preparation retains only the current
curve; revisiting recreates it from the same source. Whole-source bounds/counts are
prepared only for a drawing request, independently of local parameter queries.
Disposal terminates the worker and
rejects pending queries. Complete downloads use the selected observation's existing route.
Server serialization and worker JSON parsing still require whole values; scheduled
playback still expands moves. Finite frames do not establish bounded memory for those paths.

### Calculations and cancellation

Application owns generic and blob geometry jobs; Studio projects their accepted
selection/job identity, elapsed time and cancellation even before a print exists.
`server.generate` owns person/tour/agent toolpath work under the held reservation;
Bundle reuses a current result or runs its [worker](../core/print/generation-worker.mjs).
Cancellation stops calculation until saving is acknowledged, then publication drains.
A person's generation failure becomes an agent request; an agent's remains its error outcome and event.

### Request completion and display

[work-state.mjs](work-state.mjs) derives [work and hand-back](#agent-request-coordination);
[agent-ui.mjs](agent-ui.mjs) reports rendering and ignores obsolete responses.
Durable request records and live event queues cannot substitute for rendering.

Export captures a ready displayed path and settings at the click and starts
independently of the Studio edit/generation queue. Upstream regeneration leaves
the completed displayed result exportable until a replacement is ready. Machine preparation/writing
returns transient download bytes; later edits do not change
the capture. Reopening uses saved neutral artifacts and never runs the writer.

### Playback storage and movie resources

[move-store.mjs](move-store.mjs) owns Float64 numeric chunks and interned categories.
`at()` returns an independent row (rows have no index properties; readers use `at()`,
which plain move arrays share); `reader()` reuses scratch values which must be
copied if retained. `push()` passes each row through the store's `annotate` stage,
which path loading uses to add Slice stack, index and modulation identity. Snapshots are transport storage, not manufacturing data.
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
