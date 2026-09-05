# SAAM Project Charter

**SAAM — Struder Agentic Additive Manufacturing** — lets you describe a part
to an AI agent you already use, inspect what it proposes, approve it, and get
a file your machine can run.

## Why it exists

Getting a part out of a 3D printer means driving a slicer GUI: a specific
program, with its own model of what a printer is, that assumes you have a
mesh and that your machine is a Cartesian FDM printer. That leaves out two
groups. People who know what they want but not CAD. And people whose machine
is a robot arm, a CNC router, or anything else that moves a tool through
space — machines a slicer will not target, though the physics is the same.

Conversational agents can already bridge the first gap. What they lack is a
way to produce real machine output without either hallucinating G-code or
being handed the keys to the hardware. SAAM is that path: the agent reasons,
a human approves, deterministic code translates.

## How it works

1. An agent discovers what operations and machines are available.
2. It composes them into a **process plan** — explicit toolpath geometry,
   which generator produced each part of it, and what evidence backs the
   machine's claimed capabilities.
3. A human reviews that plan in a 3D workbench and approves it. The approval
   is bound to a hash of the plan's content; any change invalidates it.
4. A **post-processor** translates the approved plan into that machine's
   native output — or refuses. It never redesigns approved geometry.

**Operations** are machine-independent: how to fill a layer, how to clad a
slope. **Machine definitions** carry constraints, capabilities, and evidence.
**Post-processors** are the only machine-aware code. That split is what lets
one operation serve a Dobot arm, an Ultimaker, and a CNC router carrying an
extruder.

## The one invariant

**Nothing here can approve its own output.** Approval is created in exactly
one place — a human clicking a button in an interface — and every path to
machine output checks for it. SAAM never calls a model, never holds a
credential, and never transmits a command to hardware.

## What SAAM is not

- **Not a slicer.** It does not compete with PrusaSlicer or Cura and does not
  aim to reimplement them.
- **Not a remote-control platform.** It emits files. A human runs them.
- **Not a hosted service.** No account, no telemetry, no proprietary
  dependency. It runs on your machine, in your agent's account.
- **Not a manufacturing ontology or a sensor platform.** Non-motion steps are
  recorded minimally; SAAM makes no claim to standardized vision or probing.

## Evidence

SAAM separates what has been observed on hardware from what has been
documented, simulated, or proposed — see `docs/authoring/evidence-labels.md`.
A clean preview or a passing test proves intent and coordinates. It is never
treated as proof that a physical setup is safe to run.

## Scope discipline

New architectural layers get added when a real operation, machine, or
interface needs one — not in advance to look more complete than the project
is.

## Governance and licensing

Struder AI directs mission, scope, roadmap, and releases. That authority
governs *direction*, not *technical inclusion*: third-party components are
indexed by the same generated conformance registry
(`registry/registry.json`) as Struder's own, which records no authorship
field. Everything here is Apache-2.0. Your parts, toolpaths, and machine
programs are yours. SAAM will never require a proprietary Struder service to
do what this document describes.
