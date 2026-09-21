# Machine interfaces and program output

## Implementation responsibilities

`6c_lua` exposes tokenization, parsing and bounded execution used by Dobot source
interpretation. `LuaRuntime` and its nested methods are one interpreter
responsibility; changing its accepted syntax or execution semantics requires the
[Dobot contract](dobot.md) and its interpreter tests, not only exporter checks.
`6d_archive` owns ZIP packing, unpacking and CRC integrity. `gcode-lines.mjs` owns
the shared line scan; it is a parsing helper rather than another dialect.
It accepts a string or synchronous iterable of text chunks, preserves commands
and CRLF across chunk boundaries, retains only an unfinished line and emits the
final remainder. Chunk boundaries have no modal meaning and establish no size
or validity policy; each interpreter still validates its commands.
Source-time evaluation is shared with machine presentation and Studio; preserve
units and modeled timing limits when changing it. The [test registry](testing.md#test-registry)
routes to dialect, source-player, streaming and round-trip coverage.

Machine capabilities, motion semantics and exporter/interpreter responsibilities.
Read the contract for the output being changed:

| Output | Contract |
|---|---|
| UltiMaker S5 / Griffin G-code | [Griffin](griffin.md) |
| Bambu H2D and X1 Carbon / sliced 3MF | [Bambu](bambu.md) |
| Dobot MG400 / Lua source ZIP | [Dobot](dobot.md) |
| DENSO VP-6242 / RC8 PacScript ZIP | [DENSO](denso.md) |

[Machine files](machine-files.md) hold capabilities and setup declarations.
[Print lifecycle](lifecycle.md) owns review and delivery of the checked output.

Ultimaker 2 Extended and Ultimaker 3 have
[geometry/setup profiles](machine-files.md#profiles-for-geometry-and-setup-review),
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

Machine profiles validate selected tool bounds, nozzle/core, filament,
material temperatures, flow/retraction and required skill capabilities. Profiles
own setup defaults; remembered setup is separate per machine. Skills target
compatible XYZ extrusion machines through this interface. Planar skills require
`planar`; drape and vase-wall additionally require `nonplanar` and a declared angle limit.
Production checks apply to interpreted export commands, including selected-tool
bounds, feeds and flow. [Validation integration](../6_output.md#command-validation)
locates the shared checker and adapter-specific paths.

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
Bambu Studio exports establish the bounded [H2D output contract](bambu.md#h2d-output-contract).
No physical H2D print has been validated.

Unavailable outputs are rejected. [Adapter dispatch](../6_output.md)
locates the exporter/interpreter owner. SAAMpath is an interoperability
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
See [writer and interpreter internals](../6_output.md#process-actions)
when changing their implementation.


## Changing output selection and shared checking

Sources: [registry.mjs](../../core/export/registry.mjs).

**Contract.** The closed registry selects a dialect only when the machine declares it and implemented is not false. Each adapter supplies emission and interpretation; an optional combined path can carry the interpretation of the exact emitted bytes forward once. The common boundary applies travel advisories and rejects oriented/rotary motion for outputs other than DENSO. A configured machine profile is not evidence that an exporter exists.

**Failures.** Unknown, undeclared or explicitly unavailable output fails before emission. A machine-specific reason is retained. Unsupported pose data must not be silently flattened; an advisory must not become a validation bypass or a blocking failure.

**Change together.** An output addition spans profile availability, registry, writer, interpreter, artifact naming, lifecycle checks, Studio source decoding and consumer tests. See [output compatibility](#output-compatibility) and the selected dialect contract.

**Verification.** Check unsupported profile rejection, dialect selection, exact-byte round trip and Studio decoding. Include action/pose capabilities and outputAvailability when changing profile support. Checks: [export.test.mjs](../../core/tests/export.test.mjs), [printer-profiles.test.mjs](../../core/tests/printer-profiles.test.mjs), [interoperability.test.mjs](../../core/tests/interoperability.test.mjs).


## Changing G-code writers and readers

Sources: [griffin.mjs](../../core/export/griffin.mjs), [bambu.mjs](../../core/export/bambu.mjs), [bambu-player.mjs](../../core/export/bambu-player.mjs), [bambu-tool-change.mjs](../../core/export/bambu-tool-change.mjs), [gcode-lines.mjs](../../core/export/gcode-lines.mjs).

**Contract.** A job may change nozzles only through a machine output's pinned nozzle-change block (`program.toolChange`): the writer renders it from numeric slots, the interpreter reads it whole and checks every line against the template, the departing nozzle, lift clearance, fans, counters and pre-heat time, and the profile's copy is pinned by digest. Writers consume SAAMpath plus locked setup; interpreters reconstruct commands into movements/events for independent checks and Studio. [Griffin](griffin.md) and [Bambu](bambu.md) own their distinct startup, shutdown, modal and artifact semantics. The Bambu writer/reader serves every Bambu model: a model's pinned envelope, output constraints, shutdown heights and package facts are data in its machine file's output declaration, never a branch on machine ID. Body metadata retains operation/phase/layer and command locations. Coordinate, filament, feed, time and volume rounding have separate budgets. The synchronous line iterator accepts a string or text chunks, preserves split commands/CRLF, and buffers only the unfinished line. Bambu archive emission may reuse the interpretation already required to calculate its package metadata.

**Failures.** Reject unsupported commands/parameters and inconsistent modal state according to the dialect contract. Do not accept an ignored motion command, substitute another model startup routine, or count firmware-managed service motion as physically simulated body motion. Truncated/corrupt archives fail before source use.

**Change together.** Trace writer quantization, modal feed/extrusion state, retract/recover, stationary deposition, temperature actions, reader source metadata and Studio compact-move transport. Preserve exact source identity when reusing checked interpretation.

**Verification.** Compare reconstructed endpoints, volume, bounds and timing; exercise relative/absolute extrusion, tiny segments, stationary events, chunk splits and dialect startup/ending fixtures. Checks: [export.test.mjs](../../core/tests/export.test.mjs), [bambu.test.mjs](../../core/tests/bambu.test.mjs), [modal-export.test.mjs](../../core/tests/modal-export.test.mjs), [gcode-stream.test.mjs](../../core/tests/gcode-stream.test.mjs), [h2d-tool-change.test.mjs](../../core/tests/h2d-tool-change.test.mjs), [h2d-two-color.test.mjs](../../core/tests/h2d-two-color.test.mjs).


## Changing robot source and bounded interpretation

Sources: [dobot.mjs](../../core/export/dobot.mjs), [dobot-player.mjs](../../core/export/dobot-player.mjs), [dobot-lua-subset.mjs](../../core/export/dobot-lua-subset.mjs), [denso.mjs](../../core/export/denso.mjs), [denso-player.mjs](../../core/export/denso-player.mjs).

**Contract.** Robot artifacts package explicit source files, not opaque movement caches. [Dobot](dobot.md) uses the bounded Lua subset and an explicitly configured relay-extrusion policy; [DENSO](denso.md) carries oriented/rotary commands and controller-space transforms. The same readers serve export checks and browser playback. Lua tokenization, parsing, variable/function execution and the bounded library are an interpreter, not host JavaScript evaluation. Generated source annotations preserve operation identity without replacing command semantics.

**Failures.** Unresolved installation data may permit geometry review but must reject export. Unsupported syntax/API calls, iteration/recursion budgets, source inconsistencies, invalid relay policy and unsupported machine actions fail explicitly. Nominal playback does not establish collision clearance, controller equivalence or measured extrusion.

**Change together.** Keep setup transforms, writer precision, robot speed/time model, artifact member names, interpreter accepted language, tool/rotary frame fields and machine-presentation sampling consistent. Expanding accepted language requires corresponding rejection and execution tests.

**Verification.** Use generated and hand-authored source, malformed/unsupported programs, setup transforms, relay start/stop, rotated tool poses and source-time continuity. Check emitted source semantics rather than matching only textual snapshots. Checks: [dobot.test.mjs](../../core/tests/dobot.test.mjs), [denso.test.mjs](../../core/tests/denso.test.mjs), [robot-playback.test.mjs](../../core/tests/robot-playback.test.mjs).


## Changing archive containers

Sources: [zip.mjs](../../core/export/zip.mjs).

**Contract.** ZIP32 archives use sorted members, fixed dates and deterministic raw deflate. packZip takes a nonempty Map; unpackZip returns member bytes in memory and never extracts paths. The reader checks central/local headers, member ranges, CRC/size, data descriptors and directory extent. Accepted names exclude path aliases and traversal. ZIP64, encryption, symlink entries, duplicate members and trailing/unreferenced data are outside this contract.

**Failures.** Invalid names, unsupported layout/method/flags, mismatched lengths/checksums, overlapping ranges and ZIP32 capacity overflows reject. Deflate output is bounded by the declared uncompressed length; that representational boundary is distinct from a project manufacturing-size policy.

**Change together.** Preserve byte determinism and every dialect member contract. Changing compression level changes hashes even when source is equivalent, so expect lifecycle export identity to change.

**Verification.** Use all three archive consumers, corrupted local/central records, duplicate names and truncated source members; confirm a valid round trip preserves each source byte. Checks: [bambu.test.mjs](../../core/tests/bambu.test.mjs), [dobot.test.mjs](../../core/tests/dobot.test.mjs), [denso.test.mjs](../../core/tests/denso.test.mjs).


## Changing shared source time and travel advisories

Sources: [source-time.mjs](../../core/export/source-time.mjs), [travel-advisory.mjs](../../core/export/travel-advisory.mjs).

**Contract.** frameAtTime binary-searches ordered move start times, returns completed/active/fraction/point and interpolates any controller/tool/rotary pose fields. Rest-to-rest records use their declared acceleration and peak speed; before the first move, empty sources and zero-duration boundaries have explicit results. Travel advisories summarize short complete travel trips between deposition using source/operation metadata. They are diagnostics attached to interpretation, not inserted repair moves.

**Failures.** Do not fabricate a physical speed model from source time or collapse rotary-frame interpolation into untransformed XYZ interpolation. Diagnostic limits/bounded examples must preserve full counts and cannot reject an otherwise valid program solely because a short trip exists.

**Change together.** Coordinate compact move fields, all dialect readers, machine presentation, playback/movies and source-report formatting. Preserve time discontinuities and stationary events when altering move indexing.

**Verification.** Check before/start/end times, dwell/retraction/stationary events, rotating frames, robot ramps and advisory attribution across multiple operations. Checks: [source-player.test.mjs](../../core/tests/source-player.test.mjs), [travel-advisory.test.mjs](../../core/tests/travel-advisory.test.mjs), [robot-playback.test.mjs](../../core/tests/robot-playback.test.mjs).


## Changing mechanism-study source

Sources: [machine-study.mjs](../../core/export/machine-study.mjs).

**Contract.** The explicit saam-machine-study-source/1 record contains initial TCP/Euler XYZ angles and nonempty timed commands. Interpretation emits ordinary source-time moves, event/volume summaries and an explicit study notice. Each command has positive finite duration, finite three-vectors and nonnegative volume; command positions/angles are retained for presentation.

**Failures.** Invalid schema/orientation/vectors/times/volumes reject. A study is not a controller dialect, manufacturing artifact or approval route. Its readable movement format must not make unavailable export capabilities appear implemented.

**Change together.** Keep the Studio study adapter, source decoder, Euler convention and presentation provider in agreement; manufacturing methods remain unavailable.

**Verification.** Check source parsing, angular interpolation, study display state and refusal of generation/approval/delivery. Checks: [machine-study.test.mjs](../../core/tests/machine-study.test.mjs).
