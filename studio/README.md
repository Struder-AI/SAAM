# SAAM Studio

Launch and client access, instance ownership, review interaction and opening saved
prints. Rendering and playback implementation live in [RENDERING](./RENDERING.md).
The [shared lifecycle](../core/print/README.md) owns bundle validity and approval state;
[MAKERS](../MAKERS.md) owns the interaction with the person making a part.

[Machine presentation integration](./KINEMATICS.md) owns the shared provider
contract. Toolpath preview shows available rails, links, carriages, bed and tool
as a quiet machine ghost. **Machine view** fits the assembly and raises its
visibility; switching back restores the part camera. Orbit, pan and zoom work in
both modes. **Follow build plate** independently chooses the reference frame
and is enabled for new views. The **Machine model** disclosure gives the model's
basis and limits; missing installation data does not disable source playback.
Playback and exported movies use the same source-time poses and rendering.

In Machine view, **Tool position** sliders pause playback and pose the simulated
machine using its supported position/orientation axes. **Return to playback**,
Play or the timeline restores the source pose. The controls do not change the
print or send hardware commands. Rails display fixed working carriage travel
from the machine definition. Sliders prioritize the dragged coordinate, adjust
the others to stay reachable, and stop at modeled boundaries. The assembly stays
visible while solving; slider readouts show the accepted pose.

## Studio agent permissions

The checkout includes [Codex rules](../.codex/rules/studio.rules) and
[Claude Code settings](../.claude/settings.json) for the same direct launcher:

```sh
node studio/server.mjs Prints/my-part
```

The same launcher also accepts `--toolkit start-tour`, `--toolkit open-print
Prints/my-part`, and `--toolkit create-preview Prints/my-part --recipe plan.json`.
These [bundled commands](../core/agent/README.md) emit a JSON `studio-ready` event
before their remaining context/result and retain the managed server session.
Use `--no-open` when the client opens the returned URL through its browser
integration. The original direct launch syntax remains supported.

Run from the repository root, quote a print path containing spaces, and keep
`node studio/server.mjs` literal. The bare command starts a new [guided tour](../examples/prints/README.md)
at lesson one, with geometry from the two bundled recipes and new automatically
saved local copies. Toolpaths are generated when the tour needs them.
The header's **Tour** button opens a fresh tour directly at the handle geometry
lesson when no tour is active; no welcome pane precedes the part view. While a
tour is active, it toggles lesson guidance. Completion has a separate
congratulations panel. Exit or cancellation ends the tour run. Starting again
creates a new run at lesson one; there is no Resume control or resume action.
Earlier example copies remain saved as ordinary prints. Teaching requests carry
run and lesson-visit identities; leaving a lesson cancels its pending teaching,
and returning creates a new request. Cancelling an individual edit does not end
the tour. Brief browser disconnects retain the run during Studio's existing
30-minute grace period. Shutdown of the owning Studio ends the run and cancels
pending work; reopening its saved print does not restore a tour. Closing an
observer or a Studio that owned an earlier run leaves another instance's current
run alone. This cleanup runs after accepted work drains; forced process death
and cross-process atomic transitions remain unresolved with the file-based store.
Use the client's managed terminal/background session so it can
retain the process handle. The human-facing `npm run studio` alias still works,
but the shared permission targets the direct command. Shell wrappers, different
script spellings, inline Node code and custom development launchers are outside
this rule. Do not replace it with a blanket Node, PowerShell, process-kill or
all-command allowance.

First-use setup is part of the agent's work; the user need not ask for it:

