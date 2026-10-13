# Print lifecycle and persistence

The [maker workflow](../../MAKERS.md#maker-interaction-flow) defines human interaction;
[composition](../path/README.md) and [export](../export/README.md) own generation operations.

## Downloaded mesh attribution

The [Thingi10K skill](../../skills/thingi10k/SKILL.md) supplies hash-matched attribution
to the importer, retained in `geometry.source.attribution` with source hash/bytes.
Unit corrections and wrappers preserve it. Delivery writes `source-attribution.json`
with the source record and current plan revision beside the reviewed program.

## Generation and review

Studio's Export click confirms displayed settings and exact checked bytes once.
Bundle retains one completed output with its immutable recipe, machine, geometry
and SAAMpath snapshot. Toolpath supplies finalized deposition operations and their
prerequisites. Bundle saves that graph before Scheduling reads it and writes the
associated motion artifact; both share one path identity and guarded manifest commit. Any edit keeps it visible and exportable with its original
settings and machine, marked as the previous toolpath; a saved SAAMpath without one
stays visible the same way. Only regeneration dims it and blocks export;
failure/cancel restores it. Agent activity never gates it.

`workflow.mjs` owns snapshots, revisions, regeneration and delivery;
`review-state.mjs` supplies the shared eligibility selector. The output id
guards display and export, `editRevision` authored changes, `revision` every commit.
Geometry includes solids, curves and points; recipe/machine may be incomplete.
Operations report missing prerequisites; opening/retry never generates ordinary output.

Geometry owns admission and reusable preparation from the recipe's single geometry.
Workers transfer that shape with its owned derived data; Bundle never accepts an
independently paired artifact. Reports persist in the geometry descriptor; unchanged
and loaded geometry stay exact. Technique semantics are checked at edit
and regeneration after prerequisites exist; saved geometry needs no extension rerun.

[Settings](../machine/settings.mjs) owns reusable profiles, defaults and remembered
setup. Its [selection/recording API](../machine/bundle-settings.mjs) submits exact
snapshots to Bundle with an expected revision; Bundle owns invalidation/history.
`recordExtensionDependency` records supplied plastic-weld configuration
in existing `plan.skills`; absence means unselected. No defaults or execution occur.
Geometry/construction references retain their own dependencies. Reusable changes
never refresh existing bundles; manuals use saved capabilities.

Bundle is the only writer, so each commit records its consequences instead of
hashing content: a new `revision`; a new `editRevision` when plan, machine or
geometry change; a new `geometryInputId` or `pathInputId` when geometry,
spatial instructions or Toolpath's `pathDependencies` change (unknown inputs count as
changed). Deposition is built in the part's frame; placement is an XY offset applied
at display and program writing, so it keeps the path. Undo/redo restore them. Geometry, SAAMpath and program get ids when
written; a path is current while its input id is, a program while its
`editRevision` is, each with an unchanged contract. Export-only setup fields,
selected machine/output, process values across a machine change and disabled optional skills keep the path.
`state.artifacts` distinguishes current, retained stale and absent results.
Edits retain artifacts; old bytes never become current by omission.

`restoreRevision(directory,{direction,expectedRevision})` restores history at a fresh
revision; new edits clear redo. Immutable records share large
artifacts.

`shareBundle(directory,newZip)` packages current recipe, machine/settings,
original source/repair provenance and selected extension dependency files.
`importBundle(zip,newDirectory)` verifies inputs and imports extensions without execution;
saved review state, listed non-input files and inconsistent source/repair provenance
are left out and named in its notes. Existing bundles/local edits are never overwritten. Open the returned directory in Studio.
Native geometry is rebuilt; toolpaths, programs, checks, history and caches are excluded;
recipients edit/regenerate and confirm before export. Print-ready delivery stays separate.

### Bundle ownership

Studio reserves a bundle on open; a second instance cannot open it. `withBundleInstance` carries that reservation into writes and generation workers. Export uses the existing reservation.
Claims, releases and manifest commits share `.bundle-write.lock`; commits compare revisions and atomically replace `plan.json`. Interrupted writes may leave unreferenced records.
The reservation releases on switch or shutdown, never by timeout. `saam` operations `get_bundle_instance` and `recover_bundle_instance` inspect and reclaim a dead Studio PID. An interrupted write lock needs separate PID inspection and explicit removal.
Power-loss durability beyond atomic replacement is not claimed.

