# Motion composition

```saam-components
move | @core/path/builder.mjs::PathBuilder::move | target mm; speed mm/s; volume mm3; optional pose/metadata | appended or merged action; updated builder state | Uses builder position/process/machine; caps feed and flow; rejects unsupported pose; mutates accumulated motion.
recover | @core/path/builder.mjs::PathBuilder::recover | builder process and retraction state | recovered extrusion state | Emits recovery only when retracted; mutates builder actions and retraction state.
```

```saam-page 5_motion
title 5 — Compose moves
sub Level 1 · dependency order, travel and layer timing
parent 0_system motion
in skill results
out path
port in | skill results
box compose | 5.1 | compose operations | @core/path/compose.mjs::composeResults
box schedule | 5.2 | schedule dependencies | @core/path/compose.mjs::scheduleOperations
box order | 5.3 | order closed strokes | @core/path/builder.mjs::orderStrokes
box cells | 5.4 | order scanline cells | @core/path/builder.mjs::orderScanlineCells
box travel | 5.5 | travel to stroke | >5a_travel
box move | 5.6 | deposit segment | $move
box finish | 5.7 | cool completed layer | @core/path/builder.mjs::PathBuilder::finishLayer
box path | 5.8 | collect path | @core/path/builder.mjs::PathBuilder::toPath
port out | path
in > compose | results and rules | data
compose > schedule | operations / prerequisites | data
schedule > compose | stable order | data | norank
compose > order | nearest closed | gate
compose > cells | nearest cells | gate
order > compose | ordered strokes | data | norank
cells > compose | ordered strokes | data | norank
compose > travel | next stroke / policy | data
travel > compose | positioned builder | data | norank
compose > move | stroke segments | data
compose > finish | last noncontinuous operation | gate
move > path | accumulated actions | data
finish > path | timing actions | data
path > out | SAAMpath | data
box 5b | 5.9 | prepare material policy | >5b_policy
ext 5bCaller | shared callers
5bCaller > 5b | deposited region / surface | data
5b > 5bCaller | travel queries | data | norank
box 5c | 5.10 | prepare deposition and pose | >5c_process
ext 5cCaller | shared callers
5cCaller > 5c | stroke / process / pose | data
5c > 5cCaller | motion inputs | data | norank
```

```saam-page 5a_travel
title 5.5 — Travel to stroke
sub Level 2 · join, comb or retreat with clearance
parent 5_motion travel
in next stroke / policy
out positioned builder
port in | next stroke / policy
box travel | 5.5.1 | choose transition | @core/path/builder.mjs::PathBuilder::travelTo
box direct | 5.5.2 | test direct travel | @core/path/builder.mjs::PathBuilder::canComb
box route | 5.5.3 | find comb route | @core/path/comb.mjs::combRoute
box retract | 5.5.4 | retract | @core/path/builder.mjs::PathBuilder::retract
box move | 5.5.5 | move at clearance | $move
box recover | 5.5.6 | recover after hop | $recover
box before | 5.5.7 | recover before comb | $recover
box comb | 5.5.8 | move directly / comb | $move
port out | positioned builder
in > travel | target and policy | data
travel > direct | unoriented; nonzero gap | gate
direct > travel | clear / blocked | data | norank
travel > route | direct blocked | gate
route > travel | route / none | data | norank
travel > retract | clearance / reorientation | gate
retract > move | retreat; position; approach | data
travel > before | direct / comb route | gate
before > comb | unretracted | data
travel > comb | oriented surface join | gate
comb > out | direct / comb complete | data
move > recover | at stroke start | data
travel > recover | already at target | gate
recover > out | hop / join complete | data
```

The PathBuilder is mutable state shared by these methods. Wires identify method
calls and state dependencies; they do not prove execution order. The composer
also parks for selected nozzle-temperature changes and emits stationary
extrusion/dwell for explicit injection strokes. [Composition contracts](reference/motion.md)
own bead, pose, dependency and travel semantics. No collision model is implied.


```saam-scope
core/path/ | Operation composition, deposited material, pose and process motion
```

```saam-references
motion | maps/reference/motion.md | Skill results, scheduling, deposition and travel contracts
collision-proposal | maps/reference/collision-proposal.md | Unimplemented collision planning proposal; not current behavior
```


```saam-page 5b_policy
title 5.9 — prepare material policy
sub Shared responsibility · contracts remain with the owning region
parent 5_motion 5b
in deposited region / surface
out travel queries
port in | deposited region / surface
port out | travel queries
box n0 | 5.9.1 | make planar policy | @core/path/builder.mjs::planarPolicy
in > n0 | make planar policy inputs | data
n0 > out | make planar policy result | data
box n1 | 5.9.2 | make surface policy | @core/path/builder.mjs::surfacePolicy
in > n1 | make surface policy inputs | data
n1 > out | make surface policy result | data
box n2 | 5.9.3 | query deposited material | @core/path/material.mjs::materialRegion
in > n2 | query deposited material inputs | data
n2 > out | query deposited material result | data
```


```saam-page 5c_process
title 5.10 — prepare deposition and pose
sub Shared responsibility · contracts remain with the owning region
parent 5_motion 5c
in stroke / process / pose
out motion inputs
port in | stroke / process / pose
port out | motion inputs
box n0 | 5.10.1 | integrate deposition | @core/path/deposition.mjs::depositionStroke
in > n0 | integrate deposition inputs | data
n0 > out | integrate deposition result | data
box n1 | 5.10.2 | set line spacing | @core/path/spacing.mjs::lineSpacing
in > n1 | set line spacing inputs | data
n1 > out | set line spacing result | data
box n2 | 5.10.3 | plan startup prime | @core/path/prime.mjs::primeBeforePart
in > n2 | plan startup prime inputs | data
n2 > out | plan startup prime result | data
box n3 | 5.10.4 | validate nozzle target | @core/path/process-controls.mjs::validateNozzleC
in > n3 | validate nozzle target inputs | data
n3 > out | validate nozzle target result | data
box n4 | 5.10.5 | validate tool frame | @core/path/pose.mjs::validatePose
in > n4 | validate tool frame inputs | data
n4 > out | validate tool frame result | data
box n5 | 5.10.6 | transform rotating bed | @core/path/pose.mjs::bedPoint
in > n5 | transform rotating bed inputs | data
n5 > out | transform rotating bed result | data
```


```saam-responsibilities
composition | core/path/compose.mjs | motion#changing-operation-composition | core/tests/composition.test.mjs, core/tests/interoperability.test.mjs, core/tests/regional-workflow.test.mjs
travel-builder | core/path/builder.mjs, core/path/comb.mjs, core/path/heat.mjs, core/path/material.mjs | motion#changing-path-state-and-travel | core/tests/travel.test.mjs, core/tests/material-travel.test.mjs, core/tests/straight-moves.test.mjs, core/tests/heat.test.mjs, core/tests/multi-tool.test.mjs
deposition-policy | core/path/deposition.mjs, core/path/spacing.mjs, core/path/prime.mjs, core/path/process-controls.mjs | motion#changing-deposition-spacing-and-process-controls | core/tests/spacing.test.mjs, core/tests/prime.test.mjs, core/tests/modal-export.test.mjs, core/tests/pipeline.test.mjs
tool-pose | core/path/pose.mjs | motion#changing-motion-pose-conventions | core/tests/denso.test.mjs, core/tests/robot-playback.test.mjs, core/tests/machine-presentation.test.mjs
finished-surfaces | core/path/finished-surface.mjs | motion#changing-finished-surface-publication | core/tests/finished-cladding.test.mjs, core/tests/reservation-surface.test.mjs
```
