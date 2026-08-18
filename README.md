# SAAM — Struder Agentic Additive Manufacturing

SAAM lets a conversational AI agent directly program your 3D printer.
(It is also good for turning other programmable motion systems into 3D printers - like robot arms and CNC machines)

Chat with your agent to conversationally set your manufacturing intent and dictate how you want your toolpaths to work.
See a preview of what you have developed in our workbench and send it to your device for printing.  No CAD or CAM

SAAM runs in YOUR agentic AI account — It turns conversational manufacturing intent into an
inspectable process plan, hands it back to you for approval, then it translates that plan into machine-native output. 

No slicer GUI, no proprietary plugin, no service to sign up for. 

See `PROJECT_CHARTER.md` for what
SAAM is and, just as deliberately, what it isn't.

## Try it

This requires a local checkout — the adapter discovers operations and
machines by real filesystem paths, and there's no published standalone
package yet (see `adapters/mcp/README.md`'s known limitations).

```bash
git clone https://github.com/Struder-AI/SAAM.git
cd SAAM
npm install
cd interfaces/reference-workbench && npm run build && cd ../..
```

Then connect the MCP adapter to your own agent. For Claude Code:

```bash
claude mcp add saam -- node adapters/mcp/src/server.mjs
```

(Any MCP-capable agent works — see `adapters/mcp/README.md` for the
generic client config.) In your agent's own chat, not this repo, ask it
to call `list_operations` and `list_machines`, then `compile_plan` for a
part. The first `compile_plan` call opens the reference workbench in
your browser automatically, already showing what was built — review the
synchronized 3D previews, name and click "Export" (this is the human
approval step — it's the one thing in this whole loop nothing but a
person clicking a real button in their own browser can do), and ask your
agent to call `post_process` for real DobotStudio Pro Lua. Composing more
operations works the same way: call `compile_plan` again with the
updated operation list, and the already-open tab updates in place.

Don't have an agent handy, or just want to see real output without
connecting one? `node examples/compile-approve-export.mjs` runs the same
loop — including the approval step — end to end and prints the result,
no browser or agent required. See `examples/README.md`.

Using this checkout to build your own part never involves committing or
pushing anything back to this repository — the deliverable is the
exported machine file on your own disk. Nothing about the loop above
touches this checkout's git history, and your agent shouldn't either.

## What runs where

The reasoning happens in your agent, on your account. SAAM never calls
a model and never holds a credential — see
`docs/architecture/agent-safety-boundary.md` for exactly what the
adapter does and does not do, including the one deliberate, narrowly
loopback-only exception that lets the workbench watch a live session.
Only a human, acting through the workbench's own UI, can create an
approval record; nothing here can approve its own output.

## Layout

| Path | What's there |
|---|---|
| `AGENTS.md` | What a connected agent should actually do here — the tool-call sequence, the rules that never bend, where to read more. `CLAUDE.md` just points here. |
| `PROJECT_CHARTER.md` | Mission, scope, non-goals, governance, licensing |
| `ROADMAP.md` | Planar-operation catalog brainstorm, designated future machines |
| `schemas/` | Process-plan and manifest JSON Schemas, plus the shared plan-hashing/approval library |
| `operations/` | Machine-independent operation generators (`layer-filling`, `non-planar-cladding`) |
| `machines/` | Machine definitions and their post-processors (`reference-dobot-mg400-struderbot`) |
| `adapters/mcp/` | The MCP adapter — seven tools, no model calls, no held credentials |
| `interfaces/reference-workbench/` | The live-connected 3D preview and approval UI |
| `registry/` | Filesystem-based discovery of operations, machines, and post-processors, plus the generated `registry.json` conformance snapshot (`npm run generate-registry`) that `PROJECT_CHARTER.md`'s governance section refers to |
| `examples/` | `compile-approve-export.mjs` — the full compile-approve-export loop, runnable with no agent |
| `docs/` | Architecture and authoring documentation |
| `tests/` | Golden-fixture and real-subprocess-MCP-protocol tests |

## Evidence and safety posture

SAAM distinguishes what's been observed on physical hardware from
what's been documented, simulated, or merely proposed —
`docs/authoring/evidence-labels.md` defines the label set every
operation and machine definition uses. A passing software validation or
a clean preview confirms intent and coordinates; it is never treated
here as proof that a specific physical setup is safe to run.

## Development

```bash
npm test   # from the repository root — golden fixtures + real subprocess MCP integration tests
```

## License

[Apache License, Version 2.0](LICENSE) — see `PROJECT_CHARTER.md` for
what that does and doesn't mean for your own generated parts, toolpaths,
and workflow records. Imported third-party material is tracked in
`THIRD_PARTY_NOTICES.md`.
