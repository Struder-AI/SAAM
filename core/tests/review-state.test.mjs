import './temporary-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {lifecycleReview} from '../print/review-state.mjs';
import {studioControls} from '../../studio/studio-controls.mjs';
import {summary as applicationSummary} from '../application/runtime.mjs';

const state=(overrides={})=>({
  dir:'Prints/example',kind:'shell',revision:'revision',geometryId:'geometry',geometryInputId:'geometry',
  plan:{geometry:{shape:'shell'},output:'gcode'},geometry:{boundsMm:{}},
  machine:{id:'machine',name:'Machine'},skills:[],limitations:[],
  review:{generation:null},program:undefined,programError:undefined,
  outputAvailability:null,...overrides
});
const ui={tab:'toolpath',busy:false,generating:false,staleProgram:null,tourActive:false,
  exported:false,currentExportKey:null,inspection:null,machineView:null,pending:false};

test('review projection covers unchecked, unavailable, development, production and failed output',()=>{
  const cases=[
    ['no output',state(),{current:false,productionReady:false,action:'generate'}],
    ['output unavailable',state({outputAvailability:'Machine output unavailable.'}),{current:false,productionReady:false,action:'generate'}],
    ['development',state({program:{},review:{generation:{mode:'development'}}}),{current:true,productionReady:false,action:'generate'}],
    ['production',state({program:{},review:{generation:{mode:'production'}}}),{current:true,productionReady:true,action:'review'}],
    ['failed read',state({programError:'Program unreadable.',review:{generation:{mode:'production'}}}),{current:false,productionReady:false,action:'generate'}]
  ];
  for(const [name,input,expected] of cases)assert.deepEqual(lifecycleReview(input),{programChecked:true,...expected},name);
  assert.deepEqual(lifecycleReview(cases[3][1],{programChecked:false}),
    {programChecked:false,current:null,productionReady:false,action:'check'});
});

test('Studio and application consume the same checked lifecycle decisions',()=>{
  const ready=state({program:{summary:{moves:10}},review:{generation:{mode:'production'}},
    completedOutput:{current:true,geometryInputId:'geometry',review:{generation:{mode:'production'}}}});
  const projected=lifecycleReview(ready);
  const controls=studioControls(ready,ui);
  const application=applicationSummary('example',ready);
  assert.equal(controls.flags.productionReady,projected.productionReady);
  assert.equal(application.generation.current,projected.current);
  assert.match(application.nextStep,/exports from Studio/);

  const uncheckedApplication=applicationSummary('example',{...ready,programChecked:false});
  assert.equal(uncheckedApplication.generation.current,null);
  assert.match(uncheckedApplication.nextStep,/check the current export/);
});
