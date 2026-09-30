# Mesh tools

Mesh repair is preparation work; accepted geometry returns to the
[import and review workflow](../../core/print/USAGE.md#import-an-stl).

Studio and agent imports attempt strict validation first, then automatic repair
for recognized defects without hole filling. They retain the original, repaired
STL and report. Progress names real stages; elapsed time is not a repair ETA.
The person or maker agent can cancel the import without direct repair tools.
Use the commands below for builder diagnosis or explicitly bounded hole filling.

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

<!-- layer: script -->
## Repair from the command line

~~~text
node core/print/cli.mjs repair-stl <new-repair-directory> <source.stl> <mm|inch> [options.json]
~~~

The destination must be new and its parent must exist. Success writes
`original.stl` (the source bytes), `repaired.stl` (validated, in millimetres) and
`repair.json` (hashes, bounds, cleanup and native results, unchanged and changed
face counts, sampled shape differences and validation evidence). Failure publishes
nothing and leaves the source unchanged. The native repair backend must be built
([native setup](../../core/geom/native/README.md)).

| Option | Meaning |
|---|---|
| `maxHoleEdges` | Maximum edges in a boundary to fill; default 0 disables filling. |
| `maxHoleDiameterMm` | Maximum boundary bounding-box diagonal in mm; default 0. Both limits must be positive to fill. |
| `maxSampledDistanceMm` | Reject results exceeding this sampled two-way shape change; sampling is not a certified bound. |

Progress goes to stderr and the report to stdout; percentages describe the named
stage. There is no time limit: a repair ends when it succeeds, fails or is
cancelled. Compare source and result and inspect changed faces: the report counts
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
