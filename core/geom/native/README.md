# Native mesh repair

The shared adapter runs unmodified **CGAL 6.2.1** in a child process. It orients
triangle soup, stitches compatible borders and fills holes only within both an
edge-count limit and a boundary bounding-box diagonal in millimeters. A closed
surface that crosses itself is replaced by the boundary of its solid. Opposed sheets
closer than [print resolution](../../README.md#dimensions-and-tolerances) (passed by
the adapter), such as a cut cap over a cavity floor, are first projected exactly onto
one fitted plane per group, so they cancel instead of leaving a film. Exact
autorefinement then splits faces along every crossing; a refined face is kept, facing
outward, where the winding number is positive on exactly one side. Overlapping shells
unite, inward shells stay cavities, inside-out files are reversed. Constructed points
are snap-rounded to doubles; triangles below SAAM's minimum area lose an edge with a
constructed end. Other faces keep their source coordinates. A non-manifold, open or
still intersecting result is refused; partial output is never accepted.

## Stage reporting and how long a repair may take

The helper writes one JSON line to stderr as it enters each stage (`orient`,
`boundaries`, `intersections`, `close`, `refine`, `classify`, `round`,
`native-validation`) and one JSON line of counts to stdout at the end. Nothing is
written while a stage runs, so no elapsed time refuses a repair: the child ends when
it finishes, fails or the caller cancels. Periodic output from inside a stage would
need a helper change and rebuild, because the adapter checks the wrapper source hash
against the build manifest.

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
[the autorefinement implementation](https://github.com/CGAL/cgal/blob/v6.2.1/PMP_Boolean_operations/include/CGAL/Polygon_mesh_processing/autorefinement.h).
Selecting a few functions does not remove those terms. Distribution must include
the applicable licenses and meet their source/distribution requirements, or use
the appropriate commercial CGAL license. This build does not claim commercial
licensing. Boost uses BSL-1.0 and Eigen uses MPL-2.0; retain their upstream notices.
See [CGAL licensing](https://www.cgal.org/license.html).

No CGAL algorithm was copied into JavaScript or modified. The wrapper source,
build instructions and public interface are shared; evaluation runners and raw
measurements remain local.
