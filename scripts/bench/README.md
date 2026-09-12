# Slicing benchmarks

Harnesses, fixtures and recorded measurements. Results apply to their stated run
and fixture; inspect current source and rerun the relevant harness to assess a
new change. See [validation ownership](../../core/print/README.md#validate-at-the-boundary-that-owns-the-data)
and [numerical precision](../../core/geom/README.md#precision-belongs-to-a-quantity-and-an-operation) for the contracts being measured.

## Slicing speed benchmarks

For an existing shell print, [print.mjs](print.mjs) measures the
actual generator and checked exporter without changing the bundle or approvals:

```sh
node scripts/bench/print.mjs Prints/my-print --out .local/print-timing
node scripts/bench/print.mjs Prints/my-print --out .local/print-profile --cpu
```

Choose an output directory outside the print bundle. `timing.json` separates
runtime loading, reading/parsing, cold geometry/plan validation, generation and
export/interpretation. It records input hashes, machine/Node information, output
hash and move counts. `--cpu` additionally writes a CPU profile for each stage;
run it separately because profiling affects elapsed time. The after-load total
is generation plus checked export, excluding Studio transport/rendering and
physical execution. Compare identical input hashes under comparable machine
load. This is an opt-in development tool, not an automatic production check,
latency gate or a substitute for the existing human review workflow.

`scripts/bench/slicing.mjs` is an opt-in development measurement harness over
the existing geometry queries, full-fill, planar-infill, draped-skin, composer,
machine checks, Griffin exporter and interpreter. It adds no product geometry
type, approval route, toolpath viewer or manufacturing pipeline. Its twisted
fixture is not yet a shape accepted by the public plan parser. It calls skill
producers on prepared geometry; it does **not** time a complete public bundle
generation or Studio load. Geometry construction/validation, section queries,
roof queries, skill production, composition/checks and export/interpretation
have separate measurements. The bounded wedge generator is not replaced.

```sh
node scripts/bench/slicing.mjs --out .local/slicing-bench --trials 3
node scripts/bench/slicing.mjs --out .local/slicing-scale --fixtures twisted-box-large --targets 0.025 --modes full --trials 3
node scripts/bench/slicing.mjs --out .local/slicing-fine --fixtures twisted-box --targets 0.00125 --modes full --trials 3
node scripts/bench/slicing.mjs --out .local/slicing-rhino --fixtures twisted-box --targets none --stl path/to/export.stl --trials 3
node scripts/bench/slicing.mjs --out .local/slicing-precision --fixtures twisted-box --targets 0.025 --native-mesh --trials 3
node scripts/bench/diagnose-regions.mjs path/to/export.stl .local/slicing-diagnostics
node scripts/bench/report.mjs .local/slicing-bench/measurements.md .local/slicing-bench/results.json .local/slicing-rhino/results.json
```

Use a fresh output directory for each experiment. Generated Rhino 6 `.3dm`
files contain six named untrimmed surfaces in millimeters; join them in Rhino
before exporting STL with the person's normal mesh settings. Keep the supplied
STL unchanged. `--stl` expects that same fixture in millimeters at its original
coordinates. It validates the mesh and checks sampled section topology and roof
coverage; it reports deviations rather than silently registering or repairing
the geometry. The external bytes and SHA-256 are saved in the ignored output.

The control is a 24 mm cube. The main fixture has a 24 × 24 mm base, a 24 mm
rim, a top rotated 45 degrees and a shallow bicubic roof reaching 24.9 mm.
The four sides are ruled NURBS patches between the base and rotated roof edges:
they form a waist, not a constant-width helical extrusion. The large fixture
doubles all dimensions. All three use the same skill settings: 0.2 mm layers,
0.4 mm line width and two walls. `full` fills the planar body at 100%; `planar`
uses 20% rectilinear infill with three top/bottom solid layers; `draped` combines
full-fill with two 0.2 mm skins at 0.5 mm survey/stroke sampling and the S5's
15 degree limit. Cooling delay is zero in the benchmark. Draping uses the
same planar support-height callback as shared generation. All results are
software-only development data, with no approval or machine execution.

Meshes use conforming UV grids over the same six patches, refined to sampled
surface-to-triangle correspondence targets of 0.1, 0.025 and 0.005 mm by default.
A second denser sampling grid verifies the chosen tessellation. This fixture
mesher is neither Rhino's mesher nor a certified Hausdorff-error calculation.
Independent comparisons include section topology, bidirectional sampled contour
distance, section area, roof height and normals. Near-horizontal roof contours
can move farther in XY than the surface error in XYZ. Matching triangle count
alone does not establish equivalent shape or process output. The fine 0.00125 mm
target stays within the existing 100000-triangle input limit; unsupported target
sizes fail explicitly. `--native-mesh` adds the same triangles before binary
STL float32 rounding to help distinguish meshing from import precision effects.

For Cura 4.12, **Maximum Resolution** is a post-slicing segment-length setting,
not an STL edge-length floor. The installed base definition has 0.5 mm maximum
resolution and 0.025 mm maximum deviation; machine/material/quality settings
can override these. The latter is only a reference error scale for the mesh
test, not a declaration of equal slicer accuracy. See the
[Cura 4.12 base definition](https://github.com/Ultimaker/Cura/blob/4.12/resources/definitions/fdmprinter.def.json)
and [Rhino 6 meshing guidance](https://docs.mcneel.com/rhino/6mac/help/en-us/commands/mesh.htm).
Rhino's maximum distance edge-to-surface is a meshing control, a different stage.

Workers run serially, with a separately recorded first invocation and three
warm repeats by default (median, minimum, maximum and raw samples). Preparation
and query microbenchmarks are independent of the complete skill timing; do not
add them to it. Output hashes check repeatability, while action/operation counts,
deposited volume, skill reports and file sizes reveal unequal work. Failures
carry their phase and stack and are never counted as fast slices. Record Node,
CPU, memory, Git/dirty state, source hashes and exact STL hash. Do not run other
CPU-heavy work during timing. These small samples establish local trends, not
statistical significance across machines. Profiling runs should be separate
from uninstrumented timing. Copy a saved `.job.json`, give it a separate result
path and use Node's `--cpu-prof` on that worker to inspect hotspots without
overwriting timed results. The optional diagnosis command intercepts an
excessive region-index allocation in that process only and saves failing inputs;
it is not a production safety fix.

The initial 2026-09-09 run found slower direct spline queries but faster **planar
full-fill** than the generated twisted meshes. The 24 mm spline took roughly
0.34–0.40 s, versus 0.76 s / 2.10 s / 5.77 s for 768 / 3072 / 12288 triangles
at the three mesh targets. The doubled fixture took 1.17 s for splines and
14.13 s for its 12288-triangle 0.025 mm mesh. These are prepared-geometry skills
plus composition/checks, excluding export and public workflow overhead. The
mesh sections contain many more vertices, so downstream region work outweighs
their cheaper intersections. Existing planar-infill/region-reservation failures
prevent successful timings for several mesh combinations.

At the finer 0.00125 mm mesh target (49152 triangles), full-fill took 22.26 s
versus 0.39 s for splines in the same run. With the production planar-support
callback included, the non-planar body+drape pass took 18.42 s for splines and
5.00 s for the double-precision 3072-triangle mesh. The binary STL version
failed region reservation. The successful drapes do not have identical coverage:
faceted normals change the included skin area, so this is a backend diagnostic,
not an equal-output speed claim. Earlier pilot drape data in local reports used
the skill's default support callback and is superseded by `slicing-drape-final`.

The user's normal Rhino export has 1078 triangles. It passes mesh validation
and query checks but exposes a full-fill outward-offset/index blow-up at Z=12.2
mm and a solid-mask intersection failure between Z=0.2 and Z=0.4 mm. Do not
treat its failed generation as a speed measurement or disable checks to make
the comparison succeed. The user's Cura 4.12 report is 14 s to load and 2.3 s
to slice, two walls and 100% infill; the load boundary and layer height were
not specified. Record load and slice separately, and compare only planar full
fill with Cura. Non-planar measurements compare SAAM backends only.

Prioritize bounded/robust offset and boolean processing, then an explicit
error-bounded contour simplification experiment, indexed mesh Z/XY queries and
redundant spline height-solve diagnostics. Keep native spline input while testing
these shared-interface improvements. A language/runtime rewrite or forced mesh
conversion is not justified by these measurements. Measure public bundle
load/check/generate separately next, then repeat matched planar tests in Cura
and Bambu Studio with saved profiles, exact versions, thread counts and repeated
timings. No architecture decision or contributor approval is recorded by this
benchmark.
