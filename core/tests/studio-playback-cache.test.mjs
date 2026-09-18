import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {needsTourToolpath} from '../../studio/tour-ui.mjs';
import {TOUR_LESSONS as L} from '../../studio/tour-catalog.mjs';

const app=await readFile(new URL('../../studio/app.mjs',import.meta.url),'utf8');
const refresh=app.slice(app.indexOf('async function refresh('),app.indexOf('\nasync function acknowledgeDisplayedView'));
const clear=app.slice(app.indexOf('function clearProgramView(){'),app.indexOf('\nconst message='));
const snapshot=(patch={})=>({printId:'part',planHash:'plan',exportHash:'export',revision:'revision',
  program:{summary:{}},geometryApproved:true,plan:{},machine:{name:'Test machine'},review:{generation:{mode:'production'}},
  geometry:{geometryVersion:'geometry',labels:[]},tour:{active:true,step:L.playback},tourExample:{id:'starter'},...patch});

function harness(){
  const counts={decode:0,bind:0,geometry:0,path:0,material:0,dispose:0},nodes=new Map(),mutations=[];
  const noop=()=>{},element=id=>{if(!nodes.has(id))nodes.set(id,{replaceChildren(){}});return nodes.get(id);};
  let next,context;
  context=vm.createContext({state:undefined,playbackCache:null,stalePresentation:null,pathView:null,materialScene:null,materialRenderer:null,
    machineSession:null,geometryScene:null,geometryRenderer:null,selected:null,tab:'geometry',seconds:0,L,needsTourToolpath,
    document:{},$:element,fetch:async()=>({ok:true,json:async()=>structuredClone(next)}),
    agentUI:{received:noop},view:()=>({skinLabel:'Test'}),cameras:{mode:'ghost',reset:noop},layerFade:{reset:noop},
    stop:noop,clearManual:noop,restoreView:noop,render:noop,acknowledgeDisplayedView:async()=>{},
    activity:noop,message:noop,selectFeature:noop,machineTheme:()=>({}),duration:()=>0,
    tourUI:{initialTab:()=>next.tour.step<L.playback?'geometry':'toolpath'},
    createGeometryRenderer:()=>({}),createMaterialRenderer:()=>({dispose(){counts.dispose++;}}),
    buildGeometryView(){counts.geometry++;return {topology:{},edgeFeatures:new Map()};},
    buildToolpathView(moves){counts.path++;return {moves};},
    async buildMaterialScene(moves){counts.material++;return {moves};},
    async decodeInWorker(){
      counts.decode++;
      context.machineSession={bind:async()=>{counts.bind++;},dispose:noop};
      return {moves:[{decode:counts.decode}],summary:{}};
    },
    async api(route){mutations.push(route);await context.generationGate;next={...next,program:{summary:{}},exportHash:'chat-export',review:{generation:{mode:'production'}}};}
  });
  vm.runInContext(clear+'\n'+refresh,context);
  return {counts,context,mutations,async load(value,{reopen=false,follow=false}={}){next=value;await vm.runInContext('refresh('+follow+','+reopen+')',context);}};
}

test('Back/Continue and explicit same-print reopen reuse decoded source and drawing scenes',async()=>{
  const {load,counts,context}=harness();
  await load(snapshot());
  const program=context.state.program,path=context.pathView,material=context.materialScene;
  await load(snapshot({program:undefined,exportHash:undefined,tour:{active:true,step:L.import}}));
  assert.equal(context.state.program,undefined,'geometry-only response remains geometry-only');
  assert.equal(context.pathView,path);assert.equal(context.materialScene,material);
  await load(snapshot());
  assert.equal(context.state.program,program,'Continue restores the same decoded move store');
  await load(snapshot({revision:'approval-revision'}),{reopen:true});
  assert.equal(context.state.program,program,'reopening keeps source bytes despite changed review metadata');
  assert.deepEqual(counts,{decode:1,bind:2,geometry:1,path:1,material:1,dispose:0});
});

test('changed export, plan or print identity rebuilds the decoded playback cache',async()=>{
  const {load,counts,context}=harness();
  await load(snapshot());
  for(const patch of [{exportHash:'new-export'},{planHash:'new-plan',exportHash:'new-export'},
    {printId:'other-part',planHash:'new-plan',exportHash:'new-export'}]){
    const previous=context.state.program;
    await load(snapshot(patch));
    assert.notEqual(context.state.program,previous);
  }
  assert.equal(counts.decode,4);assert.equal(counts.path,4);assert.equal(counts.material,4);
  assert.equal(counts.bind,0,'incompatible source is never rebound as a cache hit');
});

test('a plan edit preserves stale playback until its replacement is ready',async()=>{
  const {load,counts,context}=harness();
  await load(snapshot());
  const path=context.pathView,material=context.materialScene;
  let release;context.generationGate=new Promise(resolve=>{release=resolve;});
  const replacing=load(snapshot({planHash:'edited-plan',program:undefined,tour:{active:true,step:L.settings}}),{follow:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(context.state.program,undefined);assert.ok(context.stalePresentation?.program);
  assert.equal(context.pathView,path);assert.equal(context.materialScene,material);
  assert.equal(counts.dispose,0);
  release();await replacing;
  assert.equal(context.stalePresentation,null);
  assert.equal(counts.decode,2);assert.equal(counts.material,2);assert.equal(counts.bind,0);
});
