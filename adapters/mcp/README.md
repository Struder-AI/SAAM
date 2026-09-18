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
Every call selects a persistent `printId` relative to that root. Up to three
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
| `list_machines`, `list_skills`, `read_skill` | Read this checkout's known profiles and manuals. Skill entries distinguish printing patterns from task skills such as mesh tools. These small fixed lists are not an automatic discovery or installation system. |
| `read_guidance` | Read a published Markdown path, optionally ending in `#heading`, or a short ID: `makers`, `development`, `glossary`, `mcp`, `print-tools`. The response resolves documentation links into IDs for further reading. |
| `get_plan_template` | Read a complete proposed shell recipe, reusing remembered setup. |
| `create_print` | Initialize a new unapproved bundle, optionally from a complete recipe. |
| `import_stl_print` | Read an absolute local `.stl` source path with optional `auto` (default), `mm` or `inch` units; preserve its bytes/hash and use the shared CLI importer and remembered setup. Sources are limited to 64 MiB. |
| `search_thingi10k` | Search descriptive keywords, a numeric file ID or a Thingiverse thing URL in the mirror. Returns per-file source/license links and pagination. Read the [Thingi10K manual](../../skills/thingi10k/SKILL.md). |
| `import_thingi10k_print` | Download `fileId` on the SAAM host into a new `printId`, with `machineId` and optional `units`. Return attribution and the mandatory chat license notice, including when strict import fails. Review successful imports with `request_review`. |
| `list_prints`, `get_print` | `list_prints` discovers names and machines with `programChecked:false`; it does not validate exports. `get_print` reads checked status/recipe, omitting geometry and marking `planComplete:false` unless `includeGeometry:true` is supplied. Neither returns motion arrays. |
| `begin_studio_work`, `respond_to_studio_request` | Start work with kind `edit` or `guidance`, supplying `studioInstanceId` when several Studios are open. After saving an edit, bind its result using status `working` and `resultStage` (`geometry`/`toolpath`); use `waiting` when paused for input. Complete after guidance or the displayed result. Overlapping work stays independent. |
| `set_stl_units` | Correct a plain imported mesh to `mm` or `inch` with current `expectedRevision`; retains mesh edits/source bytes and invalidates final review. |
| `wait_for_studio_request`, `get_studio_requests` | Receive live Studio requests with bounded event waits, or inspect durable recovery/history state. Optional `studioInstanceId` scopes a wait; `claim:true` marks returned requests working in the same call. The wait also ends on a delivered Studio event and returns the drained `events`. Runs outside the print-work queue. This does not wake an ended or disconnected chat. |
| `get_studio_events` | Read and clear the [Studio event queue](../../studio/README.md#studio-event-queue): what the person did in this agent's Studio instances, plus `generation` progress for any instance still calculating. Delivered events also arrive as `studioEvents` on every tool result and as `saam.studio` notifications. Optional `history` includes recently read events. |
| `get_studio_sessions`, `close_studio_session` | List or close this agent's explicitly owned Studio instances. One agent may own several; no Studio instance is shared between agents. |
| `get_tour` | Read tour progress and the next maker-agent chat instruction. Optional `after` cursor and `waitMs` wait for a change for up to 25 seconds. |
| `set_tour_start_at` | Set explicit `{startAt:{layer:12}}` for the playback lesson; choose a layer with sparse infill. |
| `change_machine` | Change printer with current `expectedRevision`, using remembered/default setup and shared compatibility checks. Final review is invalidated. |
| `adjust_print` | Apply a recipe patch with the latest `expectedRevision` from state. |
| `apply_text` | Add, edit or remove text geometry using the [text skill](../../skills/text/SKILL.md), a local font and current `expectedRevision`. Reuses the shared preparation and review lifecycle. |
| `heat_set_catalog` | Read packaged heat-set insert IDs and dimensions before choosing a profile. |
| `apply_heat_set` | Add, edit or remove insert holes with six loops and connecting fins using the [heat-set insert skill](../../skills/heat-set-inserts/SKILL.md) and current `expectedRevision`. Reuses the shared preparation and review lifecycle. |
| `check_print` | Revalidate native geometry, plan and any stored export; no generation. |
| `check_path` | Check path feasibility through the shared generator without approvals or persisted artifacts; production export/review are still required. |
| `remember_setup` | Save this print's setup as editable defaults for the next print, shared with the CLI. |
| `request_review` | Start/reuse an exclusively owned Studio for this print and return its instance ID and loopback URL. Supply `studioInstanceId` to rebind an existing owned instance, or `newInstance:true` to open another instance for the same bundle. |
| `get_approval_status` | Read the hash-bound final settings/toolpath confirmation from disk as `toolpathApproved`, the only approval state print summaries report. |
| `generate_print` | Generate and check the machine export from current geometry and complete settings, including during a tour; no development-mode bypass. |
| `deliver_print` | Copy the exact current approved export into the print's delivery directory. |

The [shared print-tool manual](../../core/print/USAGE.md) owns importing,
recipe adjustments, setup reuse, reopening and delivery. Read it through
`read_guidance` with `guidanceId: "print-tools"`; individual pattern manuals own
their settings and limits. Mesh diagnostics route to the
[mesh-tools manual](../../skills/mesh-tools/SKILL.md). Mesh repair currently runs
through the local CLI; this adapter exposes STL import, with no repair tool.

Manual responses include their repository-relative `path`, available `headings`,
and `links` whose `guidanceId` values can be passed straight to `read_guidance`.
For example, `core/export/griffin.md#s5-startup-observations` reads that section
and its subsections. This follows the same Markdown files as a local collaborator.
The reader accepts public root manuals and Markdown in the component, skill,
Studio, machine, adapter and script trees. Private/hidden paths, dependencies,
build output, source code, traversal and filesystem links are unavailable.
The selected skill's links provide the normal reference route.

For a tour request in a client with command access, first run
`node studio/server.mjs --toolkit start-tour --no-open`, open its Studio URL,
then use its returned context and listener. Do not precede that launch with
`read_guidance`, skill reads or onboarding. This is the local CLI tour route;
the MCP adapter does not expose a tour-start tool.

For ordinary new-part work with command access and missing maker context, run
`node scripts/agent-toolkit.mjs maker-onboarding` once. It supplies MAKERS, the
complete skill digest and shared print tools. In an MCP-only client, read those
missing sources through `read_guidance`. Reuse supplied/current context in either
case, choose and read the relevant skill manuals individually, create the first
reasonable geometry, and call
`request_review`. Studio opens in the default browser where available; the
returned URL remains usable if browser launch fails. Set `SAAM_NO_AUTO_OPEN=1`
for tests or a headless client. Studio servers are owned by the MCP process,
use free loopback ports, and close 30 minutes after the last viewer tab
disconnects (with a grace period for refresh), or when the owning stdio client
disconnects. There is no deadline to open the first viewer.
Repeated review requests use the print's preferred still-open server within this
adapter; an explicit instance ID can rebind any other owned server. After it
closes, review starts a fresh instance from the saved bundle. Closing a
viewer leaves the MCP connection and its other viewers running. Separate adapter
processes never adopt each other's Studio sessions. One adapter may own several
Studio instances, and the same print bundle may be opened by separately owned
instances. MCP transport closure marks
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
Prints root. A bundle that fails current-version validation is recreated from its
skills; nothing migrates it, silently or explicitly.

Thingi10K tools additionally read a pinned public mirror over HTTPS and cache its
metadata/downloads under the configured Prints root's `.thingi10k/` folder. They
accept model identifiers, not arbitrary download URLs. A Thingiverse link is
looked up in that index; it is not scraped or downloaded directly. The
[task manual](../../skills/thingi10k/SKILL.md) owns limits, absent-model fallback,
per-download chat notices and attribution. This works for an MCP-only client
when the SAAM host can reach Hugging Face and its CDN.

Use `create_print` / `adjust_print`, the shared approvals and `generate_print`;
`check_print` verifies the persisted print and `deliver_print` delivers its
checked export. Legacy `compile_plan`, `validate_plan` and `post_process`
are unsupported.
The fixed catalog also includes `denso-vp6242-rc8` and
[pipe-cladding](../../skills/pipe-cladding/SKILL.md). This experimental rotary
demo uses the same tools and Studio. Actual installation setup is unresolved;
synthetic development calibration is not a hardware configuration.

The known-manual list supplies operation guidance; legacy `list_operations`
is unsupported. `get_approval_status` requires a persisted print ID. `request_review` also
accepts the tour-only `startAt` parameter. Revision-only approvals and a global live-session plan
are unsupported.

SDK subprocess integration coverage is available below. Select checks under
[Avoid check spirals](../../BUILDERS.md#avoid-check-spirals); these commands add no
separate verification pass.

```sh
node --test core/tests/mcp.test.mjs core/tests/mcp-access.test.mjs
```

Tests use isolated temporary Prints roots and synthetic approval records written
by test fixtures outside the adapter protocol. They never approve a real print.
