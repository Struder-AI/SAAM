# Print lifecycle and persistence

The [maker workflow](../../MAKERS.md#maker-interaction-flow) defines human interaction;
[composition](../path/README.md) and [export](../export/README.md) own generation operations.

## Bundle value queries

Portable archive admission and part publication are Runtime orchestration in
`core/application/portable.mjs`; STL import lives beside it (`import-stl.mjs`,
`source-operations.mjs`). Both create parts through Runtime's part execution.
It validates captured asset hashes, archive paths/inventory and source/license
records, prepares a private part, claims its exact destination and publishes
atomically. Extensions coordinates selected-package validation and installation
through these APIs; Bundle never installs library packages. Failed part
publication removes only its owned incomplete part and preserves any already
installed packages reported by Extensions. The public `share_bundle` and
`import_bundle` commands retain their names and inputs.

`view-values.mjs` owns saved-part discovery, captured state/snapshot reads,
editable-recipe projection and reservation inspection. CLI supplies the library
root and an admitted-directory resolver; queries return values without exposing
a command adapter. `get_bundle` omits geometry by default and marks that omission;
`includeGeometry` returns the complete editable recipe. `get_bundle_instance`
reports the recorded reservation identity without releasing or recovering it.
These queries do not migrate recipes, attach Studio or update pending work.

Studio library names/listing and CLI discovery use the same implementation.
`identity.mjs` supplies their shared Bundle-ID schema; Runtime retains Studio and
request authority guards. Historical captured values remain distinct from the
current editable recipe.

## Operation recipe storage

`bundle.mjs` exports `createBundleRecipeState(directory,{bundleId})` for an already
admitted part. It stores supplied per-operation definitions, input links and saved
values in `bundle.operationRecipes` at the existing `plan.json` commit point.
`save({edits,values})` expects each edit's stable `id`, `expectedRevision` (null
for a new definition) and `definition` (null to remove it). Bundle returns minted
definition revisions. Values have supplied immutable IDs; replacing a value uses
a new ID. Unfinished definitions can be saved without running work.

`readRecipeInputs({bundleId,targets})` returns the requested saved input closure;
`read()` returns saved definitions/results/outcomes. Both transfer immutable
values and perform no generation. Runtime submits results with captured recipe
revisions, value presence/absence and saved-result identity/availability.
`includeResults:true` also returns available saved producer values; it does not
establish current executable admission for a fresh invocation.
`publishRecipeResults` checks those facts
and current Studio authority under the write lock, preserves unrelated changes,
and returns `superseded` for changed inputs. A failed calculation records its
outcome while retaining the earlier completed value. An attribution failure
after publication reports committed identities and the unfinished step.

Authoring A and then B referencing A's layers saves definitions; neither starts
a solve. A separate explicit submission admits one Bundle pipeline execution.
`createBundleRecipeExecution` uses one Runtime job to resolve those references
internally; it has no follower, commit subscription or automatic retry on edits.
The admitted directory is the Bundle execution identity. The shared
`bundle-execution.mjs` guard also covers the existing CLI/Studio generation entry,
so an overlapping submission is refused before input reads or job creation.
An edit during preparation can supersede publication; it waits for the next
explicit submission. Previously completed Export remains available.

These are the passive storage and execution foundations of the approved recipe
migration. Runtime job/command/Studio wiring and operation-owner/source admission
remain incomplete. Saving a graph does not convert the old whole-part
plan; legacy commits cannot erase it. Native resources need their producer's
explicit durable artifact handoff rather than implicit JSON conversion.

## Existing whole-part command migration

`edit-operations.mjs` owns recipe patch routing, compiled-geometry edit guards,
Slice/modifier edits, revision navigation, dependency records and deferred setup
preferences. `settings-edits.mjs` publishes resolved Settings values against the
captured Bundle revision. Their algorithms and imports now live only in Bundle;
the machine/bundle-settings module retains its current machine-change callers.
`adjust_recipe`, `slice`, `modulate`, `restore_revision`,
`record_extension_dependency`, `set_deferred_setup_save`, `set_stl_units`,
`combine_geometry` and `migrate_bundle` return completion and
committed identities with `commandResult.id`. Query
`get_bundle_command_result` with the same `bundleId` and that `id` for the exact
associated summary, edit and findings. Other legacy command/report refinements
remain tracked separately. Changing the deferred preference
preserves the serialized recipe and all input/result identities; only the saved
manifest revision and preference change.