1. **Codex:** have the person trust this checkout through Codex's project trust
   flow. The [project config](../.codex/config.toml) carries no general permission
   overrides. Trusted project rules load at startup, so restart Codex after
   adding or updating them. If a running session has not loaded the rule and a
   launch needs escalation, request the specific launcher permission through
   the client, offering the `node studio/server.mjs` prefix when supported.
   Do not silently install a global rule. See
   [Codex rules](https://learn.chatgpt.com/docs/agent-configuration/rules).
2. **Claude Code:** have the person accept the workspace trust prompt. Shared
   `permissions.allow` entries cover the direct launcher in Bash and PowerShell;
   `sandbox.excludedCommands` runs that Bash launcher outside the sandbox so
   local listening does not need a separate sandbox exception each time.
   Restart the client after updating this setup. Use `/permissions` to inspect
   the loaded rules if a prompt persists. Personal overrides belong in ignored
   `.claude/settings.local.json`. See
   [Claude Code settings](https://code.claude.com/docs/en/settings),
   [permission rules](https://code.claude.com/docs/en/permissions), and
   [sandboxing](https://code.claude.com/docs/en/sandboxing).
3. **Browser:** open the printed `http://127.0.0.1:<port>` URL using the client's
   browser integration. Use its site permission flow if needed; keep any request
   scoped to Studio. Codex manages allowed sites in Settings > Browser; see
   [browser permissions](https://learn.chatgpt.com/docs/browser). Claude browser
   integrations have their own setup and permissions. These command rules do
   not preauthorize browser tools. Persistence across Studio's different ports
   is client-dependent and has not been verified; do not promise exactly one
   prompt. Claude Desktop/web MCP connections also retain their separate
   [connection setup](../adapters/mcp/README.md); Claude Code settings do not configure them.

During work, inspect geometry, source and playback and use camera/view controls
without another conversational permission question. Keep each instance's print,
URL and terminal handle together. To finish or restart it, close that instance's
viewer tabs; after 30 minutes without a viewer its server exits. To stop it
immediately, stop only its recorded terminal task or send Ctrl+C through that
session. For a server
with no viewer connection yet, or a stuck server, stop only its recorded terminal task
or send Ctrl+C through that session. A client's stop-tool permission can still
apply. Do not scan for and kill all Node processes. Leave a viewer open while
the person is expected to review it. Existing manufacturing approvals still
belong to the person.

For Codex download testing, return browser control to the person before their
download click. Ordinary clicks during agent control can be canceled by the
desktop host. Agents should use the browser tool's supported download action;
if the host reports a policy block, preserve it and let the person try with
control returned. A completed HTTP response does not establish a saved file.
Check browser completion or the saved bytes before reporting delivery success;
see the [observed download behavior](../DEVLOG.md#2026-09-15--browser-control-and-download-completion).

These allowances trust the launcher and its imported repository code; they are
command matches, not an OS boundary restricting the process to previews or the
print argument to `Prints/`. They do not pin a code hash or a working directory.
Keep the rules in the trusted project and use the repository root as instructed.
More restrictive client or administrator policies can still block or prompt.
No global approval mode or full-access setting is changed.

State and revision responses carry a server instance identity. When a server is
restarted, the browser reloads to obtain its new session token and reconnect its
viewer before posting acknowledgements. Old credentials remain invalid. Update
errors retain their concrete reason instead of an indefinite generic reconnect
message. Saved tour progress and print edits survive the reload.

To check Codex matching without launching Studio:

```sh
codex execpolicy check --rules .codex/rules/studio.rules -- node studio/server.mjs Prints/my-part
codex execpolicy check --rules .codex/rules/studio.rules -- node --eval 1
```

The first must report an allow match; the second must have no matching rule.
The rule file also includes positive and negative examples validated on load.

## Studio feature references

Implement the [maker interaction flow](../MAKERS.md#maker-interaction-flow): geometry
review and its revision loop, then combined settings/toolpath review followed by
confirm and export. There is no separate settings pane or settings confirmation.
The toolpath pane shows printer/material choices and the expandable full settings. Keep the interface concise and
accessible. Use chat for all recipe adjustments; expose camera, playback speed,
scrubbing and travel visibility as viewer controls. Layer height means deposited
layer thickness, not a separate height setting.

The agent applies patches with the `adjust` command of
`core/print/cli.mjs`. Studio checks the bundle fingerprint (`/api/revision`)
when the viewer stream pushes a print or tour change, or a request change during
an active tour (request activity gates the tour's Next), and reloads changed data
automatically, keeping the view when nothing changes and returning to the
affected approval step after edits. A viewer-stream error or reopen, the page
becoming visible and a 15-second heartbeat also check it; these cover missed
pushes, an unavailable watcher, request expiry and a restarted server. There is
no fixed short-interval revision poll.
Geometry and settings edits invalidate the single settings/toolpath confirmation.
A server running old imported
code must be restarted after runtime changes. Each agent owns its Studio instances;
do not adopt another agent's viewer or terminate another agent's process. Independent
CLI launches and separate local MCP adapter processes use separate free loopback
ports. Identify the current work's print and URL before restarting its viewer.
Check the loaded geometry and export afterward.

After changing SAAM's own code, restart the owning Studio server so the server
and its preparation workers run the same code. A confirmation is bound to the
plan and the exact exported bytes, not to the code that produced them, so a code
change alone does not ask the person to review an unchanged file again.
Do not rewrite approval hashes.

Studio tracks open pages through authenticated persistent viewer connections,
independent of revision polling and background-tab timer throttling. There is no
deadline to open the first viewer, for either CLI or MCP launches. Once opened,
Studio closes 30 minutes after its last viewer disconnects, allowing task switches,
browser suspension and refreshes to reconnect. Each reconnection cancels the
pending shutdown; the next final disconnect starts a fresh 30-minute grace period.
Connected viewers have no idle deadline. An accepted bundle write finishes before shutdown
completes. Saved bundles are retained and can be opened in a fresh instance later.
The CLI process exits when its work drains. In MCP, only that Studio listener and
session are released; the adapter and its other viewers stay available. Repeated
review requests within the same adapter can use that print's still-open session.
Independent agent ownership uses separate stdio adapters. Distinct instances do not lock a shared bundle against edits
from another process, so concurrent agent work should use separate bundles.

### Historical toolpath inspection

A local development launcher may explicitly supply a scratch adapter resolver to
[`server.mjs`](server.mjs); that is the scratch-launcher route for inspecting a
historical toolpath. It is a development affordance, not a product command.

### Remembered printer setup

The [shared print-tool manual](../core/print/USAGE.md#remember-machine-setup) owns
setup persistence and reuse; [machine contracts](../core/export/README.md) own
installation requirements. Studio displays the proposed setup with its assumption
and verification metadata in the toolpath pane. Apply the
[standard parameter policy](../MAKERS.md#standard-parameter-policy) when proposing
the printer and material before entering this view. They remain editable through
chat; changes invalidate the combined confirmation.

### Geometry and program views

Every displayed toolpath uses the shared [short-travel advisory](../core/export/README.md#short-travel-advisory).
When a matching toolpath view is acknowledged, findings create one `advisory`
notification per print/export through the agent request listener. It preserves
the export identity, recipe skills and diagnostic evidence for later generator
improvement. Advisories do not show busy dots, time out into UI errors, overlap
edit work or block review/export. Agents tell the person about the finding in
their next reply and acknowledge receipt without repairing the path. Reopening the same export does not resend an acknowledged advisory.

The viewer provides click-to-select faces and matching feature buttons.
Features identify the geometry version and native object UUID or mesh face identity. Geometry edits
recreate those identifiers and invalidate both confirmations.
Click near a visible crease or boundary to select its edge and see its name.
Surface interiors still select surfaces. Edge names combine adjacent surface or
component names with a number for that connected edge; names belong to the current
geometry revision, and geometry changes clear an edge selection. These are display
identifiers, not additional CAD topology or editing commands. Generic object
selection and freeform geometry editing remain deferred.

For toolpath review, the interpreter must support the selected export language
and required machine state. Unsupported commands, missing helper files, or
incompatible setup must be resolved before production review. The S5 subset
interpreter checks the actual export and rejects unsupported commands. Griffin
firmware startup is external and its internal motions are not simulated. The S5
export does not issue G280 or run a bed-leveling routine. An unknown installed firmware version does not block review;
the standard profile assumption is shown with the settings. Development preview
creates no approvals and cannot authorize delivery.
A path display alone cannot establish arbitrary machine-program behavior.

## Opening local prints in Studio

**Open print** lists saved bundles below `Prints/` (up to three directory levels).
It also accepts a local bundle folder, `plan.json`, or an export/delivery file
inside the bundle. It opens the owning bundle through the same adapter and
integrity checks; standalone machine-program import is not implemented.
Selecting another bundle updates this Studio server's active print, including
other tabs attached to that server. The client sends the current print identity
with mutations, so an old tab cannot approve, generate or deliver the new print.

Opening does not regenerate current stored files. Selecting a saved print
confirms its current geometry before entering a valid stored toolpath; the tour
selection also confirms geometry. It stays in geometry view through the optional
STL introduction. Step 4 starts speculative preparation of the selected part while
geometry remains visible; earlier lessons omit program data and do not start
workers. Continuing commits the candidate for the exact current plan and loads
playback. The import control is highlighted but disabled for the active tour;
normal Studio enables it after completion or exit.
Reopening the same selected print retains its matching preparation candidate.
The first continuation after a completed preparation diagnostic reports it without
repeating it; an explicit retry can start preparation again. Crashed workers
restart on an explicit generation request.
Preparation workers are currently per Studio server, with no priority coordinator
across Studio, CLI and MCP processes; starting earlier or preparing alternative
choices would need that coordination to avoid competing with foreground work.
During toolpath lessons, saved edits trigger generation after active work
publishes its saved input target. Ordinary state reads never start speculative
slicing. A failed generation stays actionable until inputs change or an explicit
retry succeeds. Geometry review remains available without pausing the lesson or
creating an approval. **Continue with this part** selects the displayed print for
the next lesson. While replacement output is prepared, the previous toolpath stays
visible at reduced opacity and cannot be approved or exported as current. Whenever
the toolpath pane has no current program and no retained previous one — first
generation, a reload mid-calculation, a tour lesson that starts its own generation,
or a failed generation — it draws the part being sliced at that same reduced
opacity instead of an empty viewport. The toolpath view still shows no part geometry
once a program is drawn.
A toolpath lesson shows preparation status while no current program is available. Generation failures remain visible after
the saved lesson is refreshed. Playback seeking waits until the program loads.
Outside the tour, a fresh print without a current export still opens in geometry
review and offers generation directly. The geometry action is a plain **Next** —
it advances to the toolpath, starting a calculation only when no current program
exists; the geometry approval gate has been removed, so it neither confirms nor
blocks. While a toolpath is still calculating, both stage tabs stay live: the
geometry pane remains reachable (and crisp), the toolpath pane remains reachable
whenever its faded preview can render, and **Next** returns to that faded pane
without starting or cancelling the pending calculation. The tour keeps its own
lesson wording on this button. A current export opens directly in the toolpath viewer. A development
export can be viewed but cannot authorize delivery. A stale or edited program
stays unavailable for approval. Failed opening retains the previous print.

An accessible viewport overlay with a spinner covers initial loading, reopening, changed
bundle validation, toolpath/export generation and delivery. It remains visible
through checks and playback loading, disables duplicate actions, and clears on
success or error. Generation prepares and checks the toolpath. The final button confirms
settings and toolpath together and downloads the checked file. After a successful download, that exact print/export shows "Export again" for the current page session, including after switching away and reopening it. Animation respects reduced-motion preferences. It represents
stage progress where counts are available (layers, composed operations and
material instances), and indeterminate work otherwise. Both the overlay and the
displayed-view acknowledgement give the compositor two frames to show what was
rendered, then continue on a short deadline: a hidden or unpainted tab runs no
frame callback, and loading must not depend on one. Percentages describe the
named stage, not estimated elapsed time or hardware status. The read-only
`GET /api/preparation` endpoint stays responsive outside the mutation queue and
binds progress to the current print and plan.

## Agent request coordination

The live request store belongs to one agent and may serve several explicitly
identified Studio instances. A Studio instance has exactly one agent owner and
cannot be adopted by another agent; print bundles remain shareable and another
agent may open the same bundle in its own Studio. Only the owning agent's store
hears its Studio instances: a listener without an owner ID never receives or
claims Studio-bound requests live, and reads them only as explicit diagnostic
history. The [Studio event queue](#studio-event-queue) carries the rest of what
happens in an owned instance to the same agent. Studio selects its open print;
the agent's request stream covers its owned instances. Operational waits are an
event-driven recovery interface and return unfinished work plus the latest edit
outcome, including completed results awaiting display. Use `list()` / MCP
`get_studio_requests` with `history: true` for complete diagnostic history. Run
one handling agent per request: cross-process claims and read/modify/write
operations are not transactional.

MCP print tools accept `requestIds` for the specific owned requests they handle.
Actual tool entry/exit renews those working requests' contact leases. The CLI
equivalent is `record-request-activity ID` through the agent toolkit; use it only
when performing that request's work, never from a timer or idle listener. Activity
does not claim, resume, complete or replace a result target. A long tool without
further observable activity can still lose contact. Studio worker progress is a
separate signal about calculation, not evidence that the agent is reasoning.

Studio exposes **Cancel calculation** while its toolpath worker is calculating.
Cancellation bypasses the normal mutation queue and stops the worker before
saving. Once saving has started, the checked file and review writes finish.
Cancellation creates no repair request and suppresses automatic retries for those
inputs; explicit Generate retries. Changes to the calculation's inputs observed
from another writer cancel obsolete calculation. View changes alone do not do so.
This control covers Studio workers; direct CLI/MCP generation and custom adapters
do not yet share a cross-process cancellation owner.

State and approval responses report `toolpathApproved` as the only approval state.
`/api/approve` takes the reviewer and revision; an active tour rejects it and
`/api/deliver` in favor of its combined confirm-and-export route.

Review metadata has its own update path. Approval, delivery history and generation
mode changes update controls after fresh validation without replacing unchanged
geometry or motion. Input/export changes still reload the presentation. Generation
identity other than mode remains part of the presentation fingerprint. This is
change detection; approval and delivery retain their current-byte checks.
Background `set_tour_start_at` calls must include the `runId` and `lessonId` from
their request scope or `get_tour`; the tour rejects a choice for an ended lesson.

The three animated dots immediately right of the logo and the dimmed viewport
are **Updating preview**, throughout ordinary Studio and the tour. They represent
active edits to the displayed part and loading the requested preview. They are
not a signal that the model is thinking or that a file is being exported. Chat
guidance, advisories, queued requests and requests marked `waiting` do not
animate. Downloads use their own progress overlay. The viewport fades to 28% opacity from the same
activity state, but only for the pane the active work regenerates: a
toolpath-only calculation dims the toolpath pane and leaves the geometry pane
crisp, while a geometry edit or a full reload dims whichever pane is shown. Both clear immediately when the requested result is displayed
and ready to use; an agent's later acknowledgement does not extend them. There
is no working-status caption. Expiration instead displays
italic *(lost contact)*: the lease expired, which does not prove the host stopped
reasoning. An observed MCP transport closure displays italic
*(connection closed)*. A new active request restores dots, and a later completion
clears the prior notice. Other active requests take precedence over notices. Requests persist under the print
library’s hidden .studio-requests directory as a restart/recovery journal and have
independent IDs, Studio instance IDs, print IDs, instructions and status. A response resolves only its matching request; a
ten-minute lease bounds abandoned work. The owning process publishes request
changes directly to the agent and its Studio instances; filesystem events reconcile
independent writers and browser state polling remains reconnect fallback. The geometry lesson unlocks
as soon as the exact edited geometry is displayed, without waiting for a chat
acknowledgement. The toolpath-edit lesson teaches how the confirmed shape is built
and suggests only contextual toolpath or process changes with their practical
effects. It still accepts any participant-requested change, including independently
requested geometry, once its confirmed current toolpath is rendered;
another actively unfinished request can still hold Next. Claiming renews that lease. MCP requests
carry their connection's ownership; that connection's close handler fails only
its unfinished work. Studio-originated requests inherit ownership when Studio
is MCP-owned, or when a connected agent claims them. Before shutting down its
Studio servers the adapter pushes the close event to open viewers. Independently
launched Studio sees persisted failures by polling. An ended chat turn is not
always a transport close, and a killed process may provide no callback. Browser
timeout rendering continues from cached request expiry even if polling fails.

Next blinks after the displayed geometry edit in the first lesson. The optional
roof lesson starts with an enabled, unhighlighted Next; active work disables it
with the dots and fade, and a displayed geometry change enables its completion
cue. These cues apply only to those two edit lessons. The STL introduction points
to the disabled Import STL control and the orange **Continue with this part**.
Both initially blink; the first pointer hover over Import STL retires its cue so
only Continue keeps blinking. The playback
lesson stops highlighting Play and unlocks Next on its first use; Pause does not
restart the cue.
Generation switches to the rendered replacement only after its checked source is
loaded; the previous toolpath remains faded while work is active, and the part
geometry stands in for it at the same opacity when none is retained.

The maker agent calls MCP begin_studio_work as early as practical for an edit; a
chat acknowledgement may come first. The claim it records is what later mutations
and result reports check. It may omit printId for the
active tour or sole open Studio; with several instances it supplies the returned
`studioInstanceId`; omission rejects when several owned instances display the
same print. `request_review` can deliberately open another instance for a shared
bundle with `newInstance`. CLI preview/tour agents receive `studio-request` events on the
managed command stream and send begin/respond/activity control messages back on
that stream. Separate CLI commands and bounded waits remain recovery options.
Studio-created guidance requests stay visually quiet, including when claimed. The agent claims
the request, sends guidance in chat or generates the requested change, then calls
respond_to_studio_request. While guiding a tour, keep the live managed session
active; MCP agents may use `wait_for_studio_request` as a bounded event-driven
wait (at most 25 seconds). Neither path can wake an ended or disconnected host chat.

Local equivalents, from the repository root:

```sh
node studio/agent-requests.mjs begin Prints tour/handle "Change the infill"
node studio/agent-requests.mjs wait Prints --claim
node studio/agent-requests.mjs claim Prints REQUEST_ID
node studio/agent-requests.mjs target Prints REQUEST_ID toolpath
node studio/agent-requests.mjs respond Prints REQUEST_ID waiting "Waiting for your choice"
node studio/agent-requests.mjs respond Prints REQUEST_ID completed "Updated toolpath generated"
```

`wait --claim` returns requests already marked working, saving a separate claim
round trip. Use `claim` only for requests received without that flag.

After saving an edit and before generating, bind its request to those inputs with
`target` (`geometry` or `toolpath`). MCP uses `respond_to_studio_request` with
`status: "working"` and `resultStage`. Beginning work records the starting inputs;
every new edit requires an explicit target so an intermediate save cannot clear a
request. Bind every included request when combining changes into one result.
An intermediate result remains playable while another request keeps the dots
and fade active. Pausing that remaining work with `waiting` restores normal
visibility and preserves its request. Claim it again when work resumes.
Intermediate presentation is optional: the agent may proceed directly to the
latest combined result. Failed, interrupted or superseded work can be failed,
paused or cancelled without displaying its target; only actual dependencies
require finishing an earlier result before continuing.
Use `kind: "guidance"` (CLI `begin-guidance`/`begin-active-guidance`) for advice;
finish it after delivering the answer. Advice never dims the preview or blocks a
completed lesson. Pausing and claiming the same request preserves its original
baseline, target and presentation record; publish another target if inputs change.

Tour metadata updates preserve source playback. Only changed bundle content or
a changed geometry/program data requirement triggers a full preview refresh.
Live request events and recovery waits coordinate agents; they do not constitute preview work.
Presentation is recorded separately from request completion, against the exact
displayed inputs and required stage. This survives viewer reconnects without
reviving dots for an already delivered result. An early agent completion retains
activity until its changed result arrives. Failed loading stops activity and
retains the error; claiming recovery starts work again. Work on another print
does not fade this viewport. The matching state and result snapshots contain no
manufacturing approvals.

An explicit generation failure queues an agent request with the exact error and
print identity. Identical failures for the same plan share one request. The agent
claims it, fixes the cause within the maker's scope, regenerates and checks the
visible result before resolving it. Generation errors remain available in the
current state until inputs change or generation succeeds; speculative preparation
alone does not alert the maker agent.

GET /api/agent-requests remains responsive during generation. Studio tour events
queue contextual toolpath/process guidance, playback start-layer selection and congratulations
after downloading. Completion displays a finished tour panel with congratulations
and an **Exit tour** button that dismisses it without erasing completion,
and a direction to talk to the agent about the next project. The chat message
also offers help with difficulties printing the downloaded file and asks what
to make next, as ordinary chat text without a question-box tool. Send it before
another listener or bookkeeping call. The client updates completion directly
without reloading the full source and material scene. POST /api/view-ready acknowledges the exact rendered revision
and export; saving or generating alone does not unlock edit lessons. The settings
lesson opens on a participant-requested agent edit whose result is the displayed
current toolpath; automatic Studio work and requests recorded before the lesson
do not count. It reads the print's whole request history rather than the current
owner's share, so relaunching Studio mid-lesson cannot lock it.

Request begin/respond/wait calls run independently of MCP’s print-work queue.
New queued requests publish immediately to the owning toolkit stream, emit MCP logging notifications and appear in subsequent
ordinary object-valued tool responses as studioRequests. The pending-request
list and wait endpoint remain durable recovery interfaces; client handling of
notifications does not guarantee that an ended host turn will wake. For CLI
previews and tours, the agent keeps reading the original managed session for
`studio-request` and correlated `agent-response` events. [Maker guidance](../MAKERS.md) specifies acknowledgement-before-wait
ordering and the active listener loop.

## Studio event queue

Studio writes what the person does, and what its workers produce, to one
**Studio event queue** owned by the agent and shared by that agent's Studio
instances. Each event carries a sequence number, time, kind, delivery class,
Studio instance, print and directory. **Held** events wait in the queue until
the agent reads it. **Delivered** events push to the agent at once and carry
every held event with them. Pushes never drain the queue; reads do, so a push
the client never surfaced is still received on the next read. Events are
ordered observations, not simultaneous state: the latest event describes the
current situation. The queue lives in the owning session's process and is not
persisted; sequence numbers identify repeats.

| Delivered (pushes now, with the held remainder) | Held (waits for a read) |
|---|---|
| `tour-started`, `tour-lesson`, `tour-exited`, `tour-finished`: lesson navigation, with the lesson and its agent instruction | `viewer-opened`, `viewer-closed`: browser viewer count |
| `request-queued`: Studio asked for agent work (Ask agent, tour guidance, generation failure, advisory) | `view-presented`: a geometry or toolpath view was displayed, with revision and export hash |
| `request-presented`: the agent's bound result is now displayed | `generation-started`, `generation-finished`: toolpath calculation start and finish, with trigger and duration |
| `generation-failed`, `generation-cancelled`: the calculation failed (with its recovery request) or was cancelled by the person or by changed inputs | `approved`: the final settings/toolpath confirmation |
| `import-completed`, `import-failed`: an STL import by the person | `import-started` |
| `print-opened`: the person opened another saved print | `tour-playback`: play or pause in the playback lesson |
| `export-delivered`: the person exported the reviewed file, in the tour or ordinary review | `example-adopted`, `plan-updated` |

Not recorded: camera, view settings, scrubbing, layer stepping, movie export,
manual machine positioning, reconnects and the agent's own request bookkeeping.

Channels. MCP: delivered events arrive as `saam.studio` `studio-events`
notifications, every tool result carries the queue as `studioEvents`,
`wait_for_studio_request` returns `events` and ends on a delivered event, and
`get_studio_events` reads and clears the queue on demand. Toolkit live session:
delivered events stream as `studio-events` lines, and the stdin commands
`read-studio-events` and `wait-for-studio-request` read in process. Independent
processes read the same queue through
`GET /api/agent-events?owner=AGENT_OWNER_ID[&wait=MS][&instance=ID][&after=ID,ID][&history]`
on any owned Studio, wrapped by the toolkit as
`read-studio-events --studio URL --agent-owner ID` and
`wait-for-studio-request --studio URL --agent-owner ID`. Every read also
returns `generation`: for each owned instance that is preparing or generating,
its status, trigger, elapsed time and worker progress with a percentage. The
passive queue holds only the calculation's start and finish; progress exists
only in a read made while it runs. No channel wakes an ended or disconnected
chat.

The same owner shows another print in its live instance with
`POST /api/agent-open` and a JSON body `{owner, path}`; it runs the serialized,
validated open used by the picker, pushes a `print` change to the viewers and
returns the agent session. The toolkit wraps it as
`open-print|create-preview DIRECTORY --studio URL --agent-owner ID`, so switching
prints reuses the instance and its browser tab.

## Importing an STL in Studio

**Import STL** opens the native file picker directly and accepts a local ASCII
or binary STL up to 64 MiB. That upload bound is an input-safety limit on the HTTP
boundary, not a geometry budget; it is about 1,342,000 triangles of binary STL and
is the only size limit Studio import applies. MCP `import_stl_print` applies the
same 64 MiB bound to the local file it is given; the CLI and the agent toolkit
apply none and are bounded only by the memory the machine actually has.
It assumes units from the loaded size without a popup,
shows that assumption beside geometry dimensions, and allows correction in chat.
The provisional policy is [D-030](../DECISIONS.md#d-030--provisional-stl-units-assumption).
Studio preserves source bytes and uses the
[shared importer](../core/print/USAGE.md#import-an-stl), current printer and
remembered setup. Ordinary imports open a new unapproved geometry for review.
During an active tour, the browser disables **Import STL** and the server rejects
direct import requests; the tour's STL introduction continues with the already
selected example. Importing becomes available after tour completion or exit.
Failed mesh validation retains its diagnostic and does not replace the selected
print. Importing alone never approves settings or the toolpath.
Parsing, mesh validation and bundle creation run in a worker so request listeners
remain responsive. For recognized mesh defects, Studio automatically runs the
existing [mesh-tools repair](../skills/mesh-tools/SKILL.md), using exact cleanup
and native patch repair when needed, without filling holes. Malformed files,
resource limits and unrelated errors retain their own diagnostics. Failed imports
remove only their newly reserved destination; existing prints are preserved.
Repair requires the optional native backend when exact cleanup is insufficient.
The original STL, repaired STL and complete change report remain in the print's
`repair/` folder. Studio shows the repair summary and repaired geometry for review;
the toolpath can then be generated directly. Import progress
distinguishes checking, repairing and opening the model.

## Studio state and worker protocols

[Print lifecycle](../core/print/README.md) owns approval and content identity;
[kinematics](KINEMATICS.md) owns the provider interface.

### Source session and stale replies

[`sourceSession`](./machine-session.mjs) owns one browser worker,
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

Verification: [Studio kinematics](../core/tests/studio-kinematics.test.mjs),
[playback cache](../core/tests/studio-playback-cache.test.mjs), and
[view readiness](../core/tests/studio-view-readiness.test.mjs).

### Preparation, generation and cancellation

[`server.mjs`](./server.mjs) owns the preparation worker and its target
directory and plan hash. Preparation checks a candidate in memory. Only an explicit
`generate` message permits persistence. The worker reads the plan hash before
preparation and again before generation; the lifecycle checks identity at commit.
An obsolete or discarded worker cannot donate checked source through an old
attachment. Preparation errors remain generation errors for that candidate.

[`generationControl`](../core/print/generation-control.mjs) uses a shared atomic
integer: 0 is working, 1 is cancelled and 2 is committing. Cancellation and
`beforeCommit` compete to change 0. If cancellation wins, commit throws
`GENERATION_CANCELLED`. Once commit wins, cancellation returns false and the short
write sequence finishes. This is not a multi-file transaction. The cancellation
API checks the current print and requested plan hash; UI progress also checks its
captured target before updating controls.

[`attachCheckedProgramWorker`](../core/print/program-handoff.mjs) accepts only
an actual server-created Node Worker. Successful generated messages must match
the expected plan hash and the check record's plan/export hashes. The handoff
retains metadata and source strings, excludes moves/events, and returns defensive
copies. It is process-local reuse of an owning check, not an API for trusting a
caller's assertion of validity.

Verification: [generation control](../core/tests/studio-generation-control.test.mjs) and
[workflow](../core/tests/workflow.test.mjs).

### Request completion and display

Request records and their state transitions are defined by the
[agent coordination contract](#agent-request-coordination). The shared
agent-owned store is the live operational channel; JSON records are its durable
recovery journal and the index reconciles independent processes. Request completion
does not establish that the requested geometry or toolpath has been displayed.
`work-state.mjs` classifies activity, receipt matching and confirmation waiting
from one normalized geometry/toolpath view and request context;
`agent-ui.mjs` orders snapshots by update time so an older response cannot revive
completed activity. Library-wide agent listeners and the currently selected
browser print intentionally have different selection scopes.

`studio-events.mjs` owns the agent's Studio event queue: one bounded, in-process
queue per agent, shared by that agent's Studio instances, holding what the
person did and what the workers produced. Held kinds wait for a read; delivered
kinds push at once through every channel and carry everything held with them.
Pushes never drain the queue; reads do, so a client that never surfaces a push
still receives the batch on its next tool result, listener wait or explicit
read. The queue is not persisted: it lives and dies with the owning session.
[Studio coordination](#studio-event-queue) owns the kinds and their
delivery class.

Verification: [request coordination](../core/tests/studio-work.test.mjs),
[readiness](../core/tests/studio-view-readiness.test.mjs), and
[activity display](../core/tests/studio-spinner.test.mjs).

### Playback storage and movie resources

[`moveStore`](./move-store.mjs) stores numeric columns in Float64 chunks
and interns categorical values. `at()` returns an independent row; `reader(names)`
reuses one scratch row and its vectors. Copy values that must survive the next
read. `snapshot()` exposes storage for transport; it is not a manufacturing format.
Source line offsets apply at read time. Consumers must preserve the difference
between source precision and display buffer precision.

[`exportMovie`](./playback.mjs) owns its encoder and closes each
VideoFrame after encoding. It uses a deterministic 30 fps source timeline, a final
two-second hold, bounded encoder backlog and explicit cancellation. Encoding speed
does not set video time. The draw callback receives explicit time/canvas state;
it must not advance live playback. This WebM writer handles one VP8/VP9 track,
without audio. [Rendering](RENDERING.md) owns bead appearance and line fallbacks.

Verification: [source player and compact moves](../core/tests/source-player.test.mjs) and
[movie export](../core/tests/studio-movie.test.mjs).

### Serving, page assets and lifetime

[index.html](./index.html) owns DOM controls consumed by `app.mjs`, settings and tour UI.
[style.css](./style.css) owns their layout and visibility; the
[logo](./struder-logo.png) is a presentation asset.
These resources belong to this region even though the JavaScript extractor
does not inspect them. When changing an element ID or its lifecycle, inspect its
selectors, handlers, accessibility state and associated tests together.

`viewer-session.mjs` owns the page's connection/reconnection; `lifetime.mjs` owns
one server's viewers and sockets, reporting viewer-count changes and the start of
closing to the server. The first viewer has no opening deadline. The
last viewer's departure starts a grace period, and reconnection cancels it.
Shutdown stops new requests, closes idle sockets, and lets accepted writes finish.
`changes.mjs` supplies change notifications, not a replacement for reading valid
current state. `browser.mjs` is the host-specific opener; its failure is distinct
from server startup failure. `machine-study.mjs` supplies explicitly scoped study
inputs through the existing source presentation boundary.

Verification: [lifetime](../core/tests/studio-lifetime.test.mjs),
[reconnect](../core/tests/studio-reconnect.test.mjs),
[settings](../core/tests/studio-settings.test.mjs), and
[tour UI](../core/tests/studio-tour-ui.test.mjs).
