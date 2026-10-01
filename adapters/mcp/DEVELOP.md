# MCP implementation

Adapter boundaries and integration tests. [The adapter manual](README.md)
owns client configuration and tool usage; [the print lifecycle](../../core/print/README.md)
owns manufacturing state.

The [Cloudflare relay milestone plan](RELAY-PLAN.md) specifies future packaged
deployment and active Studio-driven web-chat sessions. It is planning context,
not an account of the current adapter's capabilities.

## Local MCP access

Fixed profiles/skills follow [D-022](../../DECISIONS.md#d-022--defer-automatic-capability-discovery); manufacturing state belongs to the shared lifecycle.
[The local runtime](src/runtime.mjs) owns every operation, its strict schema,
the print-work queue and the Studio/request state. It outlives its sessions: one
is active at a time, an ended session fails its unfinished requests and rejects
late calls, and Studio stays for the next. [The MCP server](src/server.mjs) is one
session per connection; stdio owns and closes its runtime. [The relay device](src/relay-device.mjs)
serves chat sessions from [the relay](../../relay/README.md) the same way.

[The shared manual reader](../../core/agent/manuals.mjs), re-exported by
[the adapter](src/manuals.mjs), accepts published repository Markdown paths and
assembles them by [context layer](../../core/agent/README.md#context-layers) with
repository-path links, confined to the public documentation trees without
private locations or filesystem links. A heading fragment selects one section.
The fixed skill catalog distinguishes toolpath, geometry and hybrid skills;
Readable manuals do not register operations. The [catalog](../../skills/catalog.mjs)
owns IDs/frontmatter and the maker digest. Tool schemas use named local JSON Schema
definitions through the installed SDK/Zod serializer; all tools remain discoverable.
Reading one shared manual checks that catalog directly and reads only the selected
manual. Unknown shared IDs may resolve through the configured local extension.
`list_bundles` returns discovery metadata with `programChecked: false`; it does not
read native geometry or exports. `get_bundle`, `check_bundle` and approval status
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
[The catalog](../../skills/catalog.mjs) distinguishes the three primitives,
extensions and guidance. Extension manuals use `metadata.saam-kind: extension`.

`apply_text`, `apply_heat_set` and `gridfinity` use the shared
[extension edit lifecycle](../../core/print/extension-edits.mjs): scripts return
recipe values; the caller checks revisions and commits through the bundle.
Thingi10K returns downloaded assets to the shared resource importer.

`core/tests/mcp.test.mjs` uses actual SDK clients and child processes, temporary
bundles and synthetic approval fixtures outside the adapter protocol.
