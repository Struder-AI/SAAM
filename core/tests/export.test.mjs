import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportGriffin, interpretGriffin } from '../export/griffin.mjs';
import { defaults, VERSION, BUILD_DATE } from '../../skills/wedge-demo/scripts/model.mjs';
import { generatePath } from '../../skills/wedge-demo/scripts/path.mjs';

const machine=JSON.parse(readFileSync('machines/ultimaker-s5.json','utf8'));
const plan=defaults(),path=generatePath(plan,machine);
const emit=(m=machine,p=path)=>exportGriffin(p,plan,m,{generatorVersion:VERSION,buildDate:BUILD_DATE});

test('machine templates preserve the last working S5 envelope',()=>{
  // Compare against the checkpoint the user identified as the working behavior.
  const before=JSON.parse(readFileSync(new URL('./fixtures/last-working-s5-envelope.json',import.meta.url),'utf8')),after=emit();
  const start=code=>code.slice(0,code.indexOf(';SAAM_PHASE:'));
  assert.equal(start(after),before.start);
  assert.equal(after.slice(after.lastIndexOf('M400')),before.end);
  assert.ok(!/^G280|^M10[49] T0/m.test(after));
  assert.match(after,/;GENERATOR.VERSION:4.4.0/);
  assert.match(after,/M109 T1 S215/);
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

test('standalone preview is no longer a product command',()=>{
  assert.throws(()=>execFileSync(process.execPath,['core/print/cli.mjs','preview'],{encoding:'utf8',stdio:'pipe'}),/Command failed/);
  assert.equal(JSON.parse(readFileSync('package.json','utf8')).scripts.preview,undefined);
});

for(const kind of ['shell','wedge']) test(`${kind} upgrade retains geometry approval and existing delivery bytes`,async()=>{
  const adapter=await import(kind==='shell'?'../print/bundle.mjs':'../../skills/wedge-demo/scripts/bundle.mjs');
  const factory=kind==='shell'?(await import('../print/plan.mjs')).defaults:defaults;
  const recipe=factory();
  if(kind==='shell'){
    recipe.geometry={shape:'box',runMm:6,widthMm:6,heightMm:0.6};
    recipe.skills['draped-skin'].enabled=false;
  }
  recipe.process.minimumLayerSeconds=0;
  const directory=await mkdtemp(join(tmpdir(),'saam-upgrade-test-'));
  try {
    await adapter.initBundle(directory,recipe);
    let state=await adapter.loadBundle(directory);
    for(const stage of ['geometry','plan'])state=await adapter.approve(directory,{stage,actor:'synthetic upgrade test',revision:state.revision});
    await adapter.generateBundle(directory);
    state=await adapter.loadBundle(directory);
    await adapter.approve(directory,{stage:'toolpath',actor:'synthetic upgrade test',revision:state.revision});
    const delivered=await adapter.deliver(directory),bytes=await readFile(delivered,'utf8');
    const oldMachine=JSON.parse(await readFile(join(directory,'machine.json'),'utf8'));
    delete oldMachine.outputs[0].program;
    await writeFile(join(directory,'machine.json'),JSON.stringify(oldMachine));
    await adapter.upgradeBundle(directory);
    state=await adapter.loadBundle(directory);
    assert.equal(state.geometryApproved,true);
    assert.equal(state.planApproved,false);
    assert.equal(state.toolpathApproved,false);
    assert.ok(state.machine.outputs[0].program);
    assert.equal(await readFile(delivered,'utf8'),bytes);
    assert.equal(await readFile(join(directory,adapter.EXPORT_PATH),'utf8'),bytes);
    await assert.rejects(()=>adapter.deliver(directory),/approval/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
