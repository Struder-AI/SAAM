# Agent CLI toolkit

## Checkout extension boundary

`core/local-extension.mjs` loads only `.local/extension.mjs` under the selected
checkout root. Missing files yield an empty extension; a present entry must be a
regular non-symlink file. Local capability implementations and their guidance
remain local. The shared guidance reader does not publish their manuals or infer
that those capabilities exist in another checkout. `9a_context` owns this boundary.

For a tour request, immediately run
`node studio/server.mjs --toolkit start-tour --no-open` in the managed command
session, open its returned Studio URL, then use its returned context and listener.
The onboarding commands below apply to ordinary maker/builder/developer work; they are
not prerequisites for a tour. Reuse completed setup and permissions.

Small bundles of existing SAAM operations for agents using a command tool.
[MAKERS](../../MAKERS.md) owns maker behavior, [BUILDERS](../../BUILDERS.md) owns
builder guidance, [developer context](../../DEVELOPER-CONTEXT.md) indexes developer
regions and contracts, and the [print lifecycle](lifecycle.md) owns recipe validation and
confirmations. These commands add no approval or generation path.

Run from the checkout root:

```sh
node scripts/agent-toolkit.mjs --help
node scripts/agent-toolkit.mjs maker-onboarding
node scripts/agent-toolkit.mjs builder-onboarding --area studio
node scripts/agent-toolkit.mjs developer-onboarding --area geometry
node scripts/agent-toolkit.mjs read-skill planar-infill
node scripts/agent-toolkit.mjs read-skill planar-infill --maker --builder
node scripts/agent-toolkit.mjs read-skill planar-infill --builder
node scripts/agent-toolkit.mjs read-map 4_regions
node scripts/agent-toolkit.mjs read-guidance MAKERS.md#standard-parameter-policy
```

