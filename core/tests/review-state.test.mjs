import test from 'node:test';
import assert from 'node:assert/strict';
import {lifecycleReview} from '../print/review-state.mjs';
import {studioControls} from '../../studio/studio-controls.mjs';
import {printSummary} from '../agent/toolkit.mjs';
import {summary as mcpSummary} from '../../adapters/mcp/src/runtime.mjs';

const state=(overrides={})=>({
  dir:'Prints/example',kind:'shell',revision:'revision',geometryHash:'geometry',
  plan:{geometry:{shape:'shell'},output:'gcode'},geometry:{boundsMm:{}},
  machine:{id:'machine',name:'Machine'},skills:[],limitations:[],
  review:{generation:null,approvals:{}},program:undefined,programError:undefined,
  toolpathApproved:false,outputAvailability:null,...overrides
});
const ui={tab:'toolpath',busy:false,generating:false,staleProgram:null,tourActive:false,
  exported:false,currentExportKey:null,inspection:null,machineView:null,pending:false};

test('review projection covers unchecked, unavailable, development, production, approval and stale output',()=>{
  const cases=[
    ['no output',state(),{current:false,productionReady:false,toolpathApproved:false,action:'generate'}],
    ['output unavailable',state({outputAvailability:'Machine output unavailable.'}),{current:false,productionReady:false,toolpathApproved:false,action:'generate'}],
    ['development',state({program:{},review:{generation:{mode:'development'},approvals:{}}}),{current:true,productionReady:false,toolpathApproved:false,action:'generate'}],
    ['production',state({program:{},review:{generation:{mode:'production'},approvals:{}}}),{current:true,productionReady:true,toolpathApproved:false,action:'review'}],
    ['approved',state({program:{},toolpathApproved:true,review:{generation:{mode:'production'},approvals:{toolpath:{hash:'exact'}}}}),{current:true,productionReady:true,toolpathApproved:true,action:'deliver'}],
    ['stale bytes',state({programError:'Generated files changed.',review:{generation:{mode:'production'},approvals:{toolpath:{hash:'old'}}}}),{current:false,productionReady:false,toolpathApproved:false,action:'generate'}]
  ];
  for(const [name,input,expected] of cases)assert.deepEqual(lifecycleReview(input),{programChecked:true,...expected},name);
  assert.deepEqual(lifecycleReview(cases[4][1],{programChecked:false}),
    {programChecked:false,current:null,productionReady:false,toolpathApproved:null,action:'check'});
});

test('Studio, toolkit and MCP consume the same checked lifecycle decisions',()=>{
  const approved=state({program:{summary:{moves:10}},toolpathApproved:true,
    review:{generation:{mode:'production'},approvals:{toolpath:{hash:'exact'}}}});
  const projected=lifecycleReview(approved);
  const controls=studioControls(approved,ui);
  const toolkit=printSummary(approved);
  const mcp=mcpSummary('example',approved);
  assert.equal(controls.flags.productionReady,projected.productionReady);
  assert.equal(controls.flags.approved,projected.toolpathApproved);
  assert.equal(toolkit.toolpathApproved,projected.toolpathApproved);
  assert.equal(toolkit.generation.current,projected.current);
  assert.equal(mcp.toolpathApproved,projected.toolpathApproved);
  assert.equal(mcp.generation.current,projected.current);
  assert.equal(mcp.nextStep,'Deliver the reviewed export.');

  const uncheckedToolkit=printSummary(approved,{programChecked:false});
  const uncheckedMcp=mcpSummary('example',{...approved,programChecked:false});
  assert.equal(uncheckedToolkit.toolpathApproved,null);
  assert.equal(uncheckedToolkit.generation.current,null);
  assert.equal(uncheckedMcp.toolpathApproved,null);
  assert.equal(uncheckedMcp.generation.current,null);
  assert.match(uncheckedMcp.nextStep,/check the current export/);
});
