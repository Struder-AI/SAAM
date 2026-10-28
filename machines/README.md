# Machines

Each machine is a **machine extension**: a folder `machines/<id>/` (release) or
`<SAAM home>/local/extensions/<id>/` (local; a local copy of the same id wins) holding
an `extension.json` manifest (`saam-extension/1`, `kind: "machine"`, `machines`: its
profile files named `<profile id>.json`, entries `machine-adapter` and optional
`machine-verify`), the `saam-machine/1` profiles, the adapter and its output contract
as `SKILL.md` (`saam-kind: machine`). `list_machines` names each profile's extension, the first
declaring its id (local first), and what it skipped; `extension_library checkout` copies one for editing.

| Extension | Profiles | Output | Contract |
|---|---|---|---|
| `ultimaker` | S5; 2 Extended and 3 for review only | `griffin-gcode` | [Griffin](ultimaker/SKILL.md) |
| `bambu` | H2D, X1 Carbon | `bambu-gcode` | [Bambu](bambu/SKILL.md) |
| `dobot` | MG400 | `dobot-lua` | [Dobot](dobot/SKILL.md) |
| `denso` | VS-068A4 / RC8A with rotary | `denso-pacscript` | [DENSO](denso/SKILL.md) |

A review-only output declares `implemented: false`; SAAMpath still generates and
the result names the missing machine-program contract. The original UM2 Extended needs volumetric UltiGCode,
the standard UM3 its own Griffin startup (one selected AA core; no BB core or tool
changes); neither inherits the S5 startup. X1 Carbon PETG, ABS, ASA, PC and TPU are
setup-review materials; only PLA has an output contract; material selection retunes nothing.
Tool bounds are conservative rectangles (X1 cutter strip, UltiMaker glass clips) with
sources in each profile, used for placement, priming and material-change handoff; arm
display bounds are not reach limits. No nonplanar
clearance is rated: the X1 (10°) and H2D (15°) limits are user-chosen and experimental.
[Machine presentation models](../core/machine/README.md) draw each machine.

## Adding a machine

A machine extension plugs into Export, and only Export, through five plugs:
**Machine description** (the profile, below: all machine-specific facts as data),
**Installation check** (`settings.validate`), **Write program** (`write`), the
optional **Machine kinematics** entry, and Export's **Writing services** (the
`Export` object). Core holds no special case for any machine; anything an adapter
needs from SAAM arrives through these plugs.

1. **Profile.** Copy the nearest one. Declare capabilities (`relay-extrusion`: external
   extrusion, so Studio omits filament, bed and fan settings), tools, bounds, startup hand-over, `defaultSetup` (your setup
   block's template; `null` marks installation values the person must supply) and
   `outputs[]`: `id`, `implemented`, vendor-fixed `program` blocks and `constraints`
   (`materialChangeMode` `tool-swap`, or the output's own same-nozzle mode such as Bambu's `single-nozzle-ams`, with `toolChangeLiftMm`
   permit material changes). Studio draws a gantry
   (`kinematics: "cartesian-fixed-vertical-nozzle"`) from the profile; any other machine needs
   a [kinematics plug](../core/export/DEVELOP.md#kinematics-plug) (`machine-kinematics` entry). `nozzleGeometry:{includedAngleDeg,tipDiameterMm,name,quality,source?,note?}` belongs on the profile or an overriding tool; flat diameter describes the external face, independently of the extrusion orifice. [Selection](../core/machine/nozzle.mjs) supplies each active material's nozzle to Export; an aggregate envelope only rejects distant candidates. Missing geometry uses the labelled 80° / 0.9 mm estimate; UltiMaker uses original CAD (90° / 1 mm), Bambu the owner's provisional 70° / 0.8 mm. Output retains the models and resolved execution; neutral source stays machine-independent. Heater blocks, parked tools and carriage remain outside this cone.
2. **Adapter.** `createAdapter(Export)` returns
   `{output, poses, settings:{key, validate}, write(prepared, settings, sink) → {report}}`.
   - `output` names `outputs[].id`; `poses: true` writes orientation, other outputs accept upright orientation.
   - `settings.key` names the block `plan.setup[key]`. Preparation reads its `initialPositionMm`
     and, when posed, `initialPose` and `retreatMm`.
     `validate({machine, setup, process, output}, {required})` throws on invalid values and,
     when `required` (export), names unresolved ones. Studio reads saved setup values; optional
     profile `settingsLabels` maps dotted setup paths to presentation labels.
   - `write` receives [prepared motion](../core/export/prepare-path.mjs), whose `actions` are a repeatable iterable,
     and `{machine, setup, process, output, release, defaultProcess}`. Preparation streams startup,
     priming, material changes and axis-feed adaptation. `report` holds `notice`, print-specific `limitations`,
     optional written `seconds`/`volumeMm3` and Studio facts; standing caveats belong in `SKILL.md`.
     Core adds totals and the [short-travel advisory](../core/export/README.md#short-travel-advisory).
     Await writes to the supplied [sink](../core/export/artifact-sink.mjs): `member()` creates a temporary file with
     `write(value)`, `line(text)`, `patch(offset, bytes)` and `close()`; its
     `byteLength` and file content remain available for assembly. `compose(parts)`
     selects an ordered plain-file result; `archive(Map<name, content>)` selects a
     ZIP32 result. Content may be text, bytes, a member or `{parts:[...]}`.
     `digest(content, algorithm)` computes a streaming digest. Finish writing members
     before composing or archiving them. The Export owner commits the complete
     artifact and cleans up failure/cancellation; the writer returns its report.
     Export offers the completed file for download and records report facts in a receipt. Bundle stores
     no programs or machine execution; reopening runs no program adapter.
   - `Export` supplies shared SAAM operations: `number` (XYZ to 0.001 mm), `slackMm`,
     `gcodeStream(prepared, settings, options)` (incremental `lines`, with `tally` after consumption),
     `gcodeMotion(prepared, settings, options)` (complete lines/totals; filament E to five decimals with residual carry),
     `packZip`, `unpackZip`, `crc32`, `encodePng` and
     `frame` and `kinematics` (stateless numeric math/dimensions). Adapters import their own files
     and use ordinary runtime APIs; this boundary supplies their SAAM inputs.
3. **Verification.** Optional `machine-verify` exports `verify(bytes, plan, machine, Export)`;
   `node scripts/machine-verify.mjs BUNDLE_DIR` writes transient bytes and compares its optional interpretation with writer facts.
4. **Contract.** `SKILL.md` owns output, settings, evidence and trials.

| # | Owner-approved standard (2026-10-12) |
|---|---|
| S1 | Adapters translate the prepared SAAMpath and resolved machine settings through the public Export interface. |
| S2 | Adapters account for each requested action through a command, an applicable external arrangement, or a named limitation. |
| S3 | Writers use precision appropriate to each commanded quantity, derive estimates from written values, and handle collapsed moves without failure. |
| S4 | Export adapts commands to the machine’s actual command contract; each remaining refusal identifies a concrete failure it prevents. |
| S5 | Program writing names only the unresolved settings needed to write its commands; geometry and SAAMpath remain available. |
| S6 | Writers use supplied inputs and release metadata, giving repeatable output without wall-clock variation. |
| S7 | The stored report gives material program differences and labels the scope and model of its estimates. |
| S8 | Machine-specific service definitions have one owner, with their source and scope recorded. |
| S9 | Adapters preserve requested work through supported splitting or streaming and name actual controller or format boundaries. |
| S10 | Builders use temporary verification to resolve named adapter uncertainties; production uses the writer’s stored result. |
