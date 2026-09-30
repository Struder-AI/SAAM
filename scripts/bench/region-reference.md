# Region kernel verification and provenance

## Offset verification and provenance

Development checks compare 90 nested/neck/star/island/collapse cases, inward and
outward with all three joins, against the **unmodified Clipper2 C# kernel** at
the pinned upstream revision. The reference uses the same material-region
normalization, integer grid and polygon offset options; its fixture records
source/input hashes and provenance. Historical Clipper 6 coordinates remain in
their original fixture, rather than being relabeled as Clipper2 results. Round
arc segmentation can differ between kernel versions. Surface checks cover flat nesting/collapse,
an inclined plane with rescaled UV, an independently unrolled rational cylinder,
and refinement of nested regions on a doubly curved quadratic surface. These
are software tests, not universal correctness or physical print validation.

```sh
node --test core/tests/offset-junctions.test.mjs core/tests/offset-remnants.test.mjs
node scripts/bench/offsets.mjs > .local/offset-timings.json
```

To regenerate the independent Clipper2 reference, fetch the revision listed in
[planar intersection provenance](../../core/region/README.md#shared-planar-intersections) into ignored
`.local/intersection-native-reference`, then use .NET 8:

```sh
node --input-type=module -e "import fs from 'node:fs'; import {offsetFixtures} from './scripts/bench/offset-fixtures.mjs'; fs.mkdirSync('.local/clipper2-offset-reference',{recursive:true}); fs.writeFileSync('.local/clipper2-offset-reference/inputs.json',JSON.stringify(offsetFixtures));"
dotnet build scripts/bench/clipper2-offset-reference.csproj --artifacts-path .local/clipper2-offset-reference/artifacts
dotnet .local/clipper2-offset-reference/artifacts/bin/clipper2-offset-reference/debug/clipper2-offset-reference.dll .local/clipper2-offset-reference/inputs.json > .local/clipper2-offset-reference/expected.json
node scripts/bench/check-clipper2-offset-reference.mjs .local/clipper2-offset-reference/expected.json --record
```

The checker records the independent C# output after comparison with WASM; it
does not manufacture expected coordinates from the production adapter.
Normal `npm ci`/`npm test` needs neither .NET, a network fetch nor Rhino desktop.
The current kernel carries the upstream Boost Software License 1.0.
Historical plugin C# provenance and its runner remain in
`core/tests/fixtures/clipper-reference.json` and
`scripts/bench/clipper-reference.cs`; they describe the superseded Clipper 6
comparison. The original surface investigation references the public
[Rhino wrapper](https://github.com/mcneel/rhino3dm/blob/main/src/dotnet/opennurbs/opennurbs_curve.cs).

Historical costs and diagnostic outcomes are in the
[devlog](../../DEVLOG.md#2026-09-09--clipper-6-and-surface-offset-measurements).
The benchmark runner reports cold time, warm samples, source/output hashes and
usage; measure the current kernel before making a current performance claim.

## Intersection verification and provenance

Tests include the captured 60-vertex STL failure, analytic nesting, contacts,
slivers, nearly parallel crossings through coincidence, translation/scaling,
repeated operations and 200 seeded rectangle-set cases checked by independent
cell classification. Another 138 star/nesting/contact/sliver/STL cases match the
unmodified upstream C# results exactly in coordinates and topology. Agreement
checks integration; it is not an independent proof of the upstream algorithm.
The original 1078-triangle STL passes every offset/solid-mask diagnostic layer.

```sh
node --test core/tests/intersection.test.mjs
node scripts/bench/intersections.mjs
node scripts/bench/diagnose-regions.mjs .local/slicing-rhino/rhino-standard.stl .local/intersection-diagnostics
```

Reference provenance: [WASM source](https://github.com/ErikSom/Clipper2-WASM/tree/3c244f3edd0adae6c851460fc409c15f3d235395),
[Clipper2 source](https://github.com/AngusJohnson/Clipper2/tree/642390d0d515cfb645d2ec4d95d218e28be645f4),
Boost Software License 1.0. Installed WASM SHA-256:
`429e866b4d7813cabfa7d31e6650825343109fb7d7a1702c533e8597573449ec`.
To regenerate the saved reference, fetch that Clipper2 revision into ignored
`.local/intersection-native-reference`, then use .NET 8:

```sh
node scripts/bench/intersections.mjs --inputs .local/intersection-inputs.json
dotnet build scripts/bench/intersection-reference.csproj --artifacts-path .local/intersection-reference-artifacts
dotnet .local/intersection-reference-artifacts/bin/intersection-reference/debug/intersection-reference.dll .local/intersection-inputs.json > .local/intersection-reference-output.json
node scripts/bench/intersections.mjs --reference .local/intersection-reference-output.json --record
```

The [devlog](../../DEVLOG.md#2026-09-09--intersection-and-twisted-fixture-measurements)
preserves the initial kernel timings and public-workflow observations. Current
benchmark output records CPU, Node, samples and source/output hashes; differences
in draped coverage limit comparisons between backends.
