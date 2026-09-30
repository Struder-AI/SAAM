# MCP access to local SAAM

This stdio adapter lets an MCP client use SAAM's existing shell/mesh bundles
and SAAM Studio. It has no compiler, private review bridge, model calls, or
hardware connection. Machine outputs and skill compatibility remain governed
by the shared plan, generation and interpreter checks.

Install the root dependencies with `npm ci` using Node.js 22+, then launch:

```sh
node adapters/mcp/src/server.mjs
```

For an MCP desktop client, add this entry to that client's local configuration,
substituting the actual absolute repository path:

```json
{
  "mcpServers": {
    "saam": {
      "command": "node",
      "args": ["C:/CodeProjects/SAAM/adapters/mcp/src/server.mjs"],
      "env": { "SAAM_PRINTS_ROOT": "C:/CodeProjects/SAAM/Prints" }
    }
  }
}
```

No client settings are installed automatically. All protocol output uses stdout;
launch errors use stderr. The repository is resolved relative to the adapter,
so the client's working directory does not matter. Direct `node` launch avoids
npm's script banner on the protocol stream. SDK and schema packages are pinned
in the root lockfile.

`SAAM_PRINTS_ROOT` defaults to the repository's ignored `Prints/` directory.
Every call selects a persistent `bundleId` relative to that root. Up to three
folder levels match Studio's library, including existing names such as
`Customer A/Job 2/Part`. Use forward slashes; absolute paths, traversal, hidden
folders, Windows reserved names, trailing dots/spaces and invalid path characters
are rejected. Names have at most 128 characters per segment and 384 overall.
Links/junctions in path ancestors and bundles, and hard-linked bundle files,
are refused. The default Prints root reuses the CLI's
shared `.local/machine-setups/` store, separately per machine. A custom Prints
root uses its own `.machine-setups/` folder to isolate tests. A restart reopens the same
saved IDs; there is no single global plan that overwrites another job.

