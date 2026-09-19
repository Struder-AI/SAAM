# Geometry

```saam-components
repairFiles | @core/print/repair-stl.mjs::repairSTLFiles | new destination; source STL; repair options | original and repaired files; change report | Worker-owned repair; millimetre output; rejects existing destination and failed validation; no geometry approval.
meshCut | @core/geom/mesh.mjs::cutMesh | mesh; height; vertex and triangle queries; optional contour cache | closed loops; requested height; nudge | Millimetres; rejects ambiguous cuts; cache must belong to unchanged geometry.
sectionShell | @core/geom/shell.mjs::sectionShell | spline shell; Z; sampling options | oriented section loops and nudge | Millimetres; rejects unresolved closure; native patches remain authoritative.
```

```saam-page 3_geometry
title 3 — Geometry
sub Level 1 · native preparation and shared queries
parent 0_system geom
in geometry query
out geometry
port query | geometry query
port result | geometry
ext authors | lifecycle / authoring tools
box queries | 3.1 | query geometry | >3q_queries
box native | 3.2 | prepare native geometry | >3c_native
box contours | 3.3 | prepare contours | >3g_contours
box contact | 3.4 | prepare radial contact | >3h_contact
box modify | 3.5 | apply features | >3d_features
box sleeve | 3.6 | fit reference sleeve | >3e_sleeve
box repair | 3.7 | repair mesh | >3f_repair
query > queries | geometry query | data
query > contours | curve family / tolerances | data
query > contact | source curves / anchors | data
contours > result | prepared curve queries | data
contact > result | contact mapping | data
queries > result | geometry | data
authors > native | geometry recipe | data
authors > modify | feature request | data
authors > sleeve | validated mesh / interval | data
authors > repair | source STL / options | data
native > authors | native bytes / descriptor | data | norank
modify > authors | updated bundle | data | norank
sleeve > authors | reference surface | data | norank
repair > authors | repaired STL / report | data | norank
```

```saam-page 3q_queries
title 3.1 — Geometry queries
sub Level 2 · mesh and spline backends share query contracts
parent 3_geometry queries
in geometry query
out geometry
port query | geometry query
box section | 3.1.1 | cut once | @core/geom/query.mjs::sectionGeometry
box prepare | 3.1.2 | prepare repeated cuts | @core/geom/query.mjs::createSectionQuery
box mesh | 3.1.3 | cut mesh | >3a_mesh
box spline | 3.1.4 | cut spline shell | >3b_spline
box top | 3.1.5 | sample top | @core/geom/query.mjs::topAt
box sampled | 3.1.6 | survey surface | @core/geom/query.mjs::sampleTopSurface
port result | geometry
query > section | single section | gate
query > prepare | repeated sections | gate
query > sampled | surface grid | gate
query > top | point query | gate
section > mesh | mesh / Z | gate
prepare > mesh | prepared mesh / Z | gate
section > spline | shell / Z | gate
prepare > spline | shell / Z | gate
mesh > result | mesh loops | data
spline > result | spline loops | data
sampled > top | XY samples | data
top > result | height / normal / slope | data
sampled > result | sampled grid / slope report | data
```

```saam-page 3a_mesh
title 3.1.3 — Cut mesh
sub Level 3 · cache topology between vertex heights
parent 3q_queries mesh
in mesh / Z
in prepared mesh / Z
out mesh loops
port once | mesh / Z
port prepared | prepared mesh / Z
box direct | 3.1.3.1 | section mesh | @core/geom/mesh.mjs::sectionMesh
box prepare | 3.1.3.2 | index section bands | @core/geom/mesh.mjs::createMeshSectionQuery
box cut | 3.1.3.3 | choose valid cut | $meshCut
box edges | 3.1.3.4 | join intersected edges | @core/geom/mesh.mjs::meshContourEdges
port out | mesh loops
once > direct | mesh and height | data
prepared > prepare | fixed mesh | data
direct > cut | all triangles | data
prepare > cut | indexed triangles / contours | data
cut > edges | uncached band | gate
edges > cut | edge loops | data | norank
cut > out | oriented loops; nudge | data
box 3j | 3.1.3.5 | validate and query mesh | >3j_mesh
ext 3jCaller | shared callers
3jCaller > 3j | indexed mesh / source file | data
3j > 3jCaller | validated mesh / query | data | norank
```

