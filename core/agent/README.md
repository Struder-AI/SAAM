# Agent CLI toolkit

## Checkout extension boundary

`core/local-extension.mjs` loads only `.local/extension.mjs` under the selected
checkout root. Missing files yield an empty extension; a present entry must be a
regular non-symlink file. Local capability implementations and their guidance
remain local. The shared guidance reader does not publish their manuals or infer
that those capabilities exist in another checkout.

Small bundles of existing SAAM operations for agents using a command tool.
[MAKERS](../../MAKERS.md) owns maker behavior, [BUILDERS](../../BUILDERS.md) owns
builder guidance, [developer context](../../DEVELOPER-CONTEXT.md) indexes developer
regions and contracts, and the [print lifecycle](../print/README.md) owns recipe validation and
confirmations. These commands add no approval or generation path.

Run from the checkout root:

```sh
node scripts/agent-toolkit.mjs --help
node scripts/agent-toolkit.mjs maker-onboarding
node scripts/agent-toolkit.mjs builder-onboarding --area skills
node scripts/agent-toolkit.mjs developer-onboarding --area core/geom
node scripts/agent-toolkit.mjs read-skill text --maker --builder --machine ultimaker-s5
node scripts/agent-toolkit.mjs read-map 0
node scripts/agent-toolkit.mjs read-map core/path/compose.mjs::planComposition --code
node scripts/agent-toolkit.mjs regenerate 6
node scripts/agent-toolkit.mjs read-guidance MAKERS.md#standard-parameter-policy
```

