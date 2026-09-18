import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportGriffin, interpretGriffin } from '../export/griffin.mjs';
import { defaults, VERSION, BUILD_DATE } from '../print/plan.mjs';
import { generatePath } from '../print/generate.mjs';
import { rhino } from '../print/geometry.mjs';

const machine=JSON.parse(readFileSync('machines/ultimaker-s5.json','utf8'));
const plan=defaults();
plan.geometry={shape:'box',runMm:10,widthMm:10,heightMm:2};plan.skills['draped-skin'].enabled=false;plan.process.minimumLayerSeconds=0;
const path=generatePath(plan,machine,await rhino());
const emit=(m=machine,p=path)=>exportGriffin(p,plan,m,{generatorVersion:VERSION,buildDate:BUILD_DATE});

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

test('shared interpretation rejects cold extrusion, unsupported state, and invalid numeric paths',()=>{
  const code=emit();
  assert.throws(()=>interpretGriffin(code.replace('M109 T1 S215','M109 T1 S0'),plan,machine),/planned temperature/);
  assert.throws(()=>interpretGriffin(code.replace('G92 E0','G92 X0 E0'),plan,machine),/Unsupported arguments/);
  assert.throws(()=>emit(machine,{...path,initialPosition:[330,219,undefined]}),/initial position/);
  const broken=structuredClone(machine);delete broken.outputs[0].program;
  assert.throws(()=>emit(broken),/upgrade/);
});

test('G-code tokenization retains packed arguments, whitespace, comments and strict malformed rejection',()=>{
  const code=emit(),reference=interpretGriffin(code,plan,machine);
  for(const command of ['M109T1S215','  M109\tT1  S215  ','M109 T1 S215 ; T0 S0 is a comment']){
    assert.deepEqual(interpretGriffin(code.replace('M109 T1 S215',command),plan,machine),reference);
  }
  for(const command of ['M109 T1 S215 S215','M109 T1 S215 M109','M109 T1 S2e2','M109 T1 SInfinity',
    'M109 T1 SNaN','M109 T1 S215junk','!M109 T1 S215','M109 T1 S215!','M109 T1 S'+'9'.repeat(400)]){
    assert.throws(()=>interpretGriffin(code.replace('M109 T1 S215',command),plan,machine),/Duplicate|Unsupported arguments|Malformed|Nonfinite/);
  }
});

test('shell upgrade invalidates the final approval and keeps existing delivery bytes',async()=>{
  const adapter=await import('../print/bundle.mjs');
  const recipe=defaults();
  recipe.geometry={shape:'box',runMm:6,widthMm:6,heightMm:0.6};
  recipe.skills['draped-skin'].enabled=false;
  recipe.process.minimumLayerSeconds=0;
  const directory=await mkdtemp(join(tmpdir(),'saam-upgrade-test-'));
  try {
    await adapter.initBundle(directory,recipe);
    let state=await adapter.loadBundle(directory);
    await adapter.generateBundle(directory);
    state=await adapter.loadBundle(directory);
    await adapter.approve(directory,{actor:'synthetic upgrade test',revision:state.revision});
    const delivered=await adapter.deliver(directory),bytes=await readFile(delivered,'utf8');
    const oldMachine=JSON.parse(await readFile(join(directory,'machine.json'),'utf8'));
    delete oldMachine.outputs[0].program;
    await writeFile(join(directory,'machine.json'),JSON.stringify(oldMachine));
    await adapter.upgradeBundle(directory);
    state=await adapter.loadBundle(directory);
    assert.equal(state.toolpathApproved,false);
    assert.ok(state.machine.outputs[0].program);
    assert.equal(await readFile(delivered,'utf8'),bytes);
    assert.equal(await readFile(join(directory,adapter.EXPORT_PATH),'utf8'),bytes);
    await assert.rejects(()=>adapter.deliver(directory),/approval/);
  } finally {await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
