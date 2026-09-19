import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGeneration,generateMessage,createProgressReporter} from '../../studio/generation-worker.mjs';
import {generationControl} from '../print/generation-control.mjs';

const settings=()=>({directory:'part',planHash:'locked',control:generationControl()});

test('worker generation waits for preparation, rechecks the plan, commits and reloads exact checked source',async()=>{
  const calls=[],options=settings(),progress=()=>{};options.onProgress=progress;
  let resolveReady;const ready=new Promise(resolve=>{resolveReady=resolve;});
  const checks=Object.freeze({planHash:'locked',checked:true}),program=Object.freeze({seconds:3}),sources=Object.freeze([{name:'part.gcode',code:'bytes'}]);
  const bundle={
    async loadBundle(directory,read){calls.push(['load',directory,read]);return read.program===false?{planHash:'locked'}:{planHash:'locked',exportHash:'exact-bytes',program,code:'bytes',sources};},
    async generateBundle(directory,write){calls.push(['generate',directory]);assert.equal(write.development,true);assert.strictEqual(write.onProgress,progress);assert.strictEqual(write.beforeCommit,options.control.beforeCommit);write.beforeCommit();return checks;}
  };
  const message=Object.freeze({type:'generate',development:true}),pending=generateMessage(message,ready,bundle,options);
  await Promise.resolve();assert.deepEqual(calls,[],'no source read or write before preparation settles');
  resolveReady({notification:{type:'prepared'},error:null});
  const response=await pending;
  assert.deepEqual(calls,[['load','part',{program:false}],['generate','part'],['load','part',{program:'source',allSources:true}]]);
  assert.deepEqual(response,{type:'generated',checks,source:{planHash:'locked',exportHash:'exact-bytes',metadata:program,code:'bytes',sources}});
  assert.strictEqual(response.source.metadata,program);assert.strictEqual(response.source.sources,sources);
  assert.equal(options.control.committing,true);assert.equal(options.control.cancel(),false);
});

test('preparation errors retain their notification and code; a changed plan takes precedence on generation',async()=>{
  const failure=Object.assign(new Error('SYNTHETIC check failure'),{code:'CHECK_FAILED'}),options=settings(),calls=[];
  const bundle={async loadBundle(){calls.push('load');return {planHash:'locked'};},async checkPathBundle(){calls.push('check');throw failure;},async generateBundle(){assert.fail('failed preparation must not write');}};
  const preparation=await prepareGeneration(bundle,options);
  assert.deepEqual(preparation.notification,{type:'prepared',error:'SYNTHETIC check failure'});assert.strictEqual(preparation.error,failure);
  assert.deepEqual(await generateMessage({type:'generate'},Promise.resolve(preparation),bundle,options),{type:'generated',error:failure.message,code:'CHECK_FAILED'});
  assert.deepEqual(calls,['load','check','load']);
  bundle.loadBundle=async()=>({planHash:'changed'});
  const changed=await generateMessage({type:'generate'},Promise.resolve(preparation),bundle,options);
  assert.deepEqual(changed,{type:'generated',error:'The prepared print changed. Reload before generating.',code:undefined});
  const prepared=await prepareGeneration(bundle,options);
  assert.equal(prepared.notification.error,changed.error);
});

test('worker cancellation and checked-source failures retain exact error responses',async()=>{
  const ready=Promise.resolve({error:null}),options=settings();options.control.cancel();
  const cancelled={async loadBundle(){return {planHash:'locked'};},async generateBundle(){assert.fail('cancelled calculations must not write');}};
  assert.deepEqual(await generateMessage({type:'generate'},ready,cancelled,options),{type:'generated',error:'Toolpath calculation cancelled.',code:'GENERATION_CANCELLED'});
  for(const [source,error] of [[{},'Checked machine source is unavailable.'],[{program:{},programError:'SYNTHETIC byte mismatch'},'SYNTHETIC byte mismatch']]){
    const bundle={async loadBundle(directory,read){return read.program===false?{planHash:'locked'}:source;},async generateBundle(directory,write){assert.equal(write.development,false);return {};}};
    assert.deepEqual(await generateMessage({type:'generate',development:'true'},ready,bundle,settings()),{type:'generated',error,code:undefined});
  }
  assert.equal(await generateMessage({type:'unrelated'},new Promise(()=>{}),{},settings()),undefined,'unrelated messages neither wait nor access the bundle');
});

test('preparation succeeds without persisting output and progress keeps stage/percent throttling and cancellation',async()=>{
  const options=settings(),messages=[],report=createProgressReporter({postMessage:message=>messages.push(message)},options.control,true),calls=[];
  const bundle={async loadBundle(directory,read){calls.push(['load',directory,read]);return {planHash:'locked'};},async checkPathBundle(directory,{onProgress}){calls.push(['check',directory]);onProgress({stage:'Checking',completed:1,total:100});},async generateBundle(){assert.fail('preparation must not persist');}};
  const preparation=await prepareGeneration(bundle,{...options,onProgress:report});
  assert.deepEqual(preparation,{notification:{type:'prepared'},error:null});
  assert.deepEqual(calls,[['load','part',{program:false}],['check','part']]);
  report({stage:'Checking',completed:1.9,total:100});report({stage:'Checking',completed:2,total:100});
  report({stage:'Writing',completed:2,total:100});report({stage:'Unknown',completed:0,total:0});report({stage:'Unknown',completed:1,total:0});
  assert.deepEqual(messages.map(m=>[m.type,m.progress.stage,m.progress.completed]),[['progress','Checking',1],['progress','Checking',2],['progress','Writing',2],['progress','Unknown',0]]);
  options.control.cancel();assert.throws(()=>report({stage:'Unknown',completed:1,total:0}),{code:'GENERATION_CANCELLED'});
  assert.equal(createProgressReporter({},options.control,false),undefined);
});