```saam-page 3b_spline
title 3.1.4 — Cut spline shell
sub Level 3 · adaptive contours on native patches
parent 3q_queries spline
in shell / Z
out spline loops
port in | shell / Z
box shell | 3.1.4.1 | section shell | $sectionShell
box at | 3.1.4.2 | collect patch chains | @core/geom/shell.mjs::sectionAt
box patch | 3.1.4.3 | contour patch | @core/geom/section.mjs::sectionPatch
box grid | 3.1.4.4 | refine sampling grid | @core/geom/section.mjs::contourGrid
box refine | 3.1.4.5 | refine contour | @core/geom/section.mjs::refine
box join | 3.1.4.6 | close chains | @core/geom/shell.mjs::joinChains
port out | spline loops
in > shell | shell and height | data
shell > at | candidate cut | data
at > patch | patches and plane | data
patch > grid | scalar field | data
grid > patch | resolved cells | data | norank
patch > refine | joined contour | data
refine > patch | refined chain | data | norank
patch > at | patch chains | data | norank
at > join | all chains | data
join > shell | closed loops | data | norank
shell > out | oriented loops; nudge | data
box 3i | 3.1.4.7 | evaluate numerical geometry | >3i_numerics
ext 3iCaller | shared callers
3iCaller > 3i | geometry primitives | data
3i > 3iCaller | evaluated samples | data | norank
```

```saam-page 3c_native
title 3.2 — Prepare native geometry
sub Level 2 · preserve recipe identity through native round trip
parent 3_geometry native
in geometry recipe
out native bytes / descriptor
port in | geometry recipe
box create | 3.2.1 | create native geometry | @core/print/geometry.mjs::createGeometry
box build | 3.2.2 | build shell | $buildShell
box mesh | 3.2.3 | serialize mesh | @core/print/geometry.mjs::createMeshGeometry
box proxy | 3.2.4 | sample display proxy | @core/print/geometry.mjs::proxyMesh
box verify | 3.2.5 | verify native round trip | $verifyGeometry
port out | native bytes / descriptor
in > create | recipe | data
create > build | spline recipe | gate
create > mesh | mesh / mixed assembly | gate
build > create | native surfaces | data | norank
mesh > create | mesh bytes and descriptor | data | norank
create > proxy | spline shell | gate
proxy > create | display mesh | data | norank
create > verify | serialized spline geometry | gate
verify > create | verified identity | data | norank
create > out | bytes; features; bounds | data
box 3k | 3.2.6 | construct geometry | >3k_construct
ext 3kCaller | shared callers
3kCaller > 3k | shape recipes | data
3k > 3kCaller | native shapes / display mesh | data | norank
```

```saam-page 3d_features
title 3.5 — Apply features
sub Level 2 · feature compilation returns through the lifecycle
parent 3_geometry modify
in feature request
out updated bundle
port in | feature request
box text | 3.5.1 | apply text | @core/print/text.mjs::applyText
box inserts | 3.5.2 | apply insert bores | @core/print/heat-set.mjs::applyHeatSet
box build | 3.5.3 | build substrate | $buildShell
box read | 3.5.4 | read current bundle | $load
ext compiler | skill feature compilers
ext lifecycle | validated plan update
port out | updated bundle
in > text | text feature | gate
in > inserts | heat-set feature | gate
text > read | current revision | data
inserts > read | current revision | data
read > text | copied plan | data | norank
read > inserts | copied plan | data | norank
text > compiler | features; embedded font | data
inserts > compiler | insert features; wrappers | data
compiler > build | substrate recipe | data
build > compiler | manufacturing geometry | data | norank
compiler > lifecycle | compiled recipe | data
lifecycle > out | updated identity | data
box 3l | 3.5.5 | prepare surface references | >3l_surfaces
ext 3lCaller | shared callers
3lCaller > 3l | surface selection / source | data
3l > 3lCaller | charts / offset queries | data | norank
box 3m | 3.5.6 | prepare text geometry | >3m_text
ext 3mCaller | shared callers
3mCaller > 3m | text feature / font | data
3m > 3mCaller | outlines / layout / identity | data | norank
```

