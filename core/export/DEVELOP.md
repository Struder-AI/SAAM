# Exporter implementation

Code structure of the exporters: the machine-output dialects that turn a
SAAMpath into a machine program, each with the interpreter that reads that
program back for review. [The export manual](README.md) owns shared output
semantics; each dialect contract ([Griffin](griffin.md), [Bambu](bambu.md),
[Dobot](dobot.md), [DENSO](denso.md)) owns what its output must contain and
the vendor and measured evidence behind it.

## The adapter interface

`registry.mjs` holds one entry per machine output id (`machine.outputs[].id`):

- `export(prepared, plan, machine, release)` writes the prepared path and returns
  `{bytes, report}`: `notice`, `limitations` and, where the writer knows them,
  `seconds` and `volumeMm3` of what it wrote;
- `interpret(bytes, plan, machine)` returns the program Studio plays: `moves`,
  `events`, `seconds`, `volumeMm3`, `summary` and dialect fields.

`exportProgram` prepares the path once (`prepare-path.mjs`, which rejects
pose-bearing paths for every output but DENSO), calls `export` and adds the
[short-travel advisory](README.md#short-travel-advisory) on the prepared path to
the report. G-code writers share `gcodeMotion` (`gcode-motion.mjs`): lines
plus the totals of what it wrote.
`core/print/workflow.mjs` reaches exporters only through it.
`studio/source-player.mjs::decodeSource` calls each dialect's source
interpreter directly on the checked source files, so Studio plays the same
interpreter the export check ran.

## Files by dialect

| Output id | Export | Interpret | Shared |
|---|---|---|---|
| `griffin-gcode` | `griffin.mjs` | `griffin-player.mjs` | `gcode-motion.mjs`, `gcode-lines.mjs` |
| `bambu-gcode` | `bambu.mjs` package; `bambu-body.mjs`, `bambu-change.mjs`, `bambu-x1-change.mjs`, `bambu-job.mjs`, `bambu-project.mjs` with `bambu-project-fields.json` | `bambu-player.mjs` (`interpretBambuSource`) | `gcode-motion.mjs`, `zip.mjs` |
| `dobot-lua` | `dobot.mjs` | `dobot-player.mjs` on `dobot-lua-subset.mjs` | `zip.mjs` |
| `denso-pacscript` | `denso.mjs` | `denso-player.mjs` | `zip.mjs` |

`dobot-lua-subset.mjs` is a Lua tokenizer, parser and runtime; `LuaRuntime` is
the approved stateful boundary of
[D-036](../../DECISIONS.md#d-036--explicit-planning-stages-and-state-in-the-path-planning-pilot).

## Adding or changing a dialect

Declare the output in the machine file, add its registry entry and its branch in
`decodeSource`, and write its contract beside the others. Record vendor facts
and measurements in that contract. Write numbers at a
[program resolution](../README.md#dimensions-and-tolerances) below print resolution. Tests are
`core/tests/<dialect>*.test.mjs`, with `export.test.mjs` and
`modal-export.test.mjs` across dialects.
