import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {loadBundle} from '../../../core/print/bundle.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
async function fixture(t){const dir=await mkdtemp(resolve(tmpdir(),'saam-synthetic-gridfinity-access-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('CLI creates and edits a shared print from parameters; stale changes fail without altering it',async t=>{
  const parent=await fixture(t),dir=resolve(parent,'print'),request=resolve(parent,'parameters.json');
  await writeFile(request,JSON.stringify({kind:'blank'}));
  const cli=resolve(root,'skills/gridfinity/scripts/cli.mjs');
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd:tmpdir(),encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  const state=run('create',dir,request,'--machine','ultimaker-s5');assert.equal(state.geometryApproved,false);
  await writeFile(request,JSON.stringify({xUnits:2}));
  const next=run('update',dir,request,'--revision',state.revision);assert.notEqual(next.revision,state.revision);
  assert.throws(()=>run('update',dir,request,'--revision',state.revision),/stale/);
  assert.equal((await loadBundle(dir)).plan.geometry.parameters.xUnits,2);
});

test('MCP discovers name-only guidance and uses the same create, edit, check and revision lifecycle',async t=>{
  const dir=await fixture(t);
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve(root,'adapters/mcp/src/server.mjs')],cwd:tmpdir(),env:{...process.env,SAAM_PRINTS_ROOT:dir,SAAM_NO_AUTO_OPEN:'1'},stderr:'pipe'});
  const client=new Client({name:'synthetic-gridfinity-access',version:'1'});await client.connect(transport);t.after(()=>client.close());
  const call=async(name,args={},error)=>{
    const result=await client.callTool({name,arguments:args}),text=result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
    if(error){assert.equal(result.isError,true,text);assert.match(text,error);return;}
    assert.ok(!result.isError,text);return JSON.parse(text);
  };
  const entry=(await call('list_skills')).find(s=>s.id==='gridfinity');assert.equal(entry.kind,'task');assert.equal(entry.description,'gridfinity');
  const tool=(await client.listTools()).tools.find(t=>t.name==='gridfinity');assert.equal(tool.description,'gridfinity');
  const manual=await call('read_skill',{skillId:'gridfinity'});assert.match(manual.manual,/compartmentsX/);
  const digest=(await readFile(resolve(root,'skills/README.md'),'utf8')).split('\n').find(line=>line.includes('[gridfinity]'));
  assert.equal(digest.trim(),'| [gridfinity](gridfinity/SKILL.md) | gridfinity |');
  await call('gridfinity',{printId:'../escape',action:'create',machineId:'ultimaker-s5',parameters:{}},/validation|Invalid|format/i);
  await call('gridfinity',{printId:'forged',action:'create',machineId:'ultimaker-s5',parameters:{approved:true}},/not an agent-editable/);
  let state=await call('gridfinity',{printId:'sample',action:'create',machineId:'ultimaker-s5',parameters:{kind:'bin',heightUnits:2}});
  assert.deepEqual(state.approvals,{geometry:false,plan:false,toolpath:false});
  await call('gridfinity',{printId:'sample',action:'update',expectedRevision:'stale',parameters:{xUnits:2}},/stale/);
  state=await call('gridfinity',{printId:'sample',action:'update',expectedRevision:state.revision,parameters:{xUnits:2}});
  const saved=await call('get_print',{printId:'sample',includeGeometry:true});assert.equal(saved.plan.geometry.parameters.xUnits,2);
  const checked=await call('check_print',{printId:'sample'});assert.deepEqual(checked.checked,['geometry','plan']);
  const path=await call('check_path',{printId:'sample'});assert.equal(path.physicalValidation,'not performed');
  await call('gridfinity',{printId:'sample',action:'create',machineId:'ultimaker-s5',parameters:{}},/already exists/);
  assert.deepEqual((await call('get_print',{printId:'sample'})).approvals,{geometry:false,plan:false,toolpath:false});
});
