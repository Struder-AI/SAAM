# Exporter implementation

The core side of the machine plug. [Adding a machine](../../machines/README.md#adding-a-machine)
owns the adapter interface and standards; [the export manual](README.md) owns shared
output semantics; each machine's `SKILL.md` owns its dialect and evidence.

- `registry.mjs`: `Export`, the operations offered to adapters; `machineAdapter` loads
  the selected output's adapter from the machine extension shipping the profile
  (`machineCatalog`, `core/extensions/library.mjs`); `exportProgram` prepares the path
  once, calls `export` and completes the report (move count, path totals as fallback
  estimates, short-travel advisory); `preparePath` gives Studio the same prepared path;
  `settingsRows` gives Studio the adapter's rows.
- `prepare-path.mjs`: `validateSetup` (common setup, logical materials, then the
  adapter's `validate`), pose refusal by the adapter's `poses`, startup, priming,
  material changes by the output's `materialChangeMode`, axis-feed limits.
- `gcode-motion.mjs`, `zip.mjs`, `travel-advisory.mjs`: shared writer, archive codec and advisory.

`core/print/workflow.mjs` reaches adapters only through the registry. Tests are
`core/tests/<dialect>*.test.mjs`, with `export.test.mjs` and `modal-export.test.mjs` across dialects.
