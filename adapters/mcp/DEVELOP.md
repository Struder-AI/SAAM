# MCP implementation

Adapter boundaries and integration tests. [The adapter manual](README.md)
owns client configuration and tool usage; [the print lifecycle](../../core/print/README.md)
owns manufacturing state.

The [Cloudflare relay milestone plan](RELAY-PLAN.md) specifies future packaged
deployment and active Studio-driven web-chat sessions. It is planning context,
not an account of the current adapter's capabilities.

## Local MCP access

The adapter uses fixed known profiles and skills under [D-022](../../DECISIONS.md#d-022--defer-automatic-capability-discovery). It delegates manufacturing state to the shared print lifecycle.
[The local runtime](src/runtime.mjs) owns every operation, its strict schema,
the print-work queue and the Studio/request state. It outlives its sessions: one
is active at a time, an ended session fails its unfinished requests and rejects
late calls, and Studio stays for the next. [The MCP server](src/server.mjs) is one
session per connection; stdio owns and closes its runtime.

[The shared manual reader](../../core/agent/manuals.mjs), re-exported by
[the adapter](src/manuals.mjs), accepts published repository Markdown paths
and returns the document's own links as resolved IDs. New references therefore
use ordinary links without a parallel per-document registry. It confines reads
to the public documentation trees and rejects private locations and filesystem
links. Optional heading fragments select one section, including its subsections.
The fixed skill catalog distinguishes geometry skills from toolpath skills;
making a manual readable does not register a new plan operation or MCP tool.
Its IDs and frontmatter reader come from the shared [skill catalog](../../skills/catalog.mjs),
which also supplies the generated maker digest.
Reading one shared manual checks that catalog directly and reads only the selected
manual. Unknown shared IDs may resolve through the configured local extension.
`list_prints` returns discovery metadata with `programChecked: false`; it does not
read native geometry or exports. `get_print`, `check_print` and approval status
read checked program metadata without copying motion arrays. Edit dispatch reads
geometry/settings without checking the export it is about to invalidate.
Unchecked generated-program currency is `null`; an unchecked existing toolpath
approval is also `null`. Explicit check and delivery retain exact-byte checks.
The agent-owned request store directly connects MCP to all Studio instances it
created. Direct subscriptions drive notifications and event-based waits; the
rebuildable JSON index is restart and independent-process recovery. `history: true`
on `get_studio_requests` explicitly selects full history. Print tools accept
`requestIds` to bind real tool activity to owned work. Only those working requests
receive contact renewal at entry/exit; listener waits and unrelated calls do not.
`get_studio_sessions`, `request_review.studioInstanceId` / `newInstance` and
`close_studio_session` explicitly manage the one-agent-to-many-Studio relation;
`request_review` without either rebinds the instance showing the print, else the
sole live instance, so switching prints opens no second Studio;
an instance never crosses adapter ownership, while print bundles remain shared.
Tour start-layer writes require the run and lesson identities they were prepared
for. See [coordination and its concurrency limits](../../studio/README.md#agent-request-coordination).
Geometry skill manuals identify themselves with `metadata.saam-kind: geometry` in their
frontmatter; toolpath skill manuals keep the default `toolpath` kind.

`apply_text` delegates to [shared text preparation](../../core/print/text.mjs),
including local font reading, stale-revision checks and geometry updates. The
adapter does not own a separate text schema, boolean pipeline or approval route.

`apply_heat_set` delegates to [shared insert preparation](../../core/print/heat-set.mjs)
with the same revision and geometry lifecycle. `heat_set_catalog` exposes the
skill's packaged insert profiles; geometry and feature validation stay at the
shared preparation and skill owners.

`core/tests/mcp.test.mjs` uses actual SDK clients and child processes, temporary
bundles and synthetic approval fixtures outside the adapter protocol.
