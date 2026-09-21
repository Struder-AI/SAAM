import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaults} from '../print/plan.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {initBundle,generateBundle,loadBundle} from '../print/bundle.mjs';
import {unpackZip} from '../export/zip.mjs';
import {syntheticDobotSetup} from './fixtures/dobot.mjs';
import {createStudio} from '../../studio/server.mjs';
import {decodeSource,fetchSources} from '../../studio/source-player.mjs';
import {moveStore,moveBuffers} from '../../studio/move-store.mjs';
import {frameAtTime} from '../../studio/playback.mjs';
import {buildToolpathView,toolpathFrame} from '../../studio/toolpath-view.mjs';

for(const id of ['ultimaker-s5','bambu-h2d','dobot-mg400'])test(`${id}: Studio plays exact machine source with identical motion, timing and layer controls`,async t=>{
  const machine=loadMachine(id),plan=defaults(machine);
  if(id==='dobot-mg400')syntheticDobotSetup(plan);
  plan.geometry={shape:'box',runMm:8,widthMm:8,heightMm:2};plan.process.minimumLayerSeconds=0;
  const dir=await mkdtemp(join(tmpdir(),'saam-source-'));let server;
  t.after(async()=>{await server?.shutdown();await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});});
  await initBundle(dir,plan,{machineId:id});await generateBundle(dir,{development:true});
  const expected=await loadBundle(dir);server=createStudio(dir);
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const origin=`http://127.0.0.1:${server.address().port}`,fetcher=(url,...args)=>fetch(origin+url,...args);
  const stateText=await(await fetcher('/api/state')).text(),state=JSON.parse(stateText);
  assert.ok(state.program);assert.equal(state.program.moves,undefined);assert.equal(state.program.events,undefined);
  assert.equal(state.code,undefined);assert.equal(state.toolpathApproved,false);
  assert.ok(stateText.length<100000,'state must stay small instead of embedding the motion list');
  const sources=await fetchSources(state,fetcher);
  const bytes=await readFile(join(dir,expected.review.generation.file));
  if(id==='ultimaker-s5')assert.equal(sources.program,bytes.toString());
  else{
    const entries=unpackZip(bytes);
    if(id==='bambu-h2d')assert.equal(sources.program,entries.get('Metadata/plate_1.gcode').toString());
    else for(const [name,source] of Object.entries(sources))assert.equal(source,entries.get(name).toString());
  }
  const decoded=decodeSource(sources,plan,machine),raw=decoded.moves.snapshot();
  const received=structuredClone(raw,{transfer:moveBuffers(raw)}),moves=moveStore(received);
  assert.deepEqual([...moves],expected.program.moves);
  assert.deepEqual(moves.findLast(m=>m.extruding),expected.program.moves.findLast(m=>m.extruding),'shutdown keeps the last deposition layer emphasized');
  assert.deepEqual(decoded.events,expected.program.events);
  assert.equal(decoded.summary.motionSeconds,expected.program.summary.motionSeconds);
  const view=buildToolpathView(moves),reference=buildToolpathView(expected.program.moves);
  for(const seconds of [0,decoded.seconds/2,decoded.seconds]){
    const frame=frameAtTime(moves,seconds);assert.deepEqual(frame,frameAtTime(expected.program.moves,seconds));
    for(const travel of [false,true])assert.deepEqual(toolpathFrame(view,frame.completed,travel),toolpathFrame(reference,frame.completed,travel));
  }
  await assert.rejects(()=>fetchSources({...state,exportHash:'changed'},fetcher),/changed/);
  await assert.rejects(()=>fetchSources({...state,revision:'changed'},fetcher),/changed/);
  await assert.rejects(()=>fetchSources({...state,printId:'changed'},fetcher),/changed/);
  await assert.rejects(()=>fetchSources({...state,program:{sources:state.program.sources.map(s=>({...s,sha256:'wrong'}))}},fetcher),/changed/);
  assert.equal((await fetcher('/api/program?file=unrelated.lua')).status,404,'no per-file program route remains');
  assert.equal((await fetcher('/api/gcode')).status,404,'no legacy single-source route remains');
  for(const file of ['/studio/source-worker.mjs','/studio/source-player.mjs','/studio/move-store.mjs','/core/export/griffin.mjs','/core/machine/rules.mjs','/core/machine/rigid.mjs'])assert.equal((await fetcher(file)).status,200);
  assert.notEqual((await fetcher('/core/print/workflow.mjs')).status,200,'only browser dependencies are served');
  if(id==='dobot-mg400'){
    // Execute changed Lua helper arithmetic. Do not derive motion from annotations.
    const changed={...sources,'global.lua':sources['global.lua'].replace('x*','(x+0.1)*')};
    const replay=decodeSource(changed,plan,machine,{compact:false});
    assert.ok(Math.abs(replay.moves[0].to[0]-expected.program.moves[0].to[0]-.1)<1e-6);
    assert.throws(()=>decodeSource({...sources,'src0.lua':'UnsupportedCall()'},plan,machine),/Unsupported|Unknown|undefined/i);
  }else {
    const invalid=id==='bambu-h2d'?sources.program.replace(';SAAM_BODY_BEGIN\n',';SAAM_BODY_BEGIN\nG999\n'):sources.program.replace('G1 ','G999 ');
    assert.throws(()=>decodeSource({program:invalid},plan,machine),/Unsupported command|explicit modal/);
  }
});

test('compact drawing storage crosses chunk boundaries without losing precision or context',()=>{
  const store=moveStore();
  for(let i=0;i<17000;i++)store.push({line:i,from:[i/7,0,.123456789012345],to:[(i+1)/7,0,.123456789012345],extruding:i%2===0,phase:'wall',operation:null,layer:i});
  const decoded=moveStore(structuredClone(store.snapshot()));
  assert.equal(decoded.length,17000);
  for(const i of [0,16383,16384,16999])assert.deepEqual(decoded[i],store[i]);
});

test('streamed source transport checks inventory and hashes across arbitrary chunks',async()=>{
  const text="Sub main\n' unicode: é\nEnd Sub\n",bytes=new TextEncoder().encode(text);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  const state={printId:'print',revision:'revision',exportHash:'export',program:{sources:[{name:'main.pcs',sha256:hash}]}};
  const fetcher=lines=>async()=>new Response(new ReadableStream({start(controller){const b=new TextEncoder().encode(lines);for(let i=0;i<b.length;i+=7)controller.enqueue(b.slice(i,i+7));controller.close();}}));
  const line=JSON.stringify({name:'main.pcs',text})+'\n';
  assert.deepEqual(await fetchSources(state,fetcher(line)),{'main.pcs':text});
  await assert.rejects(()=>fetchSources(state,fetcher(line+line)),/duplicate/);
  await assert.rejects(()=>fetchSources(state,fetcher('')),/Missing/);
  await assert.rejects(()=>fetchSources(state,fetcher(line.replace('unicode','changed'))),/changed/);
});
