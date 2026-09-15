import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createAgentRequests} from '../../studio/agent-requests.mjs';
import {createTour} from '../../studio/tour.mjs';
import {createStudio,bundleFor} from '../../studio/server.mjs';
import {loadBundle,adjustBundle,generateBundle,approve} from '../print/bundle.mjs';
import {printName,downloadName} from '../../studio/print-name.mjs';
import {boxMesh} from './fixtures/mesh.mjs';
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'saam-agent-'));t.after(()=>rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100}));return dir;}

test('tour geometry recovery preserves the lesson and requires explicit confirmation before generation',async t=>{
  const root=await fixture(t);let time=0;const tour=createTour(root,{now:()=>time}),requests=createAgentRequests(root);
  const {directory}=await tour.action('fresh');let state=await loadBundle(directory,{program:false});
  state.plan.geometry.parts[1].geometry.heightMm=11;await adjustBundle(directory,{geometry:state.plan.geometry});
  state=await loadBundle(directory,{program:false});await tour.acknowledgeView(directory,{revision:state.revision},state);
  await tour.action('step',1);await tour.action('step',2);await tour.select(directory);await tour.action('step',4);
  await approve(directory,{stage:'geometry',revision:state.revision,actor:'SYNTHETIC selected geometry'});
  await generateBundle(directory);
  await tour.playback('play');for(let i=0;i<5;i++){time+=1000;await tour.playback('tick');}
  await tour.action('step',5);
  const edit=await requests.begin({directory,instruction:'SYNTHETIC participant requests a taller handle'});
  state=await loadBundle(directory,{program:false});state.plan.geometry.parts[1].geometry.heightMm=12;
  await adjustBundle(directory,{geometry:state.plan.geometry});
  await requests.update(edit.id,{status:'working',resultStage:'toolpath'});
  const server=createStudio(directory,{libraryRoot:root});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.shutdown());
  const url='http://127.0.0.1:'+server.address().port,html=await(await fetch(url)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const post=(route,data)=>fetch(url+'/api/'+route,{method:'POST',headers:{Origin:url,'X-SAAM-Token':token,'Content-Type':'application/json'},body:JSON.stringify(data)});
  const get=async()=>await(await fetch(url+'/api/state')).json();
  state=await get();assert.equal(state.geometryApproved,false);assert.equal(state.tour.step,5);
  assert.equal((await post('tour',{action:'step',step:4})).status,400,'Back cannot silently confirm changed geometry');
  assert.equal((await post('tour',{action:'resume'})).status,400,'ended tours cannot be resumed');
  state=await get();assert.equal(state.geometryApproved,false);assert.equal(state.tour.step,5);assert.equal(state.localPrintDirectory,directory);
  assert.equal((await post('approve',{stage:'toolpath',actor:'SYNTHETIC',revision:state.revision})).status,400);
  assert.equal((await post('approve',{stage:'geometry',actor:'SYNTHETIC explicit geometry review',revision:state.revision})).status,200);
  state=await get();assert.equal(state.tour.step,5);assert.equal(state.geometryApproved,true);
  const generated=await post('generate',{planHash:state.planHash});assert.equal(generated.status,200,await generated.text());
  state=await get();assert.ok(state.program);assert.equal(state.tour.step,5);assert.equal(state.toolpathApproved,false);
  const displayed=await post('view-ready',{stage:'toolpath',revision:state.revision,exportHash:state.exportHash});
  assert.equal(displayed.status,200);
  assert.ok((await displayed.json()).presentedRequests.some(r=>r.id===edit.id&&r.presented),
    'the acknowledgement returns its receipt directly instead of requiring another state read');
  state=await get();assert.equal(state.tour.canNext,true,'geometry-only request completes the same chat-edit lesson');
});

test('CLI listener claims returned requests in the same call',async t=>{
  const root=await fixture(t),requests=createAgentRequests(root);
  const request=await requests.begin({directory:join(root,'part'),source:'studio',instruction:'SYNTHETIC completion'});
  const {stdout}=await promisify(execFile)(process.execPath,['studio/agent-requests.mjs','wait',root,'--claim']);
  const result=JSON.parse(stdout);assert.equal(result.requests[0].id,request.id);assert.equal(result.requests[0].status,'working');
  assert.equal((await requests.list())[0].status,'working');
});