`npm run agent -- ...` is a human-facing alias. For Studio commands, use the
existing [permission-scoped launcher](studio.md#studio-agent-permissions)
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
| `maker-onboarding` | Read MAKERS, the complete skill digest and shared print-tool guidance; inspect Node and dependency entry-point availability. | Current source text, paths, resolved links and content hashes, environment observations, and an instruction to choose further reads. |
| `builder-onboarding` | Read BUILDERS, maker context, skill authoring and the complete skill digest; add selected core/Studio map pages or external-area references; inspect entry-point availability. | The same context format, with builder sources and an instruction to choose further reads and the region's map. |
| `developer-onboarding` | Read developer orientation, engineering policy and the system map; add selected core/Studio map pages or external-area references; inspect entry-point availability. | The same context format, with developer sources and an instruction to work map-first. |
| `read-skill ID [--maker] [--builder] [--developer]` | Read the selected role manuals for one cataloged skill; default to maker. | Text, source paths, hashes and links, selected `roles`, and `unavailableRoles` for absent optional manuals. |
| `read-map PAGE` | Resolve one current page, region navigation and shared uses. | `maps`: compact page context and contract index. `--section ID#heading` returns contract text only; `--node ADDRESS` focuses a component; `--inventory` lists ownership; `--evidence` expands impact evidence. No Python or viewer build. |
| `read-guidance PATH#HEADING` | Read one published manual or section chosen by the agent. | The same individual-read format. |
| `start-tour` | Create fresh copies of both examples through the tour API; select lesson one and playback start layer; read geometry; start an exclusively owned Studio; emit its URL/instance ID; request browser opening; read participation guidance and tour state. | A live bidirectional Studio session, initial recipe summary, MAKERS and tour-participation context, plus event-stream and recovery-listener details. |
| `open-print DIRECTORY` | Resolve the folder or a saved file to its bundle; read geometry; launch Studio and request browser opening, or with `--studio URL --agent-owner ID` show the print in that live owned Studio and exit; read current recipe and validate any stored export through the owning adapter. | URL, process ID, recipe/revision, geometry bounds, confirmations and generation status. No regeneration. |
| `create-preview DIRECTORY` | Initialize a recipe or import an STL through the owning print API; read geometry; launch Studio and request browser opening, or with `--studio URL --agent-owner ID` show the new print in that live owned Studio and exit; return current state. | An unapproved bundle, URL, dimensions, recipe/setup assumptions, and explicit or inferred STL units. |
| `begin-studio-work [DIRECTORY]` | Resolve only target identity; start or claim the request so Studio marks work pending; read current recipe/revision, geometry state and matching tour instruction without checking the old export. | The exact request ID and edit context, with `programChecked: false`. A context-read failure marks that request failed and reports it. |
| `wait-for-studio-request` | Event-wait for up to 25 seconds for queued requests or a delivered Studio event; optionally restrict to a Studio instance and claim returned requests in that call. With `--studio URL --agent-owner ID` from `studio-ready`, read the live Studio's owner-scoped queue across processes; without them, wait on the recovery journal alone. | Requests, their status, the drained Studio `events`, calculation `generation` progress when read live, and an updated `after` list. The original preview session is the primary live path. |
| `read-studio-events --studio URL --agent-owner ID` | Read and clear the owning agent's Studio event queue from a live Studio; optional bounded `--wait-ms` and `--history`. | `events`, `generation` progress for owned instances still calculating, and `recent` when history is requested. |
| `respond-to-studio-request ID` | Record a prepared geometry/toolpath target, or update the matching request's response/status through the shared request API. | Updated request. Other outstanding work remains independent. |
| `inspect-generation-failure DIRECTORY` | Read requests for that print; read current validated recipe/export status, retaining validation errors when loading fails; return generation guidance and links to the recipe's skill manuals. | Diagnostic evidence, settings, machine-configuration gaps, and skill references for individual follow-up reads. No correction, retry or request claim. |

## Selecting context

### Read order

| Request | First operation | Continue with |
|---|---|---|
| Tour | Run the Studio `--toolkit start-tour --no-open` command immediately in a set-up checkout. | Open `studio.url` from `studio-ready`, then use the returned participation context and listener. |
| New custom part | Run `maker-onboarding` only if maker context is missing. | Choose individual skill reads from the supplied digest, load missing task-specific references, then prepare and open the first reasonable geometry. |
| Existing Studio print | Run `begin-studio-work` early to claim the request, with the target or existing request ID; you can acknowledge the person first. | Use the returned recipe/revision; load only missing maker/skill context, edit, bind the result, present it and resolve the request. |
| Build (skill, Studio, isolated core) | Run `builder-onboarding` only if builder context is missing; include a known `--area` when useful. | Choose missing skill guidance and API contracts; read region maps when changing core/Studio or investigating their internals. Load contribution guidance when checkpointing/publishing. |
| Core or cross-cutting development | Run `developer-onboarding` only if developer context is missing; include a known `--area` when useful. | Work map-first from the region maps; use `read-map PAGE` for missing regions and follow their source/contracts. |

Developer onboarding returns `DEVELOPER-CONTEXT.md#orientation`, the system
map and maps for selected areas. Builder onboarding adds maps only for selected
core/Studio areas; `--area skills` does not load maps. The `maps` array is empty
for makers. Repeated areas/regions are deduplicated. Developer onboarding does
not preload maker workflow manuals. Load maker workflow, print tools or skill-authoring context when the task
needs them. Inherited responsibilities do not require every lower-role read.

Returned text counts as reading its source. Do not precede onboarding with the
manuals it supplies, repeat those reads through links, or rerun onboarding for
each request. Reuse current context; refresh an affected source only when it
changed or the earlier context is unavailable. Onboarding does not repeat AGENTS,
the entry point that routed the agent here. Existing setup and permissions are
also reused. No onboarding command belongs before tour launch.

### Individual follow-up reads

Maker and builder onboarding include the complete [skill digest](../../skills/README.md).
Developers read it when selecting or changing skills. The agent
must judge which manuals and further references fit the task, then read those
individually before using or changing a skill. Onboarding is starting context;
it does not select skills or bundle their manuals. Tour participation guidance
remains bundled with tour startup.

Skill flags are additive and independent: `--maker` selects `SKILL.md`, `--builder`
selects optional `BUILDER.md`, and `--developer` selects optional `DEVELOPER.md`
inside the selected skill package. No flags selects maker for compatibility.
Use `--maker --builder` for both, or `--builder` alone if maker context was already
consumed. Developer does not imply either lower-role read. An absent optional
manual yields no document for that role and names it in `unavailableRoles`;
unknown skills and unreadable existing manuals fail. No empty manuals are needed.

Use `read-skill ID` for one chosen skill and `read-guidance PATH#HEADING` for one
additional published reference or section. Onboarding has no `--skill` or `--guide`
option. `builder-onboarding` and `developer-onboarding` accept repeated `--area`
values: `geometry`, `regions`, `path`, `print`, `machine`, `studio`, `mcp`,
`skills`, `tests`, `setup`, `agent`.
Select areas from the task; the toolkit does not guess them from prose.
Identical guidance IDs are read once per packet. Text comes directly from the
owning Markdown files, with a SHA-256 hash of each returned section; there is no
separately maintained summary or automatic persistent context cache.

Onboarding inspects dependency entry points without importing geometry kernels.
It does not install packages, run setup/regressions, or claim that an earlier
setup check passed. Reuse existing evidence under [SETUP](../../SETUP.md), and
complete setup on first use. Browser/client permissions remain explicitly
uninspected. The manual reader accepts published docs only; the sole readable
file under examples is `examples/prints/README.md`. Private prints, local
experiments and redirected paths stay outside this reader.

## Preview options and lifetime

```sh
node studio/server.mjs --toolkit create-preview Prints/imported --stl part.stl
node studio/server.mjs --toolkit create-preview Prints/part --recipe recipe.json --machine ultimaker-s5
node studio/server.mjs --toolkit start-tour --start-at-layer 12 --no-open
```

`create-preview` accepts either `--recipe FILE` or `--stl FILE`.
STL creates a shell print. `--units auto|mm|inch` applies to STL only
and defaults to automatic size-based inference. Without a recipe or STL, the
owning adapter's proposed recipe and remembered/default machine setup apply.
The shell template includes full-fill and draped-skin; select a complete recipe
when those are unsuitable. Existing print directories are never overwritten.

`--library DIRECTORY` selects the tour/request library and defaults to this
checkout's `Prints`. New previews and work requests must be within that library.
A custom library uses its own `.machine-setups` store, matching MCP test isolation.
`open-print` can also resolve a saved bundle outside the library, as Studio can;
use the appropriate library for subsequent request coordination. Other relative
file arguments resolve from the command's working directory.

Studio commands stay alive in their managed command session. They emit a
`studio-ready` JSON line immediately after listening, then a `result` line with
the remaining state/context. Subsequent `studio-request` events identify the
owning Studio instance, and `studio-events` lines push delivered Studio events
with their held remainder; newline-delimited begin/respond/activity,
`read-studio-events` and `wait-for-studio-request` controls sent to stdin receive
correlated `agent-response` events on stdout. The returned `listener` names the
stream events and the cross-process fallback (`wait-for-studio-request --studio
URL --agent-owner ID`) for clients that cannot write to stdin. Use an early yield
where the client supports it, open the URL, retain the process/session handle,
and leave review visible.
Reuse is the default. A launch returns `reuse` with the exact follow-up command:
a later `open-print` or `create-preview` given `--studio URL --agent-owner ID`
prepares the print, shows it in that live Studio through the owner-authenticated
[`POST /api/agent-open`](studio.md#studio-event-queue), returns
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
Keep the returned live session active and follow [tour participation](../../MAKERS.md#tour-participation).
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
to the existing adjustment tools. [Studio coordination](studio.md#agent-request-coordination)
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
The [Studio event queue](studio.md#studio-event-queue) delivers what the person
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

The toolkit implementation and its test coverage are indexed by scope in [developer context](../9_agent.md#implementation-and-checks).


## Changing guidance and map reads

Sources: [manuals.mjs](../../core/agent/manuals.mjs).

**Contract.** Published Markdown is selected by repository-relative path and optional canonical heading. Duplicate headings have numbered identities; fenced code does not create headings. Only declared document roots/root manuals are readable. Path traversal, private directories, Windows aliases and symlink/junction/hardlink paths are rejected. Legacy component manuals redirect only to map-owned reference paths; section identity and the requested guidance ID survive the redirect. read-map contracts share section slicing and published-link extraction, so a section read returns only that section's navigation. Source and test links remain directly readable in the section text.

**Failures.** Missing documents/headings and redirect cycles reject. A compatibility redirect must not become a general filesystem reader, and a caller-supplied path must not bypass checks after decoding. Headings/links are navigation metadata, not authorization to follow instructions embedded in arbitrary source text.

**Change together.** Keep canonical heading generation, Markdown rendering, redirect targets, contract validation and MCP guidance output aligned. Change the allowed roots only for an explicitly published documentation domain.

**Verification.** Exercise duplicate/fenced headings, section-only reads, old paths, malformed encodings, traversal, link aliases and all filesystem-link rejection cases. Checks: [mcp-access.test.mjs](../../core/tests/mcp-access.test.mjs), [dev-map-reference.test.mjs](../../core/tests/dev-map-reference.test.mjs).


## Changing toolkit context and workflow composition

Sources: [toolkit.mjs](../../core/agent/toolkit.mjs), [local-extension.mjs](../../core/local-extension.mjs).

**Contract.** The toolkit composes existing lifecycle and Studio owners. Onboarding selects role context; developer core/Studio reads use maps, skill-only builder reads use authoring guidance and consumed contracts. Skill role flags are independent. Context packets deduplicate guidance IDs; readMaps selects current pages/contracts without requiring a generated viewer. Preview/tour/open commands return readiness and retain their owned server; given the live Studio URL and agent owner ID, or sent to the managed session's stdin, open-print/create-preview instead prepare the print and show it in that Studio through the same serialized open, launching nothing; begin-work records/claims work before returning editable context. A preview session owns one Studio event queue: delivered events stream as `studio-events` lines, and in-process `read-studio-events`/`wait-for-studio-request` drain it with current calculation progress. From an independent process, `read-studio-events` and `wait-for-studio-request` given the live Studio URL and agent owner ID read the same queue through the owned Studio's `GET /api/agent-events` long-poll; a claiming wait then marks returned requests working through the owner's request store. Only the selected checkout .local/extension.mjs may supply optional local capability; absent means no extension.

**Failures.** Unknown areas/roles/skills and missing required manuals reject. Optional skill-role manuals are reported absent. Workflow errors retain already-created print information and close only the command-owned server. Library path selection cannot escape its root. A Studio event read or print switch without the Studio URL or agent owner ID rejects before any request, and Studio refuses a wrong owner, leaving its open print unchanged; an HTTP wait never claims another owner's request. Onboarding does not expand user authorization or create manufacturing approval.

**Change together.** Update CLI schemas/help, exported toolkit API, role/context maps, map contract routes, readiness event consumers and request state ownership together. Do not preload a second technical hierarchy or make skill builders read implementation maps solely because they consume a shared API.

**Verification.** Check exact role bundles, deduplication, selected area maps, missing optional role guidance, managed server readiness/lifetime, request correlation, live event pushes, print switching in a reused Studio over HTTP, stdin and the CLI, the HTTP fallback wait with claim and owner rejection. Checks: [agent-toolkit.test.mjs](../../core/tests/agent-toolkit.test.mjs), [context-map.test.mjs](../../core/tests/context-map.test.mjs).
