// Studio's review results that other owners rely on: the drawn moves a window shows,
// and the view receipt that tells Runtime a request's result was presented.
import './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPart} from '../application/part-execution.mjs';
import {generateBundle} from '../application/generation.mjs';
import {createChatChannel} from '../application/chat-requests.mjs';
import * as shell from '../print/bundle.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {splineBox} from './fixtures/spline-shapes.mjs';
import {createStudio} from '../../studio/server.mjs';
import {loadPathPreview} from '../../studio/path-preview.mjs';
import {outputView} from '../../studio/refresh-plan.mjs';

const boxPlan=()=>{const p=defaults(loadMachine());p.geometry=splineBox({runMm:10,widthMm:10,heightMm:2});p.process.minimumLayerSeconds=0;return p;};
async function studio(t,{generate=false}={}){
  const library=await mkdtemp(join(tmpdir(),'saam-studio-results-'));t.after(()=>rm(library,{recursive:true,force:true}));
  const dir=join(library,'box');await createPart(dir,boxPlan(),{machineId:'ultimaker-s5'});
  if(generate)await generateBundle(dir);
  const channel=createChatChannel(library,{ownerId:'studio:test'}),server=createStudio(dir,{libraryRoot:library,chat:channel.binding});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>server.shutdown());
  const origin=`http://127.0.0.1:${server.address().port}`,token=(await(await fetch(origin)).text()).match(/name="saam-token" content="([^"]+)"/)[1];
  const post=(route,data)=>fetch(origin+'/api/'+route,{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token},body:JSON.stringify(data)});
  const state=async()=>(await fetch(origin+'/api/state')).json();
  return {dir,channel,server,origin,post,state};
}

test('drawn moves are the completed output\'s Paath with its own timing; a changed or unreadable Paath is refused',async t=>{
  const {dir,origin,state}=await studio(t,{generate:true});
  const shown=outputView(await state()),fetcher=url=>fetch(origin+url);
  const drawn=await loadPathPreview(shown,{id:shown.outputId},fetcher);
  assert.ok(drawn.moves.length>0);
  assert.equal(drawn.moves.length,shown.program.moves,'every saved move is drawn');
  assert.ok(Math.abs(drawn.summary.motionSeconds-shown.program.seconds)<1e-6,'the drawing keeps the Paath\'s requested timing');
  assert.ok(Math.abs(drawn.volumeMm3-shown.program.volumeMm3)<1e-6*Math.max(1,shown.program.volumeMm3));
  await assert.rejects(loadPathPreview({...shown,revision:'stale'},{id:shown.outputId},fetcher),/displayed path changed/,'an older page cannot draw a different Paath');
  const saved=await shell.loadBundle(dir);
  await writeFile(join(dir,saved.completedOutput.path.file),'not a Paath');
  await assert.rejects(loadPathPreview(shown,{id:shown.outputId},fetcher),'an unreadable Paath names its failure instead of drawing');
});

test('a drawn view of a request\'s published result is its receipt; an older view is not',async t=>{
  const {channel,server,post,state,dir}=await studio(t);
  const studioInstanceId=server.agentSession().instanceId,requests=channel.requests;
  const request=await requests.begin({directory:dir,instruction:'Lengthen the cooling window.',kind:'edit',studioInstanceId});
  const before=await state(),plan=structuredClone(before.plan);plan.process.minimumLayerSeconds=3;
  assert.equal((await post('plan',{plan,revision:before.revision,expectedEditRevision:before.editRevision,printId:before.printId})).status,200);
  await requests.update(request.id,{status:'completed',resultStage:'geometry'});
  const stale=await(await post('view-ready',{stage:'geometry',revision:before.revision})).json();
  assert.deepEqual(stale.presentedRequests,[],'the view from before the edit does not present its result');
  assert.equal((await requests.list()).find(r=>r.id===request.id).presented,false);
  const after=await state();
  const shown=await(await post('view-ready',{stage:'geometry',revision:after.revision})).json();
  assert.deepEqual(shown.presentedRequests.map(r=>r.id),[request.id]);
  assert.equal((await requests.list()).find(r=>r.id===request.id).presented,true);
});
