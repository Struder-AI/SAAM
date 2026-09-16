# SAAM Studio

Launch and client access, instance ownership, review interaction and opening saved
prints. Rendering and playback implementation live in [RENDERING](RENDERING.md).
The [shared lifecycle](../core/print/README.md) owns bundle validity and approval state;
[MAKERS](../MAKERS.md) owns the interaction with the person making a part.

[Machine presentation integration](KINEMATICS.md) owns the shared provider
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
layer thickness; the old "horizontal body" label referred to the flat-layer
portion of the wedge, not a separate height setting.

The agent applies patches with the owning package's `adjust` command - the wedge
CLI for a wedge, `core/print/cli.mjs` for a shell print. Studio polls a bundle
fingerprint and reloads changed data automatically, keeping the view when nothing
changes and returning to the affected approval step after edits.
Geometry edits invalidate both confirmations; settings edits preserve geometry
approval and invalidate settings/toolpath approval. A server running old imported
code must be restarted after runtime changes. Each agent owns its Studio instances;
do not adopt another agent's viewer or terminate another agent's process. Independent
CLI launches and separate local MCP adapter processes use separate free loopback
ports. Identify the current work's print and URL before restarting its viewer.
Check the loaded geometry and export afterward.

If generation reports "The prepared print changed. Reload before generating."
after source changes, a browser refresh alone may leave an older server runtime
active while a new preparation worker imports current code. Restart the owning
Studio server, reconnect its viewer and check the fresh state. Geometry approval
can remain valid when geometry is unchanged; combined settings/toolpath confirmation is also bound to
the generator runtime and may require the person to review the regenerated result.
Do not rewrite approval hashes to make an old approval match new code.

Studio tracks open pages through authenticated persistent viewer connections,
independent of revision polling and background-tab timer throttling. There is no
deadline to open the first viewer, for either CLI or MCP launches. Once opened,
Studio closes 30 minutes after its last viewer disconnects, allowing task switches,
browser suspension and refreshes to reconnect. Each reconnection cancels the
pending shutdown; the next final disconnect starts a fresh 30-minute grace period.
Connected viewers have no idle deadline. An accepted bundle write finishes before shutdown
completes. Saved bundles are retained and can be opened in a fresh instance later.
The old `--close-when-idle` flag is accepted but no longer needed. The CLI process
exits when its work drains. In MCP, only that Studio listener and session are
released; the adapter and its other viewers stay available. Repeated
review requests within the same adapter can use that print's still-open session.
Independent agent ownership uses separate stdio adapters. Distinct instances do not lock a shared bundle against edits
from another process, so concurrent agent work should use separate bundles.

### Historical toolpath inspection

For an explicitly requested historical toolpath inspection, a local scratch
launcher may pass `resolveBundle` to `createStudio`. The resolver supplies a
scratch adapter over `createBundleWorkflow`; Studio keeps its existing source
playback, print picker and lifecycle. The default CLI and known adapters are
unchanged. This is explicit development injection, not automatic discovery or
permission to load module paths from a print. Record the original revision and
settings, distinguish historical stroke geometry from modern export assumptions,
and verify the interpreted deposition against the source generator.
An adapter's optional `inspection` presentation supplies a title, description,
facts/settings rows and note for a development tour. Studio then exposes settings
for reading and hides its approval button; the scratch adapter must independently
reject approval and delivery. This presentation does not grant production rights.

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
edit work or block review/export. Agents acknowledge receipt without repairing
the path. Reopening the same export does not resend an acknowledged advisory.

