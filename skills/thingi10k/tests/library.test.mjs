import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createThingi10KClient, csvRows, readRemote, REVISION} from '../scripts/library.mjs';
import {importThingi10KBundle} from '../scripts/import.mjs';
import {boxMesh} from '../../../core/tests/fixtures/mesh.mjs';
import {loadBundle, generateBundle, approve, deliver, updatePlan} from '../../../core/print/bundle.mjs';
import {setSTLUnits} from '../../../core/print/import-stl.mjs';
import {createMcpAdapter} from '../../../adapters/mcp/src/server.mjs';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';

// Synthetic data deliberately gives a file a different license from its thing.
const context = 'Thing ID,Date,Category,Sub-category,Name,Author,License\r\n'
  + '12,2015,models,animals,"Bunny, small",Alice,WRONG THING LICENSE\r\n'
  + '13,2015,models,animals,Forest friend,Bob,Public Domain\r\n';
const tags = 'Thing ID,Tag\n12,bunny\n13,rabbit\n13,bunny\n';
const headers = 'ID,Thing ID,License,Link,No duplicated faces,Closed,Edge manifold,No degenerate faces,Vertex manifold,Single Component,PWN\n';
const fileRow = (id, thing, name) => `${id},${thing},Creative Commons - Attribution,https://example.org/${name},TRUE,TRUE,TRUE,TRUE,TRUE,TRUE,TRUE\n`;
const files = headers + fileRow('101','12','body.stl') + fileRow('102','12','tail.stl') + fileRow('103','13','rabbit.obj') + fileRow('104','14','missing-description.stl');
const mesh = boxMesh(12, 10, 0.6);
const stl = Buffer.from('solid synthetic\n' + mesh.triangles.map(t => 'facet normal 0 0 0\nouter loop\n'
  + t.map(i => 'vertex ' + mesh.vertices[i].join(' ')).join('\n') + '\nendloop\nendfacet').join('\n') + '\nendsolid synthetic');

