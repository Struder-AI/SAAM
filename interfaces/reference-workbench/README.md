# SAAM Reference Workbench

A control panel for inspecting and approving SAAM process plans:
synchronized 3D previews, build-history navigation, and the one place in
this toolchain where a human can actually create an approval record. It
does not run a conversation — that happens in whichever agent you're
using, in that agent's own interface. This workbench is what that
agent's work looks like once it's real.

## What changed from the private prototype this was adapted from

The prototype this was built from embedded its own chat panel, wired to
one specific local Codex-backed service — describing a part and
approving it both happened inside the same window. That model doesn't
fit an MCP-first design: the conversation belongs in whatever agent has
the SAAM MCP server connected (Claude Code, Claude Desktop, anything
else), not duplicated into a second chat box here. Two real iterations
happened before landing on this:

1. First pass: ported the layout faithfully, including the chat panel,
   but wired its input to nothing.
2. Second pass (this one): recognized that was backwards — the chat
   panel doesn't belong here at all once an agent can talk to SAAM
   directly through `adapters/mcp/`. Removed it, along with the "select
   a machine before composing a request" workflow that assumed a
   request gets built in this UI — it doesn't anymore. What's left is a
   **live-connected viewer**: `adapters/mcp/`'s `compile_plan` publishes
   directly to this workbench's session, no exported file, no manual
   "Open plan…", the browser tab updates automatically as an agent
   composes operations.

Also dropped from the original prototype: unused Cloudflare
D1/`chatgpt-auth.ts` starter boilerplate, and draggable workspace
splitters (nice-to-have UI complexity, cut to keep this port
reviewable). Kept: the three synchronized rotating Canvas previews, the
build-history rail, and the SAAM brand's visual language.

## Two ways a plan gets here

**Live** (the normal case): `adapters/mcp/`'s HTTP bridge serves this
workbench's own built files and polls-updates it over `/api/session`.
Nothing to click — the tab shows whatever the connected agent last
compiled, and it keeps updating as more operations are composed. The
status strip's "Live session" indicator (green, pulsing orange if the
connection drops) reflects this, not whether an agent happens to be
typing right now — this page can't see that; it only knows whether the
local bridge is reachable.

**Standalone**: open this app on its own (`npm run dev`, or a plain
static host) and there's no bridge to poll. "Open plan…" loads any
`.json` plan file for inspection — a teammate's file, an archived
revision — and approval is computed locally rather than written back to
a session. Still fully real (same hashing, same approval-record shape),
just not shared with anything outside the tab. "Save plan…" produces a
durable, portable copy of what was approved, for either mode — this
project's evidence culture treats an approval record as worth keeping
independent of whatever the live session does next.

## Machine display

The machine name in the top right is a readout, not a selector — the
machine is whatever the live session (or loaded file) actually targets;
there's no "choose a machine, then compose a request" step in this UI
to constrain. `ROADMAP.md`'s four other named machines still appear
disabled in the underlying list, so the roadmap stays visible even
though there's nothing to pick.

## Approval and export

One button: type a file name, click "Export." Approving and exporting
used to be two separate steps — a named approver, a choice between two
approval scopes, then a second click to actually export — but this
workbench only ever does one thing with an approval (use it immediately
to export), so that split was ceremony without a real second decision.
The click itself is still the one real gate a human has to clear:
`exportPlan()` gets (or reuses, if the current revision is already
approved) an `executable-export` approval before translating anything,
through the exact same `schemas/process-plan/plan-lib.mjs` function a
human clicking used to trigger directly — live mode `POST`s it to the
adapter's `/api/session/approve`; standalone mode computes it locally.
Either way: a SHA-256 content hash (Web Crypto, no dependency) over the
plan's manufacturing content; any later edit changes the revision and
silently invalidates that approval, checked on every render, not just at
approval time. `machine-control` and a separate `geometry`-only scope
both still exist in the schema and are checked by `hasCurrentApproval`
exactly like before — this UI just never asks a human to choose between
scopes, since export is the only thing it does with one.

Export calls the real `dobot-lua-postprocessor` generator directly — the
identical module `tests/golden` exercises. Its `warnings` (real defects
like a large travel-with-extrusion-on gap, not just cosmetic notices —
see `machines/reference-dobot-mg400-struderbot/postprocessor/README.md`)
land in the **Output** tab, grouped into large (&ge;5mm, called out
prominently) and small (expected fill-pass transitions) rather than
dumped as one undifferentiated list — the full raw list is still there,
behind a "Show all" toggle, not deleted.

## Workbench / Output tabs

Two pages, not one long scrolling panel. **Workbench** is the live 3D
previews and the Export control. **Output** — disabled until something's
actually been exported — holds the real generated files at full size,
each with Copy (for pasting into DobotStudio Pro directly) and Save (to
the human's own disk, named from the Export tab's file name field) next
to it. A successful export switches to this tab automatically; nothing
about the generated Lua is ever squeezed into a small scrolling box the
way it once was.

## Running it

```bash
npm install
npm run build   # adapters/mcp's bridge serves this build, not the dev server
npm run dev      # for standalone development instead
```

Verified live in a browser, both modes: bridge-served with a real
compiled session (load, approve, export, zero console errors) and
standalone (`Open plan…`, local approval). Three real bugs were found
and fixed only by that live testing, none visible from reading the code
alone: a CSS sizing loop that made the canvases grow without bound, a
React 19 quirk that silently broke scroll-to-zoom, and polling that
silently went quiet after a connection drop instead of saying so.

## Known gaps

- The "Building Skills" / "Machine Definitions" library views from the
  private prototype are not ported yet — they'd need real data from
  `registry/`, which doesn't exist until that's built.
- Only one machine (`reference-dobot-mg400-struderbot`) has a registered
  post-processor in this interface.
- One live session at a time — see `adapters/mcp/README.md`'s known
  limitations for the same constraint from the adapter's side.