```saam-page 3e_sleeve
title 3.6 — Fit reference sleeve
sub Level 2 · the reference does not replace source material
parent 3_geometry sleeve
in validated mesh / interval
out reference surface
port in | validated mesh / interval
box propose | 3.6.1 | propose usable interval | @core/geom/mesh-sleeve.mjs::detectMeshSleeveInterval
box fit | 3.6.2 | fit periodic sleeve | @core/geom/mesh-sleeve.mjs::fitMeshSleeve
box sections | 3.6.3 | sample source sections | @core/geom/mesh-sleeve.mjs::fitMeshSleeve::sourceSectionAt
box solve | 3.6.4 | solve least squares | @core/geom/least-squares.mjs::leastSquares
box point | 3.6.5 | evaluate fitted point | @core/geom/mesh-sleeve.mjs::fitMeshSleeve::pointAt
port out | reference surface
in > propose | authoring proposal | gate
in > fit | explicitly selected interval | gate
propose > fit | accepted interval | io
fit > sections | sample heights | data
sections > fit | source rings | data | norank
fit > solve | U and V basis matrices | data
solve > fit | separable QR solvers | data | norank
fit > point | fitted control net | data
point > out | sleeve query | data
```

```saam-page 3f_repair
title 3.7 — Repair mesh
sub Level 2 · preserve source facets and report changes
parent 3_geometry repair
in source STL / options
out repaired STL / report
port in | source STL / options
box files | 3.7.1 | repair to files | $repairFiles
box prepare | 3.7.2 | prepare repair | @core/print/repair-stl.mjs::prepare
box clean | 3.7.3 | clean triangle soup | @core/geom/mesh-repair.mjs::cleanTriangleSoup
box native | 3.7.4 | run native repair | @core/geom/mesh-native.mjs::repairMeshNative
box changes | 3.7.5 | measure shape changes | @core/print/repair-stl.mjs::shapeChanges
port out | repaired STL / report
in > files | source and options | data
files > prepare | worker-owned request | data
prepare > clean | decoded source | data
clean > prepare | cleaned mesh | data | norank
prepare > native | cleanup still invalid | gate
native > prepare | repaired mesh | data | norank
prepare > changes | validated mesh pair | data
changes > prepare | sampled changes | data | norank
prepare > files | mesh and report | data | norank
files > out | reimported STL; source copy | data
box job | 3.7.6 | supervise repair worker | @core/print/mesh-repair-job.mjs::runRepairJob
state pending | 3.7.7 | await geometry acknowledgments | @core/print/mesh-repair-worker.mjs::pending
```

```saam-page 3g_contours
title 3.3 — Prepare contours
sub Level 2 · refine correspondence; retain exact fallback
parent 3_geometry contours
in curve family / tolerances
out prepared curve queries
port in | curve family / tolerances
box prepare | 3.3.1 | prepare contour family | @core/geom/prepared-contours.mjs::prepareContourFamily
box select | 3.3.2 | select height-offset cell | @core/geom/prepared-contours.mjs::prepareContourFamily::select
box cell | 3.3.3 | test interpolation cell | @core/geom/prepared-contours.mjs::prepareContourFamily::cell
box fits | 3.3.4 | compare curve breakpoints | @core/geom/prepared-contours.mjs::fits
box curve | 3.3.5 | interpolate curve | @core/geom/prepared-contours.mjs::prepareContourFamily::preparedCurveAt
ext exact | supplied exact curve query
port out | prepared curve queries
in > prepare | interval; step; tolerance | data
prepare > curve | bound query | data
curve > select | height and offset | data
select > cell | uncached refinement | gate
cell > exact | corner and probe curves | data
exact > cell | phase-aligned polylines | data | norank
cell > fits | weighted corners / probe | data
fits > cell | within half tolerance | data | norank
cell > select | accepted corners / none | data | norank
select > exact | unresolved / outside range | gate
exact > select | direct curve | data | norank
select > curve | corners or exact result | data | norank
curve > out | phase query; report | data
```

```saam-page 3h_contact
title 3.4 — Prepare radial contact
sub Level 2 · bounded profiles retain source-side detail
parent 3_geometry contact
in source curves / anchors
out contact mapping
port in | source curves / anchors
box prepare | 3.4.1 | prepare contact | @core/geom/prepared-radial-contact.mjs::prepareRadialSleeveContact
box select | 3.4.2 | select height interval | @core/geom/prepared-radial-contact.mjs::prepareRadialSleeveContact::select
box interval | 3.4.3 | test profile interpolation | @core/geom/prepared-radial-contact.mjs::prepareRadialSleeveContact::interval
box frame | 3.4.4 | prepare polar profile | @core/geom/prepared-radial-contact.mjs::prepareRadialSleeveContact::frame
box regularize | 3.4.5 | unfold directional contour | @core/geom/directional-contour.mjs::regularizeDirectionalContour
box transition | 3.4.6 | test mesh transition | @core/geom/prepared-radial-contact.mjs::prepareRadialSleeveContact::meshTransition
box sample | 3.4.7 | constrain radial point | @core/geom/prepared-radial-contact.mjs::prepareRadialSleeveContact::at
port out | contact mapping
in > prepare | interval; side; budgets | data
prepare > sample | bound mapping | data
sample > select | point height | data
select > interval | new or refined slab | data
interval > frame | ends and probe heights | data
frame > regularize | source curve / anchor | data
regularize > frame | ordered loop and error | data | norank
frame > interval | polar profile | data | norank
interval > transition | failed fit; depth at least 8 | gate
transition > interval | sampled source-distance fit | data | norank
interval > select | accepted / subdivide | data | norank
select > sample | profiles and interpolation | data | norank
sample > out | side-limited point; report | data
```

