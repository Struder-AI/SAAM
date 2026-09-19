# Machine interfaces and program output

Machine capabilities, motion semantics and exporter/interpreter responsibilities.
Read the contract for the output being changed:

| Output | Contract |
|---|---|
| UltiMaker S5 / Griffin G-code | [Griffin](./griffin.md) |
| Bambu H2D and X1 Carbon / sliced 3MF | [Bambu](./bambu.md) |
| Dobot MG400 / Lua source ZIP | [Dobot](./dobot.md) |
| DENSO VP-6242 / RC8 PacScript ZIP | [DENSO](./denso.md) |

[Machine files](../../machines/README.md) hold capabilities and setup declarations.
[Print lifecycle](../print/README.md) owns review and delivery of the checked output.

Ultimaker 2 Extended and Ultimaker 3 have
[geometry/setup profiles](../../machines/README.md#profiles-for-geometry-and-setup-review),
but no implemented output contract. X1 Carbon shares the H2D exporter with its
own pinned envelope; the H2D envelope does not apply to it. S5 startup is not
assumed for UM3. UM2 Extended uses volumetric UltiGCode rather
than the filament-length extrusion used by Griffin. Their declared output
limitations are reported before path generation; catalog presence is not export support.

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
Generation records it as `checks.json.shortTravel`; CLI/toolkit summaries and MCP
print state expose it. Review, approvals, delivery and emitted bytes are unchanged
by the finding. Browser playback does not rerun the check.
Studio's read-only machine-study adapter applies the same advisory to its authored
motion and caches it by source text.

### Output compatibility

Machine profiles validate selected tool bounds, nozzle/core, filament,
material temperatures, flow/retraction and required skill capabilities. Profiles
own setup defaults; remembered setup is separate per machine. Skills target
compatible XYZ extrusion machines through this interface. Planar skills require
`planar`; drape and vase-wall additionally require `nonplanar` and a declared angle limit.
Production checks apply to interpreted export commands, including selected-tool
bounds, feeds and flow.

| Profile | Skill checks | Declared export and review |
|---|---|---|
| UltiMaker S5 | Fill, planar-infill, drape and bounded vase-wall on mesh/splines | Griffin exporter/interpreter, same-file Studio review/delivery. |
| Bambu H2D | Fill, planar-infill, drape and bounded vase-wall on mesh/splines | Experimental sliced-3MF exporter, checked firmware envelope and print-body interpreter; same-file review/delivery. |
| Bambu X1 Carbon | Planar skills only (no nonplanar capability declared); PLA output | The H2D exporter, interpreter and package writer with the X1's own pinned envelope and machine-file package facts; same-file review/delivery. |
| Dobot MG400 | Shared fill, planar-infill, drape and vase-wall paths with synthetic configured installation checks | Experimental Lua source ZIP and bounded interpreter; same-file review/delivery. Setup is unconfigured by default; vendor project import is unverified. |
| DENSO VP-6242 / RC8 + rotary | Native pipe body/cladding plus fixed-orientation mesh/spline regional skills, with synthetic setup | Experimental PacScript source ZIP and bounded interpreter; same Studio/lifecycle. Actual rotary/calibration and vendor execution unresolved; feasibility deferred. |

The user selected H2D left 0.4 mm nozzle, 1.75 mm PLA and experimental 15°
non-planar limit. The profile records official hardware/slicer sources, separate
nozzle work areas and conservative PLA settings. The inherited left-tool height
is 320 mm; the advertised overall height is 325 mm. The supplied left/right
Bambu Studio exports establish the bounded [H2D output contract](./bambu.md#h2d-output-contract).
No physical H2D print has been validated.

Unavailable outputs are rejected. SAAMpath is an interoperability
boundary, not an automatic translator to every machine language. Current actions
are XYZ moves with deposition volume, retraction/recovery, fan and dwell for one
selected tool, plus optional part-frame tool orientation and an unwrapped rotary
angle. Existing XYZ-only adapters reject pose-bearing paths rather than discard
their orientation. New dialects need adapters; in-program tool changes and other
unsupported semantics need explicit representation extensions.
Preserve units, transforms, feature identity and material ownership across every
boundary. A common extension or file suffix alone does not establish compatibility.

### Stationary extrusion and nozzle control

Optional `extrude` actions specify positive stationary volume and volumetric
flow; `temperature` actions specify a nozzle target within the locked recipe and
machine/material ranges. Griffin and H2D support these actions; relay robot
outputs reject them. Thermal wait duration and actual temperature are not simulated.
