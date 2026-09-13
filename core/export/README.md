# Machine interfaces and program output

Machine capabilities, motion semantics and exporter/interpreter responsibilities.
Read the contract for the output being changed:

| Output | Contract |
|---|---|
| UltiMaker S5 / Griffin G-code | [Griffin](griffin.md) |
| Bambu H2D / sliced 3MF | [Bambu](bambu.md) |
| Dobot MG400 / Lua source ZIP | [Dobot](dobot.md) |
| DENSO VP-6242 / RC8 PacScript ZIP | [DENSO](denso.md) |

[Machine files](../../machines/README.md) hold capabilities and setup declarations.
[Print lifecycle](../print/README.md) owns review and delivery of the checked output.

## Machine interoperability design

`core/machine/profile.mjs` validates selected tool bounds and every installed
core/nozzle pair. [Generic material profiles](../../materials/README.md) own
filament diameter support, temperatures, flow, retraction and export identity.
The combined validator checks machine, active tool, nozzle, material, temperature,
flow, line width and layer height. Machine profiles own shipped setup defaults;
remembered setup is separate per machine and includes all tool slots. Skills target
compatible XYZ extrusion machines through this interface. Planar skills require
`planar`; drape and vase-wall additionally require `nonplanar` and a declared angle limit.
`checkMachinePath` remains available to developer tests; production checks run
on interpreted export commands, including selected-tool bounds, feeds and flow.
Dobot uses this shared function on commands reconstructed from Lua. Wedge uses the same profile validation and its bounded
eight-point generator, with S5, experimental H2D and configured Dobot output.

| Profile | Skill checks | Declared export and review |
|---|---|---|
| UltiMaker S5 | Fill, planar-infill, drape and bounded vase-wall on mesh/splines; bounded wedge | Griffin exporter/interpreter, same-file Studio review/delivery. |
| Bambu H2D | Fill, planar-infill, drape and bounded vase-wall on mesh/splines; bounded wedge | Experimental sliced-3MF exporter, checked firmware envelope and print-body interpreter; same-file review/delivery. |
| Dobot MG400 | Shared fill, planar-infill, drape, vase-wall and bounded wedge paths with synthetic configured installation checks | Experimental Lua source ZIP and bounded interpreter; same-file review/delivery. Setup is unconfigured by default; vendor project import is unverified. |
| DENSO VP-6242 / RC8 + rotary | Native pipe body/cladding plus fixed-orientation mesh/spline regional skills and bounded wedge, with synthetic setup | Experimental PacScript source ZIP and bounded interpreter; same Studio/lifecycle. Actual rotary/calibration and vendor execution unresolved; feasibility deferred. |

The H2D ships with a left 0.4 mm nozzle, 1.75 mm PLA proposal and experimental
15° non-planar limit, while Studio can select either head and any declared
0.2/0.4/0.6/0.8 mm hotend. The profile records official hardware/slicer sources,
separate nozzle work areas and conservative generic-material settings. The inherited left-tool height
is 320 mm; the advertised overall height is 325 mm. The supplied left/right
Bambu Studio exports establish the bounded [H2D output contract](bambu.md#h2d-output-contract).
No physical H2D print has been validated.

`core/export/registry.mjs` dispatches the selected output to its exporter and
interpreter; it rejects unavailable outputs. SAAMpath is an interoperability
boundary, not an automatic translator to every machine language. Current actions
are XYZ moves with deposition volume, retraction/recovery, fan and dwell for one
selected tool, plus optional part-frame tool orientation and an unwrapped rotary
angle. Existing XYZ-only adapters reject pose-bearing paths rather than discard
their orientation. New dialects need adapters; in-program tool changes and other
unsupported semantics need explicit representation extensions.
Preserve units, transforms, feature identity and material ownership across every
boundary. A common extension or file suffix alone does not establish compatibility.