Creation and geometry maintenance use that same command owner. Runtime's
geometry-job port supplies cancellation and commit control. Runtime's part
execution (`core/application/part-execution.mjs`: `createPart`, `editPart`)
reads the recipe into its current form, builds changed geometry, selects and
resolves Settings against the built bounds, and hands Bundle the complete plan,
built artifact and machine label. Bundle's `initBundle`/`updatePlan` only store
them and refuse changed geometry without its built artifact. The legacy creation response separately queries the known
created kind and Context guidance. Capturing that kind preserves the former
post-create read even when the supplied saved schema cannot serve ordinary Studio
queries; it is not an arbitrary executable-adapter selector.

## Downloaded mesh attribution

The [Thingi10K skill](../../skills/thingi10k/SKILL.md) supplies hash-matched attribution
to the importer, retained in `geometry.source.attribution` with source hash/bytes.
Unit corrections and wrappers preserve it. Export includes the captured source
record and revision in its receipt and offers `source-attribution.json` beside
the machine-file download.

## Generation and review

Bundle stores geometry, recipe, immutable neutral SAAMpath and reviewed input
snapshots. Reads return the saved recipe with its machine settings (setup,
process, placement, output) exactly as stored; nothing is completed from a
profile, and the consumer that resolves settings reports a missing value. It
names the machine only by label (`bundle.machineId`); a manifest or
history record saved with a profile snapshot keeps only its ID. Settings resolves
the label to the installed profile for each consumer (`installedMachine`):
Construction's nozzle inputs, presentation and Export admission. A label
for a machine not installed here still reads and edits; generation and Export
report the machine unavailable. Generation constructs deposition and a neutral
schedule without a machine adapter. Each completed path captures its recipe,
geometry and machine label. Edits and regeneration retain that completed result for review and
Export while upstream work produces a replacement.

The person's Export captures the ready displayed path/settings and immediately
starts writing its machine program independently of other Studio tasks.
[Export](../export/reviewed-export.mjs) reads the saved Paath, writes the program
and records its receipt here; Bundle runs no Export. Bundle keeps a small export
preparation receipt (time, output, input revision, output ID, byte count), never
a machine profile, generated program bytes, a writer's report or machine
execution. Export's result report records the machine ID, profile digest and
writer output it used (`written`). Source attribution stays in the captured recipe.
Writer failure leaves saved work intact. Existing historical program files are
ignored and preserved. [ADR 0002](../../docs/adr/0002-neutral-bundles-and-transient-export.md)
records the owner's direction.

New history records `export-prepared`: captured bytes were prepared, not received
by a client or executed by a machine. Legacy `delivered` history remains intact.
Studio's `export-ready` observation reports preparation; its attachment link offers
the transient file, and retrieving that link serves the exact bytes.

`workflow.mjs` owns revisions/snapshots/publication; `review-state.mjs` projects eligibility. Creation, including gridfinity contributions, shares Application's cancellable job.
Bundle alone awaits `beforeCommit` once before saving; author hosts receive cancellation/progress. Extension edits retain revisioned publication; import staging keeps its outer boundary.
Commits mint revisions; edits mint edit revisions and relevant geometry/path IDs. Changed sources prevent reuse while retaining views.
Workers check revision/source and cancellation. Bundle reads return stored state only: Studio prepares the drawn path (`studio/drawn-path.mjs`, a cancellable worker) and presentation (`studio/bundle-presentation.mjs`: Settings rows, program name from the output declaration, bed fit, recipe skills, display geometry); Runtime owns generation-source currency.

`restoreRevision` restores snapshots at a new revision. History shares immutable artifacts. Geometry reuses unchanged solid artifacts from Bundle’s saved source/bytes; scoped solid metadata shares the flat proxy arrays.
Spatial edits derive fresh bounds/features; legacy aggregate views rebuild once. Material queries reconstruct admitted source; settings stores submit explicit snapshots without silently refreshing bundles. Source paths remain in the part frame; placement applies at
display and Export. Geometry owns admission and native lifetime.

`shareBundle` packages inputs, source/repair provenance and selected extension
dependencies. `importBundle` checks those inputs without executing extension
scripts; it excludes review state, paths, programs, history and caches. Existing
bundles/local edits are never overwritten; recipients regenerate and review.

### Bundle ownership

Studio reserves its open bundle. Claims, releases and manifest commits share
`.bundle-write.lock`; commits compare revisions and atomically replace
`plan.json`. Reservations end on switch/shutdown, never timeout. Recovery inspects
the recorded PID; interrupted write-lock recovery is separate. Power-loss
durability beyond atomic replacement is not claimed.

## Validate at the boundary that owns the data

Validate changed/raw inputs where their meaning first becomes known; reuse
identity-bound preparation across consumers. Opening baked geometry does not
reread its archival STL. Public geometry admission, producer construction,
scheduling and machine writing retain their distinct prerequisites.

