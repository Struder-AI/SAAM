# Agent Safety Boundary

What `adapters/mcp/` will and won't do, and why, for anyone deciding
whether it's safe to point their own agent at it.

## What it does

- Discovery (`list_machines`, `list_operations`): reads manifests from
  the local filesystem.
- Generation (`compile_plan`): runs the same deterministic generator
  functions `tests/golden` exercises, publishes the result as the
  reference workbench's live session (opening it in the operator's
  browser the first time), and also writes it to a local file.
- Review requests (`request_review`): publishes an existing plan as the
  live session the same way, for cases outside `compile_plan`.
- Validation (`validate_plan`) and approval-status reads
  (`get_approval_status`): pure functions over a plan you hand it.
- Post-processing (`post_process`): translates an **already-approved**
  plan into native machine output, enforcing the exact same gate the
  post-processor's own code enforces — see
  `machines/reference-dobot-mg400-struderbot/postprocessor/generator.mjs`.

## What it deliberately does not do

- **It never calls a model.** No provider API key, no outbound request
  to any LLM. The reasoning happens in whichever agent is calling this
  adapter's tools, on that agent's own account. This is what makes it
  usable by "whatever agent" without SAAM hosting or paying for anyone's
  compute — see `ROADMAP.md`'s machine-onboarding note for the same
  principle applied to hardware.
- **It never creates an approval.** Every tool that touches approval
  either reads it (`get_approval_status`) or refuses to proceed without
  it (`post_process`). Only a human, acting through the reference
  workbench's own UI, can create an approval record — see
  `docs/authoring/process-plan-workflow.md`. An adapter that could
  approve its own output would collapse the one gate this whole project
  is built around.
- **It never redesigns geometry.** `compile_plan` restates exactly what
  the named operations' own generators produce; `post_process` restates
  exactly what an approved plan's paths already are. Neither invents or
  adjusts a coordinate.
- **Tool calls happen over stdio only** — the same mechanism Claude Code
  and other MCP clients use to launch local tools as a subprocess.
  Nothing about the *tool protocol* is exposed over a network.
- **The one exception, deliberately scoped:** `compile_plan` and
  `request_review` also start a small loopback-only HTTP bridge
  (`src/http-bridge.mjs`) so the reference workbench can watch and
  approve the live session without manual file export/import. It binds
  to `127.0.0.1` only, never `0.0.0.0`; serves nothing but the
  workbench's own built static files (read-only, path-normalized so a
  crafted request can't escape that directory) plus two endpoints —
  `GET /api/session` (read the current plan) and
  `POST /api/session/approve` (build an approval record through
  `plan-lib.mjs`'s `buildApprovalRecord`, the exact function and rules a
  human clicking the workbench's own button goes through). That POST
  endpoint cannot inject arbitrary plan content — it only approves
  whatever session is already held server-side, and still cannot itself
  authorize `post_process`'s approval check by a different path than a
  human would. This is closer to the private prototype this project
  grew out of (which used a similar loopback HTTP service) than pure
  stdio is, and it's a real, deliberate trade: the alternative was no
  live-updating viewer at all, which turned out to matter more than
  minimizing surface area to zero. Nothing here accepts connections from
  anywhere but the same machine.
- **It does not start hardware or transmit machine commands.** The
  furthest this adapter reaches is generating text files
  (`global.lua`, `src0.lua`, `src1.lua`) for a human to paste into
  DobotStudio Pro themselves. Nothing here has a serial port, a network
  socket to a controller, or any other path to a physical machine.

## Filesystem reach

`compile_plan` and `request_review` write to `.saam/plans/` (one file
per compiled plan) and `.saam/session.json` (the current live session,
overwritten each time) under the repository this adapter is running
from — both gitignored. That's the only filesystem writing this adapter
performs. It does not read or write anywhere else, and does not accept
a path from tool arguments to write to — the destination is always
fixed, never attacker- or model-controllable.

## Trust model

An MCP client connecting this adapter is trusting it the way it would
trust any local tool it launches as a subprocess: same user, same
filesystem permissions, no sandboxing beyond what the OS process
boundary already provides. That's an appropriate amount of trust for
what this adapter actually does (read local manifests, run pure
functions, write to one local directory) — it would not be appropriate
if this adapter also held credentials, controlled hardware, or could
approve its own output, which is exactly the set of things it's
designed not to do.
