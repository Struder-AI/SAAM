import test from 'node:test';
import assert from 'node:assert/strict';
import {analyse,extrusions,stepFootprint} from '../../scripts/h2d-tower-analysis.mjs';

// A body square at 125..225 x 110..210, a tower beside it, a start purge line, and one arc on the tower.
const gcode=[
  'M83',
  '; FEATURE: Custom','G1 X250 Y-0.5 E1 F3000',
  '; layer num/total_layer_count: 1',
  '; FEATURE: Outer wall','G1 X125 Y110','G1 X225 Y110 E10','G1 X225 Y210 E10','G1 X125 Y210 E10','G1 X125 Y110 E10',
  '; FEATURE: Prime tower','G1 X158 Y240','G1 X177 Y240 E1','G3 X177 Y250 I0 J5 E0.5',
  '; layer num/total_layer_count: 2',
  '; FEATURE: Prime tower','G1 X158 Y256 E1'
].join('\n');

test('a slice separates into start purge, model and prime tower, and the tower lies outside the model footprint',()=>{
  const out=analyse(gcode,stepFootprint('#1=CARTESIAN_POINT(\'\',(0.,0.,0.));\n#2=CARTESIAN_POINT(\'\',(100.,100.,4.));'));
  assert.equal(out.startPurge.moves,1);
  assert.equal(out.model.moves,4);
  assert.deepEqual(out.model.bbox,[125,110,225,210]);
  assert.equal(out.tower.moves,3);
  assert.equal(out.towerInsideModelFootprint,0);
  assert.equal(out.nonTowerOutsideModelFootprint,0);
  assert.deepEqual(out.stepFootprintMm,[100,100,4]);
  assert.deepEqual(out.modelOffsetInGcode,[125,110]);
});

test('an arc is counted by its extrusion and its swept extent, not its endpoints',()=>{
  const arc=extrusions('M83\n; FEATURE: Prime tower\nG1 X10 Y0\nG3 X0 Y10 I-10 J0 E1').at(-1);
  assert.equal(arc.arc,true);
  assert.ok(arc.points.length>2);
  assert.ok(arc.points.every(([x,y])=>Math.abs(Math.hypot(x,y)-10)<1e-9),'sampled on the circle about the centre');
});

test('tower moves inside the model footprint are reported',()=>{
  const bad=gcode+'\n; FEATURE: Prime tower\nG1 X150 Y150 E1';
  assert.equal(analyse(bad).towerInsideModelFootprint,1);
});
