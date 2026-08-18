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
| `compile_plan` | Runs the real generators for named operation invocations, writes the result to `.saam/plans/`, returns it |
| `request_review` | Writes an existing plan to `.saam/plans/` with instructions to open it in the reference workbench |
| `validate_plan` | Structural shape check against the process-plan schema |
| `get_approval_status` | Reports whether a plan currently carries a valid approval for a given scope |
| `post_process` | Translates an **approved** plan to native output; refuses otherwise |

None of them call a model, hold a credential, or can create an approval.

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

1. Ask your agent to call `list_operations` and `list_machines`, then
   `compile_plan` with the part you want.
2. Open the file `compile_plan` reports (`writtenTo`) in the reference
   workbench (`interfaces/reference-workbench/`, `npm run dev`) — "Open
   plan…".
3. Review the synchronized 3D previews. If it's right, approve it there
   — "Approve for export".
4. Save the approved plan and hand its path back to your agent (or paste
   its JSON), which can then call `post_process` and get real
   DobotStudio Pro Lua.

Step 2–3 is deliberately a human action in a different piece of
software, not a tool call — see
`docs/authoring/process-plan-workflow.md` for why that gate exists.

## Known limitations

- **Not yet a standalone published package.** Running it requires a
  local SAAM checkout; `npx saam-mcp` from outside one won't find
  `operations/`, `machines/`, or `schemas/`. Publishing a real standalone
  package would need a build step that bundles that content into this
  package rather than referencing sibling directories.
- **Only one machine has a registered post-processor** in this adapter:
  `reference-dobot-mg400-struderbot`. `post_process` refuses cleanly for
  any other machine id rather than pretending to support it.
- **No "save approved plan back to a shared location" step yet.** The
  workbench can save a `.saamproj`-style file, but there's no automatic
  hand-back to the calling agent — a human currently relays the approved
  file or its content manually. Closing that loop without adding a
  network surface (see the safety-boundary doc) is open work.

## Development

```bash
npm test   # from the repository root — runs both unit and integration suites
```
