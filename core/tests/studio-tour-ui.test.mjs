import test from 'node:test';
import assert from 'node:assert/strict';
import {createTourUI,needsTourToolpath} from '../../studio/tour-ui.mjs';

test('tour recipe edits trigger generation only for the selected confirmed toolpath lesson',()=>{
  const state={tour:{active:true,step:4,directory:'part'},localPrintDirectory:'part',geometryApproved:true};
  assert.equal(needsTourToolpath(state),true);
  for(const patch of [{program:{}},{geometryApproved:false},{generationError:'Failed'},
    {localPrintDirectory:'another'},{tour:{...state.tour,step:3}},{tour:{...state.tour,active:false}}])
    assert.equal(needsTourToolpath({...state,...patch}),false);
  assert.equal(needsTourToolpath({...state,program:{},programError:'Stale export'}),true);
});

test('Tour opens lesson one directly; only Resume tour continues saved progress',async t=>{
  const saved={document:globalThis.document,fetch:globalThis.fetch,setInterval:globalThis.setInterval};
  t.after(()=>Object.assign(globalThis,saved));
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);};
  globalThis.document={getElementById:element,addEventListener(){}};
  globalThis.setInterval=()=>0;
  let progress={active:false,step:0,completed:false};
  globalThis.fetch=async()=>({ok:true,json:async()=>progress});
  const actions=[];
  const ui=createTourUI({state:()=>null,working:async(_text,task)=>task(),
    post:async(_route,data)=>actions.push(data),refresh:async()=>{}});
  await ui.load();await element('tour-toggle').onclick();
  progress={...progress,step:5};await ui.load();await element('tour-resume').onclick();
  await element('tour-toggle').onclick();
  progress={...progress,completed:true};await ui.load();await element('tour-toggle').onclick();
  assert.deepEqual(actions,[{action:'fresh',step:0},{action:'resume',step:5},{action:'fresh',step:0},{action:'fresh',step:0}]);
});

test('tour cues follow their lessons and Exit dismisses congratulations while retaining completion',async t=>{
  const saved={document:globalThis.document,fetch:globalThis.fetch,setInterval:globalThis.setInterval};
  t.after(()=>Object.assign(globalThis,saved));
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id)){const classes=new Set();elements.set(id,{classes,textContent:'',parentElement:{dataset:{}},querySelectorAll:()=>[],
      classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),toggle:(name,on)=>on?classes.add(name):classes.delete(name)}});}
    return elements.get(id);
  };
  globalThis.document={getElementById:element,querySelectorAll:()=>[],addEventListener(){}};
  globalThis.setInterval=()=>0;
  let progress={active:false,step:0,directory:'part',canNext:false};
  const state={tour:progress,localPrintDirectory:'part',printId:'part'};
  globalThis.fetch=async()=>({ok:true,json:async()=>progress});
  let ui,shown;
  ui=createTourUI({state:()=>state,isBusy:()=>false,working:async(_text,task)=>task(),setTab(tab){shown=tab;},
    post:async(_route,data)=>{assert.equal(data.action,'exit');progress={...progress,active:false,dismissed:true};},
    refresh:async()=>ui.render(state)});
  ui.render(state);assert.equal(element('tour-panel').hidden,true,'idle Studio has no introductory pane');
  assert.equal(element('tour-resume').hidden,true);
  state.tour=progress={...progress,selected:'handle',step:1};ui.render(state);
  assert.equal(element('tour-panel').hidden,true,'paused tour keeps the part visible without an introductory pane');
  assert.equal(element('tour-resume').hidden,false);
  state.tour=progress={...progress,active:true,step:0};ui.render(state);await Promise.resolve();
  assert.equal(shown,'geometry');assert.equal(element('tour-lesson').hidden,false);
  assert.equal(element('tour-complete').hidden,true);
  await element('tour-toggle').onclick();assert.equal(element('tour-panel').hidden,true);
  await element('tour-toggle').onclick();assert.equal(element('tour-panel').hidden,false);
  state.tour=progress={...progress,step:2};ui.render(state);assert.ok(element('canvas').classes.has('tour-faded'));
  state.tour=progress={...progress,step:3};ui.render(state);
  assert.ok(!element('canvas').classes.has('tour-faded'));
  for(const id of ['import-stl','tour-next'])assert.ok(element(id).classes.has('tour-choice'));
  for(const id of ['import-stl','tour-next'])assert.ok(element(id).classes.has('tour-highlight'),'both paths blink');
  state.tour=progress={...progress,step:7,active:false,completed:true};ui.render(state);
  assert.equal(element('tour-exit').hidden,false);assert.equal(element('tour-panel').hidden,false);
  assert.equal(element('tour-complete').hidden,false);assert.equal(element('tour-lesson').hidden,true);
  for(const id of ['import-stl','tour-next'])assert.ok(!element(id).classes.has('tour-choice'));
  await element('tour-exit').onclick();
  assert.equal(element('tour-panel').hidden,true);assert.equal(state.tour.completed,true);
  ui.render(state);assert.equal(element('tour-panel').hidden,true,'later updates do not reopen the dismissed panel');
});

test('playback leaves geometry before a program exists, seeks when ready, and retains generation errors',async t=>{
  const saved={document:globalThis.document,fetch:globalThis.fetch,setInterval:globalThis.setInterval};
  t.after(()=>Object.assign(globalThis,saved));
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{textContent:'',parentElement:{dataset:{}},querySelectorAll:()=>[],classList:{add(){},remove(){},toggle(){}}});
    return elements.get(id);
  };
  globalThis.document={getElementById:element,querySelectorAll:()=>[],addEventListener(){}};
  globalThis.setInterval=()=>0;
  let progress={active:true,step:4,directory:'part',startAt:{layer:12},canNext:false};
  const state={tour:progress,localPrintDirectory:'part',printId:'part',tourExample:{}};
  let shown='geometry',seeks=0,ui;
  globalThis.fetch=async()=>({ok:true,json:async()=>progress});
  ui=createTourUI({state:()=>state,isBusy:()=>false,working:async(_text,task)=>task(),
    post:async()=>{throw Error('Concrete generation failure');},
    refresh:async()=>{state.tour=progress;ui.render(state);},setTab:tab=>{shown=tab;},seek:()=>seeks++});
  ui.render(state);await Promise.resolve();
  assert.equal(shown,'toolpath');assert.equal(seeks,0);
  assert.match(element('tour-status').textContent,/Preparing.*toolpath/);
  state.program={};ui.render(state);await Promise.resolve();assert.equal(seeks,1);
  ui.render(state);await Promise.resolve();assert.equal(seeks,1,'rerenders do not reset playback');
  delete state.program;
  state.tour={...progress,step:3};ui.render(state);await Promise.resolve();
  assert.equal(shown,'geometry');
  await element('tour-next').onclick();await Promise.resolve();
  assert.equal(shown,'toolpath');
  assert.equal(element('tour-status').textContent,'Concrete generation failure');
  ui.render(state);await Promise.resolve();
  assert.equal(element('tour-status').textContent,'Concrete generation failure');
  progress={active:false,completed:true};await ui.load();
  assert.equal(state.tour.completed,true,'completion updates the panel without reloading the source');
});
