import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {loadFlow,flowPacket} from '../../dev-map/lib/flow.mjs';

const source=await readFile(new URL('../../studio/server.mjs',import.meta.url),'utf8');
function harness({state={generationHash:'p',review:{}},executionState,executionDirectory,worker=true,closed=false,job=null,failure=null,loadError,runError,requestError,guide={},afterLoad}={}){
  const trace=[],original=runError??null,bundleFor=()=>{},context=vm.createContext({dir:'/print',closed,preparation:job,
    generationFailure:failure,generationCancelled:{old:true},generationRun:null,instanceId:'studio',resolveBundle:worker?bundleFor:()=>{},bundleFor,
    Error,Date:{now:()=>100},L:{playback:4},note:(...args)=>trace.push(['note',...args]),
    annotateSourceSkew:async error=>trace.push(['annotate',error.message]),
    requests:{begin:async fields=>{trace.push(['request',fields]);if(requestError)throw requestError;return {id:'request'};}},
    tour:{info:async()=>{trace.push(['tour']);return guide;},requestStartLayer:async()=>trace.push(['start-layer'])},
    PreparedGenerationJob:class{constructor(options){trace.push(['prepare',options.key]);this.key=options.key;this.status='preparing';}
      async generate(development){trace.push(['worker',development]);if(runError)throw runError;}},
    Worker:class{constructor(){throw Error('worker factory should stay lazy');}}});
  const code=source.slice(source.indexOf('  const discardPreparation='),source.indexOf('  const openPrint='))
    .replace("new URL('./generation-worker.mjs',import.meta.url)","'worker-url'");
  vm.runInContext(code+'\nglobalThis.runGeneration=generate;globalThis.runPrepare=prepare;globalThis.decisions={planPreparation};',context);
  const current={loadBundle:async(...args)=>{trace.push(['load',...args]);if(loadError)throw loadError;afterLoad?.(context);return state;},
    generateBundle:async(path,options)=>{
      if(state.program&&!state.programError)return {};
      if(options.dispatchComputation)return options.dispatchComputation({directory:executionDirectory??path,state:executionState??state,
        development:options.development,onProgress:options.onProgress,beforeCommit:options.beforeCommit});
      options.onProgress?.({stage:'Preparing geometry'});trace.push(['direct',path,{development:options.development}]);
      if(runError)throw runError;return {};
    }};
  return {context,trace,original,run:development=>context.runGeneration(current,development),prepare:(s=state,path='/print')=>context.runPrepare(s,path),
    normalized:()=>JSON.parse(JSON.stringify(trace))};
}
const kinds=h=>h.trace.map(x=>x[0]==='note'?x[1]:x[0]);

test('saved programs reuse or promote without calculation notes or worker preparation',async()=>{
  for(const [mode,development] of [['production',false],['development',true],['development',false]]){
    const h=harness({state:{program:{},generationHash:'p',review:{generation:{mode}}}});await h.run(development);
    assert.deepEqual(kinds(h),['load','tour']);
    assert.equal(h.context.generationCancelled,null);assert.equal(h.context.generationFailure,null);assert.equal(h.context.generationRun,null);
  }
});

test('new generation selects prepared worker, direct adapter or closed-worker fallback in existing order',async()=>{
  for(const [options,expected] of [[{},['load','prepare','generation-started','worker','generation-finished','tour','start-layer']],
    [{worker:false},['load','generation-started','direct','generation-finished','tour','start-layer']],
    [{closed:true},['load','generation-started','direct','generation-finished','tour','start-layer']]]){
    const h=harness({...options,guide:{active:true,directory:'/print',step:4}});await h.run(false);
    assert.deepEqual(kinds(h),expected);assert.equal(h.context.generationRun,null);assert.equal(h.context.preparation,null);
  }
});

test('matching prepared job is reused and failed matching run is discarded before replacement',async()=>{
  const order=[];const existing={key:'/print:p',status:'ready',worker:{},generate:async d=>order.push(['existing',d])};
  const h=harness({job:existing});await h.run(true);assert.deepEqual(order,[['existing',true]]);
  assert.deepEqual(kinds(h),['load','tour']);assert.equal(h.context.preparation,null);
  const failed={key:'/print:p',status:'failed',worker:{},dispose:async()=>order.push(['dispose'])};
  const next=harness({job:failed,failure:{directory:'/print',generationHash:'p'}});await next.run(false);
  assert.deepEqual(order.at(-1),['dispose']);assert.deepEqual(kinds(next),['load','prepare','generation-started','worker','generation-finished','tour']);
});

