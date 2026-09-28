---
name: mesh-tools
description: Diagnose failed mesh imports, clean duplicate or collapsed facets, repair self-intersections and fill explicitly bounded holes.
metadata:
  saam-kind: geometry
---

# Mesh tools

Mesh repair is preparation work; accepted geometry returns to the
[import and review workflow](../../core/print/USAGE.md#import-an-stl).

When strict import fails on a recognized defect, Studio's file picker repairs it
automatically, without hole filling: it keeps both STLs and the report in the new
print's `repair/` folder and shows the repaired geometry for confirmation, also
during the tour. Tool and command-line imports stay strict. Without command
access there is no repair tool: ask the person to import through Studio, or
choose another mesh. With it, run `repair-stl` ([command line](#repair-from-the-command-line)).

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
