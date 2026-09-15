import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMcpAdapter} from '../../adapters/mcp/src/server.mjs';
import {createTour} from '../../studio/tour.mjs';
import {initBundle,loadBundle,adjustBundle,confirmGeometryFromChat} from '../print/bundle.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';

const run=promisify(execFile);
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'saam-chat-confirmation-'));
  t.after(()=>rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
  const directory=join(root,'part'),plan=defaults(loadMachine('ultimaker-s5'));
  plan.geometry={shape:'box',runMm:12,widthMm:10,heightMm:2};plan.skills['draped-skin'].enabled=false;
  await initBundle(directory,plan,{machineId:'ultimaker-s5',setupFile:join(root,'setup.json')});
  return {root,directory};
}
const evidence=state=>({actor:'SYNTHETIC TEST human',expectedRevision:state.revision,geometryHash:state.geometryHash,
  statement:'Yes, I approve this resulting shape.\nKeep its current dimensions.',chatReference:'SYNTHETIC TEST conversation, human message 7'});

test('chat geometry confirmation rejects stale or missing evidence and records only the exact shape approval',async t=>{
  const {directory}=await fixture(t),initial=await loadBundle(directory,{program:false}),confirmation=evidence(initial);
  for(const missing of ['statement','chatReference','geometryHash']){
    const incomplete={...confirmation};delete incomplete[missing];
    await assert.rejects(confirmGeometryFromChat(directory,incomplete));
  }
  await assert.rejects(confirmGeometryFromChat(directory,{...confirmation,geometryHash:'wrong'}),/confirmed geometry changed/);
  await adjustBundle(directory,{skills:{'planar-infill':{pattern:'grid'}}});
  await assert.rejects(confirmGeometryFromChat(directory,confirmation),/review is stale/);
  const current=await loadBundle(directory,{program:false}),accepted=await confirmGeometryFromChat(directory,evidence(current));
  assert.equal(accepted.geometryApproved,true);assert.equal(accepted.planApproved,false);assert.equal(accepted.toolpathApproved,false);
  assert.deepEqual(Object.keys(accepted.review.approvals),['geometry']);
  const saved=(await loadBundle(directory,{program:false})).review.approvals.geometry.evidence;
  assert.deepEqual(saved,{source:'chat',statement:confirmation.statement,chatReference:confirmation.chatReference,
    directory,revision:current.revision,geometryHash:current.geometryHash});
  await assert.rejects(confirmGeometryFromChat(directory,evidence(current)),/review is stale/);
  await adjustBundle(directory,{geometry:{heightMm:3}});
  const changed=await loadBundle(directory,{program:false});assert.equal(changed.geometryApproved,false);
  await assert.rejects(confirmGeometryFromChat(directory,{...evidence(changed),geometryHash:current.geometryHash}),/confirmed geometry changed/);
});

test('CLI exposes the geometry hash and records fixed-scope chat confirmation from JSON',async t=>{
  const {root,directory}=await fixture(t),script=resolve('core/print/cli.mjs');
  const state=JSON.parse((await run(process.execPath,[script,'check',directory])).stdout);
  assert.ok(state.geometryHash);const file=join(root,'confirmation.json'),confirmation=evidence(state);
  await writeFile(file,JSON.stringify({...confirmation,stage:'toolpath'}));
  await assert.rejects(run(process.execPath,[script,'confirm-geometry',directory,file]),error=>/accepts only/.test(error.stderr));
  await writeFile(file,JSON.stringify(confirmation));
  const accepted=JSON.parse((await run(process.execPath,[script,'confirm-geometry',directory,file])).stdout);
  assert.equal(accepted.geometryApproved,true);assert.equal(accepted.toolpathApproved,false);
  assert.equal((await loadBundle(directory,{program:false})).review.approvals.geometry.evidence.statement,confirmation.statement);
});

test('MCP records explicit shape confirmation and cannot bypass it for an active tour or approve final output',async t=>{
  const {root}=await fixture(t),tour=createTour(root),{directory}=await tour.action('resume');
  const adapter=createMcpAdapter({printsRoot:root,autoOpen:false});
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair(),client=new Client({name:'synthetic-chat-confirmation',version:'1'});
  await adapter.server.connect(serverTransport);await client.connect(clientTransport);
  try{
    const call=async(name,args,expectedError)=>{
      const response=await client.callTool({name,arguments:args});
      const text=response.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');
      if(expectedError){assert.equal(response.isError,true,text);assert.match(text,expectedError);return;}
      assert.ok(!response.isError,text);return JSON.parse(text);
    };
    const printId='tour/handle',state=await call('get_print',{printId});assert.ok(state.geometryHash);
    await call('generate_print',{printId},/geometry.*before|geometry.*confirm/i);
    assert.equal((await loadBundle(directory,{program:false})).review.generation,null);
    await call('confirm_geometry',{printId,...evidence(state),geometryHash:'wrong'},/confirmed geometry changed/);
    await call('confirm_geometry',{printId,...evidence(state),stage:'toolpath'},/Unrecognized|unrecognized/);
    const confirmed=await call('confirm_geometry',{printId,...evidence(state)});
    assert.equal(confirmed.approvals.geometry,true);assert.equal(confirmed.approvals.toolpath,false);
    const generated=await call('generate_print',{printId});assert.equal(generated.checks.mode,'production');
    assert.equal(generated.approvals.plan,false);assert.equal(generated.approvals.toolpath,false);
    await call('deliver_print',{printId},/approval|Exit the tour/);
  }finally{await client.close();await adapter.close();}
});