test('explicit generation failures alert the agent with the cause and clear after a corrected retry',async t=>{
  const root=await fixture(t),tour=createTour(root),{directory}=await tour.action('fresh');
  await tour.action('exit');
  const actual=await bundleFor(directory);let fail=true;
  const server=createStudio(directory,{libraryRoot:root,resolveBundle:async()=>({...actual,
    generateBundle:async(...args)=>{if(fail)throw Error('Synthetic discontinuous roof');return actual.generateBundle(...args);}})});
  t.after(()=>server.shutdown());server.listen(0,'127.0.0.1');await once(server,'listening');
  const url='http://127.0.0.1:'+server.address().port,html=await(await fetch(url)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const generate=()=>fetch(url+'/api/generate',{method:'POST',headers:{Origin:url,'X-SAAM-Token':token,'Content-Type':'application/json'},body:JSON.stringify({development:true})});
  assert.equal((await generate()).status,400);
  const requests=createAgentRequests(root),pending=(await requests.wait({waitMs:0})).requests;
  assert.equal(pending.length,1);assert.equal(pending[0].printId,'tour/handle');
  assert.match(pending[0].instruction,/Synthetic discontinuous roof/);
  assert.match(pending[0].instruction,/appropriate fixes before regenerating/);
  assert.equal((await(await fetch(url+'/api/state')).json()).generationError,'Synthetic discontinuous roof');
  await generate();assert.equal((await requests.list()).length,1,'unchanged repeated failure does not queue duplicate work');
  await requests.update(pending[0].id,{status:'working'});
  await adjustBundle(directory,{process:{planarSpeedMmS:30}});fail=false;
  const recovered=await generate();assert.equal(recovered.status,200,await recovered.text());
  const state=await(await fetch(url+'/api/state')).json();assert.ok(state.program);assert.equal(state.generationError,undefined);
  assert.equal((await requests.list())[0].status,'working','agent resolves recovery after verifying the displayed result');
});
test('STL lesson imports into playback; normal import stays unapproved in geometry review',async t=>{
  const root=await fixture(t),tour=createTour(root),{directory}=await tour.action('fresh');
  let state=await loadBundle(directory,{program:false});state.plan.geometry.parts[1].geometry.heightMm=11;await adjustBundle(directory,{geometry:state.plan.geometry});
  state=await loadBundle(directory,{program:false});await tour.acknowledgeView(directory,{revision:state.revision},state);
  await tour.action('step',1);await tour.action('step',2);await tour.setStartAt({layer:12});await tour.select(directory);
  const server=createStudio(directory,{libraryRoot:root});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.shutdown());
  const url='http://127.0.0.1:'+server.address().port,html=await(await fetch(url)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const mesh=boxMesh(12,10,4),bytes=Buffer.from('solid test\n'+mesh.triangles.map(tri=>'facet normal 0 0 0\nouter loop\n'+tri.map(i=>'vertex '+mesh.vertices[i].join(' ')).join('\n')+'\nendloop\nendfacet').join('\n')+'\nendsolid test\n');
  const upload=(name,units,body=bytes)=>fetch(url+'/api/import-stl?'+new URLSearchParams({name,units}),{method:'POST',headers:{Origin:url,'X-SAAM-Token':token,'Content-Type':'application/octet-stream'},body});
  assert.equal((await upload('Sample.stl','unknown')).status,400);assert.equal((await tour.info()).step,3);
  assert.equal((await upload('Broken.stl','mm',Buffer.from('not a mesh'))).status,400);assert.equal((await tour.info()).step,3);
  const imported=await upload('Sample model.stl','mm');assert.equal(imported.status,200,await imported.text());
  state=await(await fetch(url+'/api/state')).json();assert.equal(state.tour.step,4);assert.equal(state.tour.startAt,null);assert.ok(state.program);assert.equal(state.geometryApproved,true);
  assert.equal(state.printName,'Sample model');assert.deepEqual(await readFile(join(state.localPrintDirectory,'geometry/source.stl')),bytes);
  assert.match((await createAgentRequests(root).wait({waitMs:0})).requests[0].instruction,/sparse-infill/);
  await tour.action('exit');assert.equal((await upload('Normal model.stl','mm')).status,200);
  state=await(await fetch(url+'/api/state')).json();assert.equal(state.tour.active,false);assert.equal(state.geometryApproved,false);assert.equal(Boolean(state.program),false);
});
test('ordinary Studio requests are correlated, survive restart, expire and do not clear overlapping work',async t=>{
  const root=await fixture(t);let now=1;const requests=createAgentRequests(root,{now:()=>now}),directory=join(root,'ordinary-part');
  const first=await requests.begin({directory,instruction:'Change the infill'}),second=await requests.begin({directory,instruction:'Add lettering'});
  await requests.update(first.id,{status:'completed'});
  assert.deepEqual((await createAgentRequests(root,{now:()=>now}).list()).filter(r=>r.status==='working').map(r=>r.id),[second.id]);
  const queued=await requests.begin({directory,source:'studio',instruction:'Offer the maker choices',key:'lesson'});
  assert.equal((await requests.begin({directory,source:'studio',instruction:'Duplicate',key:'lesson'})).id,queued.id);
  assert.equal((await requests.wait({waitMs:0})).requests.length,1);
  await requests.update(queued.id,{status:'working'});assert.equal((await requests.wait({waitMs:0})).requests.length,0);
  now+=600001;assert.equal((await requests.list()).find(r=>r.id===second.id).status,'failed');
  await assert.rejects(requests.update('../escape'),/Invalid/);
});
test('tour queues chat guidance and exports exact reviewed bytes before completion',async t=>{
  const root=await fixture(t);let time=0;const tour=createTour(root,{now:()=>time}),requests=createAgentRequests(root);
  const {directory}=await tour.action('fresh');let state=await loadBundle(directory,{program:false});
  state.plan.geometry.parts[1].geometry.heightMm=11;await adjustBundle(directory,{geometry:state.plan.geometry});
  state=await loadBundle(directory,{program:false});await tour.acknowledgeView(directory,{revision:state.revision},state);
  await tour.action('step',1);await tour.action('step',2);await tour.setStartAt({layer:12});await tour.select(directory);await tour.action('step',4);
  await tour.playback('play');for(let i=0;i<5;i++){time+=1000;await tour.playback('tick');}
  await tour.action('step',5);const pending=(await requests.list())[0];assert.match(pending.instruction,/gyroid/);assert.equal(pending.printId,'tour/handle');
  await requests.update(pending.id,{status:'completed',message:'Offered patterns in chat'});
  const edit=await requests.begin({directory,instruction:'SYNTHETIC participant requests gyroid infill'});
  await adjustBundle(directory,{skills:{'planar-infill':{pattern:'gyroid'}}});
  await requests.update(edit.id,{status:'working',resultStage:'toolpath'});
  state=await loadBundle(directory,{program:false});await approve(directory,{stage:'geometry',revision:state.revision,actor:'SYNTHETIC TEST geometry selection'});
  await generateBundle(directory,{development:true});
  state=await loadBundle(directory,{program:'source'});await tour.acknowledgeView(directory,{revision:state.revision,exportHash:state.exportHash,stage:'toolpath'},state);
  await tour.action('step',6);await tour.action('step',7);
  const server=createStudio(directory,{libraryRoot:root});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.shutdown());
  const url='http://127.0.0.1:'+server.address().port,html=await(await fetch(url)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const post=(route,data)=>fetch(url+'/api/'+route,{method:'POST',headers:{Origin:url,'X-SAAM-Token':token,'Content-Type':'application/json'},body:JSON.stringify(data)});
  assert.equal((await post('tour-export',{revision:'stale',exportHash:state.exportHash})).status,400);
  assert.equal((await post('tour',{action:'finish'})).status,400,'completion requires a download');
  const response=await post('tour-export',{revision:state.revision,exportHash:state.exportHash});assert.equal(response.status,200,await response.clone().text());
  assert.match(response.headers.get('content-disposition'),/Handle.gcode/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(join(directory,'delivery/part.gcode')));
  assert.equal((await loadBundle(directory,{program:'source'})).toolpathApproved,true);
  assert.equal((await post('tour',{action:'finish'})).status,200);assert.equal((await tour.info()).completed,true);
  const completion=(await requests.list()).find(r=>r.status==='queued').instruction;assert.match(completion,/ordinary chat text congratulating/);assert.match(completion,/help with any difficulties printing/);assert.match(completion,/before status checks/);assert.match(completion,/Never use a question box/);
  assert.equal((await post('tour',{action:'exit'})).status,200);
  assert.equal((await tour.info()).completed,true);assert.equal((await tour.info()).dismissed,true);
  assert.equal(await printName(directory),'Handle');assert.equal(downloadName('Named handle · Nave','part.gcode'),'Named handle · Nave.gcode');
});


test('connection closure is scoped to owned unfinished requests, including claimed Studio requests',async t=>{
  const root=await fixture(t),directory=join(root,'part');let now=10;
  const one=createAgentRequests(root,{ownerId:'one',now:()=>now}),two=createAgentRequests(root,{ownerId:'two',now:()=>now}),studio=createAgentRequests(root,{now:()=>now});
  const first=await one.begin({directory,instruction:'First'}),other=await two.begin({directory,instruction:'Other'}),done=await one.begin({directory,instruction:'Done'});
  await one.update(done.id);
  const claimed=await studio.begin({directory,source:'studio',instruction:'Claim me'}),unclaimed=await studio.begin({directory,source:'studio',instruction:'Unclaimed'});
  await one.update(claimed.id,{status:'working'});now++;await one.disconnect();await one.disconnect();
  const records=await studio.list(),get=id=>records.find(r=>r.id===id);
  for(const id of [first.id,claimed.id]){assert.equal(get(id).status,'failed');assert.equal(get(id).connectionClosed,true);}
  assert.equal(get(other.id).status,'working');assert.equal(get(done.id).status,'completed');assert.equal(get(unclaimed.id).status,'queued');
  await assert.rejects(one.begin({directory,instruction:'Too late'}),/connection closed/);
  await two.update(claimed.id,{status:'working'});assert.equal((await two.list()).find(r=>r.id===claimed.id).connectionClosed,false);
});

test('indicator shows italic-message content only when no overlapping request remains, and times out offline',async()=>{
  const {agentIndicator}=await import('../../studio/agent-ui.mjs');
  const working={ownerId:'one',status:'working',updatedAt:1,expiresAt:600001};
  assert.deepEqual(agentIndicator([working],{now:100}),{active:true,message:''});
  assert.deepEqual(agentIndicator([working],{now:600002}),{active:false,message:'(lost contact)'});
  const closedOwners=new Set(['one']);
  assert.deepEqual(agentIndicator([working],{now:100,closedOwners}),{active:false,message:'(connection closed)'});
  assert.deepEqual(agentIndicator([working,{...working,ownerId:'two'}],{now:100,closedOwners}),{active:true,message:''});
  assert.deepEqual(agentIndicator([{...working,status:'failed',connectionClosed:true,updatedAt:2},{...working,status:'completed',updatedAt:3}],{now:100}),{active:false,message:''});
});

test('STL units are inferred without a dialog and can be corrected without losing mesh edits',async t=>{
  const {importSTLBundle,setSTLUnits,inferSTLUnits}=await import('../print/import-stl.mjs');
  const bounds={min:[0,0,0],max:[200,200,200]};
  assert.equal(inferSTLUnits(boxMesh(2,1,1),bounds),'inch');
  assert.equal(inferSTLUnits(boxMesh(20,10,4),bounds),'mm');
  assert.equal(inferSTLUnits(boxMesh(9,1,1),bounds),'mm');
  const root=await fixture(t),directory=join(root,'import'),mesh=boxMesh(2,1,1);
  const bytes=Buffer.from('solid test\n'+mesh.triangles.map(tri=>'facet normal 0 0 0\nouter loop\n'+tri.map(i=>'vertex '+mesh.vertices[i].join(' ')).join('\n')+'\nendloop\nendfacet').join('\n')+'\nendsolid test\n');
  await importSTLBundle(directory,bytes,{machineId:'ultimaker-s5'});
  let state=await loadBundle(directory,{program:false});assert.equal(state.plan.geometry.source.units,'inch');assert.equal(state.plan.geometry.source.unitsInferred,true);
  state.plan.geometry.vertices=state.plan.geometry.vertices.map(p=>[p[0]*1.1,p[1],p[2]]);await adjustBundle(directory,{geometry:state.plan.geometry,skills:{'planar-infill':{pattern:'gyroid'}}});
  state=await loadBundle(directory,{program:false});await approve(directory,{stage:'geometry',revision:state.revision,actor:'SYNTHETIC TEST units fixture'});
  state=await loadBundle(directory,{program:false});const before=state.plan.geometry.vertices,revision=state.revision;
  await assert.rejects(setSTLUnits(directory,'mm',{expectedRevision:'stale'}));
  state=await setSTLUnits(directory,'mm',{expectedRevision:revision});
  assert.equal(state.geometryApproved,false);assert.equal(state.plan.geometry.source.unitsInferred,false);assert.equal(state.plan.skills['planar-infill'].pattern,'gyroid');
  state.plan.geometry.vertices.forEach((p,i)=>p.forEach((v,k)=>assert.ok(Math.abs(v-before[i][k]/25.4)<1e-10)));
  assert.deepEqual(await readFile(join(directory,'geometry/source.stl')),bytes);
});


test('Studio pushes disk changes from independent CLI writers without waiting for polling',async t=>{
  const {watchStudioChanges}=await import('../../studio/changes.mjs');
  const root=await fixture(t),directory=join(root,'part');
  let resolveChange;const changed=new Promise(resolve=>{resolveChange=resolve;});
  const stop=watchStudioChanges(root,kinds=>resolveChange(kinds));t.after(stop);
  const start=Date.now();await createAgentRequests(root).begin({directory,instruction:'Immediate dots'});
  const timer=setTimeout(()=>resolveChange([]),1500),kinds=await changed;clearTimeout(timer);
  assert.ok(kinds.includes('requests'));assert.ok(Date.now()-start<1000);
});
