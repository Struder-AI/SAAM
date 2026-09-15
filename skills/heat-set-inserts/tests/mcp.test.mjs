import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');

test('MCP discovers heat-set profiles and applies revision-checked insert edits',async()=>{
  const printsRoot=await mkdtemp(resolve(tmpdir(),'saam-heat-set-mcp-'));
  const transport=new StdioClientTransport({command:process.execPath,
    args:[resolve(root,'adapters/mcp/src/server.mjs')],cwd:tmpdir(),
    env:{...process.env,SAAM_PRINTS_ROOT:printsRoot,SAAM_NO_AUTO_OPEN:'1'},stderr:'pipe'});
  const client=new Client({name:'saam-heat-set-test',version:'1.0.0'});
  async function call(name,args={},errorPattern){
    const result=await client.callTool({name,arguments:args});
    const message=result.content.filter(item=>item.type==='text').map(item=>item.text).join('\n');
    if(errorPattern){assert.equal(result.isError,true,message);assert.match(message,errorPattern);return;}
    assert.ok(!result.isError,message);return JSON.parse(message);
  }
  try{
    await client.connect(transport);
    const tools=(await client.listTools()).tools;
    assert.equal(tools.find(tool=>tool.name==='heat_set_catalog')?.annotations.readOnlyHint,true);
    assert.equal(tools.find(tool=>tool.name==='apply_heat_set')?.annotations.readOnlyHint,false);
    const {inserts}=await call('heat_set_catalog');
    const insert=inserts.find(entry=>entry.id==='spirol-29-m3-long');
    assert.ok(insert,'Catalog exposes an exact insert ID usable in requests.');
    assert.equal(insert.holeDiameterMm,3.99);
    assert.equal(insert.lengthMm,5.74);

    const {plan}=await call('get_plan_template',{kind:'shell',machineId:'ultimaker-s5'});
    const base={shape:'box',runMm:30,widthMm:26,heightMm:10};
    plan.geometry=base;plan.skills['draped-skin'].enabled=false;
    const printId='insert-sample';
    let state=await call('create_print',{printId,kind:'shell',machineId:'ultimaker-s5',plan});
    const firstRevision=state.revision;
    state=await call('apply_heat_set',{printId,expectedRevision:state.revision,
      request:{feature:{id:'mount',insertId:insert.id,positionMm:[15,13,10],finCount:4}}});
    assert.notEqual(state.revision,firstRevision);
    let saved=await call('get_print',{printId,includeGeometry:true});
    assert.equal(saved.plan.geometry.shape,'heat-set');
    assert.ok(saved.plan.geometry.triangles.length>12,'The transport persists the compiled hole geometry.');
    assert.equal(saved.plan.geometry.features[0].insertId,insert.id);

    await call('apply_heat_set',{printId,expectedRevision:firstRevision,
      request:{feature:{id:'mount',finCount:8}}},/stale/i);
    assert.equal((await call('get_print',{printId})).revision,state.revision,'A stale update changes nothing.');
    state=await call('apply_heat_set',{printId,expectedRevision:state.revision,
      request:{feature:{id:'mount',finCount:6}}});
    saved=await call('get_print',{printId,includeGeometry:true});
    assert.equal(saved.plan.geometry.features[0].finCount,6);
    assert.equal(saved.plan.geometry.features[0].insertId,insert.id);
    assert.deepEqual(saved.plan.geometry.features[0].positionMm,[15,13,10]);
    await call('apply_heat_set',{printId,expectedRevision:state.revision,request:{remove:'mount'}});
    assert.deepEqual((await call('get_print',{printId,includeGeometry:true})).plan.geometry,base);
  }finally{
    await client.close();
    await rm(printsRoot,{recursive:true,force:true});
  }
});
