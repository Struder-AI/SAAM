---
name: dobot-programmer
description: Create or modify StruderBot programs for the Dobot MG400 using the project's preview-approval-to-Lua workflow. Use when the operator describes a robot feature, shape, print, fill, curve, calibration test, motion change, DobotStudio Pro tab update, or physical test result that must be turned into exact preview geometry, paste-ready Lua, validation steps, or durable robot knowledge.
---

# Dobot Programmer

> **Imported legacy workflow manual.** SAAM's current geometry, locked-plan,
> Studio toolpath, and delivery approvals supersede the older preview-to-Lua
> workflow. Retain this manual for robot-specific evidence and migration
> provenance; do not create a parallel SAAM approval or export pipeline from it.

Turn operator intent into an exact approved motion plan, DobotStudio Pro Lua, and durable robot learning.

## Load project truth

Read these before planning or editing robot motion:

1. `docs/ROBOT_KNOWLEDGE.md`
2. `docs/PROGRAM_CREATION_WORKFLOW.md`
3. `docs/PROJECT_STATE.md`
4. The relevant firmware snapshot README and Lua tabs

Use evidence labels exactly as defined in `docs/ROBOT_KNOWLEDGE.md`. Treat the physical robot as ground truth. Do not promote an inference to ROBOT-CONFIRMED.

The OpenSauce 2026 event iteration is closed at
`iteration-opensauce-2026`. Preserve it as a historical baseline. New projects
should use a new branch and new working/milestone directories instead of
altering the tagged event state.

## Follow the approval workflow

1. Translate the requested result into geometry, placement, tool-state, and safety requirements.
2. Ask only for unknowns that materially change the program.
3. Build one ordered path specification for both preview and Lua.
4. Render a deterministic coordinate-accurate SVG or PNG. Never use a generative illustration as the approval artifact.
5. Show axes, units, origin, dimensions/key coordinates, start/end, direction, and distinct print/travel moves. For 3D parts, default to a four-view drawing with top, front, right-side, and isometric views derived from the same geometry.
6. Check bounds, continuity, arc data, tool transitions, and start/finish safety.
7. Obtain explicit operator approval before creating final paste-ready Lua, unless the operator explicitly authorizes a diagnostic shortcut.
8. Regenerate the preview when geometry changes.

Save approved previews under `generated_previews/`.

## Plan filled layers by region

For solid or sparse layers, stepover calibration, wall overlap, or obstacle
fill ordering, also use the focused `dobot-layer-filling` skill. Keep this
skill responsible for the complete robot program and safety workflow; let the
focused skill supply the layer plan.

For a rim, rounded bead, rolled edge, or width-driven transition from a
single-wall spiral into multiple perimeters, also use `dobot-spiral-lip`.

## Generate Lua

Default to `firmware/dobotstudio/milestone_struderbot_cube_diamond_stable/` as the baseline.

For every material-depositing program, also use `dobot-prime-lead-in`. Add its
compact minimum-100-mm purge path before the model and continue from that path
into the model without stopping extrusion. Explicit dry-motion and
extrusion-off diagnostics are the only default exception.

When the operator requests dog ears, mouse ears, helper discs, brim ears, or
rounded corner-adhesion tabs, also use `dobot-dog-ears`. Complete its connected
ear-and-skirt scaffold before the part's first perimeter.

For ordinary iterative development, default to one Online-mode program that
can be launched directly from DobotStudio Pro. Treat the multi-button Remote
I/O dispatcher below as an opt-in offline/demo deployment target. Do not make
the operator switch into Remote I/O merely to test a development program.

- Preserve the tab structure: `global.lua`, `src0.lua`, and program tabs.
- Use slot-based entry points in active projects: `RunSrc1()` in `src1.lua`,
  `RunSrc2()` in `src2.lua`, and `RunSrc3()` in `src3.lua`. Map blue DI1/DO1
  alone to SRC1, white DI2/DO2 alone to SRC2, and a qualified two-button chord
  to SRC3. Restart the hold timer whenever the observed selection changes so
  slightly staggered button presses cannot launch a single-button program.
  Require full release before rearming. Do not reintroduce cube/diamond names.
