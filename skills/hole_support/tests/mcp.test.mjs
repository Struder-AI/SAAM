import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {referenceControl,referenceInventory} from '../scripts/reference.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
test('MCP discovers hole_support and preserves revision and approval rules across all treatments',async()=>{
  const printsRoot=await mkdtemp(resolve(tmpdir(),'saam-hole-support-'));
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve(root,'adapters/mcp/src/server.mjs')],cwd:tmpdir(),env:{...process.env,SAAM_PRINTS_ROOT:printsRoot,SAAM_NO_AUTO_OPEN:'1'},stderr:'pipe'});
  const client=new Client({name:'hole-support-test',version:'1.0.0'});
  async function call(name,args={},error){
    const result=await client.callTool({name,arguments:args}),message=result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
    if(error){assert.equal(result.isError,true,message);assert.match(message,error);return;}
    assert.ok(!result.isError,message);return JSON.parse(message);
  }
  try{
    await client.connect(transport);
    const tools=(await client.listTools()).tools;
    assert.equal(tools.find(t=>t.name==='inspect_hole_support').annotations.readOnlyHint,true);
    assert.equal(tools.find(t=>t.name==='apply_hole_support').annotations.readOnlyHint,false);
    assert.ok((await call('list_skills')).some(s=>s.id==='hole_support'&&s.kind==='geometry'));
    assert.equal((await call('read_skill',{skillId:'hole_support'})).path,'skills/hole_support/SKILL.md');
    const {plan}=await call('get_plan_template',{kind:'shell',machineId:'ultimaker-s5'});
    const base=await referenceControl();plan.geometry=base;plan.skills['draped-skin'].enabled=false;
    plan.skills['planar-infill'].enabled=true;plan.skills['full-fill'].mode='solid-surfaces';
    const printId='counterbore';await call('create_print',{printId,kind:'shell',machineId:'ultimaker-s5',plan});
    const inspection=await call('inspect_hole_support',{printId});
    assert.equal(inspection.features.length,1);
    const {part,applied,...feature}=inspection.features[0];
    assert.deepEqual(feature.centerMm,[20,20,10]);assert.equal(feature.boreRadiusMm,5);assert.equal(feature.counterboreRadiusMm,10);
    let revision=inspection.revision;
    for(const strategy of ['membrane','stepped-reduction','bore-support']){
      const changed=await call('apply_hole_support',{printId,expectedRevision:revision,request:{feature:{...feature,strategy}}});
      assert.notEqual(changed.revision,revision);assert.equal(changed.toolpathApproved,false);revision=changed.revision;
      const saved=await call('get_print',{printId,includeGeometry:true});
      assert.deepEqual(saved.plan.geometry.base,base);assert.equal(saved.plan.geometry.features.length,1);assert.equal(saved.plan.geometry.features[0].strategy,strategy);
      await call('generate_print',{printId});assert.equal((await call('get_approval_status',{printId})).toolpathApproved,false);
      revision=(await call('get_print',{printId})).revision;
    }
    await call('apply_hole_support',{printId,expectedRevision:inspection.revision,request:{feature:{id:feature.id,strategy:'membrane'}}},/stale/i);
    await call('apply_hole_support',{printId,expectedRevision:revision,request:{feature:{id:feature.id,overlap:0.6}}},/50% or 75%/);
    assert.equal((await call('get_print',{printId})).revision,revision);
    const rebuilt=await call('apply_hole_support',{printId,expectedRevision:revision,request:{feature:{id:feature.id,overlap:0.75},process:{layerMm:0.25,firstLayerMm:0.25},holeLineWidthMm:0.35}});revision=rebuilt.revision;
    assert.equal((await call('get_print',{printId,includeGeometry:true})).plan.geometry.process.layerMm,0.25);
    assert.equal((await call('get_print',{printId,includeGeometry:true})).plan.geometry.process.holeLineWidthMm,0.35);
    await call('generate_print',{printId});revision=(await call('get_print',{printId})).revision;
    await call('apply_hole_support',{printId,expectedRevision:revision,request:{remove:feature.id}});
    assert.deepEqual((await call('get_print',{printId,includeGeometry:true})).plan.geometry,base);
  }finally{await client.close();await rm(printsRoot,{recursive:true,force:true});}
});

test('supplied STEP reference dimensions and source identities remain unchanged',async()=>{
  const refs=await referenceInventory();
  assert.deepEqual(refs.map(r=>r.sha256),[
    '5790ae5ab2d3abc2356241de4cbe6b2f653ebd2fc5713bf776bc94c0a6f5b5e0',
    'f08a06c70f4e6f8309abfd5b47f4a1cbb1cd2a1aaf0c63014e6d1088f2b8450c',
    'd49df9bb4cab188c02d5505212b99230e2ef0ac6bb122f395235556607a5fa3d',
    'a752e400ad9e72641cc8cb8d71e71c1e40e60a978a54d014c2d3339a7062f34b'
  ]);
  assert.deepEqual(refs[2].zLevelsMm,[-10,0,0.4,0.8,1.2,10]);
  assert.deepEqual(refs[3].radiiMm,[4.4,5,5.2,9,10]);
});