Prepared contour acceptance samples height and offset; the breakpoint comparison
is exact only for the queried piecewise-linear curves. Cells that cannot meet
the sampled target use the original query. Radial contact preserves angular
ordering with bounded directional regularization, refines height intervals and
can validate small ledge transitions against mesh distance. Profile/depth/query
budgets fail explicitly. These are sampled fidelity controls, not universal
surface-error certificates; rebuild preparation after its source changes.

Caller contracts: [geometry](reference/geometry.md). The surface proxy used by
Studio is not the slicing geometry. Sleeve interval proposals require an explicit
authoring choice; sampled bounds are not proof over every height. The fit uses
separable QR solves and preserves actual Z. Repair checks and sampled distances
do not establish exact shape fidelity or human acceptance of the shape.


```saam-scope
core/geom/ | Geometry construction, queries, numerical foundations and native repair
core/print/geometry.mjs | Geometry preparation and authoring through the shared lifecycle
core/print/repair-stl.mjs | Geometry preparation and authoring through the shared lifecycle
core/print/mesh-repair-job.mjs | Geometry preparation and authoring through the shared lifecycle
core/print/mesh-repair-worker.mjs | Geometry preparation and authoring through the shared lifecycle
core/print/import-stl.mjs | Geometry preparation and authoring through the shared lifecycle
core/print/text.mjs | Geometry preparation and authoring through the shared lifecycle
core/print/heat-set.mjs | Geometry preparation and authoring through the shared lifecycle
```

```saam-references
geometry | maps/reference/geometry.md | Geometry queries, precision, representations and repair contracts
native-repair | maps/reference/native-repair.md | Native repair build, licenses and provenance
```


```saam-page 3i_numerics
title 3.1.4.7 — evaluate numerical geometry
sub Shared responsibility · contracts remain with the owning region
parent 3b_spline 3i
in geometry primitives
out evaluated samples
port in | geometry primitives
port out | evaluated samples
box n0 | 3.1.4.7.1 | evaluate spline | @core/geom/nurbs.mjs::evaluate
in > n0 | evaluate spline inputs | data
n0 > out | evaluate spline result | data
box n1 | 3.1.4.7.2 | project XY to patch | @core/geom/field.mjs::projectToPatch
in > n1 | project XY to patch inputs | data
n1 > out | project XY to patch result | data
box n2 | 3.1.4.7.3 | solve bracketed root | @core/geom/tolerance.mjs::findRoot
in > n2 | solve bracketed root inputs | data
n2 > out | solve bracketed root result | data
box n3 | 3.1.4.7.4 | clean planar seams | @core/geom/polyline.mjs::cleanPlanarLoop
in > n3 | clean planar seams inputs | data
n3 > out | clean planar seams result | data
box n4 | 3.1.4.7.5 | parameterize contour | @core/geom/contour-path.mjs::contourPath
in > n4 | parameterize contour inputs | data
n4 > out | parameterize contour result | data
```


