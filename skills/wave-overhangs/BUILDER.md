# Surface wave construction and provenance

The producer in [wave.mjs](scripts/wave.mjs) uses the shared
[intrinsic surface offset](../../core/region/surface-offset.mjs), not constant
UV offsets or a flattened mesh. It clips the already reached region to the
assigned domain after each physical advance. It walks the resulting boundaries
in cyclic order and excludes stationary domain/seed edges, rather than clipping
an outline against a coincident area boundary (which discarded front segments).
Growing fronts split and rejoin through Clipper topology. Short alternating
connections produce one continuous pass where possible; generation rejects a
slice requiring multiple passes. Hole-branch continuity remains incomplete.

Constrained rays stop at their first region-boundary crossing, including holes;
they do not restart at a later re-entry. Boundary-tangent rays retain their
allowed extent, with small endpoint drift projected onto the same boundary.
Clipper2's `SimplifyPaths64` removes redundant segments between advances;
epsilon uses sampled native derivative magnitudes and preserves domain contact
vertices. Obstacle tangent directions are explicit samples of corner fans.
Geodesic integrations use native first and second derivatives.
Straight UV integration segments and swept strips approximate obstacle contact;
`propagationStepMm`, `sampleStepMm` and `toleranceMm` bound their sampling work.
There is no global shortest-distance or arbitrary topology guarantee across
unresolved features or geodesic cut loci. This remains an experimental extension.

Repeated UV booleans use one grid anchored at the chart's lower parameter bounds
(`precisionUv = 1e-10`). The shared boolean adapter accepts an explicit `origin`
for this purpose; existing callers retain their original automatic local origin.
This avoids changing the quantization lattice as a front grows. XYZ polylines
are refined after UV clipping, with native points and normals retained together.
Terminal corner residuals and collapsed contour diagnostics stay in the report
under the manual's sampling rules. The final perimeter is not a cap stroke.
Long strips from rounded polygon intersections are resolved before extracting
the terminal front when a tiny planar UV expansion of reached material contains
the entire residual. This diagnostic uses the physical tolerance,
scaled by sampled native derivative magnitudes. It does not
replace geodesic propagation, change reached material, or emit extra rim paths.
The residual geometry, band and actual sampled diameter remain explicit.

The skill returns one standard atomic operation/stroke per accepted slice.
There is no inter-front travel or cooling pause; the slice is the cooling unit.
Named predecessor/successor components bind existing operations. It does not
infer material support or replace other skills' regions. Shared functional planning stages own travel, cooling and flow limits; exporters
own machine output. Exact runtime
identity includes the producer, shared numerical functions and dependencies.

## Research and license findings

Inspected 2026-09-14 for `remettub`'s request inspired by a YouTube short:

- Janis Andersons, Salomé Sanchez and Tom Vaneker, *Wave-inspired path-planning
  strategy for support-free horizontal overhangs in FDM* (2026).
  [Research dataset](https://data.mendeley.com/datasets/xhw8xkjyc2/1),
  DOI `10.17632/xhw8xkjyc2.1`, describes recursive Huygens-style fronts.
  The dataset is labeled **CC BY 4.0** and includes `wave overhangs.gh`,
  experimental G-code, scan data and a demonstrator. Its description names
  Pufferfish as a dependency of the Grasshopper loop. Those files were not
  incorporated or executed. The SSRN paper entry, DOI `10.2139/ssrn.6640458`,
  was located; access to its full contents was unavailable during this work.
  Follow-up located the published article in *Additive Manufacturing Letters* 18,
  DOI [10.1016/j.addlet.2026.100392](https://doi.org/10.1016/j.addlet.2026.100392),
  and [dataset version 2](https://data.mendeley.com/datasets/xhw8xkjyc2/2).
  Full paper contents remained inaccessible; no claim of a full-paper review.
- [PrusaSlicer WaveOverhangs](https://github.com/stmcculloch/PrusaSlicer-WaveOverhangs)
  credits the researchers and Steven McCulloch's preceding arc-overhang work.
  Its README identifies **AGPL-3.0** licensing.
- [OrcaSlicer WaveOverhangs](https://waveoverhangs.com/) describes the corresponding
  Orca port and publishes examples. Its
  [license file](https://github.com/dennisklappe/OrcaSlicer-WaveOverhangs/blob/main/LICENSE.txt)
  is **AGPL-3.0**. These slicer implementations are references, not dependencies.
- The user supplied Janis Andersons's
  [specific short](https://www.youtube.com/shorts/RxPW5A4__X4), which links to his
  [longer explanation](https://www.youtube.com/watch?v=IhAzIXTE-FE). The title,
  visible playback frames and description establish the intended research;
  a full transcript was unavailable. The author's description links the above
  slicer forks. Their [pattern settings](https://github.com/dennisklappe/OrcaSlicer-WaveOverhangs/blob/main/docs/WAVE_OVERHANG_SETTINGS.md)
  and [traversal implementation](https://github.com/dennisklappe/OrcaSlicer-WaveOverhangs/blob/main/src/libslic3r/WaveOverhangs/WaveOverhangs.cpp)
  permit branch restarts in Zig Zag mode when no short connection is available.
  They do not establish a guaranteed single pass per complete slice or a special
  perpendicular glue-jog procedure. The earlier SAAM perimeter tails were an
  implementation error, not an adopted exemplar behavior.

SAAM's producer and constrained-offset extension are original implementation
under this repository's Apache-2.0 license. No AGPL implementation, Grasshopper
script, research G-code, image or data fixture was copied. The published concept
is credited above. This license check records source terms and the chosen
implementation boundary; it is not a patent clearance investigation.
If a future change incorporates dataset material, preserve attribution, link
the [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/), and identify
changes. Incorporating AGPL source requires a separate distribution/licensing
decision; this work does not silently relicense SAAM.

## Verification

[Wave tests](tests/wave.test.mjs) use analytical inclined/rescaled planes, an
independently unrolled rational cylinder, a doubly curved polynomial surface,
holes, seeded/disconnected islands, unbudgeted propagation and shared composition/export.
Regressions require complete saddle fronts, a single deposited stroke per
accepted slice, no internal rapid moves/dwells in exported G-code, and rejection
of hole branches that would require separate passes.
The original `canopy-rim.json` fixture starts near the large example's rim and
checks that long rounding strips remain diagnostic geometry, without producing
additional perimeter passes or exhausting growth.
The example provides a reproducible public development workflow.
Existing surface-offset tests retain unconstrained behavior. Shared boolean
tests cover the unchanged default origin and topology path.

```sh
node --test skills/wave-overhangs/tests/*.test.mjs core/tests/surface-offset.test.mjs core/tests/intersection.test.mjs core/tests/offset.test.mjs
```

Software fixtures and synthetic approvals establish no physical result. The
user has Grasshopper available as an optional future comparison host; no
comparison result or physical validation is claimed.
