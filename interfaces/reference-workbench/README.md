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

Live mode: clicking "Approve for export" `POST`s to the adapter's
`/api/session/approve`, which builds the approval record through the
exact same `schemas/process-plan/plan-lib.mjs` function a standalone
approval uses, attaches it to the session, and the response becomes
this tab's new state — no export/import step. Standalone mode: the same
function runs locally instead. Either way: a SHA-256 content hash (Web
Crypto, no dependency) over the plan's manufacturing content, scoped to
`geometry` or `executable-export`; any later edit changes the revision
and silently invalidates that approval, checked on every render, not
just at approval time.

Export calls the real `dobot-lua-postprocessor` generator directly —
the identical module `tests/golden` exercises — and only runs once the
plan carries a matching `executable-export` approval; the
post-processor's own safety gate would refuse it anyway even if this
check were bypassed.

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
