---
name: dobot-prime-lead-in
description: Plan and generate compact sacrificial purge paths that prime the fixed-feed Struder nozzle before a Dobot print and connect continuously into the part. Use for every material-depositing Online-mode StruderBot program, especially after idle time, when avoiding heat-discolored nozzle residue, replacing a short lead-in, fitting at least 100 mm of priming path near a part, or validating purge clearance against the bed and full part envelope.
---

# Dobot Prime Lead-In

> **Imported legacy StruderBot manual.** The purge geometry and fixed-feed
> invariants are preserved, but this is not yet connected to SAAM's composer or
> Dobot exporter. Integrate it as whole-plan machine/process behavior and test
> the interpreted delivered program before calling it available.

## Overview

Create a compact purge path before every material print so stale or discolored
filament is deposited outside the part. Preserve one uninterrupted extrusion
window from the start of the purge through the end of the model.

Use this skill together with `dobot-programmer`. Read
`references/geometry.md` before choosing or generating the purge geometry.

## Apply the default

- Add a priming path to every material-depositing program.
- Omit it only for explicit dry-motion or extrusion-off diagnostics.
- Target at least 100 mm of deposited purge path.
- Keep the serpentine body 5 mm clear of the complete part envelope; only its
  deliberate final connector may cross that gap to meet the model entry.
- Prefer a three-lane serpentine with 4 mm lane pitch and tangent 2 mm
  semicircular turns.
- Use normal print speed for the purge.
- Increase to the next odd lane count only when three lanes cannot fit the
  required length beside the part.

Treat the defaults as StruderBot process parameters, not universal 3D-printing
standards. Keep them conspicuous in generated Lua so robot testing can tune
them.

## Preserve one extrusion window

1. Approach the purge start with extrusion off.
2. Descend to the first-layer Z.
3. Call `PenOn()` once. Its normal startup delay applies at the sacrificial
   purge start.
4. Print the complete purge path.
5. Continue directly into the first model path without a dwell, rapid move,
   `PenOff()`, retract, or second `PenOn()`.
6. Use only the normal final pre-shutoff and `PenOff()` at program end.

The startup blob and heat-discolored material therefore remain at the purge
start, while stable flow reaches the part.

## Fit the path around the complete part

- Compute from the complete deposited XY envelope, including brim, flange,
  clips, tabs, or other protrusions.
- Place the serpentine on the side that best fits the bed and minimizes the
  final connection to the model entry.
- Measure serpentine-body clearance edge-to-edge, not
  centerline-to-centerline.
- Include bead radius, turn bulges, and the bed-edge margin in all bounds
  checks.
- Fail the plan instead of silently reducing the 100 mm minimum or the 5 mm
  clearance.
- Route the connector without crossing any deposited purge segment or entering
  the model before the intended first point.

Use `scripts/plan_prime.py` for rectangular bed and part envelopes. Review its
reported bounds, length, start, finish, and move list before transcribing the
path into Lua.

## Keep the motion smooth

- Use long continuous linear strokes.
- Use native `Arc3` semicircles only at tangent turnarounds.
- Do not approximate turns with many short line segments.
- Do not add waits between purge segments or at the purge-to-part connection.
- If a candidate arc is outside the robot-proven geometry range, redesign the
  serpentine rather than relying on CP to hide discrete corners.

## Validate and record the first test

Before material testing, verify:

- deposited purge length, including its printed final connector, is at least
  100 mm;
- the serpentine body's nearest edge is at least 5 mm from the complete part
  envelope and only its final connector enters that gap;
- the entire bead and every arc bulge remain within the printable bed margin;
- the path contains one `PenOn()` and no intermediate extrusion shutoff;
- the purge ends at the first model entry without crossing deposited material;
- the preview distinguishes purge geometry from model geometry.

Treat the first physical purge as experimental. Record whether 100 mm clears
the discoloration, whether the 5 mm gap prevents bonding, and whether the 4 mm
pitch and 2 mm turns remain clean. Promote changed values only after a
successful robot test.