| Boundary | Responsibility |
|---|---|
| Geometry | Import/topology/units, source provenance and numerical preparation. |
| Bundle | Saved component references, snapshots, reservations and expected revisions. |
| Toolpath/Scheduling | Construction prerequisites, source admission and exact execution coverage. |
| Export | Actual-tool preparation, required installation and writer facts. |
| Reopening | Read saved neutral results without executing a program adapter. |
| Studio Export | Capture displayed path/settings; return transient machine bytes. |

Optional interpretation is developer verification, not a production lifecycle.
Measure geometry preparation, construction, scheduling, writing and viewer load
separately; software checks do not establish a physical print result.

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
  paths/<path-id>.json               # immutable curve/profile source
  paths/<path-id>.schedule.json      # execution references and checked transfers
  history/<record-id>.json           # immutable component/history records
```

`plan.json` owns the recipe, machine label, review and immutable artifact references.
It is the only mutable commit point. Export returns bytes to the browser download.
Compatibility changes are trivial field adjustments only. The retired split-file
layout receives a compact deprecation message without rewriting files, copying
artifacts or rebuilding geometry. The shell plan/geometry schemas are in
[Formats](#formats) below:

- `saam-print-bundle/3`: the reserved `bundle` envelope owns machine, review and
  artifact references. Derived views omit duplicated plain mesh arrays; `/2` remains readable.
  Older `/2` readers refuse `/3`. Portable input-only ZIPs retain `/2` recipes;
  an emptied STL keeps its source bytes/provenance in a `saam-print-package/2` ZIP.
- `saam-machine/1`: millimeter bounds, nominal axis limits, tools, output options
  and the declared firmware startup contract. Output options carry program
  header, start and end templates in the extension. Export uses the currently
  installed profile for the part's machine label; Bundle stores no profile or
  template data.
- New `saampath/3` source and `saam-schedule/1` execution follow the
  [Paath contract](../path/README.md).
  `readConstructedPath` reads source; Studio's `readDrawnPath` joins its exact schedule.
  Earlier saved `/2` sources/actions use the shared reader's compatibility branch
  for inspection; deprecated source is explicitly unavailable for new Export.
- `saam-review/1`: the manifest's history, path and
  generation records and a small generation summary for display (never
  playback geometry). Its generation record owns `saam-path-checks/1` neutral-path
  checks and limitations.

`loadBundle` reads what SAAM wrote without re-hashing, regenerating or requiring
complete settings. Content hashes are taken once where bytes arrive from outside
SAAM: an imported STL and extension packages. Prints saved before these ids
are read once by `savedBundle`, which drops undo history, old hashes and a program
saved without its SAAMpath (kept in `exports/`; the print shows no toolpath until generated).

Reopening reads the captured neutral path and settings; it does not interpret or
require any historical program file.

Use `examples/prints/` only for explicitly curated examples.

## Shell pipeline (planar and nonplanar slices)

[Bundle](./bundle.mjs) adapts shell plans; [Scheduling](../path/README.md#retained-construction-interfaces) reads saved Toolpath operations.
[Assignment generation](./assignment-generation.mjs) owns prerequisite identities and transitive failure removal.
Retries rebuild ownership/contact, retaining preparation and deposition with unchanged inputs/producers.
Construction uses indexed references and dependency counts; only Trace reads named predecessor deposition.
Final references share that registry; retired forms reject compactly.
Manuals own supported settings; software checks establish no physical print success. The plan's geometry is authored
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

Existing tests cover geometry, construction, scheduling and command writing;
workflow fixtures must use neutral snapshots and transient Export results.
Run the checks appropriate to a change and report their actual scope. None
establishes clearance, surface quality or physical print success.

## Prepared Slice work

`geometric-references.mjs` resolves [source edge selectors](../../GEOMETRY.md#selecting-edges) against saved model geometry or prepared Slice regions. Trimming retains the source selector and orientation. Geometry owns mesh adjacency, named face boundaries and curve/Slice-band intersections; Print associates those contacts with native assignment/index/part targets. Edge-support authoring binds each crossed part slice to its local supporting Trace curves, with matching local predecessor curves within the support. `Recipe.slices(selection)` queries the owning prepared charts and regions without constructing deposition.

Material preparation expands translated or normal-offset stacks into native-chart
regions and local normal gaps. Solid masks and generated Trace sources share this
owned material intent; Trace can also supply a prepared surface with a closed boundary.

Slice has one surface-pattern/deposition route. It measures no physical area and
reconstructs no unused coverage; Geometry supplies footprint/height queries only
for depositing connections. Flatness/wrapping are geometry properties; lips use
zero infill and ordinary inward loops. Prepared references retain their bounded regions.
Slice never reads completed deposition, even with experimental adaptation enabled.
Current fitted/pointwise normal offsets still lack general self-intersection
trimming; this remains a Geometry limitation.