`generateBundle` is the one generation: it saves the SAAMpath from the recipe
alone and writes the program only when a machine, its exporter and installation
are supplied (`programReadiness`); otherwise it returns what is missing.
Active edits/generation compare its source stamp with the installed release
and selected extensions. Changed or unstamped sources invalidate prior output and
confirmation; unchanged sources retain output-only reuse. Viewing/delivery use saved
artifacts without extension code. Changed loaded scripts require restarting SAAM.
Preparation leaves the manifest unchanged; commit checks sources and revision.
Saved paths survive restarts/history; delivery copies the confirmed checked bytes.

`loadBundleSnapshot` supplies Studio one persisted revision, artifact currency,
history, review and checked program, tagged by `revision` and by a presentation
tag (edit revision, geometry id, output id) that delivery and mode leave unchanged.
Studio owns polling, pending requests and job progress separately; no subscription
API or click-time Export gate is implied. `generateBundle` runs the generation
worker under the caller's reservation; its `signal` cancels before any output,
check or review write, until `beforeCommit` is acknowledged; then commit finishes.

## Validate at the boundary that owns the data

Validate geometry on ingestion or changed content; reuse identity-bound evidence
and prepared queries across settings, slicing and review. Viewing baked geometry
does not depend on rereading its archival STL. Import and source-consuming edits
still check the source. Public raw inputs require admission; owned immutable
recipes and SAAMpaths reuse it across internal calls.

Before adding a check, identify its owner, changed inputs and new failure it can
detect. Otherwise reuse or remove it. Never add a public skip-validation switch.
Bound reuse to relevant content and validator identity, protect shared results
from mutation and evict cached values without changing acceptance.

| Boundary | Work owned there |
|---|---|
| Geometry ingestion or changed geometry bytes | Topology, intersections, units, native/source identity; prepare reusable geometry queries. |
| Bundle creation/edit/open | Component integrity, references and expected revision; no completeness or machine-compatibility gate. |
| Skill construction | Preconditions that first become knowable from the actual section, offset, support region or operation dependency being constructed. |
| Machine emission and interpretation | Validate the emitted command state and quantized motions once; those commands can differ from the producer's unrounded path. |
| Reopening | Check saved artifacts and interpret machine commands; never regenerate unchanged output. |
| Studio Export | Deliver the displayed result’s held bytes; availability follows Studio's pending state. |

An exporter that already interprets its emitted body for package totals must
return that result with the exact bytes through `exportAndInterpretProgram`.
Do not immediately parse it again. An untrusted archive still needs its own
integrity and source interpretation boundary. Likewise, checking a new offset
for the topology its algorithm requires is different from repeating validity
of the original mesh.

Measure geometry preparation, sectioning/offsets,
composition, emission, interpretation and viewer loading separately when
latency is reported. Name the work actually running in the UI. Do not hide
minutes of slicing or mesh work under a label about saving a confirmation.
For the current spiral-mesh slicing work, the user's target is 10–12 seconds;
this is a performance objective to measure, not a new production rejection
rule, and it has not yet been achieved. Check that invalid changed input still
fails and unchanged input avoids redundant work. Use regression tests and
opt-in profiling, not additional production scans to police these principles.

