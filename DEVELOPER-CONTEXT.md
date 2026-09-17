# Developer context bin

## Orientation

This bin holds implementation context for the region maps to absorb. A mapped
region owns its structural account and supporting contracts; delete the matching
bin material when absorbed rather than maintain two accounts.

Read the system overview, the affected region maps, their shared-use references
and the source they name. The [map contract](BUILDERS.md#maps-and-local-documentation)
also governs useful supporting prose and local comments. Builders follow the same
route when changing core/Studio or investigating their internals. Skill-script
changes need skill guidance and consumed API contracts. Role inheritance
is about responsibilities, not loading every manual. Developers load
[MAKERS.md](MAKERS.md), [print tools](core/print/USAGE.md) or
[skill authoring](skills/DEVELOP.md) when their task needs that context.

Onboarding reads this orientation, not every implementation slice below. Read
only the relevant section through `read-guidance DEVELOPER-CONTEXT.md#HEADING`.

### Implementation slices

- [Agent toolkit — implementation and verification](#agent-toolkit--implementation-and-verification)
- [Machine output — stationary extrusion and nozzle control](#machine-output--stationary-extrusion-and-nozzle-control)
- [Studio — historical toolpath inspection](#studio--historical-toolpath-inspection)
- [Regions — planar offset kernel](#regions--planar-offset-kernel)
- [Regions — perimeter recovery](#regions--perimeter-recovery)
- [Regions — surface offset construction](#regions--surface-offset-construction)
- [Regions — offset verification and provenance](#regions--offset-verification-and-provenance)
- [Regions — intersection kernel](#regions--intersection-kernel)
- [Regions — intersection verification and provenance](#regions--intersection-verification-and-provenance)
- [Studio — request indexing and persistence](#studio--request-indexing-and-persistence)
- [Studio — request presentation implementation](#studio--request-presentation-implementation)
- [Machine output — validation integration](#machine-output--validation-integration)
- [Machine output — adapter dispatch](#machine-output--adapter-dispatch)

### Contracts and scoped implementation references

These are not whole-document developer-only reads. Consume the interface
contract when building a caller; read internal mechanics when changing that
implementation. The region maps absorb the structural account without copying
it into role-specific narratives.

| Scope | Owning reference and required audience |
|---|---|
| System boundaries | [Core architecture](core/README.md): builders and developers tracing producers and consumers. |
| Geometry | [Geometry contracts](core/geom/README.md): skill builders need query, precision and representation contracts; kernel changes need implementation context. |
| Regions | [Regions](core/region/README.md): builders consume offset/intersection contracts and material interfaces; kernel internals are collected below. |
| Skill results and motion | [Composition](core/path/README.md): skill builders need operation/dependency/travel contracts; scheduler changes need implementation context. |
| Print lifecycle | [Lifecycle](core/print/README.md): builders extending plans, generation or delivery need these contracts. Makers use [print tools](core/print/USAGE.md). |
| Output | [Machine output](core/export/README.md): makers need output limits; builders need action and capability contracts; adapter internals are collected below and in dialect references. |
| Studio | [Studio](studio/README.md), [rendering](studio/RENDERING.md) and [kinematics](studio/KINEMATICS.md): builders extending those surfaces need their relevant contracts and mechanics. |
| Machine presentation | [Machine models](core/machine/README.md): presentation/provider implementations, source-time evaluation and installation limits. |
| Machine declarations | [Machine files](machines/README.md): setup limits for makers and capability/profile format for builders and developers. |
| MCP | [Adapter implementation](adapters/mcp/DEVELOP.md): builders or developers changing the adapter. |
| Checks and measurements | [Tests](core/tests/README.md), [benchmarks](scripts/bench/README.md): read for the concrete verification task. |
| Skill authoring | [Skill development](skills/DEVELOP.md) and package `DEVELOP.md` files: builder-facing implementation context, with shared contracts at their owners. |

## Implementation bin

### Agent toolkit — implementation and verification
Source: [core/agent/README.md](core/agent/README.md).

[toolkit.mjs](core/agent/toolkit.mjs) composes exported owning APIs; the thin
[CLI](scripts/agent-toolkit.mjs) validates arguments and handles JSON output
and process lifetime. [manuals.mjs](core/agent/manuals.mjs) is shared with MCP
through its compatibility re-export. The browser opener and request wait/claim
implementation are also shared with MCP. No new MCP onboarding or preview tools
are registered.

Focused coverage lives in [agent-toolkit.test.mjs](core/tests/agent-toolkit.test.mjs):
current-source context, isolated setup reuse, approval/export preservation on
reopening, STL import, fresh tours, request coordination, partial failure and
the actual managed CLI launcher. Existing manual-access, MCP and Studio request
tests cover the shared seams. Select checks under
[check policy](BUILDERS.md#avoid-check-spirals).

### Machine output — stationary extrusion and nozzle control
Source: [core/export/README.md](core/export/README.md).

The [action contract](core/export/README.md#stationary-extrusion-and-nozzle-control)
defines the inputs and supported outputs. Griffin and H2D's common motion writer converts
stationary volume to E-only `G1` commands in the selected absolute/relative mode.
The interpreter resolves retraction debt first, then counts unretracted positive
E-only deposition as volume and duration at a fixed position. These commands
produce zero-length display moves and `injection` events with position, volume,
temperature and source time. Studio uses the same source interpreter.

The writer emits `M400` followed by `M109 S` at the
composer's parked position and restores the normal target after the operation.
Thermal wait durations and actual temperatures are not simulated. These are the
existing dialect commands; do not assume a generic Marlin `M109 R` cooling mode
is portable to both outputs. Firmware behavior still needs physical verification.
Relay robot outputs explicitly reject the new actions.

### Studio — historical toolpath inspection
Source: [studio/README.md](studio/README.md).

For an explicitly requested historical toolpath inspection, a local scratch
launcher may pass `resolveBundle` to `createStudio`. The resolver supplies a
scratch adapter over `createBundleWorkflow`; Studio keeps its existing source
playback, print picker and lifecycle. The default CLI and known adapters are
unchanged. This is explicit development injection, not automatic discovery or
permission to load module paths from a print. Record the original revision and
settings, distinguish historical stroke geometry from modern export assumptions,
and verify the interpreted deposition against the source generator.
An adapter's optional `inspection` presentation supplies a title, description,
facts/settings rows and note for a development tour. Studio then exposes settings
for reading and hides its approval button; the scratch adapter must independently
reject approval and delivery. This presentation does not grant production rights.

### Regions — planar offset kernel

Source: [core/region/README.md](core/region/README.md).

The [adapter](core/region/clipper.mjs) uses the same pinned Clipper2 C++/WASM
[kernel](core/region/clipper2.mjs) as general booleans. There is one initialized
WASM instance, with bulk integer-coordinate transfer and shared native-memory
ownership. All skills use this boundary for closed planar offsets, including
supports, pipe substrate, material regions and comb travel. There is no Clipper 6
runtime dependency or fallback. Input normalization
and polygon inflation use Clipper2, with nonzero winding and upstream topology
construction. Inflation already unions its output internally; do not add a
second output-normalization union. SAAM selects **closed material
polygons**: an inset yields remaining material, rather than a stroke band on
both sides of a boundary. Point-touching components, holes and collapse retain
regression coverage; their construction is owned by the shared kernel.

### Regions — perimeter recovery

Source: [core/region/README.md](core/region/README.md).

`perimeterLoops` in [perimeters.mjs](core/region/perimeters.mjs) is the shared
deposition-contour wrapper used by full-fill and planar-infill. It retains a
single central closed track when an outer/hole pair meets and material erosion
loses that hole. A surviving hole must still contain the original hole; tiny
quantization rings do not suppress central-track recovery merely by matching
the original hole count. Candidate fronts use the existing 0.001 mm chord target and
are compared within the sum of their two chord tolerances. Only their boundary
band is replaced; disconnected/nested islands and other holes remain accounted
for. Polygonal approximation and integer rounding can leave small material
remnants where ideal curved fronts coincide; these remain in `offsetRegion`'s
result. Recovery changes deposition contours without changing region erosion, fill
masks, machine output interfaces or approval workflow. General medial-axis,
open centerline and variable-width gap fill remain unimplemented.

### Regions — surface offset construction

Source: [core/region/README.md](core/region/README.md).

It constructs geodesic boundary strips
and round corner sectors using native NURBS first/second derivatives and an
adaptive Runge-Kutta integrator. The shared Clipper2 union/difference and winding
implementation combines the swept bands with the source material and resolves
holes, nesting and collapse. The distance construction is **new SAAM code**,
not copied Rhino source. RhinoCommon's public `OffsetOnSurface` wrapper calls
a native modelling routine whose implementation is not in the public source.
No Rhino output fixture has been supplied or run; do not claim Rhino equivalence.

### Regions — offset verification and provenance

Source: [core/region/README.md](core/region/README.md).

Development checks compare 90 nested/neck/star/island/collapse cases, inward and
outward with all three joins, against the **unmodified Clipper2 C# kernel** at
the pinned upstream revision. The reference uses the same material-region
normalization, integer grid and polygon offset options; its fixture records
source/input hashes and provenance. Historical Clipper 6 coordinates remain in
their original fixture, rather than being relabeled as Clipper2 results. Round
arc segmentation can differ between kernel versions. Surface checks cover flat nesting/collapse,
an inclined plane with rescaled UV, an independently unrolled rational cylinder,
and refinement of nested regions on a doubly curved quadratic surface. These
are software tests, not universal correctness or physical print validation.

```sh
node --test core/tests/offset.test.mjs core/tests/surface-offset.test.mjs
node scripts/bench/offsets.mjs > .local/offset-timings.json
```

To regenerate the independent Clipper2 reference, fetch the revision listed in
[planar intersection provenance](core/region/README.md#shared-planar-intersections) into ignored
`.local/intersection-native-reference`, then use .NET 8:

```sh
node --input-type=module -e "import fs from 'node:fs'; import {offsetFixtures} from './scripts/bench/offset-fixtures.mjs'; fs.mkdirSync('.local/clipper2-offset-reference',{recursive:true}); fs.writeFileSync('.local/clipper2-offset-reference/inputs.json',JSON.stringify(offsetFixtures));"
dotnet build scripts/bench/clipper2-offset-reference.csproj --artifacts-path .local/clipper2-offset-reference/artifacts
dotnet .local/clipper2-offset-reference/artifacts/bin/clipper2-offset-reference/debug/clipper2-offset-reference.dll .local/clipper2-offset-reference/inputs.json > .local/clipper2-offset-reference/expected.json
node scripts/bench/check-clipper2-offset-reference.mjs .local/clipper2-offset-reference/expected.json --record
```

The checker records the independent C# output after comparison with WASM; it
does not manufacture expected coordinates from the production adapter.
Normal `npm ci`/`npm test` needs neither .NET, a network fetch nor Rhino desktop.
The current kernel carries the upstream Boost Software License 1.0.
Historical plugin C# provenance and its runner remain in
`core/tests/fixtures/clipper-reference.json` and
`scripts/bench/clipper-reference.cs`; they describe the superseded Clipper 6
comparison. The original surface investigation references the public
[Rhino wrapper](https://github.com/mcneel/rhino3dm/blob/main/src/dotnet/opennurbs/opennurbs_curve.cs).

Historical costs and diagnostic outcomes are in the
[devlog](DEVLOG.md#2026-09-09--clipper-6-and-surface-offset-measurements).
The benchmark runner reports cold time, warm samples, source/output hashes and
usage; measure the current kernel before making a current performance claim.

### Regions — intersection kernel

Source: [core/region/README.md](core/region/README.md).

The adapter uses pinned `clipper2-wasm@0.4.0`, C++ Clipper2 2.0.1 compiled to
WebAssembly, with upstream `Clipper64`, `NonZero`, `PreserveCollinear=false`.
Intersection, winding and topology construction stay intact. Unused upstream
functions are not exposed by SAAM; the packaged Z build uses zero/unused Z.
The shared [kernel module](core/region/clipper2.mjs) initializes once for offsets
and booleans together; operations remain synchronous.
Allocated WASM objects are released on success/failure. Normal installation and
tests need no compiler or Rhino desktop; operations need no network at runtime.

### Regions — intersection verification and provenance

Source: [core/region/README.md](core/region/README.md).

Tests include the captured 60-vertex STL failure, analytic nesting, contacts,
slivers, nearly parallel crossings through coincidence, translation/scaling,
repeated operations and 200 seeded rectangle-set cases checked by independent
cell classification. Another 138 star/nesting/contact/sliver/STL cases match the
unmodified upstream C# results exactly in coordinates and topology. Agreement
checks integration; it is not an independent proof of the upstream algorithm.
The original 1078-triangle STL passes every offset/solid-mask diagnostic layer.

```sh
node --test core/tests/intersection.test.mjs
node scripts/bench/intersections.mjs
node scripts/bench/diagnose-regions.mjs .local/slicing-rhino/rhino-standard.stl .local/intersection-diagnostics
```

Reference provenance: [WASM source](https://github.com/ErikSom/Clipper2-WASM/tree/3c244f3edd0adae6c851460fc409c15f3d235395),
[Clipper2 source](https://github.com/AngusJohnson/Clipper2/tree/642390d0d515cfb645d2ec4d95d218e28be645f4),
Boost Software License 1.0. Installed WASM SHA-256:
`429e866b4d7813cabfa7d31e6650825343109fb7d7a1702c533e8597573449ec`.
To regenerate the saved reference, fetch that Clipper2 revision into ignored
`.local/intersection-native-reference`, then use .NET 8:

```sh
node scripts/bench/intersections.mjs --inputs .local/intersection-inputs.json
dotnet build scripts/bench/intersection-reference.csproj --artifacts-path .local/intersection-reference-artifacts
dotnet .local/intersection-reference-artifacts/bin/intersection-reference/debug/intersection-reference.dll .local/intersection-inputs.json > .local/intersection-reference-output.json
node scripts/bench/intersections.mjs --reference .local/intersection-reference-output.json --record
```

The [devlog](DEVLOG.md#2026-09-09--intersection-and-twisted-fixture-measurements)
preserves the initial kernel timings and public-workflow observations. Current
benchmark output records CPU, Node, samples and source/output hashes; differences
in draped coverage limit comparisons between backends.

### Studio — request indexing and persistence

Source: [studio/README.md](studio/README.md).

JSON request files remain authoritative; no database, migration or Node minimum
change is required. A process-local index watches changed records and reconciles
file metadata every five seconds to recover missed notifications. Warm operational
polls avoid history reads/scans and return unfinished work plus the latest edit
outcome per print, including completed results still awaiting display.
Studio polls select only its open print; the agent listener covers the library.
Explicit `list()` / MCP `get_studio_requests` with `history: true` retains complete diagnostic
history and forces reconciliation. Cold discovery and periodic reconciliation
still scale with file count, and index memory scales with request history.
This index does not make cross-process claims or read/modify/write operations
transactional. Run one handling agent per request; independent writers can race.
Print, request and tour writes use unique temporary files and bounded retries
for Windows sharing conflicts; a failed replacement retains the previous file.

### Studio — request presentation implementation

Source: [studio/README.md](studio/README.md).

`work-state.mjs` owns request activity and presentation matching for the UI and
tour gates. `agent-requests.mjs` persists those records; `agent-ui.mjs` merges
request snapshots by update time, so an older response cannot revive finished
work. `app.mjs` owns preview loading. Tour metadata (including lesson readiness
and start-layer choices) updates without reloading source or stopping playback.
Only changed bundle content or a changed geometry/program data requirement
triggers a full refresh. Listener waits are agent coordination, not preview work.
View-ready responses return the presentation receipts they wrote, so the browser
can settle those requests without a second acknowledgement or full state read.

### Machine output — validation integration

Source: [core/export/README.md](core/export/README.md).

[profile.mjs](core/machine/profile.mjs) owns validation of the
[machine capability contract](core/export/README.md#output-compatibility).

`checkMachinePath` remains available to developer tests; production checks run
on interpreted export commands, including selected-tool bounds, feeds and flow.
Dobot uses this shared function on commands reconstructed from Lua. Wedge uses the same profile validation and its bounded
eight-point generator, with S5, experimental H2D and configured Dobot output.

### Machine output — adapter dispatch

Source: [core/export/README.md](core/export/README.md).

`core/export/registry.mjs` dispatches the selected output to its exporter and
interpreter; it rejects unavailable outputs.
