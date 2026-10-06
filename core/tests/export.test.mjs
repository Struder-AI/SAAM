import './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportProgram } from '../export/registry.mjs';
import { defaults, VERSION, BUILD_DATE } from '../print/plan.mjs';
import { generatePath } from '../print/generate.mjs';
import {splineBox} from './fixtures/spline-shapes.mjs';

const machine=JSON.parse(readFileSync('machines/ultimaker-s5.json','utf8'));
const plan=defaults();
plan.geometry=splineBox({runMm:10,widthMm:10,heightMm:2});plan.process.minimumLayerSeconds=0;
const path=await generatePath(plan,machine);
const emit=(m=machine,p=path)=>exportProgram(p,plan,m,{generatorVersion:VERSION,buildDate:BUILD_DATE}).bytes;

test('machine templates preserve the last working S5 envelope',()=>{
  // Compare against the checkpoint the user identified as the working behavior.
  const before=JSON.parse(readFileSync(new URL('./fixtures/last-working-s5-envelope.json',import.meta.url),'utf8')),after=emit();
  // Runtime release, estimates and material usage change with the recipe.
  // Keep comparing every machine/startup contract field to the historical bytes.
  // PRINT.SIZE.* is the model's own bounding box, not part of the machine
  // envelope contract; filter it alongside the other model-dependent fields.
  const start=code=>(code.includes(';SAAM_PHASE:')?code.slice(0,code.indexOf(';SAAM_PHASE:')):code).split('\n').filter(line=>!/^;(SAAM\.GENERATOR\.VERSION|GENERATOR\.BUILD_DATE|PRINT\.TIME|PRINT\.SIZE\.[A-Z.]+|EXTRUDER_TRAIN\.\d+\.MATERIAL\.VOLUME_USED):/.test(line)).join('\n');
  assert.equal(start(after),start(before.start));
  assert.equal(after.slice(after.lastIndexOf('M400')),before.end);
  assert.ok(!/^G280|^M10[49] T0/m.test(after));
  assert.match(after,/;GENERATOR.VERSION:4.4.0/);
  assert.match(after,/M109 T1 S215/);
  assert.match(after,/^M82$/m,'S5 retains absolute extrusion mode');
  assert.doesNotMatch(after,/^M83$/m,'the H2D relative-extrusion fix does not alter S5 output');
  const revised=structuredClone(machine);revised.outputs[0].program.header.splice(4,0,';PROFILE.TEST:from-machine');
  assert.match(emit(revised),/;PROFILE.TEST:from-machine/);
});

test('a profile without program templates is refused',()=>{
  const broken=structuredClone(machine);delete broken.outputs[0].program;
  assert.throws(()=>emit(broken),/no program templates/);
});

test('a pause longer than one G4 command is written as commands that sum to it',()=>{
  const at=path.actions.findIndex(a=>a.kind==='move')+1;
  const paused=seconds=>({...path,actions:[...path.actions.slice(0,at),
    {kind:'dwell',seconds},...path.actions.slice(at)]});
  const waits=code=>code.split('\n').map(l=>l.trim()).filter(l=>l.startsWith('G4 '));
  assert.deepEqual(waits(emit(machine,paused(12))),['G4 P12000'],'a pause within one command is written unchanged');
  const long=emit(machine,paused(150));
  assert.deepEqual(waits(long),['G4 P60000','G4 P60000','G4 P30000']);
  assert.equal(waits(emit()).length,0,'a path without a pause emits no wait');
});