The wedge viewer provides click-to-select faces and matching feature buttons.
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
wedge export does not issue G280 or run a bed-leveling routine. An unknown installed firmware version does not block review;
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
STL lesson. Step 4 starts speculative preparation of the selected part while
geometry remains visible; earlier lessons omit program data and do not start
workers. Continuing commits the candidate for the exact current plan and loads
playback. Importing creates a separate saved part and prepares that selection.
Reopening the same selected print retains its matching preparation candidate.
The first continuation after a completed preparation diagnostic reports it without
repeating it; an explicit retry can start preparation again. Crashed workers
restart on an explicit generation request. Choosing an STL
stops the previous selection's preparation before importing.
Preparation workers are currently per Studio server, with no priority coordinator
across Studio, CLI and MCP processes; starting earlier or preparing alternative
choices would need that coordination to avoid competing with foreground work.
During toolpath lessons, saved process or machine edits trigger generation for
the selected, geometry-confirmed part after active edits publish their saved
input targets. Ordinary state reads never start speculative slicing. Production
generation checks geometry confirmation before starting a worker. A failed generation stays
actionable until inputs change or an explicit retry succeeds.
A changed, unconfirmed shape temporarily shows the normal geometry review and
dimensions within the current toolpath lesson. **Confirm geometry & return to lesson**
or an explicit human chat confirmation resumes that same lesson and generates its
current toolpath. Back and Next do not approve geometry; the import lesson's
explicit **Continue with this part** selection remains a confirmation action.
The review says it is waiting for geometry confirmation and clears work dots/fading
once the new shape is displayed, while the requested toolpath remains pending.
A confirmed toolpath lesson shows preparation status while no program is available. Generation failures remain visible after
the saved lesson is refreshed. Playback seeking waits until the program loads.
Outside the tour, a fresh print without a current export still opens in geometry
review and uses the normal Confirm geometry click. Unchanged approvals
retain their existing version binding: geometry-only confirmation resumes at
toolpath/settings, and a current export opens directly in the toolpath viewer. A development
export can be viewed but cannot authorize delivery. A stale or edited program
stays unavailable for approval. Failed opening retains the previous print.

An accessible viewport overlay with a spinner covers initial loading, reopening, changed
bundle validation, toolpath/export generation and delivery. It remains visible
through checks and playback loading, disables duplicate actions, and clears on
success or error. Geometry confirmation prepares and checks the toolpath. The final button confirms
settings and toolpath together and downloads the checked file. After a successful download, that exact print/export shows "Export again" for the current page session, including after switching away and reopening it. Animation respects reduced-motion preferences. It represents
stage progress where counts are available (layers, composed operations and
material instances), and indeterminate work otherwise. Percentages describe the
named stage, not estimated elapsed time or hardware status. The read-only
`GET /api/preparation` endpoint stays responsive outside the mutation queue and
binds progress to the current print and plan.

## Agent request coordination

JSON request files remain authoritative; no database, migration or Node minimum
change is required. A process-local index watches changed records and reconciles
file metadata every five seconds to recover missed notifications. Warm operational
polls avoid history reads/scans and return unfinished work plus the latest edit
outcome per print, including completed results still awaiting display.
Studio polls select only its open print; the agent listener covers the library.
Explicit `list()` / MCP `get_studio_requests` with `history: true` retains complete diagnostic
history and forces reconciliation. Cold discovery and periodic reconciliation
still scale with file count, and index memory scales with request history.
This index does not make cross-process claims or read/modify/write operations
transactional. Run one handling agent per request; independent writers can race.
Print, request and tour writes use unique temporary files and bounded retries
for Windows sharing conflicts; a failed replacement retains the previous file.

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
activity state. Both clear immediately when the requested result is displayed
and ready to use; an agent's later acknowledgement does not extend them. There
is no working-status caption. Expiration instead displays
italic *(lost contact)*: the lease expired, which does not prove the host stopped
reasoning. An observed MCP transport closure displays italic
*(connection closed)*. A new active request restores dots, and a later completion
clears the prior notice. Other active requests take precedence over notices. Requests persist under the print
library’s hidden .studio-requests directory and have independent IDs, print IDs,
instructions and status. A response resolves only its matching request; a
ten-minute lease bounds abandoned work. Disk-change events push request and print
updates to open viewers, with polling as fallback. The geometry lesson unlocks
as soon as the exact edited geometry is displayed, without waiting for a chat
acknowledgement. The toolpath-edit lesson accepts any participant-requested change,
including geometry, once its confirmed current toolpath is rendered;
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
cue. These cues apply only to those two edit lessons. The playback lesson stops
highlighting Play on its first use and does not restart the cue on Pause.
Ordinary geometry confirmation switches to the rendered toolpath before sending
its view acknowledgement, so completed loading clears the dots and fade.

