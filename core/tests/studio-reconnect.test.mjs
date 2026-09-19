import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import vm from 'node:vm';
import {createStudio} from '../../studio/server.mjs';
import {createTour} from '../../studio/tour.mjs';
const freshFetch=(url,options={})=>fetch(url,{...options,headers:{Connection:'close',...options.headers}});

test('a restarted server changes its public instance identity and rejects the old session token',async t=>{
  const root=await mkdtemp(join(tmpdir(),'saam-reconnect-'));t.after(()=>rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
  const {directory}=await createTour(root).action('fresh');
  let server=createStudio(directory,{libraryRoot:root});t.after(()=>server.shutdown());
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=server.address().port,url='http://127.0.0.1:'+port;
  const html=await(await freshFetch(url)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const state=await(await freshFetch(url+'/api/state')).json(),first=await(await freshFetch(url+'/api/revision')).json();
  assert.equal(first.instanceId,state.instanceId);
  await server.shutdown();
  server=createStudio(directory,{libraryRoot:root});server.listen(port,'127.0.0.1');await once(server,'listening');
  const next=await(await freshFetch(url+'/api/revision')).json();assert.notEqual(next.instanceId,first.instanceId);
  assert.equal((await freshFetch(url+'/api/view-ready',{method:'POST',headers:{Origin:url,'X-SAAM-Token':token,'Content-Type':'application/json'},body:'{}'})).status,403);
});

test('the actual browser poll reloads a restarted session before sending acknowledgements',async()=>{
  const app=await readFile(new URL('../../studio/app.mjs',import.meta.url),'utf8');
  const poll=app.slice(app.indexOf('async function poll(){'),app.indexOf('\nfunction seekTourLayer('));
  let reloads=0,refreshes=0;
  const context=vm.createContext({URLSearchParams,polling:false,busy:false,reconnecting:false,movieController:null,
    state:{instanceId:'old',fingerprint:'before'},fetch:async()=>({ok:true,json:async()=>({instanceId:'new',fingerprint:'after'})}),
    window:{location:{reload:()=>reloads++}},message(){},$:()=>({}),working:async(_label,task)=>task(),refresh:async()=>refreshes++});
  await vm.runInContext(poll+'\npoll()',context);
  assert.equal(reloads,1);assert.equal(refreshes,0);
  context.state.instanceId='new';await vm.runInContext('poll()',context);
  assert.equal(reloads,1);assert.equal(refreshes,1);
});

test('tour metadata updates preserve playback and source; a newly published edit target can start generation',async()=>{
  const app=await readFile(new URL('../../studio/app.mjs',import.meta.url),'utf8');
  const poll=app.slice(app.indexOf('async function poll(){'),app.indexOf('\nfunction seekTourLayer('));
  let loads=0,renders=0,needsGeneration=false;
  const next={instanceId:'same',fingerprint:'same',tour:{step:4,canNext:true,startAt:{layer:8}}};
  const context=vm.createContext({URLSearchParams,polling:false,busy:false,reconnecting:false,movieController:null,playing:true,
    state:{instanceId:'same',fingerprint:'same',tour:{step:4,canNext:false,startAt:{layer:12}}},
    fetch:async()=>({ok:true,json:async()=>next}),message(){},render(){renders++;},needsTourToolpath:()=>needsGeneration,
    working:async(_label,task)=>{context.playing=false;return task();},refresh:async()=>loads++});
  await vm.runInContext(poll+'\npoll()',context);
  assert.equal(loads,0);assert.equal(renders,1);assert.equal(context.playing,true);
  assert.equal(context.state.tour.startAt.layer,8);
  needsGeneration=true;await vm.runInContext('poll()',context);
  assert.equal(loads,1,'request target changes need no bundle rewrite to trigger generation');
});
