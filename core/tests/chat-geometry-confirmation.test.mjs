import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMcpAdapter} from '../../adapters/mcp/src/server.mjs';
import {initBundle,loadBundle,generateBundle,approve,deliver} from '../print/bundle.mjs';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'saam-final-confirmation-'));
  t.after(()=>rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
  const directory=join(root,'part'),plan=defaults(loadMachine('ultimaker-s5'));
  plan.geometry={shape:'box',runMm:12,widthMm:10,heightMm:2};plan.skills['draped-skin'].enabled=false;
  await initBundle(directory,plan,{machineId:'ultimaker-s5',setupFile:join(root,'setup.json')});
  return {root,directory};
}

test('generation needs no geometry approval and only final toolpath approval enables delivery',async t=>{
  const {directory}=await fixture(t);let state=await loadBundle(directory,{program:false});
  await assert.rejects(approve(directory,{stage:'geometry',actor:'SYNTHETIC TEST',revision:state.revision}),/Only the final/);
  const checks=await generateBundle(directory);assert.equal(checks.mode,'production');
  state=await loadBundle(directory);assert.equal(state.geometryApproved,false);assert.deepEqual(state.review.approvals,{});
  await assert.rejects(deliver(directory),/requires approval/);
  state=await approve(directory,{stage:'toolpath',actor:'SYNTHETIC TEST',revision:state.revision});
  assert.equal(state.planApproved,true);assert.equal(state.toolpathApproved,true);assert.ok(await deliver(directory));
});

test('MCP omits geometry confirmation and generates review output directly',async t=>{
  const {root,directory}=await fixture(t),adapter=createMcpAdapter({printsRoot:root,autoOpen:false});
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair(),client=new Client({name:'synthetic-final-confirmation',version:'1'});
  await adapter.server.connect(serverTransport);await client.connect(clientTransport);
  try{
    const names=(await client.listTools()).tools.map(tool=>tool.name);assert.ok(!names.includes('confirm_geometry'));
    const response=await client.callTool({name:'generate_print',arguments:{printId:'part'}});
    assert.equal(response.isError,undefined,response.content.map(item=>item.text).join('\n'));
    const state=await loadBundle(directory);assert.ok(state.program);assert.equal(state.geometryApproved,false);assert.equal(state.toolpathApproved,false);
  }finally{await client.close();await adapter.close();}
});
