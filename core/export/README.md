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

X1 Carbon, Ultimaker 2 Extended and Ultimaker 3 have
[geometry/setup profiles](../../machines/README.md#profiles-for-geometry-and-setup-review),
but no implemented output contract. The H2D envelope does not apply to X1, and
S5 startup is not assumed for UM3. UM2 Extended uses volumetric UltiGCode rather
than the filament-length extrusion used by Griffin. Their declared output
limitations are reported before path generation; catalog presence is not export support.

## Machine interoperability design

### Short-travel advisory

Shared export/interpretation attaches `summary.shortTravel` to every program,
including saved programs reopened in Studio. A travel is a maximal sequence of
non-depositing moves: lifts, traverses, descents, detours and sampled robot moves
remain one trip. Process-only events do not split it; stationary deposition does.
Initial and final travels are included. The check flags straight-line XYZ distance
between trip endpoints **at or below 2 mm**, including coincident endpoints,
regardless of the distance traveled along the route.

This is a bad-path advisory for later producer improvement, not a validity gate
or automatic repair. The report includes total/count, operation counts and up to
20 examples with endpoints and source file/line, phase, layer and adjacent
operation labels. Missing labels remain unknown; recipe skills alone do not prove
which producer caused a travel. The check is one linear scan of interpreted moves,
cached with the owning program and included in source-only worker handoff.
Generation records it as `checks.json.shortTravel`; CLI/toolkit summaries and MCP
print state expose it. Review, approvals, delivery and emitted bytes are unchanged
by the finding. Browser playback does not rerun the check.
Studio's read-only machine-study adapter applies the same advisory to its authored
motion and caches it by source text.

### Output compatibility

`core/machine/profile.mjs` validates selected tool bounds, nozzle/core, filament,
material temperatures, flow/retraction and required skill capabilities. Profiles
own setup defaults; remembered setup is separate per machine. Skills target
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

The user selected H2D left 0.4 mm nozzle, 1.75 mm PLA and experimental 15°
non-planar limit. The profile records official hardware/slicer sources, separate
nozzle work areas and conservative PLA settings. The inherited left-tool height
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

### Stationary extrusion and nozzle control

Shared `extrude` actions carry positive volume and volumetric flow; `temperature`
actions carry a nozzle target. Griffin and H2D's common motion writer converts
stationary volume to E-only `G1` commands in the selected absolute/relative mode.
The interpreter resolves retraction debt first, then counts unretracted positive
E-only deposition as volume and duration at a fixed position. These commands
produce zero-length display moves and `injection` events with position, volume,
temperature and source time. Studio uses the same source interpreter.

Operation temperature targets are validated against the locked recipe and
machine/material ranges. The writer emits `M400` followed by `M109 S` at the
composer's parked position and restores the normal target after the operation.
Thermal wait durations and actual temperatures are not simulated. These are the
existing dialect commands; do not assume a generic Marlin `M109 R` cooling mode
is portable to both outputs. Firmware behavior still needs physical verification.
Relay robot outputs explicitly reject the new actions.
