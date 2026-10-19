# Print lifecycle and persistence

The [maker workflow](../../MAKERS.md#maker-interaction-flow) defines human interaction;
[composition](../path/README.md) and [export](../export/README.md) own generation operations.

## Downloaded mesh attribution

The [Thingi10K skill](../../skills/thingi10k/SKILL.md) supplies hash-matched attribution
to the importer, retained in `geometry.source.attribution` with source hash/bytes.
Unit corrections and wrappers preserve it. Export includes the captured source
record and revision in its receipt and offers `source-attribution.json` beside
the machine-file download.

## Generation and review

Bundle stores geometry, recipe, immutable neutral SAAMpath and reviewed input
snapshots. Generation constructs deposition and a neutral schedule without a
machine adapter. Each completed path captures its recipe, geometry and machine
settings. Edits retain that previous result visibly; regeneration dims it and
blocks new Export clicks until success, failure or cancellation settles.

The person's Export captures the displayed path/settings before queued work,
then writes a machine program for download. Bundle keeps an export receipt and
source attribution, never program bytes, machine execution or program templates.
Writer failure leaves saved work intact. Existing historical program files are
ignored and preserved. [ADR 0002](../../docs/adr/0002-neutral-bundles-and-transient-export.md)
records the owner's direction.

`workflow.mjs` owns revisions, snapshots and publication; `review-state.mjs`
projects eligibility. Each commit mints a revision; authored changes mint an
edit revision; geometry/path input IDs track only relevant changes. Changed
generator sources prevent path reuse without removing the retained view.
Workers publish only after revision/source checks and cancellation acknowledgement.
`readDrawnPath` prepares saved previews in a cancellable worker.

`restoreRevision` restores snapshots at a new revision. History shares immutable
artifacts. Settings stores submit explicit snapshots; they never silently refresh
existing bundles. Source paths remain in the part frame; placement applies at
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

`plan.json` owns the recipe, locked machine, review and immutable artifact references.
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
  header, start and end templates in the extension; bundle snapshots omit them.
- `saampath/2` source and `saam-schedule/1` execution follow [SP2](../path/README.md).
  `readConstructedPath` reads source; `readDrawnPath` joins its exact schedule.
  Earlier saved actions use the shared reader's compatibility branch.
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
