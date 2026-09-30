# Native mesh repair

The shared adapter runs unmodified **CGAL 6.2.1** polygon-mesh repair in a child
process. It orients triangle soup, stitches compatible borders and calls
`experimental::remove_self_intersections` with smoothing disabled and genus
preservation enabled. Optional hole filling uses both an edge-count limit and
the boundary bounding-box diagonal in millimeters. These algorithms can fail;
partial output is never accepted. This is not a universal solid Boolean kernel.

## Stage reporting and how long a repair may take

The helper writes one JSON line to stderr as it enters each of its four stages —
`orient`, `patch`, `boundaries` and `native-validation` — and one JSON line of
counts to stdout at the end. Nothing is written while a stage runs. Self-intersection
removal inside `patch`, and hole triangulation inside `boundaries`, grow much faster
than the triangle count, so a single stage can be silent for a very long time on a
large or badly tangled mesh and still be making progress.

The caller therefore has no liveness signal to judge the child by, and no elapsed
time refuses a repair: the child ends when it finishes, when it fails, or when the
caller cancels. A repair that appears stuck cannot be distinguished from a slow one
from outside the process. Making that distinction possible is a change to this
helper — emit a line periodically from within the long stages — and it requires
rebuilding the pinned executable, because the adapter checks the wrapper source
hash against the build manifest.

## Build

[CMakeLists.txt](./CMakeLists.txt) declares the exact CGAL
version, C++17 target, Eigen linkage and source-hash build manifest.
[dependencies.json](./dependencies.json) pins downloaded
toolchain inputs by URL, byte length and SHA-256 for setup tooling.
[LICENSE.GPL](./LICENSE.GPL) accompanies the native wrapper.
Keep these inputs and the build manifest aligned when changing the native source
or dependency versions; they are supporting resources of this map region.

Install a C++17 compiler, CGAL 6.2.1 headers, Boost and Eigen 3.4 headers, then run
from the repository root (paths may contain spaces):

```text
npm run setup:mesh -- --compiler <g++-path> --cgal <CGAL-include-directory> --boost <Boost-directory> --eigen <Eigen-directory>
```

The tested Windows toolchain is GCC 16.2.0 from w64devkit 2.10.0, Boost 1.88.0 and
Eigen 3.4.0. The script builds a static Windows executable. With system include
paths configured, compiler and include arguments may be omitted; `CXX` is honored.
The script uses Boost multiprecision instead of GMP. The reproducible dependency
sources and hashes are in [dependencies.json](./dependencies.json).

Alternatively, use [CMakeLists.txt](./CMakeLists.txt) with installed CGAL/Eigen
packages. Configure and build, then install with prefix `build/mesh-repair` at the
repository root. CMake uses CGAL's configured arithmetic dependencies.

Runtime files are `build/mesh-repair/saam-mesh-repair[.exe]` and `build.json`.
Generated binaries stay ignored. The adapter checks the manifest against the
current wrapper source; rebuild after source changes. There is no runtime
dependency on `.local`, a global executable search or automatic download.
Ordinary valid STL import and exact cleanup work without this optional backend;
a repair requiring it reports the setup command when it is unavailable.

## Licenses and provenance

[mesh-repair.cpp](./mesh-repair.cpp) is GPL-3.0-or-later. This is a separately
identified component; the root Apache-2.0 notice must not be used to describe the
CGAL-linked helper. The rest of the repository's existing license notices remain.
CGAL's relevant packages are GPL-3.0-or-later or commercially licensed, including
[the patch-repair implementation](https://github.com/CGAL/cgal/blob/v6.2.1/PMP_Mesh_repair/include/CGAL/Polygon_mesh_processing/repair_self_intersections.h).
Selecting a few functions does not remove those terms. Distribution must include
the applicable licenses and meet their source/distribution requirements, or use
the appropriate commercial CGAL license. This build does not claim commercial
licensing. Boost uses BSL-1.0 and Eigen uses MPL-2.0; retain their upstream notices.
See [CGAL licensing](https://www.cgal.org/license.html).

No CGAL algorithm was copied into JavaScript or modified. The wrapper source,
build instructions and public interface are shared; evaluation runners and raw
measurements remain local.
