# Print lifecycle and persistence

The [maker workflow](../../MAKERS.md#maker-interaction-flow) defines human interaction;
[composition](../path/README.md) and [export](../export/README.md) own generation operations.

## Downloaded mesh attribution

The [Thingi10K skill](../../skills/thingi10k/SKILL.md) supplies hash-matched attribution
to the importer, retained in `geometry.source.attribution` with source hash/bytes.
Unit corrections and wrappers preserve it. Delivery writes `source-attribution.json`
with the source record and current plan revision beside the reviewed program.
Source metadata does not confer printing approval.

## Generation and review

Studio's Export click confirms the displayed settings and exact checked toolpath.
Studio waits for queued edits and rejects stale displayed snapshots; `exportReviewed`
then writes the captured bytes unchanged. Opening a bundle checks artifacts before display.

`core/print/workflow.mjs` owns initialization, validation, revisions, preparation,
reopening and delivery. The shell adapter supplies recipe validation, geometry,
generation, limitations and release metadata. Studio selects it by plan schema.
Non-Studio callers retain `approve({actor, revision})` and `deliver`: the former
records settings/toolpath approval; the latter requires that exact approval.
`review-state.mjs` projects persisted currency and approval for these callers;
Studio combines currency with transient work and presentation state.

Bundle stores supplied components; creation, reopening and edits require integrity,
not completeness. Missing geometry, recipe or machine stays missing. Slice needs
source geometry; Trace/Inject may use authored curves/points without a solid.
Operation boundaries report missing prerequisites. No machine is inferred at creation.

Geometry extensions return proposals through Geometry; only deposition or hybrid
assignment contributions need Toolpath composition. Bundle accepts one revisioned
edit. Saved geometry remains viewable without rerunning the extension.

`prepareSliceRegionContext` accepts a supplied Geometry layer family, preset,
recipe, process resolver and report. Toolpath resolves the assignment's filament
and process and returns an ordinary Slice context; it does not infer regions.

[Settings](../machine/settings.mjs) owns reusable profiles, defaults and remembered
setup. Its [selection/recording API](../machine/bundle-settings.mjs) submits exact
snapshots to Bundle with an expected revision; Bundle owns invalidation/history.
`recordExtensionDependency` records supplied supports/plastic-weld configuration
in existing `plan.skills`; absence means unselected. No defaults or execution occur.
Geometry/construction references retain their own dependencies. Reusable changes
never refresh existing bundles; manuals use saved capabilities.

Geometry, completed SAAMpath and program have separate identities. Toolpath owns
`pathDependencies`; unknown inputs conservatively invalidate the path. Known
export-only setup fields, selected machine/output and disabled optional skills reuse it. Authored motion remains a path dependency. `generationHash` binds the complete
recipe, machine, geometry and generation contract to the checked program.
`state.artifacts` distinguishes current, retained stale and absent results.
Edits retain artifacts and clear approvals; old bytes never become current by omission.

`restoreRevision(directory,{direction,expectedRevision})` implements undo/redo
for both agents and Studio. Restoration creates a fresh revision, retains the audit
trail, clears approval and leaves delivered files alone. New edits clear the redo
branch. Immutable history records reference separately saved components and artifacts;
large geometry/path/program files are shared. Camera and playback remain Studio-private.
CLI: `undo|redo <directory> --revision <revision>`; Studio exposes Undo/Redo.

### Bundle ownership

Studio reserves a bundle on open; a second instance cannot open it. `withBundleInstance` carries that reservation into writes and generation workers. Export uses the existing reservation.
Claims, releases and manifest commits share `.bundle-write.lock`; commits compare revisions and atomically replace `plan.json`. Interrupted writes may leave unreferenced records.
The reservation releases on switch or shutdown, never by timeout. `instance-status` and `recover-instance` in `core/print/cli.mjs` inspect and reclaim a dead Studio PID. An interrupted write lock needs separate PID inspection and explicit removal.
Power-loss durability beyond atomic replacement is not claimed.

`generateToolpath` saves the completed SAAMpath independently of export. CLI
`toolpath <directory>` exposes it. `prepareGeneration` reuses that path or builds
one, then asks Export to encode/check the program. One prepared result
binds the exact bytes to the captured revision; `commitGeneration` rejects stale
completion, including an intervening edit undone back to the same content.
Export failure retains the in-memory path. Saved paths survive restarts and history
restoration. Checked exports reuse interpretation and production promotion without granting approval. Delivery copies the confirmed bytes.

`loadBundleSnapshot` supplies Studio one persisted revision, artifact currency,
history, review and checked program with source/presentation fingerprints.
`bundleFingerprints` exposes those fingerprints; `bundleFingerprint` exposes source.
Presentation excludes approval, delivery history and mode; source includes them.
Studio owns polling, pending requests and job progress separately; no subscription
API or click-time Export gate is implied. Generation accepts `beforeCommit` for
an owning worker to arbitrate cancellation before any output/check/review writes;
once commit begins, cancellation must let the sequence finish.

Generation uses the plan's explicit choices, settings and versions for repeatability.
There is no mandatory seed field; seeds belong only to skills that randomize results.

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
of the original mesh. A browser rebuilding drawing data from checked source
performs playback work; it is not an extra manufacturing approval stage.

Measure approval persistence, geometry preparation, sectioning/offsets,
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
native JSON asset. Shared generation sections that mesh; Studio displays it.
Field edits explicitly rebuild the mesh through the `blob_field` tool
and invalidate the final confirmation through this same lifecycle.

The shared workflow stores one directory per print:

```text
Prints/<name>/
  plan.json                         # atomic plan + bundle manifest
  geometry/<geometry-sha>.3dm       # or .mesh.json
  paths/<path-sha>.json              # completed SAAMpath
  history/<record-sha>.json          # immutable component/history records
  exports/<output>/<export-sha>-<name>
  delivery/part.gcode
```

`plan.json` retains the recipe fields at top level and owns one `bundle` envelope
containing the locked machine, review/check evidence and content-addressed
geometry/program references. It is the only mutable commit point. Referenced
artifacts are immutable; `delivery/` exists only after approval and delivery.
Ordinary reads of the previous parallel-file layout are effect-free and return
an actionable migration-required error. Run
`node core/print/cli.mjs migrate Prints/<name>` explicitly to preflight and
convert one bundle. Migration atomically replaces only `plan.json`, retains the
legacy sidecars and unknown files, and reports every created, updated, removed
and retained path. Bundles with current layout and recipe fields are no-ops. Compatibility
remains while supported or distributed print roots contain split-file bundles;
it can be removed after a bounded inventory reaches zero and the migration
window is closed in a documented release. The lifecycle and SAAMpath formats
are shared; the shell plan/geometry schemas are in [Formats](#formats) below:

- `saam-print-bundle/2`: the reserved `bundle` envelope in `plan.json`; it owns
  the locked machine, review lifecycle and immutable geometry/program references.
- `saam-machine/1`: millimeter bounds, nominal axis limits, tools, output options
  and the declared firmware startup contract. Output options carry program
  header, start and end templates; these are part of the locked machine snapshot.
- `saampath/1`: saved completed machine-independent motion. Moves carry absolute XYZ millimeters,
  speed in mm/s and deposited volume in mm³. Retraction/recovery uses filament
  millimeters; fan and dwell actions are explicit. Phase/layer labels describe
  the move without determining its geometry.
- `saam-review/1`: the manifest's exact-version final approval record, history,
  generation/export hashes and a small generation summary for display (never
  playback geometry). Its generation record owns `saam-checks/1` software
  checks and limitations.

`loadBundle` checks native artifact identity and recipe/geometry agreement without
regenerating or requiring complete settings. Consuming a saved path checks its
content hash; reopening a saved program checks its exact bytes. Archival STL is
checked by source-consuming operations, not by every view. These local records
are integrity evidence, not authentication of files or human statements.

The adapter also retains its latest checked interpretation, keyed by the
plan/machine/geometry identity and actual export hash. Generation seeds
this cache. Reopening interprets saved commands on a miss and returns copies on
a hit; it never regenerates the path or export. Delivery reads and hashes the
reviewed export, then copies those bytes. A changed export cannot inherit its
previous toolpath approval. Local records detect changes relative to recorded
content; they are not signatures authenticating the files or human statements.
Use `examples/prints/` only for explicitly curated examples.

## Shell pipeline (slices and draped-skin)

`core/print/bundle.mjs` adapts shell plans to the [shared lifecycle](#generation-and-review).
Skills return operations to the [shared composer](../path/README.md#skill-result-composition).
Their manuals own supported settings and process limits; software checks do not
establish successful physical printing. The plan's geometry is authored
([GEOMETRY.md](../../GEOMETRY.md)): spline patches, indexed triangle meshes,
blob fields, [booleans](../../GEOMETRY.md#booleans) of these and an `assembly` of any of them. A boolean is stored
as its recipe in the native JSON asset with a display mesh; generation sections its operands. An edited or imported 3DM
is still not accepted as input.

## Print bundle and review

`core/print/geometry.mjs` writes the shell as its named untrimmed NURBS surfaces
in a 3DM. rhino3dm builds no general solid from a set of patches; the file is accepted only
once it reopens, rebuilds the same patches, passes the closure check and matches
the reviewed control nets. Changed geometry repeats that verification;
unchanged content reuses validity under the [bundle contract](#print-bundle-and-current-formats).
The descriptor also carries a quad proxy mesh, tessellated per patch, for the viewer.

## Formats

- `saam-shell-plan/1`: shape and its parameters, placement, setup, shared
  process settings, and each skill's settings under `skills`. Composition rules, component selections and settings are locked with the plan. Unknown or
  misspelled fields are rejected, and the strict field check is made against the
  selected shape. Its rejection names the offending path and lists the unexpected
  and the missing keys. Generation introduces no further process choices.
- `saam-shell-geometry/1`: native file hash, shape parameters, geometry version,
  per-patch control-net hash, named face references and the display proxy.
- The bundle layout is the shared one above. `saampath/1`,
  `saam-review/1` and `saam-checks/1` are unchanged.
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

`npm test` runs `core/tests/` and every skill's tests. They
cover evaluation against rhino3dm, sections against analytic areas, closure
rejection, degenerate cuts, offsets and booleans against analytic areas, the
surface height field, travel and lift behaviour, the angle limit excluding steep
surface, strict interpretation of the export, determinism, and detection of an
edited export. `core/tests/workflow.test.mjs` adds the review workflow: the 3DM
round trip and rejection of a substituted file, development generation creating
no approvals, two synthetic confirmations with stale views and byte-identical
delivery, invalidation by each kind of edit, remembered setup, and
Studio serving and delivering a shell print. Synthetic approvals are written
with an actor name that says so. None of that establishes clearance, surface
quality, or that any part prints.
