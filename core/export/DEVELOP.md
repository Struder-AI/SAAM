# Exporter implementation

[Adding a machine](../../machines/README.md#adding-a-machine) owns adapter interfaces/standards; [the export manual](README.md) owns shared output semantics; each machine's `SKILL.md` owns its dialect and evidence.

- `registry.mjs`: `Export`, the operations offered to adapters; `machineAdapter` loads
  the selected output's adapter from the machine extension shipping the profile
  (`machineCatalog`, `core/extensions/library.mjs`); `exportProgram` prepares the path
  once, calls `export` and completes the report (move count, path totals as fallback
  estimates, short-travel advisory); `programReadiness` names what writing still needs;
  saved settings rows come from [snapshot data](../machine/settings-rows.mjs). Adapters translate SAAMpath into
  programs and draw nothing: Studio draws the SAAMpath.
- `transfer-planning.mjs`: selected-tool ordering, continuous transfers, parking and retraction; execution stays transient with Export.
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

`core/print/workflow.mjs` reaches adapters only through the registry. Tests are
`core/tests/<dialect>*.test.mjs`, with `export.test.mjs` and `modal-export.test.mjs` across dialects.
