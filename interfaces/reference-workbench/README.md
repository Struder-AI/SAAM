# SAAM Reference Workbench

A local, read-only 3D inspection interface for SAAM process plans. It
loads the same process-plan data used for post-processing
(`schemas/process-plan/process-plan.schema.json`), renders synchronized
previews, and is the one place in this reference toolchain where a human
can actually create an approval record.

## What changed from the private prototype this was adapted from

The prototype this was built from embedded a chat panel wired to one
specific local Codex-backed agent service. That coupling is gone. This
interface has no opinion about which agent, if any, produced the plan it
loads — per the launch decision to make MCP the initial adapter, a plan
can come from any MCP-capable agent running on its own account, and this
workbench's only job is to load, inspect, and gate that plan's approval.
Also dropped: the unused Cloudflare D1/`chatgpt-auth.ts` starter
boilerplate the prototype carried but never used, and the draggable
workspace splitters (nice-to-have UI complexity, cut to keep this port
reviewable).

Kept and adapted: the three synchronized rotating Canvas previews
(finished part / collective toolpath / current operation), the
build-history rail with layer scrubbing, and the SAAM brand's visual
language.

## What's new

- **Open plan…** loads a `.json` file against
  `src/lib/plan.mjs`'s structural validator — not full JSON Schema
  validation (see its own header comment), but enough to protect the UI
  from an obviously malformed file.
- **Human approval** is a real, working gate, not a mockup. Approving a
  revision computes a SHA-256 content hash (Web Crypto, no dependency)
  over the plan's manufacturing content and attaches an approval record
  scoped to `geometry` or `executable-export`. Editing or reloading the
  plan changes its revision, which silently invalidates that approval —
  the export panel checks this on every render, not just at approval
  time.
- **Export** calls the real `dobot-lua-postprocessor` generator directly
  — the identical module `tests/golden` exercises, imported from
  `machines/reference-dobot-mg400-struderbot/postprocessor/generator.mjs`,
  not a reimplementation. It only runs once a plan carries a matching
  `executable-export` approval; the post-processor's own safety gate
  (see its `generator.mjs`) would refuse it anyway even if the UI check
  were somehow bypassed.

## Running it

```bash
npm install
npm run dev
```

`npm install` has not been run in the environment this was authored in
(no `npm` was available), so this has been reviewed carefully by hand
and by a full manual read-through, but **not build-verified**. Run
`npm run build` after installing and treat the first real build as the
actual verification step; report anything it surfaces.

## Known gaps

- The "Building Skills" / "Machine Definitions" library views from the
  private prototype are not ported yet — they'd need real data from
  `registry/`, which doesn't exist until that's built.
- Only one machine (`reference-dobot-mg400-struderbot`) has a registered
  post-processor in this interface. Loading a plan resolved against a
  different machine shows an honest "no post-processor registered" state
  rather than pretending to export it.
