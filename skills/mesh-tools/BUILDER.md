# Mesh tools

Mesh repair is preparation work; accepted geometry returns to the
[import and review workflow](../../core/print/USAGE.md#import-an-stl).

Ordinary imports validate first, then repair recognized defects without proximity
merging or hole filling. They retain original/repaired STL and a report. Imports
are cancellable; progress names stages, not an ETA. Use explicit repair below to
request tolerance-based vertex merging, diagnosis or bounded hole filling.

| Finding | Operation |
|---|---|
| Malformed or truncated STL, nonfinite coordinates | Obtain a complete export or fix the source. |
| Duplicate points/faces or collapsed triangles | Exact cleanup and matching collinear boundary stitching. |
| Inconsistent winding or self-intersecting faces | Orientation and local patch repair; review the changed areas. |
| Open boundaries | Fill only openings within explicit edge-count and size limits, according to the intended solid. |
| Nonmanifold topology | Compatible patches are split and oriented; ambiguous topology is rejected. |
| Out of memory for this mesh | The reported stage could not allocate for the reported size; rerun with a larger `--max-old-space-size` or on a machine with more RAM. |

A diagnostic does not determine the intended solid. Preserve the original and
explain consequential shape changes. Don't fill a large opening automatically or
accept a partial result.

## Explicit repair

`saam call repair_stl` takes an absolute `sourcePath`, a new absolute
`outputDirectory` whose parent exists, `units` (`mm` or `inch`) and the limits
below. Success writes
`original.stl` (the source bytes), `repaired.stl` (validated, in millimetres) and
`repair.json` (hashes, bounds, cleanup and native results, unchanged and changed
face counts, merge displacement and sampled shape evidence). Failure publishes
nothing; source bytes stay unchanged. Only native fallback needs [CGAL setup](../../core/geom/native/README.md).

| Option | Meaning |
|---|---|
| `mergeToleranceMm` | Opt-in nearest-retained vertex merging in mm, such as 0.01; default 0 means exact duplicates only. See [merge semantics](../../core/geom/README.md#explicit-mesh-repair). |
| `maxHoleEdges` | Maximum edges in a boundary to fill; default 0 disables filling. |
| `maxHoleDiameterMm` | Maximum boundary bounding-box diagonal in mm; default 0. Both limits must be positive to fill. |
| `maxSampledDistanceMm` | Reject results exceeding this sampled two-way shape change; sampling is not a certified bound. |

The result carries the report. `get_studio_events` shows the job's named stage
and percentage; `cancel_studio_calculation` cancels it; there is no time limit.
Compare source and result and inspect changed faces: the report counts
exactly unchanged faces and samples distances both ways, and a clean intersection
check alone doesn't show the shape was preserved. Import `repaired.stl` with
units **mm** and review it; repair and import create no approvals.

[The repair entry](../../core/print/repair-stl.mjs) owns orchestration and files;
[the geometry reference](../../core/geom/README.md#explicit-mesh-repair) owns the
cleanup, stitching (1e-9 mm line tolerance), CGAL 6.2.1 local patch repair with
smoothing disabled, and the [memory contract](../../core/geom/README.md#memory-files-and-progress).

`repairSTLFiles(directory, source, options)` takes an STL path or bytes; prefer
paths for large inputs, since reading, hashing and writing stream in chunks.
`repairSTL(source, options)` returns an STL buffer. Both work off the main thread,
cancel with an AbortSignal, and accept `onGeometry(chunk)` for accepted geometry
(`vertices`, `faces`, `firstTriangle`, `completed`, `total`, `percent`), awaited
chunk by chunk and emitted only after validation. The only size check is index
capacity; a mesh larger than memory fails on the allocation, naming stage and size.
