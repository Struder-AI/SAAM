# Machines

Each machine is a **machine extension**: a folder `machines/<id>/` (release) or
`<SAAM home>/local/extensions/<id>/` (local; a local copy of the same id wins) holding
an `extension.json` manifest (`saam-extension/1`, `kind: "machine"`, `machines`: its
profile files named `<profile id>.json`, entries `machine-adapter` and optional
`machine-verify`), the `saam-machine/1` profiles, the adapter and its output contract
as `SKILL.md` (`saam-kind: machine`). `list_machines` names each profile's extension;
`extension_library checkout` copies one for editing.

| Extension | Profiles | Output | Contract |
|---|---|---|---|
| `ultimaker` | S5; 2 Extended and 3 for review only | `griffin-gcode` | [Griffin](ultimaker/SKILL.md) |
| `bambu` | H2D, X1 Carbon | `bambu-gcode` | [Bambu](bambu/SKILL.md) |
| `dobot` | MG400 | `dobot-lua` | [Dobot](dobot/SKILL.md) |
| `denso` | VS-068A4 / RC8A with rotary | `denso-pacscript` | [DENSO](denso/SKILL.md) |

A review-only output declares `implemented: false`; generation names the missing
contract before building a toolpath. The original UM2 Extended needs volumetric UltiGCode,
the standard UM3 its own Griffin startup (one selected AA core; no BB core or tool
changes); neither inherits the S5 startup. X1 Carbon PETG, ABS, ASA, PC and TPU are
setup-review materials; only PLA has an output contract; material selection retunes nothing.
Tool bounds are conservative rectangles (X1 cutter strip, UltiMaker glass clips) with
sources in each profile, used for placement, priming and material-change handoff; arm
display bounds are not reach limits. No nonplanar
clearance is rated: the X1 (10°) and H2D (15°) limits are user-chosen and experimental.
[Machine presentation models](../core/machine/README.md) draw each machine.

## Adding a machine

1. **Profile.** Copy the nearest one. Declare capabilities (`relay-extrusion`: external
   extrusion, so Studio omits filament, bed and fan settings; `coordinated-rotary`: Studio
   draws the rotary table), tools, bounds, startup hand-over, `defaultSetup` (your setup
   block's template; `null` marks installation values the person must supply) and
   `outputs[]`: `id`, `implemented`, vendor-fixed `program` blocks and `constraints`
   (`materialChangeMode` `tool-swap` or `single-nozzle-ams` with `toolChangeLiftMm`
   permit material changes). Studio draws a gantry
   (`kinematics: "cartesian-fixed-vertical-nozzle"`) from the profile; an arm model is core code.
2. **Adapter.** `createAdapter(Export)` returns
   `{output, poses, settings:{key, validate, rows}, export(prepared, settings) → {bytes, report}}`.
   - `output` is the profile's `outputs[].id`. `poses: true` only when the program writes tool
     orientation and rotary motion; otherwise posed paths are refused.
   - `settings.key` names the block `plan.setup[key]`. Preparation reads its `initialPositionMm`
     and, when posed, `initialPose`, `retreatMm`, `transitionSeconds` and `rotaryCenterMm`.
     `validate({machine, setup, process, output}, {required})` throws on invalid values and,
     when `required` (export), names unresolved ones; `rows` (same input) returns
     `[[label, text]]` for Studio's settings panel.
   - `export` receives the prepared path (the SAAMpath plus startup, priming, material-change
     lifts and axis-feed limits; [prepare-path.mjs](../core/export/prepare-path.mjs)) and
     `{machine, setup, process, output, release}`. `report` holds `notice`, `limitations`,
     optional `seconds` and `volumeMm3` of what was written (else the path's) and any facts
     Studio shows. Core adds the move count and [short-travel advisory](../core/export/README.md#short-travel-advisory);
     Bundle stores the report, and reopen and delivery run no adapter code.
   - `Export` is everything an adapter uses besides its own files: `number` (program
     resolution), `slackMm`, `gcodeMotion(prepared, settings, options)` (G-code lines and the
     totals written), `packZip`, `unpackZip`, `crc32`, `temperatureC` (ceiling check) and
     `frame` (stateless rotation math). Adapters import no core module.
3. **Verification, debug only.** `machine-verify` exports `verify(bytes, plan, machine, Export)`,
   which executes a checked program; `node scripts/machine-verify.mjs BUNDLE_DIR` compares it
   with the stored report. Nothing else loads it. Delete it once the contract records a physical trial.
4. **Contract.** `SKILL.md` states what the output contains, its settings, vendor evidence and trials.

| # | Standard |
|---|---|
| S1 | Use only the prepared path, settings and `Export`. |
| S2 | Write every action kind or reject it at export with a named error; drop none. |
| S3 | Write coordinates and amounts at program resolution (`PROGRAM_DECIMALS`, [core/dimensions.mjs](../core/dimensions.mjs), through `Export.number`); quantize once and derive later values from written ones; a deposition that collapses is an error naming the move. |
| S4 | Enforce physical limits from settings: workspace, axis feed, temperature ceiling, park and material-change clearance. |
| S5 | Unresolved installation values block export and are named. |
| S6 | The same prepared path, settings and adapter give identical bytes; dates come from `release`. |
| S7 | The report states what the drawn path does not show (firmware blocks, purge, park, external start or heating) and the time and material estimates with their model. |
| S8 | Vendor-fixed blocks are profile data pinned by hash; changing one needs review. |
| S9 | No fixed size or count cap: split into what the controller accepts ([limits](../core/README.md#limits-that-adapt-and-limits-that-are-kept)). |
| S10 | Verification is debug-only; the first physical trial changes one thing from a file known to load. |