```saam-page 3j_mesh
title 3.1.3.5 — validate and query mesh
sub Shared responsibility · contracts remain with the owning region
parent 3a_mesh 3j
in indexed mesh / source file
out validated mesh / query
port in | indexed mesh / source file
port out | validated mesh / query
box n0 | 3.1.3.5.1 | validate indexed mesh | @core/geom/mesh.mjs::makeMesh
in > n0 | validate indexed mesh inputs | data
n0 > out | validate indexed mesh result | data
box n1 | 3.1.3.5.2 | check topology | @core/geom/mesh-topology.mjs::meshTopology
in > n1 | check topology inputs | data
n1 > out | check topology result | data
box n2 | 3.1.3.5.3 | index triangle contacts | @core/geom/mesh-spatial.mjs::triangleIndex
in > n2 | index triangle contacts inputs | data
n2 > out | index triangle contacts result | data
box n3 | 3.1.3.5.4 | index triangle boxes | @core/geom/triangle-bvh.mjs::triangleBVH
in > n3 | index triangle boxes inputs | data
n3 > out | index triangle boxes result | data
box n4 | 3.1.3.5.5 | bound nearest distance | @core/geom/mesh-distance.mjs::createMeshDistanceQuery
in > n4 | bound nearest distance inputs | data
n4 > out | bound nearest distance result | data
box n5 | 3.1.3.5.6 | check index capacity | @core/geom/mesh-capacity.mjs::checkMeshCapacity
in > n5 | check index capacity inputs | data
n5 > out | check index capacity result | data
box n6 | 3.1.3.5.7 | stream STL input | @core/geom/stl-file.mjs::decodeSTLFile
in > n6 | stream STL input inputs | data
n6 > out | stream STL input result | data
```


```saam-page 3k_construct
title 3.2.6 — construct geometry
sub Shared responsibility · contracts remain with the owning region
parent 3c_native 3k
in shape recipes
out native shapes / display mesh
port in | shape recipes
port out | native shapes / display mesh
box n0 | 3.2.6.1 | construct spline shell | @core/geom/shapes.mjs::shellFromSurfaces
in > n0 | construct spline shell inputs | data
n0 > out | construct spline shell result | data
box n1 | 3.2.6.2 | construct spline tube | @core/geom/spline-tube.mjs::splineTubeShell
in > n1 | construct spline tube inputs | data
n1 > out | construct spline tube result | data
box n2 | 3.2.6.3 | construct pipe mesh | @core/geom/cylinder.mjs::pipeMesh
in > n2 | construct pipe mesh inputs | data
n2 > out | construct pipe mesh result | data
box n3 | 3.2.6.4 | combine solid meshes | @core/geom/solid.mjs::combineSolids
in > n3 | combine solid meshes inputs | data
n3 > out | combine solid meshes result | data
box n4 | 3.2.6.5 | tessellate display shell | @core/geom/tessellate.mjs::tessellateShell
in > n4 | tessellate display shell inputs | data
n4 > out | tessellate display shell result | data
```


```saam-page 3l_surfaces
title 3.5.5 — prepare surface references
sub Shared responsibility · contracts remain with the owning region
parent 3d_features 3l
in surface selection / source
out charts / offset queries
port in | surface selection / source
port out | charts / offset queries
box n0 | 3.5.5.1 | resolve selected surface | @core/geom/surface-region.mjs::surfaceRegion
in > n0 | resolve selected surface inputs | data
n0 > out | resolve selected surface result | data
box n1 | 3.5.5.2 | map reference surface | @core/geom/reference-surface.mjs::referenceSurface
in > n1 | map reference surface inputs | data
n1 > out | map reference surface result | data
box n2 | 3.5.5.3 | prepare normal offsets | @core/geom/surface-offset.mjs::prepareSurfaceOffsets
in > n2 | prepare normal offsets inputs | data
n2 > out | prepare normal offsets result | data
box n3 | 3.5.5.4 | prepare curvature weights | @core/geom/offset-curvature.mjs::prepareOffsetCurvature
in > n3 | prepare curvature weights inputs | data
n3 > out | prepare curvature weights result | data
box n4 | 3.5.5.5 | prepare sleeve frame | @core/geom/sleeve-frame.mjs::prepareLooseSleeveOffsets
in > n4 | prepare sleeve frame inputs | data
n4 > out | prepare sleeve frame result | data
box n5 | 3.5.5.6 | prepare sleeve contact | @core/geom/sleeve-contact.mjs::prepareSleeveContact
in > n5 | prepare sleeve contact inputs | data
n5 > out | prepare sleeve contact result | data
box n6 | 3.5.5.7 | build support reference | @core/geom/support-surface.mjs::supportSurface
in > n6 | build support reference inputs | data
n6 > out | build support reference result | data
box n7 | 3.5.5.8 | enumerate selections | @core/geom/selections.mjs::geometrySelections
in > n7 | enumerate selections inputs | data
n7 > out | enumerate selections result | data
```


