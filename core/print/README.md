# Print lifecycle and persistence

Plans, revision identity, validation ownership, generation, reopening and delivery.
The [maker workflow](../../MAKERS.md#maker-interaction-flow) defines the human interaction;
[composition](../path/README.md) and [export](../export/README.md) provide the
operations and checked program used by this lifecycle.

## Generation and review

Implement the three human stages in [the maker interaction flow](../../MAKERS.md#maker-interaction-flow):
geometry, locked process plan, and toolpath. `core/print/workflow.mjs` owns
initialization, verification, revision hashes, adjustment, approvals, generation,
reopening, setup reuse, upgrades and delivery. Shell and wedge adapters supply
their recipe validation, geometry, generator, limitations and release metadata.
Studio chooses the adapter by saved plan schema.

The [text preparation entry](text.mjs) compiles editable font/surface features
into the same native mesh geometry used by Studio and slicing, then calls
`updatePlan`. It retains the original target and exact font bytes in the geometry
recipe. Reopening checks the saved result without rerunning its construction;
text edits reconstruct from the retained source and invalidate geometry review.

Generate the machine-declared export directly from the approved complete plan,
using transient motion objects. Check its actual commands before Studio plays
that export for toolpath approval. Delivery copies those reviewed bytes unchanged.
Geometry edits invalidate all approvals; process, composition, runtime or machine
changes invalidate plan and toolpath approval. Development generation records
`mode: development`, creates no human approvals and cannot satisfy delivery.

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
exist. See the [remaining validation work](../../build_request.md#br-039--slicing-latency-and-remaining-validation-duplication).

## Print bundle and current formats

The shared workflow stores one directory per print (wedge filenames shown):

```text
Prints/<name>/
  plan.json
  machine.json
  geometry/model.mesh.json
  geometry/model.json
  exports/griffin-gcode/wedge.gcode
  checks.json
  review.json
  delivery/wedge.gcode
```

`delivery/` exists only after approval and delivery. Geometry and plan schemas remain adapter-specific; lifecycle and SAAMpath formats are shared:

- `saam-machine/1`: millimeter bounds, nominal axis limits, tools, output options
  and the declared firmware startup contract. Output options carry program
  header, start and end templates; these are part of the locked machine snapshot.
- `saam-wedge-plan/1`: eight source points in `geometry.points`, placement, setup, complete process
  settings, generator version and selected output. Its lock hash also includes
  the native geometry, machine snapshot and generating runtime source hash.
- `saam-wedge-geometry/1`: native mesh file hash, source points, roof coefficients, mesh display and
  geometry-version-specific face references.
- `saampath/1`: transient motion objects during generation. Moves carry absolute XYZ millimeters,
  speed in mm/s and deposited volume in mm³. Retraction/recovery uses filament
  millimeters; fan and dwell actions are explicit. Phase/layer labels describe
  the move without determining its geometry. New bundles do not serialize this
  representation. Regeneration removes an obsolete `path.saampath` file.
- `saam-review/1`: exact-version human approvals, history, generation/export hashes
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
Skills return operations to the [shared composer](../path/README.md#skill-result-composition).
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

Old machine snapshots without templates must be explicitly upgraded with the
owning CLI's `upgrade` command before generation. It installs the current machine
snapshot and invalidates plan/toolpath approval, retaining unchanged geometry
approval. Do not rewrite a person's existing export or delivery as a migration.

## Formats

- `saam-shell-plan/1`: shape and its parameters, placement, setup, shared
  process settings, and each skill's settings under `skills`. Composition rules, component selections and settings are locked with the plan. Unknown or
  misspelled fields are rejected, and the strict field check is made against the
  selected shape. Generation introduces no further process choices.
- `saam-shell-geometry/1`: native file hash, shape parameters, geometry version,
  per-patch control-net hash, named face references and the display proxy.
- The bundle layout matches the wedge's, with `exports/griffin-gcode/part.gcode`
  and `delivery/part.gcode` in place of `wedge.gcode`. `saampath/1`,
  `saam-review/1` and `saam-checks/1` are unchanged.
- The machine file gains `nonplanar.maxAngleDeg` (15 for the S5): the surface
  slope beyond which a fixed vertical nozzle cannot follow. It is a declared
  software limit, not a measured clearance rating, and no collision model exists.
- SAAMpath and the Griffin export follow the same contracts as the wedge,
  including machine-owned header/start/end templates and the header fields the printer's reader requires. The exporter reads
  `startup.zAfterStartupMm`, falling back to the older `zAfterPrimeMm`.
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
no approvals, three synthetic approvals with stale views and byte-identical
delivery, the approvals each kind of edit invalidates, remembered setup, and
Studio serving and delivering a shell print. Synthetic approvals are written
with an actor name that says so. None of that establishes clearance, surface
quality, or that any part prints.
