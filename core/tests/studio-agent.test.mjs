import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createAgentRequests} from '../../studio/agent-requests.mjs';
import {createTour} from '../../studio/tour.mjs';
import {createStudio,sourceSkewNotice,annotateSourceSkew} from '../../studio/server.mjs';
import {bundleFor} from '../../studio/adapter-resolution.mjs';
import {loadBundle,adjustBundle,generateBundle,approve} from '../print/bundle.mjs';
import {printName,downloadName} from '../../studio/print-name.mjs';
import {boxMesh} from './fixtures/mesh.mjs';
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'saam-agent-'));t.after(()=>rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100}));return dir;}

test('tour geometry recovery preserves the lesson and generates without a geometry gate',async t=>{
  const root=await fixture(t);let time=0;const tour=createTour(root,{now:()=>time}),requests=createAgentRequests(root);
  const {directory}=await tour.action('fresh');let state=await loadBundle(directory,{program:false});
  state.plan.geometry.parts[1].geometry.heightMm=11;await adjustBundle(directory,{geometry:state.plan.geometry});
  state=await loadBundle(directory,{program:false});await tour.acknowledgeView(directory,{revision:state.revision},state);
  await tour.action('step',1);await tour.action('step',2);await tour.select(directory);await tour.action('step',4);
  await generateBundle(directory);
  await tour.playback('play');
  await tour.action('step',5);
  const edit=await requests.begin({directory,instruction:'SYNTHETIC participant requests a taller handle'});
  state=await loadBundle(directory,{program:false});state.plan.geometry.parts[1].geometry.heightMm=12;
  await adjustBundle(directory,{geometry:state.plan.geometry});
  await requests.update(edit.id,{status:'working',resultStage:'toolpath'});
  const server=createStudio(directory,{libraryRoot:root});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.shutdown());
  const url='http://127.0.0.1:'+server.address().port,html=await(await fetch(url)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const post=(route,data)=>fetch(url+'/api/'+route,{method:'POST',headers:{Origin:url,'X-SAAM-Token':token,'Content-Type':'application/json'},body:JSON.stringify(data)});
  const get=async()=>await(await fetch(url+'/api/state')).json();
  state=await get();assert.equal(state.toolpathApproved,false);assert.equal(state.tour.step,5);
  assert.equal((await post('tour',{action:'resume'})).status,400,'ended tours cannot be resumed');
  state=await get();assert.equal(state.toolpathApproved,false);assert.equal(state.tour.step,5);assert.equal(state.localPrintDirectory,directory);
  assert.equal((await post('approve',{actor:'SYNTHETIC',revision:state.revision})).status,400);
  state=await get();assert.equal(state.tour.step,5);assert.equal(state.toolpathApproved,false);
  const generated=await post('generate',{generationHash:state.generationHash});assert.equal(generated.status,200,await generated.text());
  state=await get();assert.ok(state.program);assert.equal(state.tour.step,5);assert.equal(state.toolpathApproved,false);
  const displayed=await post('view-ready',{stage:'toolpath',revision:state.revision,exportHash:state.exportHash});
  assert.equal(displayed.status,200);
  assert.ok((await displayed.json()).presentedRequests.some(r=>r.id===edit.id&&r.presented),
    'the acknowledgement returns its receipt directly instead of requiring another state read');
  state=await get();assert.equal(state.tour.canNext,true,'the requested toolpath completes the same chat-edit lesson');
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
  assert.equal((await createAgentRequests(root).wait({waitMs:0})).requests.length,0,'an ownerless listener never hears an owned Studio instance');
  const requests=createAgentRequests(root,{ownerId:server.agentSession().ownerId}),pending=(await requests.wait({waitMs:0})).requests;
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
test('active tours block STL import; normal import stays unapproved in geometry review',async t=>{
  const root=await fixture(t),tour=createTour(root),{directory}=await tour.action('fresh');
  let state=await loadBundle(directory,{program:false});state.plan.geometry.parts[1].geometry.heightMm=11;await adjustBundle(directory,{geometry:state.plan.geometry});
  state=await loadBundle(directory,{program:false});await tour.acknowledgeView(directory,{revision:state.revision},state);
  await tour.action('step',1);await tour.action('step',2);await tour.setStartAt({layer:12});await tour.select(directory);
  const server=createStudio(directory,{libraryRoot:root});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.shutdown());
  const url='http://127.0.0.1:'+server.address().port,html=await(await fetch(url)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const mesh=boxMesh(12,10,4),bytes=Buffer.from('solid test\n'+mesh.triangles.map(tri=>'facet normal 0 0 0\nouter loop\n'+tri.map(i=>'vertex '+mesh.vertices[i].join(' ')).join('\n')+'\nendloop\nendfacet').join('\n')+'\nendsolid test\n');
  const upload=(name,units,body=bytes)=>fetch(url+'/api/import-stl?'+new URLSearchParams({name,units}),{method:'POST',headers:{Origin:url,'X-SAAM-Token':token,'Content-Type':'application/octet-stream'},body});
  const blocked=await upload('Sample model.stl','mm');assert.equal(blocked.status,400);
  assert.match((await blocked.json()).error,/available after you finish or exit the tour/);
  state=await(await fetch(url+'/api/state')).json();assert.equal(state.tour.step,3);
  assert.equal(state.localPrintDirectory,directory);assert.equal(state.toolpathApproved,false);
  await tour.action('exit');assert.equal((await upload('Normal model.stl','mm')).status,200);
  state=await(await fetch(url+'/api/state')).json();assert.equal(state.tour.active,false);assert.equal(state.toolpathApproved,false);assert.equal(Boolean(state.program),false);
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
  await tour.playback('play');
  await tour.action('step',5);const pending=(await requests.list())[0];assert.match(pending.instruction,/toolpath controls how the reviewed shape is built/);assert.equal(pending.printId,'tour/handle');
  await requests.update(pending.id,{status:'completed',message:'Offered patterns in chat'});
  const edit=await requests.begin({directory,instruction:'SYNTHETIC participant requests gyroid infill'});
  await adjustBundle(directory,{skills:{'planar-infill':{pattern:'gyroid'}}});
  await requests.update(edit.id,{status:'working',resultStage:'toolpath'});
  await generateBundle(directory,{development:true});
  state=await loadBundle(directory,{program:'source'});await tour.acknowledgeView(directory,{revision:state.revision,exportHash:state.exportHash,stage:'toolpath'},state);
  await tour.action('step',6);await tour.action('step',7);
  const server=createStudio(directory,{libraryRoot:root});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.shutdown());
  const url='http://127.0.0.1:'+server.address().port,html=await(await fetch(url)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const post=(route,data)=>fetch(url+'/api/'+route,{method:'POST',headers:{Origin:url,'X-SAAM-Token':token,'Content-Type':'application/json'},body:JSON.stringify(data)});
  assert.equal((await post('tour-export',{revision:'stale',exportHash:state.exportHash})).status,400);
  assert.equal((await post('tour',{action:'finish'})).status,400,'completion requires a download');
  const response=await post('tour-export',{revision:state.revision,exportHash:state.exportHash,name:'Workshop handle'});assert.equal(response.status,200,await response.clone().text());
  assert.match(response.headers.get('content-disposition'),/Workshop%20handle.gcode/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(join(directory,'delivery/part.gcode')));
  assert.equal((await loadBundle(directory,{program:'source'})).toolpathApproved,true);
  assert.equal((await post('tour',{action:'finish'})).status,200);assert.equal((await tour.info()).completed,true);
  const completion=(await requests.list()).find(r=>r.status==='queued').instruction;assert.match(completion,/ordinary chat text congratulating/);assert.match(completion,/help with any difficulties printing/);assert.match(completion,/before status checks/);assert.match(completion,/Never use a question box/);
  assert.equal((await post('tour',{action:'exit'})).status,200);
  assert.equal((await tour.info()).completed,true);assert.equal((await tour.info()).dismissed,true);
  assert.equal(await printName(directory),'Handle');assert.equal(downloadName('Named handle · Nave','part.gcode'),'Named handle · Nave.gcode');
  assert.equal(downloadName('dice-weld-demo-h2d-right-0.8mm','part.gcode.3mf'),'dice-weld-demo-h2d-right-0.8mm.gcode.3mf');
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
  const {summarizeWork}=await import('../../studio/agent-ui.mjs');
  const working={ownerId:'one',status:'working',updatedAt:1,expiresAt:600001};
  assert.deepEqual(summarizeWork([working],{now:100}),{active:true,message:'',stage:'all'});
  assert.deepEqual(summarizeWork([working],{now:600002}),{active:false,message:'(lost contact)',stage:null});
  const closedOwners=new Set(['one']);
  assert.deepEqual(summarizeWork([working],{now:100,closedOwners}),{active:false,message:'(connection closed)',stage:null});
  assert.deepEqual(summarizeWork([working,{...working,ownerId:'two'}],{now:100,closedOwners}),{active:true,message:'',stage:'all'});
  assert.deepEqual(summarizeWork([{...working,status:'failed',connectionClosed:true,updatedAt:2},{...working,status:'completed',updatedAt:2}],{now:100}),
    {active:false,message:'',stage:null},'equal timestamps preserve the later record as the latest status');
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
  state=await loadBundle(directory,{program:false});const before=state.plan.geometry.vertices,revision=state.revision;
  await assert.rejects(setSTLUnits(directory,'mm',{expectedRevision:'stale'}));
  state=await setSTLUnits(directory,'mm',{expectedRevision:revision});
  assert.equal(state.toolpathApproved,false);assert.equal(state.plan.geometry.source.unitsInferred,false);assert.equal(state.plan.skills['planar-infill'].pattern,'gyroid');
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

test('Studio records person-driven actions as owner-scoped events: held ones wait, delivered ones push with the held remainder',async t=>{
  const root=await fixture(t),tour=createTour(root),{directory}=await tour.action('fresh');
  await tour.action('exit');
  const server=createStudio(directory,{libraryRoot:root});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.shutdown());
  const url='http://127.0.0.1:'+server.address().port,html=await(await fetch(url)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const post=(route,data)=>fetch(url+'/api/'+route,{method:'POST',headers:{Origin:url,'X-SAAM-Token':token,'Content-Type':'application/json'},body:JSON.stringify(data)});
  const read=(owner,query={})=>fetch(url+'/api/agent-events?'+new URLSearchParams({owner,...query})).then(async response=>({status:response.status,body:await response.json()}));
  const {ownerId,instanceId}=server.agentSession(),pushed=[];
  server.studioEvents.subscribe(batch=>pushed.push(batch.map(e=>e.kind)));
  const kinds=()=>server.studioEvents.peek().map(e=>e.kind);
  assert.equal((await read('someone-else')).status,403,'only the owning agent reads its queue');
  const viewer=await fetch(url+'/api/viewer?token='+token),reader=viewer.body.getReader();await reader.read();
  assert.ok(server.studioEvents.peek().some(e=>e.kind==='viewer-opened'&&e.viewers===1));
  let state=await(await fetch(url+'/api/state')).json();
  const generated=await post('generate',{generationHash:state.generationHash});assert.equal(generated.status,200,await generated.text());
  assert.deepEqual(pushed,[],'calculation start and finish are held, not pushed');
  assert.deepEqual(kinds(),['viewer-opened','generation-started','generation-finished']);
  const started=server.studioEvents.peek()[1];assert.equal(started.trigger,'generate');assert.equal(started.studioInstanceId,instanceId);assert.equal(started.printId,'tour/handle');
  assert.ok(server.studioEvents.peek()[2].durationMs>=0);
  state=await(await fetch(url+'/api/state')).json();
  assert.equal((await post('view-ready',{stage:'toolpath',revision:state.revision,exportHash:state.exportHash})).status,200);
  // The displayed toolpath is held; a short-travel advisory it queues is agent work and pushes.
  assert.ok(kinds().includes('view-presented'));
  const advisories=pushed.length;assert.ok(advisories<=1);
  if(advisories)assert.equal(pushed[0].at(-1),'request-queued');
  const approved=await post('approve',{actor:'SYNTHETIC',revision:state.revision});assert.equal(approved.status,200,await approved.text());
  assert.equal(kinds().at(-1),'approved','a confirmation is held');assert.equal(pushed.length,advisories);
  const delivered=await post('deliver',{name:'Workshop handle',downloadLink:true});assert.equal(delivered.status,200,await delivered.text());
  assert.equal(pushed.length,advisories+1);const batch=pushed.at(-1);assert.equal(batch.at(-1),'export-delivered');
  assert.ok(batch.includes('approved')&&batch.includes('view-presented')&&batch.includes('generation-finished'),'a delivered event carries the held remainder');
  const first=await read(ownerId);
  assert.deepEqual(first.body.events.map(e=>e.kind),batch,'a push does not drain; the read does');
  assert.match(first.body.events.at(-1).name,/Workshop handle/);assert.equal(first.body.events.at(-1).exportHash,state.exportHash);
  assert.deepEqual(first.body.generation,[]);assert.equal(first.body.studioInstanceId,instanceId);
  const queuedBefore=first.body.requests.map(r=>r.id);
  assert.deepEqual((await read(ownerId)).body.events,[],'drained');
  const waiting=read(ownerId,{wait:'5000',after:queuedBefore.join(',')});await new Promise(done=>setTimeout(done,30));const woken=Date.now();
  assert.equal((await post('agent-request',{})).status,200);
  const woke=(await waiting).body;assert.ok(Date.now()-woken<2000,'a delivered event ends the bounded wait');
  assert.deepEqual(woke.events.map(e=>e.kind),['request-queued']);assert.equal(woke.events[0].requestKind,'guidance');
  assert.deepEqual(woke.requests.map(r=>r.id),[woke.events[0].requestId],'the cursor excludes requests already returned');
  const again=(await read(ownerId,{wait:'300',after:[...queuedBefore,woke.requests[0].id].join(',')})).body;
  assert.deepEqual(again.requests,[]);assert.deepEqual(again.events,[]);
  const stranger=createAgentRequests(root);
  assert.equal((await stranger.wait({waitMs:0})).requests.length,0,'an ownerless listener never hears an owned Studio instance');
  await assert.rejects(stranger.update(woke.requests[0].id,{status:'working'}),/belongs to another agent/);
  assert.ok((await stranger.list()).some(r=>r.id===woke.requests[0].id),'explicit history remains a diagnostic read');
  const owner=createAgentRequests(root,{ownerId});
  const claimed=(await owner.wait({waitMs:0,claim:true})).requests;assert.ok(claimed.length>=1&&claimed.every(r=>r.status==='working'));
  await reader.cancel();
  for(let n=0;n<100&&!server.studioEvents.peek().some(e=>e.kind==='viewer-closed');n++)await new Promise(done=>setTimeout(done,20));
  assert.ok(server.studioEvents.peek().some(e=>e.kind==='viewer-closed'&&e.viewers===0));
});

test('tour lesson changes are delivered with the lesson instruction, and calculation progress is readable mid-flight',async t=>{
  const root=await fixture(t),guide=createTour(root),{directory}=await guide.action('fresh');
  const server=createStudio(directory,{libraryRoot:root});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.shutdown());
  const url='http://127.0.0.1:'+server.address().port,html=await(await fetch(url)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const post=(route,data)=>fetch(url+'/api/'+route,{method:'POST',headers:{Origin:url,'X-SAAM-Token':token,'Content-Type':'application/json'},body:JSON.stringify(data)});
  const {ownerId}=server.agentSession(),read=async()=>(await fetch(url+'/api/agent-events?owner='+ownerId)).json();
  assert.equal((await post('tour',{action:'fresh'})).status,200);
  const started=(await read()).events.find(e=>e.kind==='tour-started');
  assert.equal(started.delivery,'delivered');assert.equal(started.step,0);assert.equal(started.lesson.title,'Your words change the shape');assert.ok(started.runId);
  assert.equal((await post('tour',{action:'exit'})).status,200);
  const exited=(await read()).events.find(e=>e.kind==='tour-exited');assert.equal(exited.active,false);
  const generating=post('generate',{development:true});
  let progress=null,finished=null;
  for(let n=0;n<600&&!finished;n++){
    const seen=await read();
    if(seen.generation.length)progress=seen.generation[0];
    finished=seen.events.find(e=>e.kind==='generation-finished')??null;
    await new Promise(done=>setTimeout(done,10));
  }
  assert.equal((await generating).status,200);
  assert.ok(finished,'the finish is held for the next read');
  assert.ok(progress,'a read during calculation reports its progress');
  assert.equal(progress.requested,true);assert.ok(['preparing','generating'].includes(progress.status));assert.equal(progress.trigger,'generate');
  assert.ok(progress.elapsedMs>=0);assert.ok(progress.progress===null||typeof progress.progress.stage==='string');
});

test('a running Studio names source that changed after it started, and says so on a failure',async t=>{
  const base=await fixture(t),module=join(base,'core','print','plan.mjs');
  await mkdir(join(base,'core','print'),{recursive:true});await mkdir(join(base,'core','tests'),{recursive:true});
  await writeFile(module,'export const VERSION="0.1.0";\n');
  await writeFile(join(base,'core','tests','churn.test.mjs'),'// suite churn is not running source\n');
  const started=(await stat(module)).mtimeMs+1;
  assert.equal(await sourceSkewNotice(started,{base,roots:['core']}),null,'an untouched checkout reports nothing');
  await writeFile(join(base,'core','tests','churn.test.mjs'),'// touched later\n');
  assert.equal(await sourceSkewNotice(started,{base,roots:['core']}),null,'test files are not the running source');
  await writeFile(module,'export const VERSION="0.2.0";\n');
  const notice=await sourceSkewNotice(started,{base,roots:['core']});
  assert.match(notice,/older SAAM source than the files on disk: core\/print\/plan\.mjs/);
  assert.match(notice,/Restart Studio/);
  // The annotation reaches whatever already failed, and never twice for one error.
  const error=Object.assign(new Error('Unexpected or missing fields in plan.skills.planar-infill: unexpected maxPatternCells.'),{code:'X'});
  const annotated=(await annotateSourceSkew(error)).message;
  await annotateSourceSkew(error);
  assert.equal(error.message,annotated);assert.equal(error.code,'X');
  assert.ok(annotated.startsWith('Unexpected or missing fields'),'the original failure is kept');
});
