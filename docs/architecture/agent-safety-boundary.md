# Agent Safety Boundary

What `adapters/mcp/` will and won't do, and why, for anyone deciding
whether it's safe to point their own agent at it.

## What it does

- Discovery (`list_machines`, `list_operations`): reads manifests from
  the local filesystem.
- Generation (`compile_plan`): runs the same deterministic generator
  functions `tests/golden` exercises, writes the result to a local file,
  and returns it.
- Review requests (`request_review`): writes a plan to the same local
  location and returns instructions for a human to open it in the
  reference workbench.
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
- **It has no network surface.** This adapter runs over stdio only — the
  same mechanism Claude Code and other MCP clients use to launch local
  tools as a subprocess. There is no HTTP port, no loopback service to
  misconfigure, nothing to expose beyond what the parent process's
  stdin/stdout already carries. (This differs from the private
  prototype this project grew out of, which used a loopback-bound HTTP
  service — stdio removes that whole surface rather than hardening it.)
- **It does not start hardware or transmit machine commands.** The
  furthest this adapter reaches is generating text files
  (`global.lua`, `src0.lua`, `src1.lua`) for a human to paste into
  DobotStudio Pro themselves. Nothing here has a serial port, a network
  socket to a controller, or any other path to a physical machine.

## Filesystem reach

`compile_plan` and `request_review` write to `.saam/plans/` under the
repository this adapter is running from (gitignored). That's the only
filesystem write this adapter performs. It does not read or write
anywhere else, and does not accept a path from tool arguments to write
to — the destination is fixed, not attacker- or model-controllable.

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