The maker agent calls MCP begin_studio_work as its first operation for an edit,
before a chat acknowledgement or status lookup. It may omit printId for the
active tour or sole open Studio. CLI tour agents use begin-active.
Studio-created guidance requests stay visually quiet, including when claimed. The agent claims
the request, sends guidance in chat or generates the requested change, then calls
respond_to_studio_request. While guiding a tour, keep wait_for_studio_request
active and repeat its waits (at most 25 seconds). This supplies events to an
active connected agent; it cannot wake an ended or disconnected host chat.

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

`work-state.mjs` owns request activity and presentation matching for the UI and
tour gates. `agent-requests.mjs` persists those records; `agent-ui.mjs` merges
request snapshots by update time, so an older response cannot revive finished
work. `app.mjs` owns preview loading. Tour metadata (including lesson readiness
and start-layer choices) updates without reloading source or stopping playback.
Only changed bundle content or a changed geometry/program data requirement
triggers a full refresh. Listener waits are agent coordination, not preview work.
View-ready responses return the presentation receipts they wrote, so the browser
can settle those requests without a second acknowledgement or full state read.

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
queue infill guidance, imported-model start-layer selection and congratulations
after downloading. Completion displays a finished tour panel with congratulations
and an **Exit tour** button that dismisses it without erasing completion,
and a direction to talk to the agent about the next project. The chat message
also offers help with difficulties printing the downloaded file and asks what
to make next, as ordinary chat text without a question-box tool. Send it before
another listener or bookkeeping call. The client updates completion directly
without reloading the full source and material scene. POST /api/view-ready acknowledges the exact rendered revision
and export; saving or generating alone does not unlock edit lessons.

Request begin/respond/wait calls run independently of MCP’s print-work queue.
New queued requests also emit MCP logging notifications and appear in subsequent
ordinary object-valued tool responses as studioRequests. The pending-request
list and wait endpoint remain authoritative; client handling of notifications
does not guarantee that an ended host turn will wake. For CLI waits that return
a running session, the agent must keep reading that session until its JSON
result arrives. [Maker guidance](../MAKERS.md) specifies acknowledgement-before-wait
ordering and the active listener loop.

## Importing an STL in Studio

**Import STL** opens the native file picker directly and accepts a local ASCII
or binary STL up to 64 MiB. It assumes units from the loaded size without a popup,
shows that assumption beside geometry dimensions, and allows correction in chat.
The provisional policy is [D-030](../DECISIONS.md#d-030--provisional-stl-units-assumption).
Studio preserves source bytes and uses the
[shared importer](../core/print/USAGE.md#import-an-stl), current printer and
remembered setup. Ordinary imports open a new unapproved geometry for review.
For an STL accepted without repairs, the optional tour lesson treats file selection
as geometry confirmation, records it before generating production output for review,
advances to playback, and asks the agent to choose a suitable infill start layer.
Next skips importing and retains
the selected part. Failed mesh validation retains its diagnostic and does not
replace the selected print. Importing alone never approves settings or the toolpath.
Parsing, mesh validation and bundle creation run in a worker so request listeners
remain responsive. For recognized mesh defects, Studio automatically runs the
existing [mesh-tools repair](../skills/mesh-tools/SKILL.md), using exact cleanup
and native patch repair when needed, without filling holes. Malformed files,
resource limits and unrelated errors retain their own diagnostics. Failed imports
remove only their newly reserved destination; existing prints are preserved.
Repair requires the optional native backend when exact cleanup is insufficient.
The original STL, repaired STL and complete change report remain in the print's
`repair/` folder. Studio shows the repair summary and unapproved geometry in both
modes. The tour stays on its import lesson with **Confirm repaired geometry &
continue**; ordinary Studio uses **Confirm geometry**. Reopening an unconfirmed
repaired import does not approve it through print selection. Only explicit geometry
confirmation continues to its toolpath. Import progress distinguishes checking,
repairing and opening the model. Without an agent-supplied start layer, playback
starts at layer 2 (the first deposited layer for a one-layer model), and the
viewing timer still works. Later agent guidance does not reposition playback
after the participant has pressed Play for the current source.
If a tour import succeeds but generation fails, successful regeneration queues
the missing infill start-layer request so playback can recover.