```saam-page 3m_text
title 3.5.6 — prepare text geometry
sub Shared responsibility · contracts remain with the owning region
parent 3d_features 3m
in text feature / font
out outlines / layout / identity
port in | text feature / font
port out | outlines / layout / identity
box n0 | 3.5.6.1 | flatten font outlines | @core/geom/text-outline.mjs::textOutlines
in > n0 | flatten font outlines inputs | data
n0 > out | flatten font outlines result | data
box n1 | 3.5.6.2 | place glyphs | @core/geom/text-layout.mjs::textLayout
in > n1 | place glyphs inputs | data
n1 > out | place glyphs result | data
box n2 | 3.5.6.3 | validate compiled record | @core/geom/text-record.mjs::validateTextRecord
in > n2 | validate compiled record inputs | data
n2 > out | validate compiled record result | data
```


```saam-responsibilities
numerics | core/geom/tolerance.mjs, core/geom/nurbs.mjs, core/geom/field.mjs, core/geom/polyline.mjs, core/geom/surface-derivatives.mjs, core/geom/least-squares.mjs | geometry#changing-numerical-foundations | core/tests/geometry.test.mjs, core/tests/contour-cleanup.test.mjs, core/tests/loose-surface-offset.test.mjs
geometry-query | core/geom/query.mjs, core/geom/shell.mjs, core/geom/section.mjs | geometry#changing-geometry-queries-and-shell-sections | core/tests/geometry.test.mjs, core/tests/mesh.test.mjs, core/tests/interoperability.test.mjs
mesh-structure | core/geom/mesh.mjs, core/geom/mesh-topology.mjs, core/geom/mesh-spatial.mjs, core/geom/triangle-bvh.mjs, core/geom/mesh-capacity.mjs, core/geom/stl-file.mjs | geometry#changing-mesh-topology-and-spatial-queries | core/tests/mesh.test.mjs, core/tests/mesh-boundary.test.mjs, core/tests/mesh-large.test.mjs
geometry-construction | core/geom/shapes.mjs, core/geom/cylinder.mjs, core/geom/spline-tube.mjs, core/geom/tessellate.mjs, core/print/geometry.mjs | geometry#changing-generated-geometry-and-persistence | core/tests/geometry.test.mjs, core/tests/pipeline.test.mjs, core/tests/text-layout.test.mjs
prepared-contours | core/geom/contour-path.mjs, core/geom/directional-contour.mjs, core/geom/prepared-contours.mjs, core/geom/prepared-radial-contact.mjs | geometry#changing-contour-correspondence-and-prepared-contact | core/tests/prepared-contours.test.mjs, core/tests/directional-contour.test.mjs, core/tests/prepared-radial-contact.test.mjs
spline-offsets | core/geom/surface-offset.mjs, core/geom/offset-curvature.mjs | geometry#changing-spline-offset-construction | core/tests/loose-surface-offset.test.mjs, core/tests/surface-offset.test.mjs, core/tests/cladding-offset-tightness.test.mjs
sleeves | core/geom/mesh-sleeve.mjs, core/geom/sleeve-frame.mjs, core/geom/sleeve-contact.mjs, core/geom/mesh-distance.mjs | geometry#changing-mesh-sleeves-and-contact-frames | core/tests/mesh-sleeve.test.mjs, core/tests/sleeve-frame.test.mjs, core/tests/sleeve-contact.test.mjs, core/tests/mesh-distance.test.mjs
surface-charts | core/geom/surface-region.mjs, core/geom/reference-surface.mjs, core/geom/support-surface.mjs, core/geom/selections.mjs | geometry#changing-selected-reference-and-support-charts | core/tests/surface-cladding.test.mjs, core/tests/reservation-surface.test.mjs, core/tests/regions.test.mjs
text-solids | core/geom/solid.mjs, core/geom/text-outline.mjs, core/geom/text-layout.mjs, core/geom/text-record.mjs, core/print/text.mjs, core/print/heat-set.mjs | geometry#changing-text-and-solid-feature-geometry | core/tests/text-layout.test.mjs, core/tests/geometry.test.mjs, core/tests/pipeline.test.mjs
mesh-repair | core/geom/mesh-native.mjs, core/geom/mesh-repair.mjs, core/geom/native/mesh-repair.cpp, core/print/repair-stl.mjs, core/print/mesh-repair-job.mjs, core/print/mesh-repair-worker.mjs | geometry#changing-explicit-mesh-repair-and-native-execution | core/tests/mesh-repair.test.mjs, core/tests/studio-import.test.mjs
stl-import | core/print/import-stl.mjs | geometry#changing-stl-normalization | core/tests/studio-import.test.mjs, core/tests/mesh.test.mjs, core/tests/mesh-large.test.mjs
```