`npm run agent -- ...` is a human-facing alias. For Studio commands, use the
existing [permission-scoped launcher](../../studio/README.md#studio-agent-permissions)
through the client's managed command session:

```sh
node studio/server.mjs --toolkit start-tour
node studio/server.mjs --toolkit create-preview Prints/my-part --recipe plan.json
node studio/server.mjs --toolkit open-print Prints/my-part
```

The same three commands also work through `scripts/agent-toolkit.mjs`, but that
spelling is outside the shared Studio launcher permission. The toolkit does not
change client trust, permissions or browser access. `--no-open` skips dispatch to
the OS browser when a client opens the returned URL itself or a test is headless.

## What each command bundles

| Command | Operations in order | Result |
|---|---|---|
| `maker-onboarding [--machine ID]` | Read MAKERS, the skill digest (the index) and print tools as a [script client](#context-layers), with the machine's advanced sections; inspect Node and dependency entry-point availability; fetch `main` for `environment.sync`, the checkout's one-line sync report. | Assembled text and paths, environment observations, and an instruction to choose further reads. |
| `builder-onboarding [--area AREA]` | Read BUILDERS, the maker manuals whole, skill authoring and the digest; add the named area's component manual, or, for a node index or declaration path, that map; inspect entry-point availability and sync. | The same context format, with builder sources and an instruction to read the component manual for what is changed and walk the map for its structure. |
| `developer-onboarding [--area AREA]` | Read the glossary, developer orientation and map `0`; add a named node’s map or outside area’s references; inspect entry-point availability and sync. Open component manuals as needed. | Shared terminology, orientation, maps and navigation instructions. |
| `read-skill ID[#HEADING] [--maker] [--builder] [--developer] [--machine ID] [--all]` | Read the selected role manuals for one cataloged skill; default to maker, assembled as a script client. | Text, paths, `omitted` gated sections, selected `roles`, and `unavailableRoles` for absent optional manuals. |
| `context-budget [--machine ID]` | Assemble every layer for both clients and each machine. | Bytes per layer and client, and per on-demand manual. |
| `read-map INDEX|DECLARATION [--code] [--details]` | Read one compact stored page: `0` for the top map, `N.…` or a declaration path for a cluster's map or a leaf's code block. | `maps`: that graph or terminal source. `range` is `[first,last]` inclusive; nested locations inherit `file`; empty arrays are omitted. `--code` returns source and edit-safety metadata; only `0` is refused. `--details` returns the full stored packet and scanner evidence. Reads never scan. |
| `regenerate [INDEX]` | Scan the source and write the stored map. | Always generates everything; an index is accepted. The only command that scans. |
| `read-guidance PATH#HEADING [--machine ID] [--all]` | Read one published manual or section chosen by the agent. | The same individual-read format, with headings and their gates. |
| `start-tour` | Create fresh copies of both examples through the tour API; select lesson one and playback start layer; read geometry; start an exclusively owned Studio; emit its URL/instance ID; request browser opening; read participation guidance, tour state and `sync`. | A live bidirectional Studio session, initial recipe summary, MAKERS and tour-participation context, plus event-stream and recovery-listener details. |
| `open-print DIRECTORY` | Resolve the folder or a saved file to its bundle; read geometry; launch Studio and request browser opening, or with `--studio URL --agent-owner ID` show the print in that live owned Studio and exit; read current recipe and validate any stored export through the owning adapter. | URL, process ID, recipe/revision, geometry bounds, confirmations and generation status. No regeneration. |
| `create-preview DIRECTORY` | Initialize a recipe or import an STL through the owning print API; read geometry; launch Studio and request browser opening, or with `--studio URL --agent-owner ID` show the new print in that live owned Studio and exit; return current state. | An unapproved bundle, URL, dimensions, recipe/setup assumptions, and explicit or inferred STL units. |
| `begin-studio-work [DIRECTORY]` | Resolve only target identity; start or claim the request so Studio marks work pending; read current recipe/revision, geometry state and matching tour instruction without checking the old export. | The exact request ID and edit context, with `programChecked: false`. A context-read failure marks that request failed and reports it. |
| `wait-for-studio-request` | Event-wait for up to 25 seconds for queued requests or a delivered Studio event; optionally restrict to a Studio instance and claim returned requests in that call. With `--studio URL --agent-owner ID` from `studio-ready`, read the live Studio's owner-scoped queue across processes; without them, wait on the recovery journal alone. | Requests, their status, the drained Studio `events`, calculation `generation` progress when read live, and an updated `after` list. The original preview session is the primary live path. |
| `read-studio-events --studio URL --agent-owner ID` | Read and clear the owning agent's Studio event queue from a live Studio; optional bounded `--wait-ms` and `--history`. | `events`, `generation` progress for owned instances still calculating, and `recent` when history is requested. |
| `cancel-studio-calculation --studio URL --agent-owner ID --job-id ID` (or `--generation-hash HASH`) | Cancel the observed import or toolpath calculation, outside the work queue. | Cancellation acceptance; follow events through cleanup to completion. |
| `respond-to-studio-request ID` | Record a prepared geometry/toolpath target, or update the matching request's response/status through the shared request API. | Updated request. Other outstanding work remains independent. |
| `inspect-generation-failure DIRECTORY` | Read requests for that print; read current validated recipe/export status, retaining validation errors when loading fails; return generation guidance and links to the recipe's skill manuals. | Diagnostic evidence, settings, machine-configuration gaps, and skill references for individual follow-up reads. No correction, retry or request claim. |

## Selecting context

### Read order

| Request | First operation | Continue with |
|---|---|---|
| Tour | Run the Studio `--toolkit start-tour --no-open` command immediately in a set-up checkout. | Open `studio.url` from `studio-ready`, then use the returned participation context and listener. |
| New custom part | Run `maker-onboarding` only if maker context is missing. | Choose individual skill reads from the supplied digest, load missing task-specific references, then prepare and open the first reasonable geometry. |
| Existing Studio print | Run `begin-studio-work` early to claim the request, with the target or existing request ID; you can acknowledge the person first. | Use the returned recipe/revision; load only missing maker/skill context, edit, bind the result, present it and resolve the request. |
| Guidance, recipe helpers, assets, examples or diagnostics using published interfaces | Run `builder-onboarding` once when context is missing; add a known `--area`. | Read consumed contracts and missing guidance. Inspect maps when useful; reading implementation does not authorize changing it. |
| Core skills, core, Studio or shared interfaces | With developer authorization, run `developer-onboarding` once when context is missing. | Walk from `0` with `read-map INDEX|DECLARATION`, read source with `--code`, and regenerate after edits. |

Developers are maps-native and open prose manuals when the work calls for it; a
builder gets a map only for a named node (`--area skills` loads none), and makers
none. Inherited responsibilities do not require every lower-role read.

Returned text counts as reading its source: don't precede onboarding with the
manuals it supplies, reread them through links, or rerun it per request. Refresh
a source only when it changed. Onboarding does not repeat AGENTS, and none
belongs before tour launch.

### Individual follow-up reads

Onboarding is starting context: it does not select skills or bundle their manuals
or GEOMETRY.md. The agent judges which manuals and sections fit the task and reads
them with `read-skill ID` and `read-guidance PATH#HEADING`. Tour participation
guidance stays bundled with tour startup.

Skill flags are additive: `--maker` selects `SKILL.md` (default for maker skills),
`--builder` selects `BUILDER.md`, and `--developer` selects `DEVELOPER.md`.
Builder-only diagnostics default to their builder manual and reject maker reads.
Absent optional manuals appear in `unavailableRoles`. `--area` repeats
and takes an area from `--help` or a map node; the toolkit does not guess areas
from prose. Identical guidance IDs are read once per packet, and there is no
separately maintained summary or persistent context cache.

Onboarding inspects dependency entry points without importing geometry kernels;
it installs nothing, runs no setup and claims no earlier setup check ([SETUP](../../SETUP.md)
owns first use), and leaves client permissions uninspected. The manual reader
accepts published docs only (under examples, only `examples/prints/README.md`).

## Context layers

Every agent gets the **index**: the [digest](../../skills/DIGEST.md), one line per
skill and per advanced section with its gate. It loads more only for its client,
its machine or an explicit request:

| Layer | Who reads it | Source |
|---|---|---|
| Index | Everyone, in onboarding and tool descriptions | The digest, generated by `node scripts/skill-digest.mjs` |
| Operate | Everyone: tools, settings, decisive limits, the maker flow | Untagged sections of maker manuals |
| Script | Agents with command access (CLI reads) | Sections tagged `<!-- layer: script -->` |
| Advanced | A print whose machine meets the gate, or on request | Sections tagged `<!-- requires: capability, … -->` or `<!-- layer: advanced -->` |
| Builder | Builders and developers | `BUILDER.md`, `DEVELOPER.md` and the component manuals |

A marker is an HTML comment on the line directly above a heading and gates that
heading's section with its subsections. `requires` names machine capabilities
(`machines/*.json` `capabilities`), any of which opens it, or `nonplanar>=N` for a
nonplanar limit of at least N degrees; `layer: advanced` alone opens only by
request. The digest generator rejects a capability no machine declares.

[manuals.mjs](manuals.mjs) assembles a read: a web client (MCP) gets operate
sections, a script client (this toolkit) adds script sections, `--machine` or
`machineId` adds the advanced sections that machine meets, and `--all` everything.
A `#heading` read returns that section whatever its gate. Closed sections are cut
and listed in `omitted` with their gate; frontmatter and markers are dropped, line
endings are LF, and relative links become repository paths that `read-guidance`
takes directly. Builder and developer onboarding read the maker manuals whole.
[layers.mjs](layers.mjs) owns the onboarding sources, the index, the one-line
`gatedGuidance` hint that creating a print or changing its printer returns when
the new machine opens sections the old one did not (among the maker manuals, the
print's skills and its geometry skill), and `context-budget`.

## Preview options and lifetime

```sh
node studio/server.mjs --toolkit create-preview Prints/imported --stl part.stl
node studio/server.mjs --toolkit create-preview Prints/part --recipe recipe.json --machine ultimaker-s5
node studio/server.mjs --toolkit start-tour --start-at-layer 12 --no-open
```

`create-preview` requires `--recipe FILE` with authored geometry or `--stl FILE`
(`--units auto|mm|inch`, default size-based inference). Existing bundles are never overwritten.

`--library DIRECTORY` selects the tour/request library (default this checkout's
`Prints`, which must hold new previews and work requests); a custom library has
its own `.machine-setups` store. `open-print` also resolves a bundle outside the
library. Other relative file arguments resolve from the working directory.

Studio commands stay alive in their managed command session. They emit a
`studio-ready` JSON line immediately after listening, then a `result` line with
the remaining state/context. Subsequent `studio-request` events identify the
owning Studio instance, and `studio-events` lines push delivered Studio events
with their held remainder; newline-delimited begin/respond/activity, event reads,
waits and `cancel-studio-calculation` controls sent to stdin receive
correlated `agent-response` events on stdout. The returned `listener` names the
stream events and the cross-process fallback (`wait-for-studio-request --studio
URL --agent-owner ID`) for clients that cannot write to stdin. Use an early yield
where the client supports it, open the URL, retain the process/session handle,
and leave review visible. Cancellation bypasses queued waits. Import progress
includes stage and elapsed time; an unknown remaining time is not an ETA. Continue
listening or cancel the observed job and explain the decision to the person.
Reuse is the default. A launch returns `reuse` with the exact follow-up command:
a later `open-print` or `create-preview` given `--studio URL --agent-owner ID`
prepares the print, shows it in that live Studio through the owner-authenticated
[`POST /api/agent-open`](../../studio/README.md#studio-event-queue), returns
`studio.reused: true` and exits; the same browser tab follows the change. The
managed session accepts the same two commands on stdin. Launch another instance
only when the person asks, or for a compelling reason stated to them.

Browser dispatch is reported as `browserOpenRequested`; it does not prove that
the page rendered. Verify the view with the client's browser integration when
needed. Studio retains its ordinary viewer lifetime and closes after its last
viewer has been disconnected for 30 minutes. Stop only the recorded owned session
to close it immediately. The toolkit does not start detached background helpers
or adopt another agent's server.

A relaunch normally mints a new agent owner, which hides the previous run's
requests from it. `--agent-owner ID`, given the `agentOwnerId` from an earlier
`studio-ready` line, resumes that owner instead, so its in-flight requests and
its share of the request journal stay visible and claimable. It accepts only an
agent-minted ID, never a `studio:` session fallback, and the relaunch still gets
its own Studio instance: one owner may own several instances over time, but an
instance's owner is fixed and no launch attaches to a running server.

Starting a tour does not conduct the interactive lessons or wake an ended chat.
Keep the returned live session active and follow [tour participation](../../examples/prints/README.md#maker-agent-participation).
The first screen is prepared before the remaining manuals are read; skill reads
and slicing are not prerequisites for that first screen.

## Work and recovery

```sh
node scripts/agent-toolkit.mjs begin-studio-work Prints/my-part --instruction "Change infill"
node scripts/agent-toolkit.mjs wait-for-studio-request --studio STUDIO_URL --agent-owner AGENT_OWNER_ID --claim --wait-ms 25000
node scripts/agent-toolkit.mjs read-studio-events --studio STUDIO_URL --agent-owner AGENT_OWNER_ID
node scripts/agent-toolkit.mjs begin-studio-work --request REQUEST_ID --include-geometry
node scripts/agent-toolkit.mjs respond-to-studio-request REQUEST_ID --status working --result-stage toolpath
node scripts/agent-toolkit.mjs respond-to-studio-request REQUEST_ID --message "Updated and displayed"
node scripts/agent-toolkit.mjs inspect-generation-failure Prints/my-part --request REQUEST_ID
```

For new work, supply `--instruction`; omit the directory only when targeting the
active tour print. Use `--kind guidance` for teaching without an edit. For an
existing Studio request use `--request`, preserving its identity and kind. Recipe
geometry is omitted by default and `planComplete` is false; use
`--include-geometry` for a complete editable recipe. Pass the returned revision
to the existing adjustment tools. [Studio coordination](../../studio/README.md#agent-request-coordination)
owns prepared-result targeting and response timing.

One agent may own several Studio instances. Each instance has one immutable
agent owner and exposes its `studioInstanceId`; use that ID whenever selection
would otherwise be ambiguous. Another agent may open the same persisted print
bundle in a separately owned Studio, but it cannot adopt or control this session.
MCP `request_review` can open another owned instance for the same bundle explicitly;
work on an ambiguously displayed bundle must name its instance.
JSON request records retain restart and independent-process recovery; they are not
the primary transport for an owned live session. A listener without the agent
owner ID hears no Studio-bound request: pass `--agent-owner` from `studio-ready`.
The [Studio event queue](../../studio/README.md#studio-event-queue) delivers what the person
does in an owned instance; reads drain it and report calculation progress.

`respond-to-studio-request` defaults to `completed`; supported statuses are
`working`, `completed`, `failed`, `waiting`, and `cancelled`. After preparation,
`--status working --result-stage geometry|toolpath` records the result expected
in the viewer. Send the required chat acknowledgement and resolve only that
request. `--after ID` may repeat when waiting. Unclaimed requests excluded by a
cursor still remain queued; use `--claim` for an active handler. Claiming in one
call is not a cross-process exclusive-worker lock.

`record-request-activity ID` renews contact while the agent is actually working
on that request. It preserves status, baseline and target, and does not resume
waiting work. Never run it as an idle heartbeat. MCP print tools can instead bind
their real tool entry/exit with `requestIds`. Failure inspection with a request ID
reads that file directly; otherwise it selects the named print's history.

Failure inspection preserves exact Studio request instructions, which include
generation errors, and labels raw recipes as unvalidated if loading fails.
Skill manuals appear as references for the agent to choose and read separately.
Requests can describe older revisions. CLI-only generation errors are not
persisted; retain their command output alongside this report. The command never
fabricates a missing error or retries generation.

Output is newline-delimited JSON. Errors return `ok:false`, `stage`, `error` and
`partial`, with a nonzero exit code. A later failure leaves a successfully created
bundle available for reopening and reports its path; any server started by the
failed call is closed and marked `closed:true`. Commands create no human
confirmation or hardware action.

## Implementation and verification

The toolkit implementation lives under `core/agent/`. It is not on the dev map,
which covers core and Studio product code; the toolkit is scanned only so its
calls into that code appear as incoming ports, so this manual and the source are
its account of structure. See the [test registry](../tests/README.md#test-registry)
for its coverage.