- Create a new working/milestone directory; do not overwrite the stable baseline.
- Express geometry in desired User Frame/work coordinates and let `P()` apply calibration.
- The post-firmware shared `P()` applies a measured nonlinear 2D point warp.
  Point transformation alone cannot curve the interior of one `MovL`. For long
  Y-oriented lines where straightness matters, generate one native `Arc3`
  through the corrected Y0 midpoint. Keep long X-oriented lines as one `MovL`;
  lookup-node segmentation caused pauses and fixed-flow blobs.
- Reuse stable motion, I/O, extrusion, lighting, and finish helpers.
- Keep in-plane reposition moves linear when extrusion may remain on.
- Use `MovJ` only for safe approach/ready moves with extrusion off.
- Prefer `Arc3`; use real points on the arc for midpoints.
- Treat `Circle3` as experimental.
- Preserve the tested thick speed floor of 1.0 unless running an explicit tuning experiment.
- Stop extrusion, lift in place, then travel away.
- Enable Struder extrusion exactly once at the external lead-in and keep it
  enabled through the complete connected model path. Never insert intermediate
  `PenOff()`/`PenOn()` cycles to imitate slicer retractions. Connect separate
  contours with deliberate printed transitions or redesign their traversal.
- Run `tools/validate_struder_lua.py` against every generated Struder program.
  Treat any failure as blocking. Permit cycling only when the operator
  explicitly requests it and the file contains
  `-- ALLOW_EXTRUSION_CYCLING: true`.
- Keep program-specific helpers local.

## Keep lead-ins outside the part

- Treat the lead-in as a sacrificial priming path: at least 100 mm long, compact,
  and normally 5 mm clear of the complete deposited part envelope. Use the
  `dobot-prime-lead-in` geometry and validation rules.
- Start every extrusion lead-in beyond the complete XY envelope of the part,
  including all later rotated, offset, or expanded layers.
- Prefer an outward surface normal or a radial ray directed away from the work
  origin. Do not assume subtracting from X or Y moves outward.
- Permit the lead-in to meet the model only at its intended entry endpoint.
  Reject any coincident, overlapping, or crossing relationship with another
  print path.
- Validate the lead-in against the complete multi-layer path, not only the
  first perimeter.
- Approach and descend at the external lead-in start before enabling flow.

Provide paste instructions organized by DobotStudio Pro tab.

If DobotStudio shows updated source but the robot executes older motion, treat
this as a known controller file-cache failure. Do not revise geometry to match
stale behavior. Save the program under a new controller-side filename, update
the slot/project reference, save again if the first load reports `cannot load
program`, then reload and verify a revision-specific marker before printing.

## Validate and hand off

- Compare final Lua coordinates and order against the approved path specification.
- Re-render final path data when necessary to prove it still matches the approved preview.
- Check tab dependencies, function/block balance, frames, I/O, calibration, Z values, and speed classes.
- Run relevant tests and `git diff --check`.
- Give a conservative physical first-run checklist; never claim software validation proves hardware safety.

## Capture robot learning

After a physical test:

1. record program/revision and hardware/frame/bed conditions;
2. record measurements, successes, alarms, stalls, dragging, blobs, skew, and tuning changes;
3. apply the correct evidence label;
4. update `docs/ROBOT_KNOWLEDGE.md` with durable conclusions;
5. update `docs/PROJECT_STATE.md` with current status and next action; and
6. preserve successful code in a named milestone directory.

When the operator says **save progress**, complete the knowledge updates and checks before synchronizing the project.

When the operator closes an iteration, add a summary under `docs/iterations/`,
update all durable project guidance, preserve uncertain work with its evidence
labels, and create an annotated `iteration-*` tag for future branching.
