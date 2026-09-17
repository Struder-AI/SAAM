# Generation

Plan schema and dispatch change contracts are in `generation`; lifecycle state
is in the map-owned `lifecycle` contract; operation
results and scheduling are in `motion`, and material assignment in `regions`.
Read any of these with `read-map 2_generation --section ID#heading`; their owning
regions remain explicit in the returned packet. The `testing` contract locates
regional workflow, composition and interoperability checks. Pattern internals
remain in the selected skill's authoring references.

```saam-components
buildShell | @core/print/generate.mjs::buildShell | Rhino runtime; geometry recipe | mesh, spline shell or assembly | Model coordinates in mm; backend selected by recipe; rejects unsupported closure.
```

```saam-page 2_generation
title 2 — Generate
sub Level 1 · skills provide operations; the composer owns motion
parent 0_system gen
in locked plan
in geometry
in regions
out geometry query
out region query
out skill results
port plan | locked plan
port geometry | geometry
port regions | regions
box generate | 2.1 | generate path | @core/print/generate.mjs::generatePath
box validate | 2.2 | validate plan | @core/print/plan.mjs::validatePlan
box build | 2.3 | build geometry | $buildShell
box place | 2.4 | place on bed | @core/print/generate.mjs::translateShell
box assigned | 2.5 | resolve assignments | >2a_assignments
ext skills | skill producers
port query | geometry query
port clipping | region query
port result | skill results
plan > generate | recipe and machine | data
generate > validate | recipe | data
generate > build | geometry recipe | data
build > place | shell / components | data
place > generate | placed geometry | data | norank
generate > assigned | explicit regions | gate
generate > skills | whole-part selection | gate
assigned > skills | region settings / support | data
skills > query | section / surface request | data
geometry > skills | query result | data
skills > clipping | offset / mask request | data
regions > skills | material loops | data
skills > generate | operations / reports | data | norank
assigned > generate | regional results | data | norank
generate > result | operations / dependencies | data
```

```saam-page 2a_assignments
title 2.5 — Resolve assignments
sub Level 2 · material ownership supplies prerequisites
parent 2_generation assigned
in explicit regions
out region settings / support
out regional results
port in | explicit regions
box assign | 2.5.1 | resolve region order | @core/print/regions.mjs::generateRegionResults
box support | 2.5.2 | query planar support | @core/print/regions.mjs::planarSupportTopAt
box finished | 2.5.3 | publish finished boundary | @core/path/finished-surface.mjs::publishFinishedBoundary
box surface | 2.5.4 | publish material top | @core/print/regions.mjs::publishSurface
box field | 2.5.5 | sample top field | @core/print/regions.mjs::surfaceField
port skill | region settings / support
ext returns | skill operations / reports
port out | regional results
in > assign | assignments; placed shells | data
assign > support | drape without consumed top | gate
support > assign | underlying layer query | data | norank
assign > skill | bounded settings and masks | data
returns > assign | result ownership | data
assign > finished | eligible result / boundary | data
finished > assign | nominal surface records | data | norank
assign > surface | completed region | data
surface > field | nonconstant material top | gate
field > surface | sampled height field | data | norank
surface > assign | footprint and source IDs | data | norank
assign > out | operations; dependencies; reports | data
```

Assignments forbid overlapping ownership without an explicitly consumed lower
surface. A consumed top carries its producer's operation prerequisites. Sparse
roofs publish emitted bead strips; a thick lip is terminal and publishes no
consumable top. Finished boundaries are nominal ownership records, not measured
bead surfaces. Cladding must validate that its selected surface has a producer.

The source declaration at 2.1 includes the whole-part dispatch. Skin surveys run
before their supporting body to establish its reservation; regional assignments
use 2.5. Skill implementations and their own scripts are outside dev-map scope.
The normal pipeline also includes selected supports, rims, waves and welds;
their results join the same composer. See [composition contracts](reference/motion.md)
and the selected skill's role-specific manual.


```saam-scope
core/print/generate.mjs | Whole-part dispatch and common generation
core/print/regions.mjs | Regional assignment and finished-surface publication
core/print/plan.mjs | Plan schema, defaults and validation
```

```saam-references
generation | maps/reference/generation.md | Plan schema, whole-part dispatch, regional dependencies and change verification
```


```saam-responsibilities
plan-schema | core/print/plan.mjs | generation#changing-plan-schema-and-compatibility | core/tests/pipeline.test.mjs, core/tests/regional-workflow.test.mjs, core/tests/printer-profiles.test.mjs
dispatch | core/print/generate.mjs | generation#changing-generation-orchestration | core/tests/pipeline.test.mjs, core/tests/interoperability.test.mjs, core/tests/composition.test.mjs, core/tests/prime.test.mjs
regional-dispatch | core/print/regions.mjs | generation#changing-regional-material-publication | core/tests/regions.test.mjs, core/tests/regional-workflow.test.mjs, core/tests/reservation-surface.test.mjs, core/tests/assembly-reservation.test.mjs, core/tests/finished-cladding.test.mjs
```
