# SAAM Reference Workbench

A local 3D inspection and approval interface for SAAM process plans. It
loads the same process-plan data used for post-processing
(`schemas/process-plan/process-plan.schema.json`), renders synchronized
previews, is where a request gets handed to a connected agent, and is the
one place in this reference toolchain where a human can actually create
an approval record.

## What changed from the private prototype this was adapted from

The prototype this was built from embedded a chat panel wired to one
specific local Codex-backed HTTP service. That specific coupling is
gone, but the interaction it enabled is not — see "Sending a request"
below. Also dropped: the unused Cloudflare D1/`chatgpt-auth.ts` starter
boilerplate the prototype carried but never used, and the draggable
workspace splitters (nice-to-have UI complexity, cut to keep this port
reviewable). Everything else — the machine selector, the three
synchronized rotating Canvas previews, the build-history rail, the
conversation panel, the bottom request/export strip — matches the
original layout; this needed to look like the interface already
designed, not a reinterpretation of it.

## Sending a request

The prompt box at the bottom left is real, not a passive notes field.
Submitting a message appends it to the open plan's conversation
transcript — the same `conversation.transcript` a `.json` file can be
loaded with (see `src/lib/plan.mjs`'s `WorkbenchFile` shape in
`App.tsx`). This workbench does not call a model itself and holds no
provider API key: it hands the request off by writing it where an
MCP-connected agent can read it. Until the MCP adapter (a separate,
not-yet-built piece of this project) actually exists to relay that,
the status strip shows an honest "Agent: not connected" indicator
rather than faking a response — the box is built ready for that
connection, not simulating one that doesn't exist yet.

## Machine selection

The dropdown in the top right is a real constraint, not a label: it's
what a new request would be composed against, and it's checked against
whatever machine a loaded plan actually resolved for (a mismatch shows
in the status strip rather than being silently ignored). Only
`reference-dobot-mg400-struderbot` has a real manifest today; the four
other machines listed are ROADMAP.md's named placeholders, shown and
disabled rather than hidden, so the roadmap is visible in the same
place a funder would look for it.

## Approval and export

Approving a revision computes a SHA-256 content hash (Web Crypto, no
dependency) over the plan's manufacturing content and attaches an
approval record scoped to `geometry` or `executable-export`. Editing or
reloading the plan changes its revision, which silently invalidates
that approval — the export panel checks this on every render, not just
at approval time. Export calls the real `dobot-lua-postprocessor`
generator directly — the identical module `tests/golden` exercises,
imported from
`machines/reference-dobot-mg400-struderbot/postprocessor/generator.mjs`,
not a reimplementation. It only runs once a plan carries a matching
`executable-export` approval; the post-processor's own safety gate
would refuse it anyway even if the UI check were somehow bypassed.

## Running it

```bash
npm install
npm run dev
```

Verified: `npm install`, `npm run build`, and a live browser pass
(load a plan with a transcript, approve it, generate real Lua) all
completed cleanly with zero console errors as of the commit that added
this line. Two real bugs were found and fixed only by that live
testing — a CSS sizing loop that made the canvases grow without bound,
and a React 19 quirk that silently broke scroll-to-zoom — neither was
visible from reading the code alone.

## Known gaps

- The "Building Skills" / "Machine Definitions" library views from the
  private prototype are not ported yet — they'd need real data from
  `registry/`, which doesn't exist until that's built.
- Only one machine (`reference-dobot-mg400-struderbot`) has a registered
  post-processor in this interface. Loading a plan resolved against a
  different machine shows an honest "no post-processor registered" state
  rather than pretending to export it.
- Sent requests are appended to the transcript locally; nothing consumes
  them yet. The MCP adapter is what turns that from "ready" into "live."
