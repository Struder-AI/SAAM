import './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportProgram } from '../export/registry.mjs';
import { defaults, VERSION, BUILD_DATE } from '../print/plan.mjs';
import { generatePath } from '../print/generate.mjs';
import {scheduled} from './fixtures/scheduled.mjs';
import {splineBox} from './fixtures/spline-shapes.mjs';

const machine=JSON.parse(readFileSync('machines/ultimaker/ultimaker-s5.json','utf8'));
const plan=defaults();
plan.geometry=splineBox({runMm:10,widthMm:10,heightMm:2});plan.process.minimumLayerSeconds=0;
// Export accepts only the joined compact pair; inserted physical actions are
// schedule execution entries that machine preparation carries in order.
const path=scheduled(await generatePath(plan),{machine,plan,sourcePathId:'export-fixture'});
// Writers stream Buffer artifacts; these envelope checks read the G-code text.
const emit=async(m=machine,p=path)=>(await exportProgram(p,plan,m,{generatorVersion:VERSION,buildDate:BUILD_DATE})).bytes.toString();

test('machine templates preserve the last working S5 envelope',async()=>{
  // Compare against the checkpoint the user identified as the working behavior.
  const before=JSON.parse(readFileSync(new URL('./fixtures/last-working-s5-envelope.json',import.meta.url),'utf8')),after=await emit();
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
  assert.match(await emit(revised),/;PROFILE.TEST:from-machine/);
});

test('a snapshot without program templates writes with the installed profile templates',async()=>{
  const old=structuredClone(machine);delete old.outputs[0].program;
  const {bytes,report}=await exportProgram(path,plan,old,{generatorVersion:VERSION,buildDate:BUILD_DATE});
  assert.equal(bytes,await emit());
  assert.ok(!report.limitations.some(text=>/program templates/.test(text)));
});

test('a pause longer than one G4 command is written as commands that sum to it',async()=>{
  const at=path.schedule.execution.findIndex(e=>e.kind==='travel'||e.kind==='deposit')+1;
  const paused=seconds=>{const p=structuredClone(path);p.schedule.execution.splice(at,0,{kind:'dwell',seconds});return p;};
  const waits=code=>code.split('\n').map(l=>l.trim()).filter(l=>l.startsWith('G4 '));
  assert.deepEqual(waits(await emit(machine,paused(12))),['G4 P12000'],'a pause within one command is written unchanged');
  const long=await emit(machine,paused(150));
  assert.deepEqual(waits(long),['G4 P60000','G4 P60000','G4 P30000']);
  assert.equal(waits(await emit()).length,0,'a path without a pause emits no wait');
});

