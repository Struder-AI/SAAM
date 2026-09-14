import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {gunzipSync} from 'node:zlib';
import {createTour,tourReference,referenceAdapter,previewBytes,useExample} from '../../studio/tour.mjs';
import {encodePreview,decodePreview} from '../../studio/preview-cache.mjs';
import {moveStore} from '../../studio/move-store.mjs';
import {createStudio} from '../../studio/server.mjs';

async function library(t){const dir=await mkdtemp(join(tmpdir(),'saam-tour-'));t.after(()=>rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100}));return dir;}
test('preview columns retain exact doubles, typed indices and missing interned values',()=>{
  const encoded=encodePreview({positions:new Float64Array([Math.PI,-0,1e-12]),indices:new Uint32Array([0,4294967295]),interned:[undefined,'travel']});
  const decoded=decodePreview(encoded.buffer);
  assert.deepEqual([...decoded.positions],[Math.PI,-0,1e-12]);assert.ok(decoded.positions instanceof Float64Array);
  assert.deepEqual([...decoded.indices],[0,4294967295]);assert.equal(decoded.interned[0],undefined);assert.equal(decoded.interned[1],'travel');
  assert.equal(new DataView(encoded.buffer).getUint32(0,true),1);
  new DataView(encoded.buffer).setUint32(0,2,true);assert.throws(()=>decodePreview(encoded.buffer),/Unsupported/);
});
test('tour resumes saved copies and starts fresh without overwriting earlier work',async t=>{
  const dir=await library(t),tour=createTour(dir),first=await tour.landing();
  assert.equal((await tour.info()).active,false);assert.equal(await createTour(dir).landing(),first);
  const wave=await tour.action('step',3);assert.notEqual(wave.directory,first);
  assert.equal(await createTour(dir).landing(),wave.directory);
  const fresh=await tour.action('fresh');assert.notEqual(fresh.directory,first);
  assert.notEqual((await tour.action('step',3)).directory,wave.directory);
  assert.ok(await tourReference(first));await assert.rejects(tour.action('step',99),/Unknown tour step/);
  await tour.action('finish');assert.equal((await tour.info()).completed,true);
});
test('packaged reference cannot approve, generate or deliver and yields to edits',async t=>{
  const dir=await library(t),copy=await createTour(dir).landing();let calls=0;
  const adapter=referenceAdapter({loadBundle:async()=>{calls++;return {live:true};}});
  const state=await adapter.loadBundle(copy);assert.equal(calls,0);
  for(const key of ['geometryApproved','planApproved','toolpathApproved'])assert.equal(state[key],false);
  for(const method of ['approve','generateBundle','deliver','updatePlan'])await assert.rejects(adapter[method](copy),/Use this example/);
  await assert.rejects(adapter.loadBundle(copy,{allSources:true}),/manufacturing output/);
  const bytes=gunzipSync(await previewBytes(copy));const display=decodePreview(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const moves=moveStore(display.moves);assert.ok(moves.length>0);assert.ok(Number.isFinite(moves[0].startSeconds));assert.ok(display.material.groups.length>0);
  await writeFile(join(copy,'plan.json'),(await readFile(join(copy,'plan.json'),'utf8'))+'\n');
  assert.equal(await tourReference(copy),null);assert.deepEqual(await adapter.loadBundle(copy),{live:true});assert.equal(calls,1);
  const fresh=await createTour(dir).landing();assert.notEqual(fresh,copy);assert.ok(await tourReference(fresh));
  assert.ok((await readFile(join(copy,'plan.json'),'utf8')).endsWith('\n\n'),'edited copy stays untouched');
});
test('Studio serves ready examples through the same viewer and protects session transitions',async t=>{
  const dir=await library(t),copy=await createTour(dir).landing(),server=createStudio(copy,{libraryRoot:dir});
  t.after(()=>server.shutdown());server.listen(0,'127.0.0.1');await once(server,'listening');const url='http://127.0.0.1:'+server.address().port;
  const html=await(await fetch(url)).text(),token=html.match(/name="saam-token" content="([^"]+)"/)[1];
  const state=await(await fetch(url+'/api/state')).json();assert.equal(state.referencePreview.id,'surface-drape');assert.ok(state.program);
  const post=(route,body,auth=token)=>fetch(url+'/api/'+route,{method:'POST',headers:{Origin:url,'X-SAAM-Token':auth,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post('tour',{action:'step',step:3},'invalid')).status,403);
  assert.equal((await post('tour',{action:'step',step:3,printId:'stale'})).status,400);
  for(const route of ['approve','generate','deliver'])assert.equal((await post(route,{printId:state.printId})).status,400);
  for(const route of ['program','sources','example-display'])assert.equal((await fetch(url+'/api/'+route)).status,400);
  assert.equal((await post('tour',{action:'step',step:3,printId:state.printId})).status,200);
  const wave=await(await fetch(url+'/api/state')).json();assert.equal(wave.referencePreview.id,'wavy-denso');assert.notEqual(wave.printId,state.printId);
  assert.equal((await post('use-example',{printId:state.printId})).status,400);
  assert.equal((await post('use-example',{printId:wave.printId})).status,200);
  assert.equal(await tourReference(wave.localPrintDirectory),null);assert.equal((await createTour(dir).info()).active,false);
});