test('failed prepared execution retains its diagnostic job until retry disposal',async()=>{
  const error=Error('prepared failure'),job={key:'/print:p',status:'ready',worker:{},async generate(){this.status='failed';throw error;}};
  const h=harness({job});await assert.rejects(h.run(false),e=>e===error);
  assert.strictEqual(h.context.preparation,job);
});

test('preparation decisions preserve early skip, saved-output discard and matching-key reuse',()=>{
  for(const state of [{program:{}},{outputAvailability:true},{review:{generation:{generationHash:'p'}},generationHash:'p'}]){
    let disposed=0;const h=harness({job:{dispose(){disposed++;}}});assert.equal(h.prepare(state),null);assert.equal(disposed,1);
  }
  const job={key:'/print:p'};const h=harness({job});assert.equal(h.prepare(),job);assert.deepEqual(h.trace,[]);
  const stopped=harness({closed:true,job});assert.equal(stopped.prepare(),null);assert.equal(stopped.context.preparation,job);
});

test('load and inspection errors occur before generation publication; cancellation bypasses failure notification',async()=>{
  const loadError=Error('load');const load=harness({loadError});await assert.rejects(load.run(false),e=>e===loadError);
  assert.deepEqual(kinds(load),['load']);assert.equal(load.context.generationCancelled,null);
  const inspection=harness({state:{inspection:true}});await assert.rejects(inspection.run(false),/does not support/);assert.deepEqual(kinds(inspection),['load']);
  const cancelled=Object.assign(Error('cancelled'),{code:'GENERATION_CANCELLED'}),h=harness({runError:cancelled});
  await assert.rejects(h.run(false),e=>e===cancelled);assert.deepEqual(kinds(h),['load','prepare','generation-started','worker']);
  assert.equal(h.context.generationRun,null);assert.equal(h.context.generationFailure,null);
});

test('generation failure annotates, records request and publishes failure while preserving original error precedence',async()=>{
  for(const requestError of [undefined,Error('notification')]){
    const error=Error('generation'),h=harness({worker:false,runError:error,requestError});
    await assert.rejects(h.run(false),e=>e===error);
    assert.deepEqual(kinds(h),['load','generation-started','direct','annotate','request',...requestError?[]:['generation-failed']]);
    assert.deepEqual(JSON.parse(JSON.stringify(h.context.generationFailure)),{directory:'/print',generationHash:'p',message:'generation'});
    assert.equal(h.context.generationRun,null);
  }
});

test('captured generation identity and live execution directory retain their distinct timing',async()=>{
  const h=harness({worker:false,afterLoad:context=>{context.dir='/changed';}});await h.run(true);
  assert.deepEqual(h.normalized().find(x=>x[0]==='direct'),['direct','/changed',{development:true}]);
  assert.deepEqual(h.normalized()[0],['load','/print',{program:false}]);
  const promote=harness({state:{program:{},review:{generation:{mode:'development'}}},afterLoad:context=>{context.dir='/changed';}});
  await promote.run(false);assert.equal(promote.normalized().find(x=>x[0]==='direct'),undefined);
});

test('computation transport uses the fresh execution directory and state supplied by core',async()=>{
  const fresh=Object.freeze({generationHash:'fresh',review:Object.freeze({})});
  const h=harness({executionDirectory:'/fresh-print',executionState:fresh});await h.run(false);
  assert.deepEqual(h.normalized().find(row=>row[0]==='prepare'),['prepare','/fresh-print:fresh']);
});

test('preparation decisions accept frozen acquired facts without touching the host',()=>{
  const h=harness();
  const empty=Object.freeze({generationHash:'p',review:Object.freeze({})});
  const decision=h.context.decisions.planPreparation(empty,'/print',Object.freeze({closed:false,workerEnabled:true,currentKey:'/print:p'}));
  assert.equal(decision.action,'reuse');assert.equal(decision.key,'/print:p');assert.deepEqual(h.trace,[]);
});

test('generation map connects acquired facts, strategy, execution outcome and publication',async()=>{
  const file='studio/server.mjs',context=await loadFlow({files:[file]});
  const page=flowPacket(context,`${file}::createStudio::generate`);
  const index=name=>page.components.find(c=>c.label===`createStudio::${name}`)?.index;
  for(const [from,to,label] of [['readGeneration','executeGeneration','snapshot'],['executeGeneration','publishGeneration','outcome']])
    assert.ok(page.wires.some(w=>w.from===index(from)&&w.to===index(to)&&w.label===label),`${from} -> ${to}`);
  assert.ok(page.components.some(c=>c.label==='createStudio::publishGenerationFailure'&&c.gate!==undefined));
  assert.ok(page.uncertainty.some(x=>x.kind==='exceptional-control-flow'),'catch/finally limits remain explicit');
});
