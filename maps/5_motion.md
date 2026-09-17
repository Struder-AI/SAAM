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
calls and state progression, not independent immutable results. The composer
also parks for selected nozzle-temperature changes and emits stationary
extrusion/dwell for explicit injection strokes. [Composition contracts](../core/path/README.md)
own bead, pose, dependency and travel semantics. No collision model is implied.