| Tool | Role |
|---|---|
| `maker_onboarding` | Listed first. The maker's starting context for a client without command access, as a web client of the [context layers](../../core/agent/README.md#context-layers): MAKERS, the digest (the index) and shared print tools, with a `machineId`'s advanced sections, plus how a relayed session reaches the computer. A relayed session also offers the [SAAM panel](RELAY-PLAN.md#saam-panel) with its result. Until a relayed session calls it (or reads `makers`), every result carries a second text item asking it to. |
| `list_machines`, `list_skills`, `read_skill` | Read this checkout's known profiles and manuals. Each skill entry is a toolpath, geometry (such as mesh tools) or hybrid skill. `read_skill` takes `ID` or `ID#heading` and an optional `machineId`. These small fixed lists are not an automatic discovery or installation system. |
| `read_guidance` | Read a published Markdown path, optionally ending in `#heading`, or a short ID: `makers`, `geometry`, `development`, `glossary`, `mcp`, `print-tools`, with an optional `machineId`. |
| `get_recipe_defaults` | Read geometry-free process/setup defaults, reusing remembered setup. |
| `create_bundle` | Initialize an unapproved bundle from a complete recipe with authored/imported geometry. |
| `import_stl_bundle` | Read an absolute local `.stl` source path with optional `auto` (default), `mm` or `inch` units; preserve its bytes/hash and use the shared CLI importer and remembered setup. Recognized mesh defects receive automatic repair; local files stream without an upload cap. |
| `search_thingi10k` | Search descriptive keywords, a numeric file ID or a Thingiverse thing URL in the mirror. Returns per-file source/license links and pagination. Read the [Thingi10K manual](../../skills/thingi10k/SKILL.md). |
| `import_thingi10k_bundle` | Download `fileId` on the SAAM host into a new `bundleId`, with `machineId` and optional `units`. Return attribution and the mandatory chat license notice, including when automatic import/repair fails. Review successful imports with `request_review`. |
| `list_bundles`, `get_bundle` | `list_bundles` discovers names and machines with `programChecked:false`; it does not validate exports. `get_bundle` reads checked status/recipe, omitting geometry and marking `planComplete:false` unless `includeGeometry:true` is supplied. Neither returns motion arrays. |
| `begin_studio_work`, `respond_to_studio_request` | Start work with kind `edit` or `guidance`, supplying `studioInstanceId` when several Studios are open. After saving an edit, bind its result using status `working` and `resultStage` (`geometry`/`toolpath`); use `waiting` when paused for input. Complete after guidance or the displayed result. Overlapping work stays independent. |
| `set_stl_units` | Correct a plain imported mesh to `mm` or `inch` with current `expectedRevision`; retains mesh edits/source bytes and invalidates final review. |
| `wait_for_studio_request`, `get_studio_requests` | Receive live Studio requests with bounded event waits, or inspect durable recovery/history state. Optional `studioInstanceId` scopes a wait; `claim:true` marks returned requests working in the same call. The wait also ends on a delivered Studio event and returns the drained `events`. Runs outside the print-work queue. This does not wake an ended or disconnected chat. |
| `get_studio_events` | Read and clear the [Studio event queue](../../studio/README.md#studio-event-queue): what the person did in this agent's Studio instances, plus `generation` progress for any instance still calculating. Delivered events also arrive as `studioEvents` on every tool result and as `saam.studio` notifications. Optional `history` includes recently read events. |
| `get_studio_sessions`, `close_studio_session` | List or close this agent's explicitly owned Studio instances. One agent may own several; no Studio instance is shared between agents. |
| `get_tour` | Read tour progress and the next maker-agent chat instruction. Optional `after` cursor and `waitMs` wait for a change for up to 25 seconds. |
| `set_tour_start_at` | Set explicit `{startAt:{layer:12}}` for the playback lesson; choose a layer with sparse infill. |
| `change_machine` | Change printer with current `expectedRevision`, using remembered/default setup and shared compatibility checks. Final review is invalidated. |
| `adjust_recipe`, `slice`, `modulate` | Patch the recipe or add/edit/remove a common assignment or field modifier with current `expectedRevision`; each validates the saved recipe and invalidates affected review. |
| `blob_field` | Create or rebuild a [blob field](../../GEOMETRY.md#blob-field) part from its points. |
| `combine_geometry`, `intersect_geometry` | Combine a print or part with another solid as a [boolean](../../GEOMETRY.md#booleans); section it or find its top at given points ([checking](../../GEOMETRY.md#checking-geometry)). `intersect_geometry` also takes a geometry without a print. |
| `gridfinity` | gridfinity |
| `apply_text` | Add, edit or remove text geometry using the [text skill](../../skills/text/SKILL.md), a local font and current `expectedRevision`. Reuses the shared preparation and review lifecycle. |
| `apply_heat_set` | Add, edit or remove insert holes with six loops and connecting fins using the [heat-set insert skill](../../skills/heat-set-inserts/SKILL.md) and current `expectedRevision`. Reuses the shared preparation and review lifecycle. |
| `check_bundle` | Revalidate native geometry, plan and any stored export; no generation. |
| `check_path` | Check path feasibility through the shared generator without approvals or persisted artifacts; production export/review are still required. |
| `remember_setup` | Save this print's setup as editable defaults for the next print, shared with the CLI. |
| `request_review` | Start/reuse an exclusively owned Studio for this print and return its instance ID and loopback URL. Reuse is the default: the instance already showing the print, else the sole live instance, is rebound in the same browser tab. Supply `studioInstanceId` to choose among several owned instances, or `newInstance:true` to open another only when the person asks or for a compelling reason stated to them. |
| `get_approval_status` | Read the hash-bound final settings/toolpath confirmation from disk as `toolpathApproved`, the only approval state print summaries report. |
| `generate_toolpath` | Generate and check the machine export from current geometry and complete settings, including during a tour; no development-mode bypass. |
| `deliver_toolpath` | Copy the exact current approved export into the print's delivery directory. |

The [shared print-tool manual](../../core/print/USAGE.md) owns importing,
recipe adjustments, setup reuse, reopening and delivery; skill manuals own their
settings and limits. Imports automatically repair recognized defects through the shared lifecycle;
`cancel_studio_calculation` takes the observed identity from `get_studio_events`.
Direct generation uses the same worker/job as Studio, with progress and cancellation;
pass its `jobId` and `generationHash`, without a Studio instance.
Direct repair commands are builder diagnostics. `create_bundle` and `change_machine` results carry `gatedGuidance`
when the printer opens advanced sections.

Manual responses carry their repository-relative `path`, the gated sections
`omitted` from this read and, from `read_guidance`, the `headings` with their
gates. Links in the text are repository paths `read_guidance` takes as they
stand: `core/export/griffin.md#s5-startup-observations` reads that section and
its subsections. The reader accepts public root manuals and Markdown in the
component, skill, Studio, machine, adapter and script trees; private or hidden
paths, dependencies, build output, source code, traversal and filesystem links
are unavailable.

For a tour request in a client with command access, first run
`node studio/server.mjs --toolkit start-tour --no-open`, open its Studio URL,
then use its returned context and listener. Do not precede that launch with
`read_guidance`, skill reads or onboarding. This is the local CLI tour route;
the MCP adapter does not expose a tour-start tool.

For ordinary new-part work with command access and missing maker context, run
`node scripts/agent-toolkit.mjs maker-onboarding` once; in an MCP-only client,
call `maker_onboarding` once instead. Reuse supplied/current context in either
case, choose and read the relevant skill manuals individually, create the first
reasonable geometry, and call
`request_review`. Studio opens in the default browser where available; the
returned URL remains usable if browser launch fails. Set `SAAM_NO_AUTO_OPEN=1`
for tests or a headless client. Studio servers are owned by the MCP process,
use free loopback ports, and close 30 minutes after the last viewer tab
disconnects (with a grace period for refresh), or when the owning stdio client
disconnects. There is no deadline to open the first viewer.
Review requests follow the reuse/selection rules in the tool table. Closing a
viewer leaves the adapter and its other viewers running. Separate adapter
processes never adopt each other's Studio instances; independently owned
instances may show the same bundle. MCP transport closure marks
that connection's unfinished owned requests failed and pushes a connection-close
event to its Studio viewers before shutdown. Requests created by its Studio
servers, or claimed with begin_studio_work, share that ownership. Other agents'
requests remain unchanged. An ended host turn is not necessarily a transport
close; abrupt process termination may provide no close callback. The ten-minute
request timeout remains the fallback. Use separate adapters for independent agent ownership; coordinate concurrent edits through the shared bundle revision contract.
A separately launched CLI Studio remains independent and is never terminated by
this adapter.

Geometry review is advisory and generation is available whenever it helps the
person inspect the result. Settings and the exact toolpath are confirmed together
in Studio before export. No MCP tool can grant that final approval, accept approval fields in recipes,
select development generation, write arbitrary files, or send a job to a machine.
Status is loaded from disk rather than accepted from the agent. Recipe edits
invalidate the affected shared approval hashes. Delivery adds no further approval
and does not regenerate. A catalog entry or passing software checks do not
establish physical printing, clearance, or a compatible recipe for every machine.

Shell recipes and patches expose the shared geometry, assembly selections,
skill settings and composition fields; the adapter does not keep a smaller
parallel recipe schema. Use `includeGeometry:true` for a complete recipe and
read the owning manuals before editing it. `check_path` reports operation order
and feasibility without becoming a separate preview or approval route. STL
import reads only the chosen source; it writes the new bundle inside the configured
Prints root. Reads reject stale recipes without rewriting them. Supported older
fields use the [explicit CLI migration](../../core/print/README.md#print-bundle-and-current-formats), then regeneration.

Thingi10K accepts model IDs or indexed Thingiverse links, never arbitrary download
URLs. Its pinned HTTPS mirror/cache and network requirements are described in the
[skill manual](../../skills/thingi10k/SKILL.md), which also owns limits, absent-model
fallback, per-download chat notices and attribution.

The experimental [pipe-cladding](../../skills/pipe-cladding/SKILL.md) demo and
`denso-vs068a4-rc8a` use the same tools. Installation setup remains unresolved;
synthetic calibration is not hardware configuration. Legacy `compile_plan`,
`validate_plan`, `post_process` and `list_operations` are unsupported, as are
revision-only approvals and a global live-session plan. `get_approval_status`
requires a saved bundle; `request_review.startAt` is tour-only.

SDK subprocess integration coverage is available below. Select checks under
[Avoid check spirals](../../BUILDERS.md#avoid-check-spirals); these commands add no
separate verification pass.

```sh
node --test core/tests/mcp.test.mjs core/tests/mcp-access.test.mjs
```

Tests use isolated temporary Prints roots and synthetic approval records written
by test fixtures outside the adapter protocol. They never approve a real print.
