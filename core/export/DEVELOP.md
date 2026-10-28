# Exporter implementation

[Adding a machine](../../machines/README.md#adding-a-machine) owns adapter interfaces/standards; [the export manual](README.md) owns shared output semantics; each machine's `SKILL.md` owns its dialect and evidence.

- `registry.mjs`: `Export`, the operations offered to adapters; `machineAdapter` loads
  the selected output's adapter from the machine extension shipping the profile
  (`machineCatalog`, `core/extensions/library.mjs`); `exportProgram` prepares the path
  once, calls `export` and completes the report (move count, path totals as fallback
  estimates, short-travel advisory); saved settings rows come from [snapshot data](../machine/settings-rows.mjs). Adapters translate SAAMpath into
  programs and draw nothing: Studio draws the SAAMpath.
- `machine-travel.mjs`: realizes the Scheduler's routed travel for the selected machine: retraction when a route is longer than `maxCombMm`, recovery before material flows, parking at temperature changes and the end. It does not re-route or rebuild the deposited scene.
- `prepare-path.mjs`: placement offset, `validateSetup` (common setup, logical materials, then the
  adapter's `validate`), pose refusal by the adapter's `poses`, startup, priming,
  material changes by the output's `materialChangeMode`, axis-feed limits.
- `gcode-motion.mjs`, `zip.mjs`: shared writer and archive codec; [motion reports](../path/motion-report.mjs) collect totals/advisories during consumption.

## Kinematics plug

The SAAMpath states only toolhead position and orientation in the part frame; every
other machine axis, including a redundant table, comes from the extension entry
`machine-kinematics` (gantries need none). `createKinematics(Kinematics)` receives
[frame math and dimension classes](../machine/kinematics.mjs) and returns forward and
inverse kinematics plus `view({machine, setup, config})` → `{limitations,
partFrame(at), arm}`; `arm` is null or `{worldFromBase, linkLengthsMm, baseSizeMm,
rotationControls, coordinateBounds, angularLeverMm, inverse(tcpInBase), reachMargins?}`.
The adapter builds it from `Export.kinematics`; Studio serves it at
`/machine-kinematics/<machine id>.mjs`.

Canonical Paath `/3` supplies an authoritative tool axis, not authored roll.
DENSO transports the captured setup's initial frame by the shortest rotation
between successive axes, using Geometry's stateless frame transport. Opposed
axes need an intermediate anchor; the adapter refuses ambiguity. Its kinematics
plug optionally provides `programOrientation({program,setup})` with
`at(moveIndex,fraction)` for a preview explicitly marked `paath-axis/1` with
`sourceSchema:saampath/3`. It retains endpoint frames once, so seeking, reverse
playback and repeated queries cannot change orientation. Historical authored
poses and mechanism-study Euler orientations bypass this derivation.

The writer and machine presentation share that procedure and captured seed.
Normal Studio samples neutral source moves; Export can realize additional
physical transfers. Different axis sequences can produce different transported
frames: this is not a claim that normal Studio displays exact program motion,
nor proof of robot reach, joint continuity, collision clearance or calibration.

`core/print/workflow.mjs` reaches adapters only through the registry. Tests are
`core/tests/<dialect>*.test.mjs`, with `export.test.mjs` and `modal-export.test.mjs` across dialects.
