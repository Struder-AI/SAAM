# Machine interfaces and program output

Read the output contract for machine behavior and exporter/interpreter responsibilities:

| Output | Contract |
|---|---|
| UltiMaker S5 / Griffin G-code | [Griffin](./griffin.md) |
| Bambu H2D and X1 Carbon / sliced 3MF | [Bambu](./bambu.md) |
| Dobot MG400 / Lua source ZIP | [Dobot](./dobot.md) |
| DENSO VS-068A4 / RC8A PacScript ZIP | [DENSO](./denso.md) |

[Machine files](../../machines/README.md) hold capabilities and setup declarations.
[Print lifecycle](../print/README.md) owns review and delivery of the checked output.

Ultimaker 2 Extended and Ultimaker 3 have
[geometry/setup profiles](../../machines/README.md#profiles-for-geometry-and-setup-review),
but no implemented output contract. X1 Carbon shares the H2D exporter with its
own pinned envelope; the H2D envelope does not apply to it. S5 startup is not
assumed for UM3. UM2 Extended uses volumetric UltiGCode rather
than the filament-length extrusion used by Griffin. Their declared output
limitations are reported at export; catalog presence is not export support.

## Machine interoperability design

### Short-travel advisory

Shared export/interpretation attaches `summary.shortTravel` to every program,
including saved programs reopened in Studio. A travel is a maximal sequence of
non-depositing moves: lifts, traverses, descents, detours and sampled robot moves
remain one trip. Process-only events do not split it; stationary deposition does.
The check flags straight-line XYZ distance
between trip endpoints **at or below 2 mm**, including coincident endpoints,
regardless of the distance traveled along the route. Required transitions are
counted as travels but never flagged: the approach before the first deposition,
the departure after the last, and a travel between depositions with different
known layer labels, where a nearby start is the intended path. A segment of at
most 0.001 mm inside a stroke, whose filament amount rounded to nothing in the
written program, is not a travel.

Producers [connect nearby strokes by deposition](../path/README.md#whole-plan-travel-requirement),
so an ordinary print reports nothing. A finding is a bad-path report, not a
validity gate or automatic repair, and the agent tells the person about it. The
report includes total/count, `liftedCount` (trips that rose above both
endpoints because the producer found the direct line blocked, such as a gap
between neighboring islands), operation counts and up to 20 examples with
endpoints, the lifted flag and source file/line, phase, layer and adjacent
operation labels. Missing labels remain unknown; recipe skills alone do not prove
which producer caused a travel. The check is one linear scan of interpreted moves,
cached with the owning program and included in source-only worker handoff.
Generation records it as
`plan.json` → `bundle.review.generation.checks.shortTravel`; `saam` print state
exposes it. Review, approvals, delivery and emitted bytes are unchanged
by the finding. Browser playback does not rerun the check.
Studio's read-only machine-study adapter applies the same advisory to its authored
motion and caches it by source text.

### Output compatibility

SAAMpath generation validates authored geometry and process values independently
of machine capabilities. Machine profiles supply authoring defaults. They do not
filter skills, reject tool poses or synthesize poses from the selected machine.
Slice optionally derives upright orientation (default) or its surface normal; FIELD
can vary either enabled output. Missing orientation implies ordinary print-Z alignment.

[Export preparation](./prepare-path.mjs) adds installation startup and priming,
material-change clearance and axis-feed limits without mutating the authored path.
Only exporters enforce installed nozzle/material compatibility and required setup.
Interpreters check the exact emitted program; Studio reviews those same bytes.
`checkMachinePath` checks an export-prepared path, not neutral authoring intent.
Unsupported output errors occur after SAAMpath construction and carry `stage: export`.

| Action | Implemented outputs |
|---|---|
| XYZ deposition, dwell | Griffin, Bambu, Dobot, DENSO |
| Filament retraction, fan, stationary extrusion, nozzle temperature | Griffin, Bambu; relay outputs reject controls they cannot express |
| Logical material/nozzle change | Bambu's declared service contracts |
| Derived orientation | Upright works on every output; non-upright poses need DENSO |

Robot setup is mandatory at export; software review does not establish controller feasibility,
actual extrusion or collision clearance.

The user selected H2D left 0.4 mm nozzle, 1.75 mm PLA and experimental 15°
non-planar limit. The profile records official hardware/slicer sources, separate
nozzle work areas and conservative PLA settings. The inherited left-tool height
is 320 mm; the advertised overall height is 325 mm. The supplied left/right
Bambu Studio exports establish the bounded [H2D output contract](./bambu.md#h2d-output-contract).
Ordinary generated H2D v13 AMS-19 and DUAL-20 physically passed same-nozzle
AMS colours and left 0.4/right 0.8/left nozzle changes, with PLA, Textured PEI
and fast startup. X1 AMS remains unresolved; the H2D passes do not validate
every nozzle, plate or feed configuration. The Bambu contract
owns the startup duplication inventory, actual installed-nozzle declarations and
the distinction between logical filament IDs and physical AMS tray intent.

Preserve units, transforms, feature and material identity at every output boundary;
new dialects need explicit adapters.

### Stationary extrusion and nozzle control

Optional `extrude` actions specify positive stationary volume and volumetric
flow; `temperature` actions specify a locked-recipe nozzle target up to 350 °C.
No generic flow cap applies. Griffin and H2D support these actions; relay robot
outputs reject them. Thermal wait duration and actual temperature are not simulated.
