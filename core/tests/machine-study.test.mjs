import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStudy} from '../../tools/kinematics/create-study.mjs';
import {createStudio} from '../../studio/server.mjs';
import {fetchSources,decodeSource} from '../../studio/source-player.mjs';
import {createMachinePresentation} from '../machine/presentation.mjs';
import {loadBundle} from '../../studio/machine-study.mjs';
import {interpretMachineStudy} from '../export/machine-study.mjs';

test('machine study uses source transport and cannot approve or deliver; changed source changes identity',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-machine-study-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await createStudy(dir);
  const server=createStudio(dir,{localExtension:{}});await new Promise(done=>server.listen(0,'127.0.0.1',done));
  t.after(()=>new Promise(done=>server.close(done)));const origin=`http://127.0.0.1:${server.address().port}`;
  const html=await(await fetch(origin)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const state=await(await fetch(origin+'/api/state')).json();assert.equal(state.inspection.note.startsWith('Simulation only'),true);
  const sources=await fetchSources(state,path=>fetch(origin+path)),program=decodeSource(sources,state.plan,state.machine);
  assert.equal(program.moves.length,48);assert.equal(program.seconds,24);
  for(const route of ['approve','deliver','generate']){
    const response=await fetch(origin+'/api/'+route,{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token,'Content-Type':'application/json'},body:JSON.stringify({printId:state.printId,stage:'toolpath',actor:'Synthetic test'})});
    assert.equal(response.status,400);assert.match((await response.json()).error,/studies do not support|approval|inspection/i);
  }
  const motion=JSON.parse(await readFile(join(dir,'motion.json'),'utf8'));motion.moves[0].seconds=1;await writeFile(join(dir,'motion.json'),JSON.stringify(motion));
  await assert.rejects(fetchSources(state,path=>fetch(origin+path)),/changed/);
  const changed=await loadBundle(dir);assert.notEqual(changed.exportHash,state.exportHash);assert.equal(changed.toolpathApproved,false);
});
test('actual nominal studies supply complete deterministic mechanism poses throughout motion',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-model-studies-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  for(const id of ['dobot-mg400','denso-vp6242-rc8','ultimaker-s5','bambu-h2d']){
    await createStudy(dir,id);const state=await loadBundle(dir),provider=await createMachinePresentation({program:state.program,machine:state.machine,setup:state.plan.setup,sourceIdentity:{printId:'fixture',revision:state.revision,exportHash:state.exportHash}});
    for(const seconds of [0,.25,6.3,12.1,24,6.3]){
      const pose=await provider.sample({requestId:1,seconds});assert.equal(pose.status,'ready',id+': '+JSON.stringify(pose.diagnostics));
      const same=await provider.sample({requestId:2,seconds});assert.deepEqual(same.worldFromFrame,pose.worldFromFrame);
      const manual=[...pose.controlValues],held=await provider.sample({requestId:3,seconds,manual});
      assert.equal(held.status,'ready',id+': '+JSON.stringify(held.diagnostics));
      for(const key of ['translationMm','rotation'])assert.ok(held.worldFromFrame.tcp[key].flat().every((v,i)=>Math.abs(v-pose.worldFromFrame.tcp[key].flat()[i])<1e-6),id+' manual controls preserve source pose');
      manual[0]+=1;const moved=await provider.sample({requestId:4,seconds,manual});assert.equal(moved.status,'ready',id+': '+JSON.stringify(moved.diagnostics));
      assert.ok(Math.abs(moved.worldFromFrame.tcp.translationMm[0]-pose.worldFromFrame.tcp.translationMm[0]-1)<1e-6,id+' X slider moves TCP');
    }
    provider.dispose();
  }
});
test('study source rejects malformed poses, duration and unsupported orientation',()=>{
  const source={schema:'saam-machine-study-source/1',orientation:'euler-xyz',initial:{tcp:[0,0,20],anglesDeg:[0,0,0]},moves:[{tcp:[1,1,20],anglesDeg:[10,10,1],seconds:1}]};
  source.orientation='unsupported';assert.throws(()=>interpretMachineStudy(source),/source/);
  source.orientation='euler-xyz';source.moves[0].anglesDeg=[10,10];assert.throws(()=>interpretMachineStudy(source),/angles/);
  source.moves[0].anglesDeg=[10,10,1];source.moves[0].seconds=0;assert.throws(()=>interpretMachineStudy(source),/duration/);
});
test('adapted studies preserve deposition phases and layers for Studio',()=>{
  const program=interpretMachineStudy({schema:'saam-machine-study-source/1',orientation:'euler-xyz',initial:{tcp:[0,0,1],anglesDeg:[0,0,0]},moves:[
    {tcp:[1,0,1],anglesDeg:[0,0,0],seconds:1,volumeMm3:.1,phase:'cladding-axial',operation:'shell-0',layer:3},
    {tcp:[1,1,1],anglesDeg:[0,0,0],seconds:1,volumeMm3:.1,phase:'cladding-hoop',operation:'shell-1',layer:4}]});
  assert.deepEqual(program.moves.map(m=>[m.phase,m.operation,m.layer]),[['cladding-axial','shell-0',3],['cladding-hoop','shell-1',4]]);
});
test('study creation refuses to overwrite an ordinary print',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'saam-study-protection-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const original=JSON.stringify({schema:'saam-shell-plan/1'});await writeFile(join(dir,'plan.json'),original);
  await assert.rejects(createStudy(dir,'ultimaker-s5'),/existing print/);assert.equal(await readFile(join(dir,'plan.json'),'utf8'),original);
});