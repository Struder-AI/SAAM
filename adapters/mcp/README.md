# SAAM MCP Adapter

The initial adapter for SAAM — see `ROADMAP.md`'s "Decision A" for why
MCP over a Codex-specific or CLI-only adapter: it's the option that
works with whatever agent is pointed at it, without SAAM hosting or
paying for anyone's compute. See
`docs/architecture/agent-safety-boundary.md` for exactly what this
adapter does and does not do before connecting it to anything.

## What it exposes

Seven tools, all verified end-to-end in `tests/integration/mcp-adapter.test.mjs`
(a real subprocess speaking real MCP protocol, not a mock):

| Tool | Does |
|---|---|
| `list_machines` | Discovers `machines/*/manifest.json` |
| `list_operations` | Discovers `operations/**/manifest.json` |
| `compile_plan` | Runs the real generators for named operation invocations, publishes the result as the reference workbench's live session (opening it in the operator's browser the first time), also writes it to `.saam/plans/` |
| `request_review` | Publishes an existing plan (e.g. edited outside `compile_plan`) as the live session the same way |
| `validate_plan` | Structural shape check against the process-plan schema |
| `get_approval_status` | Reports whether a plan currently carries a valid approval for a given scope |
| `post_process` | Translates an **approved** plan to native output; refuses otherwise |

None of them call a model, hold a credential, or can create an approval.
`compile_plan` and `request_review` are also the only two with any
network surface at all — a small loopback-only HTTP bridge
(`src/http-bridge.mjs`) that serves the workbench's built static files
and a same-origin session API. See
`docs/architecture/agent-safety-boundary.md` for exactly what that
bridge does and does not expose.

## Connecting it to an agent

This currently requires a local checkout of the SAAM repository — the
adapter discovers operations and machines by real filesystem paths
(`registry/discover.mjs`), not by bundling them into this package. From
the repository root:

```bash
npm install
```

Then point your MCP client at:

```json
{
  "mcpServers": {
    "saam": {
      "command": "node",
      "args": ["adapters/mcp/src/server.mjs"],
      "cwd": "/absolute/path/to/your/SAAM/checkout"
    }
  }
}
```

(For Claude Code specifically: `claude mcp add saam -- node adapters/mcp/src/server.mjs`,
run from the repository root.)

## The end-to-end loop

1. Build the workbench once so the bridge has something to serve:
   `cd interfaces/reference-workbench && npm run build`.
2. Ask your agent — in its own chat, not this adapter — to call
   `list_operations` and `list_machines`, then `compile_plan` with the
   part you want. The first `compile_plan` call opens your browser to
   the live workbench automatically, already showing what was built; no
   file to go find, no "Open plan…" click needed.
3. Review the synchronized 3D previews. If it's right, click "Approve
   for export" — that writes the approval back to the adapter's session
   directly, so nothing needs saving or copying anywhere.
4. Ask your agent to call `post_process`, passing the same plan (or ask
   it to call `get_approval_status` first if it wants to confirm the
   approval landed) — it reads the just-approved session and returns
   real DobotStudio Pro Lua.

Composing more operations works the same way: call `compile_plan` again
with the complete updated operation list, and the already-open workbench
tab updates to show the new revision — still no manual file handling.
Step 3 is deliberately a human action in a different piece of software,
not a tool call — see `docs/authoring/process-plan-workflow.md` for why
that gate exists.

## Known limitations

- **Not yet a standalone published package.** Running it requires a
  local SAAM checkout; `npx saam-mcp` from outside one won't find
  `operations/`, `machines/`, or `schemas/`. Publishing a real standalone
  package would need a build step that bundles that content (and the
  workbench's own build output) into this package rather than
  referencing sibling directories.
- **Only one machine has a registered post-processor** in this adapter:
  `reference-dobot-mg400-struderbot`. `post_process` refuses cleanly for
  any other machine id rather than pretending to support it.
- **One live session at a time.** The bridge holds exactly one "current"
  plan; there's no multi-project or multi-tab session model yet. A
  second `compile_plan` call replaces what the workbench is watching
  rather than opening a second one.
- **Polling, not push.** The workbench checks for updates roughly every
  1.5 seconds rather than being notified instantly. Fine for how fast an
  agent actually composes operations; noticeable if you were expecting
  sub-second updates.

## Development

```bash
npm test   # from the repository root — runs both unit and integration suites
```
