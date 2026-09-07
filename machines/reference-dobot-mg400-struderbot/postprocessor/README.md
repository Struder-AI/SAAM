# Dobot Lua Post-Processor

Translates an approved process plan into DobotStudio Pro Lua for the
`reference-dobot-mg400-struderbot` machine: `global.lua` (shared helpers
and this unit's calibration), `src0.lua` (entry point), and `src1.lua`
(the program itself, as `RunPlan()`).

This is the one machine-aware piece in SAAM's reference toolchain. It
translates or rejects; it never redesigns geometry — see
`../../../docs/architecture/operations-vs-postprocessors.md`. Every
point emitted in the generated Lua is a restatement of a point already
present in the input plan.

## What it enforces

- **No export without approval.** `translate()` throws unless the plan
  carries an approval record whose `revision` matches the plan's current
  `revision` and whose `scope` authorizes export. This is the one place
  in the reference toolchain where
  `docs/authoring/process-plan-workflow.md`'s approval gate is enforced
  in code, not just documented.
- **One continuous extrusion window.** Exactly one `PenOn()` near the
  start and one final `PenOff()` — never intermediate cycling. This
  matches a real, hard-won lesson from the source project: cycling
  extrusion between contours produced controller hesitation and local
  overfill on physical hardware.
- **Gaps are reported, not silently bridged.** When one printed path
  doesn't end where the next one starts, the post-processor still
  travels it — linearly, extrusion left on, matching the source
  project's convention — but adds a `disjoint-transition` warning
  instead of pretending the transition was deliberately designed. The
  operations can supply explicit travel using `settings.travelHopHeight`.
  Those paths, including hop coordinates, are followed without gap
  warnings. This machine still extrudes through internal travel; use the
  separate experimental `dobot-stop` machine for stop/start extrusion.
- **Intent controls the helper.** Print strokes use `L`, travel uses `J`.
  Distance is never used to classify a stroke as travel. Exported source
  annotations carry intent to the viewer independently of relay state.

## Instance calibration

`translate({ plan, instanceProfile })` takes calibration separately from
the plan. Omit `instanceProfile` and it falls back to an identity
transform with placeholder I/O names — safe for inspecting output shape,
never safe to run on real hardware. See
`../instance-profile.example.json` for the expected shape, and
`../../../docs/authoring/machine-definitions.md` for why real calibration
doesn't belong in this repository.

## Known limitations

See `manifest.json` &rarr; `knownLimitations`. The current reference
operations emit sampled polylines, not native arc/center data, so this
post-processor emits `MovL`-based linear motion throughout — even though
the source project's own Dobot conventions prefer native `Arc3` for
production curves. Closing that gap means teaching an operation to carry
arc-native path data, not just changing this file.
