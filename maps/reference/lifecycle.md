# Print lifecycle and persistence

## Implementation ownership and change detection

The lifecycle map owns persistence, input identities and human review records.
`core/print/bundle.mjs` binds the shared workflow to the shell generator and the
runtime dependency set. `core/print/cli.mjs` is the command entry point; it does
not own another lifecycle. Its module-level dispatch and destructured workflow
exports need inspection even where there is no standalone callable map anchor.
`1d_runtime` names the runtime dependency list, selected limitation messages and
CLI dispatch. Changes to dependencies must preserve generation invalidation;
declared limitations describe the selected plan/machine and do not relax checks.

`core/print/file-snapshot.mjs` is bounded, stat-keyed change detection for refresh.
It must not substitute for the current-byte reads used by validation, approval or
delivery. Geometry and plan validity caches belong to a workflow instance and
reuse their owning result only for unchanged inputs. File replacement protects
one complete file; it does not lock a bundle or make several replacements atomic.
The [Studio generation protocol](studio-protocols.md#preparation-generation-and-cancellation)
explains the cancellation/commit boundary and checked-worker handoff.

When changing an identity field, trace final settings/toolpath confirmation,
cached interpretation, presentation receipts and delivery together.
Use [workflow tests](../../core/tests/workflow.test.mjs) and the
[test registry](testing.md#test-registry) to select the affected checks.

Plans, revision identity, validation ownership, generation, reopening and delivery.
The [maker workflow](../../MAKERS.md#maker-interaction-flow) defines the human interaction;
[composition](motion.md) and [export](output.md) provide the
operations and checked program used by this lifecycle.

## Downloaded mesh attribution

The [Thingi10K preparation skill](../../skills/thingi10k/SKILL.md) downloads a
selected STL and calls the shared importer with hash-matched attribution.
The importer retains that record in `geometry.source.attribution`, alongside
the original source hash and bytes. Unit corrections and wrappers retaining
the base geometry preserve it. Delivery writes `source-attribution.json`
beside the exact reviewed machine program, including its source record and
current plan revision. Source metadata does not confer a printing approval.

## Generation and review

Implement the single human confirmation in [the maker interaction flow](../../MAKERS.md#maker-interaction-flow):
settings and the exact toolpath together immediately before export. `core/print/workflow.mjs` owns
initialization, verification, revision hashes, adjustment, approvals, generation,
reopening, setup reuse and delivery. The shell adapter supplies
recipe validation, geometry, generator, limitations and release metadata.
Studio chooses the adapter by saved plan schema. There is no standalone settings
confirmation. `approve({actor, revision})` writes the only approval record,
`review.approvals.toolpath`, carrying the export hash and the plan hash it was
given for; `toolpathApproved` is the one derived boolean. Any recorded change
(plan, machine, upgrade or regeneration) empties `review.approvals`. Generation is available for inspection;
production delivery still requires the exact current final confirmation.

The [text preparation entry](../../core/print/text.mjs) compiles editable font/surface features
into the same native mesh geometry used by Studio and slicing, then calls
`updatePlan`. It retains the original target and exact font bytes in the geometry
recipe. Reopening checks the saved result without rerunning its construction;
text edits reconstruct from the retained source and invalidate geometry review.

The [mesh vase preparation tool](../../skills/advanced-vase-wall/SKILL.md#mesh-input-workflow)
authors sleeve-fit, motif and base settings on an imported mesh through
`adjustBundle`, using the expected revision. It preserves the source geometry
and selected machine, and rejects conflicting composition instead of replacing
it. The resulting recipe uses the same generation, review and delivery lifecycle.

Generate the machine-declared export from the complete plan whenever it helps review,
using transient motion objects. Check its actual commands before Studio plays
that export for combined settings/toolpath confirmation. Delivery copies those reviewed bytes unchanged.
Geometry, process, composition, runtime or machine changes invalidate the
combined settings/toolpath confirmation. Development generation records
`mode: development`, creates no human approvals and cannot satisfy delivery.
Production generation can reuse a current checked
development export: it verifies current input/runtime identity, export bytes and
saved check hashes, then records production mode without reslicing or changing
the reviewed bytes. This transition does not approve settings or toolpath.
Stale source falls back to generation. A plan changed during generation cannot
receive the earlier candidate.

Geometry-only bundle reads and their change fingerprints omit export bytes.
Fingerprint snapshots reuse content digests while file identity, size, modification
and change times match; this is change detection, not approval evidence. Review,
approval and delivery still check current bytes at their owning boundary. Runtime
provenance retains its full manifest and order, reading duplicate file entries once.
Recipe adjustment returns the owning update result instead of loading it again;
the update still checks a fresh revision before saving.

`bundleFingerprints` returns the `source` and `presentation` fingerprints from
one snapshot pass (`bundleFingerprint` is its `source`); every Studio bundle
adapter provides it. The `presentation` fingerprint separates scene/source identity from approval,
delivery history and generation mode. Other generation claims and current export
bytes remain part of source identity. Compact review updates still load validated
state before updating controls. Generation accepts a `beforeCommit` callback for
an owning worker to arbitrate cancellation before any output/check/review writes;
once commit begins, cancellation must let the sequence finish.

Generation performs the calculations specified by the plan. It does not add
another planning stage. A plan must include the choices, settings and versions
required for repeatable generation. A random seed is only appropriate for a
future skill that deliberately randomizes a result, such as seam placement;
there is no mandatory seed field or randomized skill in this foundation.

## Validate at the boundary that owns the data

Validate new geometry when it is ingested or its content changes. Carry that
result into settings, slicing and review. Saving an approval, changing infill,
loading a viewer state or creating another skill operation must not repeat a
full mesh topology/intersection pass on unchanged geometry. Reuse prepared
section indexes and other derived geometry across the skills using that part.
Public input boundaries still reject malformed new input; internal producers
consume the already validated data rather than each acting as another importer.

The same rule applies beyond meshes. Before adding a validator call, identify
its owner, its exact inputs, what changed since the previous check and what
new failure it can detect. If nothing relevant changed, reuse the result or
remove the call. Do not scatter `validatePlan`, `validateSetup`, `validatePath`
or equivalent whole-object passes through helper layers merely because they
are available. Do not add a public skip-validation switch. Reuse must be bound
to exact relevant content and validator/runtime identity, not a filename,
mutable object identity or a caller's claim that data is trusted. Bound caches
and prevent caller mutation from changing the recorded validity or shared data.

| Boundary | Work owned there |
|---|---|
| Geometry ingestion or changed geometry bytes | Topology, intersections, units, native/source identity; prepare reusable geometry queries. |
| New or edited plan/setup | Field validity, selected skill preconditions, machine compatibility and process choices. |
| Skill construction | Preconditions that first become knowable from the actual section, offset, support region or operation dependency being constructed. |
| Machine emission and interpretation | Validate the emitted command state and quantized motions once; those commands can differ from the producer's unrounded path. |
| Approval, reopening and delivery | Check current revision and content identity, then reuse matching validity and interpreted output. Interpret new or changed external bytes; do not regenerate unchanged output. |

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

The shared workflow stores one directory per print:

```text
Prints/<name>/
  plan.json
  machine.json
  geometry/model.mesh.json
  geometry/model.json
  exports/griffin-gcode/part.gcode
  checks.json
  review.json
  delivery/part.gcode
```

`delivery/` exists only after approval and delivery. The lifecycle and SAAMpath formats are shared; the shell plan/geometry schemas are in [Formats](#formats) below:

- `saam-machine/1`: millimeter bounds, nominal axis limits, tools, output options
  and the declared firmware startup contract. Output options carry program
  header, start and end templates; these are part of the locked machine snapshot.
- `saampath/1`: transient motion objects during generation. Moves carry absolute XYZ millimeters,
  speed in mm/s and deposited volume in mm³. Retraction/recovery uses filament
  millimeters; fan and dwell actions are explicit. Phase/layer labels describe
  the move without determining its geometry. New bundles do not serialize this
  representation.
- `saam-review/1`: the exact-version final approval record, history, generation/export hashes
  and a small generation summary for display (never playback geometry).
  `saam-checks/1` records software checks and limitations.

`loadBundle` reads current review records, native geometry bytes and any imported
STL source on each load. It checks the source digest and plan/geometry agreement.
Within one adapter instance, unchanged native bytes plus geometry descriptor
reuse geometry validity; unchanged plan plus machine content reuse plan validity.
A cache miss runs the owning validation. Restarting the runtime clears these
in-memory results. A filename or caller's claim of validity is insufficient.

The adapter also retains its latest checked interpretation, keyed by the
plan/machine/geometry/runtime identity and actual export hash. Generation seeds
this cache. Reopening interprets saved commands on a miss and returns copies on
a hit; it never regenerates the path or export. Delivery reads and hashes the
reviewed export, then copies those bytes. A changed export cannot inherit its
previous toolpath approval. Local records detect changes relative to recorded
content; they are not signatures authenticating the files or human statements.
Use `examples/prints/` only for explicitly curated examples.

## Shell pipeline (full-fill and draped-skin)

`core/print/bundle.mjs` adapts shell plans to the [shared lifecycle](#generation-and-review).
Skills return operations to the [shared composer](motion.md#skill-result-composition).
Their manuals own supported settings and process limits; software checks do not
establish successful physical printing. The plan expresses shapes in `core/geom/shapes.mjs`
(`box`, `wedge`, `spline-top`, `spline-shell`, `vertical-spline-shell`), indexed
triangle meshes, and an `assembly` of these components. An
edited or imported 3DM is still not accepted as input. The vertical spline shell
extrudes its bulged spline footprint vertically below a spline roof; arbitrary
side editing remains deferred.

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
  distance-based cutoff when the pose is unchanged. See [precision guidance](geometry.md#precision-belongs-to-a-quantity-and-an-operation).

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


## Changing lifecycle identity and persistence

Sources: [workflow.mjs](../../core/print/workflow.mjs), [bundle.mjs](../../core/print/bundle.mjs), [cli.mjs](../../core/print/cli.mjs).

**Contract.** The workflow factory owns plan/native-geometry/machine/export/review files, content-derived identities, cached validation and approval invalidation. The shell binding supplies geometry, generation, limitations and the runtime dependency list; CLI dispatch invokes that same workflow. Geometry-only, source-only and fully interpreted reads have different costs and guarantees. Plan validation can normalize old fields in memory; neither reading nor a development export creates human approval. Remembered setup can select a different supported nozzle; a fresh proposal or machine change retains the current line width when it remains in that tool's envelope and otherwise clamps it to a nozzle-compatible starting width before validation. Any geometry, process, machine or runtime change invalidates the single settings/toolpath approval, which is bound to both the plan and export hashes. See [validation ownership](#validate-at-the-boundary-that-owns-the-data) and [formats](#print-bundle-and-current-formats).

**Failures.** Stale revision guards, absent/unverified source, invalid native geometry, unavailable output and missing manufacturing approvals reject at their owning boundary. Cached display state and a previous successful export cannot authorize delivery. Multi-file publication is not a transaction or cross-process lock.

**Change together.** Update identity construction, runtime dependency registration, review records, command adapters, Studio receipts and the selected exporter together when changing a persisted field. Preserve the distinction between geometry creation, generation checking, generation commit, human review and delivery.

**Verification.** Exercise stale revisions, geometry versus settings invalidation, cold reopen, unchanged-input reuse, development versus production generation and delivery of the exact approved bytes. Use read-scope cases when changing refresh cost. Checks: [workflow.test.mjs](../../core/tests/workflow.test.mjs), [chat-geometry-confirmation.test.mjs](../../core/tests/chat-geometry-confirmation.test.mjs), [read-scope.test.mjs](../../core/tests/read-scope.test.mjs).


## Changing file replacement and refresh snapshots

Sources: [file-write.mjs](../../core/file-write.mjs), [file-snapshot.mjs](../../core/print/file-snapshot.mjs).

**Contract.** replaceFile writes a uniquely named sibling temporary file then renames it over the destination; its finally block attempts to remove the temporary file. Windows sharing errors EPERM/EACCES/EBUSY receive bounded exponential retries. createFileSnapshot keys cached bytes/digests by device, inode, size and nanosecond modification/change times, clears its bounded cache at capacity, and optionally parses the retained bytes. These snapshots accelerate change discovery, not validation or approval.

**Failures.** Read/parse/write errors propagate; a missing snapshot returns null and removes its entry. Replacement failure must retain the previous complete destination. Neither helper coordinates several writers or several files. Returned parsed snapshot values are cached objects; consumers must not mutate them as an editing interface.

**Change together.** Inspect workflow current-byte validation, Studio revision polling, machine-study fingerprints and every file-replacement consumer. Preserve temporary-name uniqueness and cleanup on both successful and failed replacement.

**Verification.** Check old destination preservation on failed replacement, sharing-conflict retry bounds, changed/deleted files, and unchanged snapshots without redundant parsing. Checks: [file-write.test.mjs](../../core/tests/file-write.test.mjs), [read-scope.test.mjs](../../core/tests/read-scope.test.mjs).
