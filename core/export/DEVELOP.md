# Exporter implementation

Code structure of the exporters: the machine-output dialects that turn a
SAAMpath into a machine program, each with the interpreter that reads that
program back for review. [The export manual](README.md) owns shared output
semantics; each dialect contract ([Griffin](griffin.md), [Bambu](bambu.md),
[Dobot](dobot.md), [DENSO](denso.md)) owns what its output must contain and
the vendor and measured evidence behind it.

Exporters are outside the dev map (`exporters` in
[the map scope](../../dev-map/lib/scope.mjs)). They are scanned as an active
outside caller: their calls into core are listed on the pages they call, and
every mapped call into them is drawn as an outside arrow naming its target.
The dialect-neutral files here stay mapped: `registry.mjs`,
`travel-advisory.mjs`, `source-time.mjs` and `machine-study.mjs`. Any other
file added under `core/export` is an exporter.

## The adapter interface

`registry.mjs` holds one entry per machine output id (`machine.outputs[].id`):

- `export(path, plan, machine, release)` returns the program bytes;
- `interpret(bytes, plan, machine)` returns the program Studio plays: `moves`,
  `events`, `seconds`, `volumeMm3`, `summary` and dialect fields;
- `exportAndInterpret`, optional, returns `{bytes, program}` when exporting
  already interprets (Bambu), so the lifecycle reuses that result.

The registry rejects pose-bearing paths for every output but DENSO and adds the
[short-travel advisory](README.md#short-travel-advisory) to each program.
`core/print/workflow.mjs` reaches exporters only through it.
`studio/source-player.mjs::decodeSource` calls each dialect's source
interpreter directly on the checked source files, so Studio plays the same
interpreter the export check ran.

## Files by dialect

| Output id | Export | Interpret | Shared |
|---|---|---|---|
| `griffin-gcode` | `griffin.mjs` (`exportGriffin`, `exportMotion`, `validatePath`) | `griffin.mjs` (`interpretGriffin`, `interpretMotion`, `interpretMotionChunk`) | `gcode-lines.mjs` |
| `bambu-gcode` | `bambu.mjs` package; `bambu-body.mjs`, `bambu-change.mjs`, `bambu-x1-change.mjs`, `bambu-job.mjs`, `bambu-project.mjs` with `bambu-project-fields.json` | `bambu-player.mjs` (`interpretBambuSource`) | Griffin motion, `gcode-lines.mjs`, `zip.mjs` |
| `dobot-lua` | `dobot.mjs` | `dobot-player.mjs` on `dobot-lua-subset.mjs` | Griffin `validatePath`, `zip.mjs` |
| `denso-pacscript` | `denso.mjs` | `denso-player.mjs` | `zip.mjs` |

`dobot-lua-subset.mjs` is a Lua tokenizer, parser and runtime; `LuaRuntime` is
the approved stateful boundary of
[D-036](../../DECISIONS.md#d-036--explicit-planning-stages-and-state-in-the-path-planning-pilot).

## Adding or changing a dialect

Declare the output in the machine file, add its registry entry and its branch in
`decodeSource`, and write its contract beside the others. Record vendor facts
and measurements in that contract, not in `dev-map/facts.tsv`. Tests are
`core/tests/<dialect>*.test.mjs`, with `export.test.mjs` and
`modal-export.test.mjs` across dialects.
