# Machine interfaces and program output

[Machines](../../machines/README.md) lists each machine extension, its output contract
and [how to add one](../../machines/README.md#adding-a-machine).
[Print lifecycle](../print/README.md) owns review and delivery of the checked output.
X1 Carbon shares the H2D adapter with its own pinned envelope. Each output's standing
limitations are in its manual; an export reports only what concerns the print.
Catalog presence is not export support.

## Machine interoperability design

### Short-travel advisory

Export attaches `shortTravel` to every program's report, computed on the
prepared program path. Generation also records the neutral path's advisory. A travel is a maximal sequence of
non-depositing moves: lifts, traverses, descents, detours and sampled robot moves
remain one trip. Process-only events do not split it; stationary deposition does.
The check flags straight-line XYZ distance
between trip endpoints **at or below 5 line widths** (process scale; 2 mm at
0.4 mm), including coincident endpoints,
regardless of the distance traveled along the route. Required transitions are
counted as travels but never flagged: the approach before the first deposition,
the departure after the last, and a travel between depositions with different
known layer labels, where a nearby start is the intended path. A segment within
print resolution inside a stroke is not a travel.

Producers [connect nearby strokes by deposition](../path/README.md#scheduler-obligations),
so an ordinary print reports nothing. A finding is a bad-path report, not a
validity gate or automatic repair, and the agent tells the person about it. The
report includes total/count, `liftedCount` (trips that rose above both
endpoints because the producer found the direct line blocked, such as a gap
between neighboring islands), operation counts and up to 20 examples with
endpoints, the lifted flag and prepared-path action index, phase, layer and adjacent
operation labels. Missing labels remain unknown; recipe skills alone do not prove
which producer caused a travel. Shared motion facts accumulate during the writer’s existing stream pass.
Generation records it as
`plan.json` → `bundle.review.generation.checks.shortTravel`; `saam` print state
exposes it. Review, delivery and emitted bytes are unchanged by the
finding. Browser playback does not rerun the check.

### Output compatibility

SAAMpath generation validates authored geometry and process values independently
of machine capabilities. Machine profiles supply authoring defaults. They do not
filter skills, reject tool poses or synthesize poses from the selected machine.
Slice optionally derives upright orientation (default) or its surface normal; FIELD
can vary either enabled output. Toolpath publishes every full pose explicitly.

[Export preparation](./prepare-path.mjs) resolves actual-tool access and transfers, then installation startup/priming, material changes and axis-feed limits. It preserves neutral source; resolved execution and program bytes remain transient.
Only adapters enforce installed nozzle/material compatibility and required setup.
Studio always draws saved neutral execution. The Export report names installation startup/priming and service; estimates describe written commands.
Unsupported output errors occur after SAAMpath construction and carry `stage: export`.

| Action | Implemented outputs |
|---|---|
| XYZ deposition, dwell | Griffin, Bambu, Dobot, DENSO |
| Filament retraction and fan | Griffin, Bambu; relay outputs omit them with a named limitation |
| Stationary extrusion | Griffin, Bambu; relay outputs name unsupported stationary extrusion at export |
| Requested nozzle-temperature changes | Griffin, Bambu; relay outputs name externally arranged requests in limitations |
| Logical material/nozzle change | Bambu's declared service contracts |
| Derived orientation | Upright works on every output; non-upright poses need DENSO |

Only installation values needed to write the selected program block export.
Software review does not establish controller feasibility or physical extrusion.

The [Bambu contract](../../machines/bambu/SKILL.md#h2d-output-contract) owns its
installed-nozzle declarations, firmware service and physical evidence.

Preserve units, transforms, feature and material identity at every output boundary.

### Stationary extrusion and nozzle control

Optional `extrude` actions specify positive stationary volume and volumetric
flow; `temperature` actions specify a locked-recipe nozzle target up to 350 °C.
Griffin and Bambu write these actions without a generic flow cap. Relay outputs
reject stationary extrusion and name requested temperature changes for external
arrangement. Preheating alone does not execute a mid-print change; thermal waits
and actual temperatures are not simulated.
