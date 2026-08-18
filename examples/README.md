# Examples

## `compile-approve-export.mjs`

A real, runnable walkthrough of SAAM's full loop — discover, compile,
approve, export — with no agent required. It talks to the actual MCP
adapter over real stdio protocol (the same way any MCP-capable agent
would) and stands in for the one manual step a human normally does in
the reference workbench's own UI by calling the exact same approval
function the workbench calls.

```bash
npm install   # from the repository root, if you haven't already
node examples/compile-approve-export.mjs
```

Prints each step as it happens: the discovered machine and operations,
the composed plan's revision and path count, the approval record, an
approval-status check, and the real generated DobotStudio Pro Lua. This
is a script standing in for a human's approval click, not a way around
the approval gate — `machines/reference-dobot-mg400-struderbot/postprocessor/generator.mjs`
still refuses to translate anything that doesn't carry a real approval
record bound to the plan's current revision, regardless of who or what
built that record.

To see the same `compile_plan` call open the live reference workbench
instead — the normal, human-in-the-loop path — connect your own agent
to the adapter per the top-level `README.md`'s quickstart rather than
running this script; it deliberately sets `SAAM_NO_AUTO_OPEN=1` so it
doesn't pop a browser tab of its own.
