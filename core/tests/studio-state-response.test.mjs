import test from 'node:test';
import assert from 'node:assert/strict';
import {composeStudioState} from '../../studio/state-response.mjs';
import {workSnapshot} from '../../studio/agent-requests.mjs';
import {TOUR_LESSONS as L} from '../../studio/tour-catalog.mjs';

const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const state=()=>({plan:{geometry:{shape:'box'}},machine:{name:'Test'},review:{history:[{event:'generated',generationHash:'old'}]},generationHash:'plan',exportName:'old.gcode.3mf',code:'private code',dir:'private dir',generationError:'existing notice'});
const facts=(patch={})=>({directory:'/prints/part',printId:'opaque-id',workId:'part',instanceId:'instance',
  guide:{active:true,directory:'/prints/part',step:L.import},records:[],importRepair:{method:'checked'},
  printName:'Part: one',fingerprint:'source-view',presentationFingerprint:'review-view',now:100,...patch});

test('Studio response is assembled without mutating loader state or acquired facts',()=>{
  const input=freeze(state()),record=freeze({id:'request',printId:'part',status:'completed'}),acquired=freeze(facts({records:[record,{id:'other',printId:'other'}]}));
  const before=JSON.stringify({input,acquired}),{response,preparation}=composeStudioState(input,acquired);
  assert.notEqual(response,input);assert.equal(response.code,undefined);assert.equal(response.dir,undefined);
  assert.equal(input.code,'private code');assert.equal(response.plan,input.plan);assert.equal(response.review,input.review);
  assert.equal(response.tour,acquired.guide);assert.equal(response.importRepair,acquired.importRepair);
  assert.equal(response.localPrintDirectory,acquired.directory);assert.equal(response.printId,'opaque-id');
  assert.equal(response.printName,'Part: one');assert.equal(response.downloadName,'Part- one.gcode.3mf');
  assert.equal(response.fingerprint,'source-view');assert.equal(response.presentationFingerprint,'review-view');
  assert.deepEqual(response.work,{printId:'part',snapshot:{...workSnapshot(input),studioInstanceId:'instance'},requests:[record]});
  assert.equal(response.generationError,'existing notice');assert.equal(response.generationCancelled,false);
  assert.equal(preparation.state,response);assert.equal(preparation.directory,acquired.directory);
  assert.equal(JSON.stringify({input,acquired}),before);
});

test('generation feedback applies only to the corresponding print and plan',()=>{
  const input=freeze(state()),failure={directory:'/prints/part',generationHash:'plan',message:'failed generation'},cancelled={directory:'/prints/part',generationHash:'plan'};
  const failed=composeStudioState(input,freeze(facts({generationFailure:failure,generationCancelled:cancelled})));
  assert.equal(failed.response.generationError,'failed generation');assert.equal(failed.response.generationCancelled,true);assert.equal(failed.preparation,null);
  const completed=composeStudioState(freeze({...input,program:{moves:[]}}),facts({generationFailure:failure}));
  assert.equal(completed.response.generationError,'existing notice','completed source suppresses this generation failure');
  for(const mismatch of [{...failure,directory:'/prints/other'},{...failure,generationHash:'other'}]){
    const result=composeStudioState(input,facts({generationFailure:mismatch,generationCancelled:mismatch}));
    assert.equal(result.response.generationError,'existing notice');assert.equal(result.response.generationCancelled,false);
  }
});

test('preparation intent preserves tour, edit and explicit-time gates',()=>{
  const input=freeze(state()),working={id:'edit',printId:'part',kind:'edit',status:'working',expiresAt:200,presented:false};
  assert.equal(composeStudioState(input,facts({records:[working],now:100})).preparation,null);
  assert.ok(composeStudioState(input,facts({records:[working],now:201})).preparation,'expired work does not hold preparation');
  const matched={...working,target:{inputKey:workSnapshot(input).inputKey}};
  assert.ok(composeStudioState(input,facts({records:[matched]})).preparation,'a published matching target does not hold preparation');
  for(const guide of [{active:false},{active:true,directory:'/prints/other',step:L.import},{active:true,directory:'/prints/part',step:L.playback}])
    assert.equal(composeStudioState(input,facts({guide})).preparation,null);
  const outside=composeStudioState(input,facts({workId:null,records:[working]}));
  assert.equal(outside.response.work.printId,'opaque-id');assert.deepEqual(outside.response.work.requests,[]);
});
