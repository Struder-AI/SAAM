import test from 'node:test';
import assert from 'node:assert/strict';
import {attachOverviewAnchors,structuralOverview} from '../lib/overview.mjs';
import {composePages} from '../lib/composition.mjs';
import {compactPage} from '../lib/agent-view.mjs';

test('structural overview follows parent group boundaries and retains every relation count',()=>{
  const region={index:'1',path:'core/one',kind:'region',structural:true,components:[{index:'1.0.2',label:'Producer'}],
    inputs:[{port:'ext',path:'core/two/work.mjs::run',index:'2.1.1'}],outputs:[],wires:[]};
  const group={index:'1.0.1',parent:'1',kind:'group',structural:true,components:[{index:'1.1.1',callerReferences:[{index:'1.1.2'}]}],
    inputs:[{port:'a',parentEndpoint:'1.0.2'},{port:'b',parentEndpoint:'1.0.2'},{port:'c',parentEndpoint:'ext'}],outputs:[],
    wires:[{from:'a',to:'1.1.1',kind:'call',edgeId:'a'}, {from:'b',to:'1.1.1',kind:'call',edgeId:'b'},
      {from:'c',to:'1.1.1',kind:'construct',edgeId:'c'}, {from:'a',to:'1.1.1',kind:'worker-message',label:'ready'},
      {from:'b',to:'1.1.1',kind:'worker-message',label:'stop'}]};
  const target={index:'2.1.1',file:'core/two/work.mjs'},outside={index:'2',path:'core/two',kind:'region'};
  const pages=new Map([region,group,target,outside].map(p=>[p.index,p]));
  attachOverviewAnchors(pages,new Map());
  assert.deepEqual(group.inputs[0].overviewAnchor,{index:'1.0.2',name:'Producer'});
  assert.deepEqual(group.inputs[2].overviewAnchor,{index:'2',name:'core/two'});
  const before=structuredClone(group),shown=structuralOverview(group);
  assert.deepEqual(group,before);
  assert.equal(shown.inputs.length,2);assert.equal(shown.wires.length,4);
  assert.equal(shown.wires.reduce((n,w)=>n+w.count,0),group.wires.length);
  assert.equal(shown.wires[0].count,2);assert.equal(shown.components[0].callerReferences,undefined);
  assert.equal(compactPage(group).relationshipSummary.sites,5);
  assert.ok(shown.wires.some(w=>w.label==='worker-message: ready'));
  assert.ok(shown.wires.some(w=>w.label==='worker-message: stop'));
});

test('function data flows are never collapsed by overview summarization',()=>{
  const page={kind:'function',wires:[{from:'a',to:'b',kind:'data',label:'first'},{from:'a',to:'b',kind:'data',label:'second'}]};
  assert.equal(structuralOverview(page),page);
});

test('module-only files remain composable, source addressed and connected by recorded module calls',()=>{
  const page={index:'1',kind:'region',path:'studio',files:['studio/worker.mjs','studio/run.mjs'],components:[]};
  const node={path:'studio/run.mjs::run',file:'studio/run.mjs',line:1,endLine:3};
  const context={model:{nodes:[node],calls:[{fromFile:'studio/worker.mjs',to:node,relation:{kind:'call'},line:2}],couplings:[],fileLines:new Map([['studio/worker.mjs',9]])},
    index:new Map([['studio/run.mjs::run','1.2.1'],['studio/worker.mjs','1.1']]),packets:new Map()};
  const result=composePages(new Map([['studio',page]]),{schema:1,flows:[{path:'studio',groups:[{id:'generation',members:['studio/worker.mjs','studio/run.mjs']}]}]},context);
  const child=result.groupPages.get('1.0.1'),worker=child.components.find(c=>c.moduleOnly);
  assert.equal(worker.path,'studio/worker.mjs');assert.equal(worker.endLine,9);
  assert.ok(child.codeTargets.includes('studio/worker.mjs'));
  assert.ok(child.wires.some(w=>w.from==='1.1'&&w.to==='1.2.1'));
});
