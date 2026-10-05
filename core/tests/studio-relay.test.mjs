// Existing print-free Studio safety coverage retained after retiring relay/MCP pairing.
import './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStudio} from '../../studio/server.mjs';
async function library(t){const dir=await mkdtemp(join(tmpdir(),'saam-studio-launch-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
async function serve(t,server){await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>server.shutdown());return `http://127.0.0.1:${server.address().port}`;}
async function page(origin){const html=await(await fetch(origin)).text();return {token:html.match(/name="saam-token" content="([^"]+)"/)[1]};}

test('Studio without a print serves the library, refuses print work and opens a print',async t=>{
  const root=await library(t);
  await mkdir(join(root,'first'));
  await writeFile(join(root,'first','plan.json'),JSON.stringify({schema:'scratch-test/1'}));
  await writeFile(join(root,'first','machine.json'),JSON.stringify({name:'Synthetic scratch machine'}));
  const resolver=async dir=>{
    const state=Object.freeze({kind:'shell',marker:dir,review:Object.freeze({approvals:Object.freeze({})})});
    return {bundleFingerprints:async()=>({source:dir,presentation:dir}),loadBundle:async()=>state};
  };
  const server=createStudio(null,{libraryRoot:root,resolveBundle:resolver}),origin=await serve(t,server);
  const {token}=await page(origin);
  assert.equal(server.currentPrint(),null);assert.equal(server.agentSession().directory,null);assert.equal(server.agentSession().printId,null);
  assert.equal(server.generationStatus(),null);
  const state=await fetch(origin+'/api/state');
  assert.equal(state.status,204,'no print is an empty state, not an error');
  assert.equal((await(await fetch(origin+'/api/prints')).json()).prints.length,1);
  assert.equal((await(await fetch(origin+'/api/agent-requests')).json()).requests.length,0);
  const post=(route,body={})=>fetch(origin+'/api/'+route,{method:'POST',headers:{Origin:origin,'X-SAAM-Token':token},body:JSON.stringify(body)});
  const refused=await post('generate');
  assert.equal(refused.status,400);assert.equal((await refused.json()).code,'NO_PRINT');
  assert.equal((await post('open',{path:join(root,'first')})).status,200);
  assert.equal(server.currentPrint(),join(root,'first'));
  assert.equal((await(await fetch(origin+'/api/state')).json()).marker,join(root,'first'));
});
