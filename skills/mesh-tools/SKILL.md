---
name: mesh-tools
description: Diagnose mesh import failures, clean duplicate or collapsed facets, and repair self-intersections with CGAL local patches. Supports explicitly bounded hole filling, preserves source files and reports shape changes for geometry review.
metadata:
  saam-kind: task
---

# Mesh tools

Mesh processing is preparation work. Accepted geometry returns to the
[shared import and review workflow](../../core/print/USAGE.md).

## Diagnose and repair

| Finding | Operation |
|---|---|
| Malformed or truncated STL, nonfinite coordinates | Obtain a complete export or fix the source. |
| Duplicate points/faces or collapsed triangles | Exact cleanup and matching collinear boundary stitching. |
| Inconsistent winding or self-intersecting faces | CGAL orientation and local patch repair; review the changed areas. |
| Open boundaries | Fill only openings within explicit edge-count and physical-size limits, according to the intended solid. |
| Nonmanifold topology | CGAL can split/orient compatible patches; remaining ambiguous or invalid topology is rejected. |
| Memory budget failure | Review available RAM/Node heap and the reported working-set estimate; increase the budget when appropriate. |

A diagnostic does not determine the intended solid. Preserve the original and
explain consequential shape changes. Do not automatically fill a large opening
or accept a partial native result.

From the repository root:

~~~text
node core/print/cli.mjs repair-stl <new-repair-directory> <source.stl> <mm|inch> [options.json]
~~~

The destination must be new and its parent must exist. Successful processing writes:

- `original.stl`: unchanged source bytes.
- `repaired.stl`: validated output in millimeters.
- `repair.json`: hashes, bounds, cleanup/native results, unchanged and changed
  face counts, sampled shape differences and validation evidence.

Cleanup merges identical coordinates and removes duplicate/degenerate facets and
unused vertices. It stitches a long edge to a complete, oppositely directed
collinear chain at existing vertices, with a 1e-9 mm line-distance tolerance.
An already valid cleaned surface returns directly. Otherwise the command uses
CGAL 6.2.1 local patch repair with smoothing disabled. That backend must be built;
see [native setup and licensing](../../core/geom/native/README.md).

Optional JSON settings:

| Option | Meaning |
|---|---|
| `maxHoleEdges` | Maximum edges in a boundary to fill; default 0 disables filling. |
| `maxHoleDiameterMm` | Maximum boundary bounding-box diagonal in mm; default 0. Both hole limits must be positive to enable filling. |
| `maxSampledDistanceMm` | Reject results exceeding this bidirectional sampled shape change. Optional; sampling is not a certified surface bound. |
| `timeoutMs` | Native operation timeout; default 120,000 ms. |

No geometry is published after failed repair or validation. The source remains
unchanged. The command writes stage progress to stderr and the final report to
stdout. Percentages describe the named stage; native patch processing has no
known completion count.

## Memory and programmatic use

The shared `repairSTLFiles(directory, source, options)` accepts an STL path or
bytes. Prefer paths for large inputs: reading, hashing and output writing stream
in chunks. The byte-returning `repairSTL(source, options)` is async and allocates
its returned STL buffer. Both run repair work off the main thread; use an
AbortSignal to cancel.

Both accept `onGeometry(chunk)` for accepted, full-quality geometry. Chunks carry
local `vertices`/`faces`, `firstTriangle`, `completed`, `total` and `percent`.
The consumer is awaited before the next chunk. Output starts after validation;
partial failed repairs are never emitted as accepted geometry.

There is no fixed 100,000-face gate. `SAAM_MESH_MEMORY_MIB` controls a conservative
working-set estimate. Its default is bounded by the Node heap and system RAM;
see [memory and progress](../../core/geom/README.md#memory-files-and-progress).
Indexed meshes and CGAL working data still require memory. This is not unlimited
or fully disk-backed processing.

## Inspect and return to printing

Compare source/result views and inspect changed faces. The report counts exact
unchanged face geometry. Otherwise, distance measurements sample vertices and
face centroids in both directions, including discarded source surfaces. A clean
intersection check alone does not establish acceptable shape preservation.

Import `repaired.stl` with units **mm**, then review its geometry. Repair/import
create no approvals. Each printing pattern's shape restrictions still apply.
With MCP-only access, `read_skill` retrieves this manual and `import_stl_print`
imports an available result; the connector currently has no repair tool.

[The repair entry](../../core/print/repair-stl.mjs) owns orchestration and files;
[the geometry reference](../../core/geom/README.md#explicit-mesh-repair) owns the
algorithms, numerical assumptions and memory contract.