Support/rim producers consume shared plan validation; repeated control-net
checks reuse content validity. H2D carries body interpretation through packaging
and renders each distinct thumbnail size once. Griffin validates the input path
through its motion writer; Dobot setup checks installation fields in one pass.
Derived-section topology, material/support intersections, dependency cycles,
numerical budgets and machine commands are checked where those inputs first
exist. See the [validation work record](../../DEVLOG.md#br-039--remove-repeated-validation-and-make-slicing-progress-truthful).

## Print bundle and current formats

[Blob fields](../../GEOMETRY.md#blob-field) use `shape: "blob-field"` records with the points,
extraction settings and checked manufacturing mesh retained together in the
recipe geometry. Shared generation sections that mesh; Studio displays the same arrays.
Field edits rebuild the mesh through the `blob_field` tool; a generic recipe
patch cannot edit compiled geometry.

The shared workflow stores one directory per print:

```text
Prints/<name>/
  plan.json                         # atomic plan + bundle manifest
  geometry/<geometry-id>.3dm        # spline native data only
  geometry/<geometry-id>.descriptor.json # source snapshot shared by history
  paths/<path-id>.json               # constructed SAAMpath operation graph
  paths/<path-id>.motion.json        # downstream scheduled motion
  history/<record-id>.json           # immutable component/history records
  exports/<output>/<output-id>-<name>
  delivery/part.gcode
```

`plan.json` owns the recipe, locked machine, review and immutable artifact references.
It is the only mutable commit point; `delivery/` holds what the person exported.
The first read of a bundle in the earlier split-file layout converts it, as any
commit does: it replaces only `plan.json`, keeps every original file, and records
a `converted` history event that `limitations` notes until the next change.
Conversion remains while supported or distributed print roots contain split-file
bundles, until a bounded inventory reaches zero in a documented release. The lifecycle and SAAMpath formats
are shared; the shell plan/geometry schemas are in [Formats](#formats) below:

- `saam-print-bundle/3`: the reserved `bundle` envelope owns machine, review and
  artifact references. Derived views omit duplicated plain mesh arrays; `/2` remains readable.
  Older `/2` readers refuse `/3`. Portable input-only ZIPs retain `/2` recipes;
  an emptied STL keeps its source bytes/provenance in a `saam-print-package/2` ZIP.
- `saam-machine/1`: millimeter bounds, nominal axis limits, tools, output options
  and the declared firmware startup contract. Output options carry program
  header, start and end templates; these are part of the locked machine snapshot.
- `saampath/1`: constructed deposition operations with `after` prerequisites and
  material geometry data, or scheduled neutral actions. `readConstructedPath` reads
  the graph; `readDrawnPath` reads its motion. Earlier linear paths remain readable.
  Moves use absolute XYZ mm, speed mm/s and deposited volume mm³; retraction uses
  filament mm. Phase/layer labels describe moves without determining geometry.
- `saam-review/1`: the manifest's history, path and
  generation records and a small generation summary for display (never
  playback geometry). Its generation record owns `saam-checks/1` software
  checks and limitations.

`loadBundle` reads what SAAM wrote without re-hashing, regenerating or requiring
complete settings. Content hashes are taken once where bytes arrive from outside
SAAM: an imported STL and extension packages. Prints saved before these ids
are read once by `savedBundle`, which drops undo history, old hashes and a program
saved without its SAAMpath (kept in `exports/`; the print shows no toolpath until generated).

The adapter caches interpretations by output id. Reopening interprets saved
commands on a miss; it never regenerates. Export copies the displayed bytes.
Use `examples/prints/` only for explicitly curated examples.

## Shell pipeline (slices and draped-skin)

`core/print/bundle.mjs` adapts shell plans to the [shared lifecycle](#generation-and-review).
Toolpath supplies completed operations to Bundle; [Scheduling](../path/README.md#skill-result-composition) reads the saved result.
A failing assignment produces nothing and the rest generates; its error, open sections
and references ending inside the part are notes in `limitations`.
Their manuals own supported settings and process limits; software checks do not
establish successful physical printing. The plan's geometry is authored
([GEOMETRY.md](../../GEOMETRY.md)): spline patches, indexed triangle meshes,
blob fields, [booleans](../../GEOMETRY.md#booleans) of these and an `assembly` of any of them. A boolean is stored
as its recipe in the native JSON asset with a display mesh; generation sections its operands. An edited or imported 3DM
is still not accepted as input.

## Print bundle and review

`core/print/geometry.mjs` writes the shell as its named untrimmed NURBS surfaces
in a 3DM. rhino3dm builds no general solid from a set of patches; the file is accepted only
when written only once it reopens, rebuilds the same patches, passes the
closure check and matches the built control nets.
The descriptor also carries a quad proxy mesh, tessellated per patch, for the viewer.

## Formats

- `saam-shell-plan/1`: shape and its parameters, placement, setup, shared
  process settings, and each skill's settings under `skills`. Composition rules, component selections and settings are locked with the plan. A recipe
  is read against the selected shape: missing settings take current defaults and unread
  fields are ignored, both named in `limitations`. Generation introduces no further process choices.
- `saam-shell-geometry/1`: shape parameters, per-patch control-net hash, named
  face references and the display proxy.
- The machine file gains `nonplanar.maxAngleDeg` (15 for the S5): the surface
  slope beyond which a fixed vertical nozzle cannot follow. It is a declared
  software limit, not a measured clearance rating, and no collision model exists.
- SAAMpath and the Griffin export follow the shared contracts,
  including machine-owned header/start/end templates and the header fields the printer's reader requires. The exporter reads
  `startup.zAfterStartupMm`, which every current machine profile declares.
- XYZ moves shorter than `1e-4` mm are omitted only when all coordinates collapse
  to the same rounded endpoint (five decimals for S5/H2D, ten for Dobot).
  Representable short moves are retained. Oriented motion currently retains a
  distance-based cutoff when the pose is unchanged. See [precision guidance](../geom/README.md#precision-belongs-to-a-quantity-and-an-operation).

## Checks

`npm test` covers native geometry, sections, offsets, booleans, surface heights,
travel/lift, export interpretation and determinism across core and skill tests.
`core/tests/workflow.test.mjs` adds the review workflow: named native faces,
development generation, byte-identical delivery, staleness after each kind of
edit, remembered setup, and Studio serving and delivering a shell print. None
of that establishes clearance, surface quality, or that any part prints.