async function fixture(t, meshBytes = stl) {
  const root = await mkdtemp(resolve(tmpdir(), 'saam-thingi10k-test-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const requests = [];
  const fetchImpl = async url => {
    url = String(url); requests.push(url);
    assert.ok(url.includes(REVISION), 'metadata and mesh come from the same pinned snapshot');
    const name = new URL(url).pathname.split('/').pop();
    const body = {'contextual_data.csv':context, 'tag_data.csv':tags, 'input_summary.csv':files,
      '101.stl':meshBytes, '102.stl':meshBytes}[name];
    return new Response(body ?? 'absent', {status:body === undefined ? 404 : 200});
  };
  const cacheDirectory = resolve(root, 'cache');
  return {root, requests, fetchImpl, cacheDirectory, client:createThingi10KClient({cacheDirectory, fetchImpl})};
}

test('CSV preserves quoted names, embedded newlines and escaped quotes', () => {
  assert.deepEqual(csvRows('ID,Name\r\n1,"A, ""quoted""\nname"\r\n'), [{ID:'1',Name:'A, "quoted"\nname'}]);
  assert.throws(() => csvRows('ID,Name\n1,"incomplete'), /Incomplete/);
});

test('keyword search, thing links, file IDs, pagination and cache reuse have distinct meanings', async t => {
  const {client, requests, cacheDirectory} = await fixture(t);
  const first = await client.search({query:'fetch me a bunny',limit:1});
  assert.equal(first.total,3); assert.equal(first.results[0].fileId,'101'); assert.equal(first.nextOffset,1);
  assert.equal(first.results[0].license,'Creative Commons - Attribution');
  assert.equal(first.results[0].licenseUrl,'https://www.thingiverse.com/thing:12#license');
  assert.equal(first.results[0].licenseVersion,null);
  assert.equal((await client.search({query:'bunny',offset:first.nextOffset,limit:1})).results[0].fileId,'102');
  assert.deepEqual((await client.search({query:'https://www.thingiverse.com/thing:12/files?x=1#files'})).results.map(x=>x.fileId),['101','102']);
  assert.deepEqual((await client.search({query:'102'})).results.map(x=>x.fileId),['102']);
  const absent = await client.search({query:'https://thingiverse.com/thing:999'});
  assert.equal(absent.status,'not_in_mirror'); assert.match(absent.nextStep,/download/);
  assert.equal((await client.search({query:'rabbit'})).results[0].importable,false);
  const incomplete=(await client.search({query:'https://thingiverse.com/thing:14'})).results[0];
  assert.equal(incomplete.fileId,'104');assert.equal(incomplete.author,null);assert.equal(incomplete.contextualMetadataMissing,true);
  for (const query of ['https://thingiverse.com.evil.test/thing:12','http://127.0.0.1/thing:12','https://thingiverse.com@evil.test/thing:12'])
    await assert.rejects(client.search({query}), /Thingiverse model link/);
  await assert.rejects(client.download('../101'),/numeric/);
  await assert.rejects(client.download('103'),/not STL/);
  assert.equal(requests.length,3,'search never downloads geometry');
  const offline = createThingi10KClient({cacheDirectory,fetchImpl:()=>{throw Error('must reuse metadata');}});
  assert.equal((await offline.search({query:'bunny'})).total,3);
});

test('network errors remain failures and can be retried, rather than becoming mirror misses', async t => {
  const {cacheDirectory, fetchImpl} = await fixture(t); let fail = true;
  const client = createThingi10KClient({cacheDirectory,fetchImpl:url => {
    if(fail) return Promise.resolve(new Response('unavailable',{status:503}));
    return fetchImpl(url);
  }});
  await assert.rejects(client.search({query:'bunny'}),/HTTP 503/);
  fail = false;
  assert.equal((await client.search({query:'bunny'})).total,3);
});

test('downloads enforce streamed and declared limits, redirect boundaries, HTTP status and cancellation', async () => {
  const url='https://huggingface.co/file';
  await assert.rejects(readRemote(url,{maxBytes:3,fetchImpl:async()=>new Response('four')}),/exceeds/);
  await assert.rejects(readRemote(url,{maxBytes:3,fetchImpl:async()=>new Response('x',{headers:{'content-length':'4'}})}),/exceeds/);
  let calls=0;
  await assert.rejects(readRemote(url,{maxBytes:100,fetchImpl:async()=>{
    calls++; return new Response(null,{status:302,headers:{location:'http://127.0.0.1/secret'}});
  }}),/outside/);
  assert.equal(calls,1,'never follows an untrusted redirect');
  const fetched=[];
  const bytes=await readRemote(url,{maxBytes:100,fetchImpl:async target=>{
    fetched.push(String(target));
    return fetched.length===1 ? new Response(null,{status:302,headers:{location:'https://us.aws.cdn.hf.co/file'}}) : new Response('mesh');
  }});
  assert.equal(bytes.toString(),'mesh'); assert.equal(fetched.length,2);
  await assert.rejects(readRemote(url,{maxBytes:100,fetchImpl:async()=>new Response('missing',{status:404})}),/HTTP 404/);
  const controller=new AbortController(); controller.abort();
  await assert.rejects(readRemote(url,{maxBytes:100,signal:controller.signal,fetchImpl:()=>{throw Error('must not fetch');}}),/abort/i);
  await assert.rejects(readRemote(url,{maxBytes:100,fetchImpl:async()=>new Response(new ReadableStream({
    start(controller){controller.enqueue(new Uint8Array([1]));controller.error(Error('connection lost'));}
  }))}),/connection lost/);
});

test('failed mesh import retains exact download, attribution and mandatory chat notice',async t=>{
  const broken=Buffer.from('not an STL'), {client,root}=await fixture(t,broken);
  const directory=resolve(root,'broken');
  const result=await importThingi10KBundle(client,directory,'101',{machineId:'ultimaker-s5',setupFile:resolve(root,'setup.json')});
  assert.equal(result.imported,false); assert.ok(result.error);
  assert.deepEqual(await readFile(result.sourcePath),broken);
  assert.equal(JSON.parse(await readFile(result.sourcePath+'.json')).license,result.attribution.license);
  assert.ok(result.chatNotice.includes(result.attribution.licenseUrl));
  await assert.rejects(access(resolve(directory,'plan.json')),/ENOENT/);
});

test('MCP searches, imports and opens an unapproved print; attribution survives correction and delivery',async t=>{
  const {client:library,root,requests}=await fixture(t);
  const printsRoot=resolve(root,'prints');
  const adapter=createMcpAdapter({printsRoot,autoOpen:false,localExtension:{},thingi10kClient:library});
  const client=new Client({name:'synthetic-thingi10k',version:'1'});
  const [ct,st]=InMemoryTransport.createLinkedPair();
  await adapter.server.connect(st); await client.connect(ct);
  t.after(async()=>{await client.close();await adapter.close();});
  const call=async(name,args)=>{
    const result=await client.callTool({name,arguments:args});
    assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text);
  };
  const tools=(await client.listTools()).tools;
  assert.equal(tools.find(tool=>tool.name==='import_thingi10k_print').annotations.openWorldHint,true);
  assert.ok((await call('list_skills',{})).some(skill=>skill.id==='thingi10k'&&skill.kind==='task'));
  const manual=await call('read_skill',{skillId:'thingi10k'}); assert.ok(manual);
  const results=await call('search_thingi10k',{query:'bunny'});
  const imported=await call('import_thingi10k_print',{printId:'Bunny',fileId:results.results[0].fileId,machineId:'ultimaker-s5'});
  assert.equal(imported.imported,true);assert.equal(imported.approvals.geometry,false);
  assert.equal(imported.approvals.toolpath,false);
  assert.ok(imported.chatNotice.includes(imported.attribution.licenseUrl));
  const dir=resolve(printsRoot,'Bunny');
  let state=await loadBundle(dir,{program:false});
  assert.equal(state.plan.geometry.source.sha256,createHash('sha256').update(stl).digest('hex'));
  assert.deepEqual(await readFile(resolve(dir,'geometry/source.stl')),stl);
  assert.deepEqual(state.plan.geometry.source.attribution,imported.attribution);
  const review=await call('request_review',{printId:'Bunny'}); assert.ok(JSON.stringify(review).includes('http://'));
  const count=requests.length;
  const duplicate=await client.callTool({name:'import_thingi10k_print',arguments:{printId:'Bunny',fileId:'101',machineId:'ultimaker-s5'}});
  assert.equal(duplicate.isError,true);assert.equal(requests.length,count,'existing print is rejected before download');
  await setSTLUnits(dir,'mm',{expectedRevision:state.revision});
  state=await loadBundle(dir,{program:false});assert.deepEqual(state.plan.geometry.source.attribution,imported.attribution);
  state.plan.process.minimumLayerSeconds=0;
  await updatePlan(dir,state.plan,state.revision);
  // Synthetic approvals apply only to this isolated fixture.
  state=await loadBundle(dir,{program:false});
  await approve(dir,{stage:'geometry',revision:state.revision,actor:'SYNTHETIC TEST ONLY'});
  await generateBundle(dir);
  state=await loadBundle(dir);
  await approve(dir,{stage:'toolpath',revision:state.revision,actor:'SYNTHETIC TEST ONLY'});
  const destination=await deliver(dir);
  assert.equal(createHash('sha256').update(await readFile(destination)).digest('hex'),state.exportHash);
  const attribution=JSON.parse(await readFile(resolve(dir,'delivery/source-attribution.json')));
  assert.equal(attribution.sha256,imported.attribution.sha256);
  assert.equal(attribution.licenseUrl,'https://www.thingiverse.com/thing:12#license');
  assert.ok(attribution.changes);assert.ok(attribution.planRevision);
});
