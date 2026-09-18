import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createTourUI,needsTourToolpath} from '../../studio/tour-ui.mjs';
import {TOUR_LESSONS,TOUR_STEPS} from '../../studio/tour-catalog.mjs';

test('tour UI teaches toolpath changes without suggesting geometry',async()=>{
  const visibleCopy=TOUR_STEPS.flatMap(step=>[step.title,step.body,step.try]).join(' ');
  assert.doesNotMatch(visibleCopy,/\binfill\b/i);
  const lesson=TOUR_STEPS[TOUR_LESSONS.settings];
  assert.match(lesson.title,/change how this part prints/i);
  assert.match(lesson.body,/toolpath decides how it is built/i);
  assert.match(lesson.body,/strength, finish, print time or material use/i);
  assert.doesNotMatch(lesson.body+' '+lesson.try,/geometry|shape change/i);
  const css=await readFile(new URL('../../studio/style.css',import.meta.url),'utf8');
  assert.match(css,/#import-stl\.tour-choice\{background:#f7f8fb/);
  assert.doesNotMatch(css,/#tour-next\.tour-choice\{background:/,'Continue retains the primary orange button style');
});

for(const lesson of [4,5,6,7])test('toolpath lesson '+lesson+' never pauses for geometry confirmation',async t=>{
  const saved={document:globalThis.document,setInterval:globalThis.setInterval};
  t.after(()=>Object.assign(globalThis,saved));
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{textContent:'',parentElement:{dataset:{}},querySelectorAll:()=>[],classList:{add(){},remove(){},toggle(){}}});
    return elements.get(id);
  };
  globalThis.document={getElementById:element,querySelectorAll:()=>[],addEventListener(){}};
  globalThis.setInterval=()=>0;
  const state={localPrintDirectory:'part',printId:'part',programError:'Old toolpath is stale',
    tour:{active:true,directory:'part',step:lesson,canNext:true,gates:{}}};
  let shown;
  const ui=createTourUI({state:()=>state,isBusy:()=>false,setTab:tab=>{shown=tab;},seek:()=>({layer:1})});
  ui.render(state);await Promise.resolve();
  assert.equal(shown,'toolpath');assert.equal(needsTourToolpath(state),true);
  assert.match(element('tour-status').textContent,/Old toolpath is stale/);
  assert.equal(element('tour-next').disabled,false);assert.equal(element('tour-back').disabled,false);
  delete state.programError;
  state.program={};ui.render(state);await Promise.resolve();
  assert.equal(shown,'toolpath');assert.equal(needsTourToolpath(state),false);
  assert.equal(element('tour-next').disabled,false);
});

test('tour recipe edits trigger generation for the selected toolpath lesson',()=>{
  const state={tour:{active:true,step:4,directory:'part'},localPrintDirectory:'part'};
  assert.equal(needsTourToolpath(state),true);
  for(const patch of [{program:{}},{generationError:'Failed'},
    {outputAvailability:'Machine setup required'},
    {localPrintDirectory:'another'},{tour:{...state.tour,step:3}},{tour:{...state.tour,active:false}}])
    assert.equal(needsTourToolpath({...state,...patch}),false);
  assert.equal(needsTourToolpath({...state,program:{},programError:'Stale export'}),true);
  const request={kind:'edit',status:'working',printId:'part',requiresTarget:true,expiresAt:Date.now()+60000};
  const work={printId:'part',snapshot:{inputKey:'saved'},requests:[request]};
  assert.equal(needsTourToolpath({...state,work}),false,'intermediate saves do not start slicing');
  work.requests=[{...request,target:{inputKey:'saved',stage:'toolpath'}}];
  assert.equal(needsTourToolpath({...state,work}),true,'publishing the intended saved inputs releases generation');
});

test('Tour always starts lesson one outside an active run and exposes no resume control',async t=>{
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
  progress={...progress,step:5};await ui.load();assert.equal(elements.has('tour-resume'),false);
  await element('tour-toggle').onclick();
  progress={...progress,completed:true};await ui.load();await element('tour-toggle').onclick();
  assert.deepEqual(actions,[{action:'fresh',step:0},{action:'fresh',step:0},{action:'fresh',step:0}]);
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
  state.tour=progress={...progress,selected:'handle',step:1};ui.render(state);
  assert.equal(element('tour-panel').hidden,true,'inactive tour keeps the part visible without an introductory pane');
  assert.equal(elements.has('tour-resume'),false);
  state.tour=progress={...progress,active:true,step:0};ui.render(state);await Promise.resolve();
  assert.equal(shown,'geometry');assert.equal(element('tour-lesson').hidden,false);
  assert.equal(element('tour-complete').hidden,true);
  await element('tour-toggle').onclick();assert.equal(element('tour-panel').hidden,true);
  await element('tour-toggle').onclick();assert.equal(element('tour-panel').hidden,false);
  state.tour=progress={...progress,step:2};ui.render(state);assert.ok(element('canvas').classes.has('tour-faded'));
  state.tour=progress={...progress,step:3};ui.render(state);
  assert.ok(!element('canvas').classes.has('tour-faded'));
  assert.equal(element('import-stl').disabled,true,'tour points out import without enabling it');
  for(const id of ['import-stl','tour-next'])assert.ok(element(id).classes.has('tour-choice'));
  for(const id of ['import-stl','tour-next'])assert.ok(element(id).classes.has('tour-highlight'),'both paths blink');
  element('import-stl').onpointerenter();
  assert.ok(!element('import-stl').classes.has('tour-highlight'),'hover retires the import cue');
  assert.ok(element('tour-next').classes.has('tour-highlight'),'Continue remains the only blinking cue');
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

for(const startAt of [null,{layer:999}])for(const fallbackLayer of [1,0])test((startAt?'unavailable':'missing')+' agent layer uses fallback playback without a late jump (resolved layer '+fallbackLayer+')',async t=>{
  const saved={document:globalThis.document,setInterval:globalThis.setInterval};
  t.after(()=>Object.assign(globalThis,saved));
  const elements=new Map(),seeks=[],requests=[],tabs=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{textContent:'',parentElement:{dataset:{}},querySelectorAll:()=>[],classList:{add(){},remove(){},toggle(){}}});
    return elements.get(id);
  };
  globalThis.document={hidden:false,getElementById:element,querySelectorAll:()=>[],addEventListener(){}};
  globalThis.setInterval=()=>0;
  const state={localPrintDirectory:'part',printId:'part',program:{},tour:{active:true,directory:'part',step:4,startAt,gates:{}}};
  const ui=createTourUI({state:()=>state,isBusy:()=>false,setTab:tab=>tabs.push(tab),
    seek:startAt=>{seeks.push(startAt);if(startAt.layer===999)throw Error('No sparse infill here');return {layer:startAt.fallback?fallbackLayer:startAt.layer};},
    post:async(route,data)=>{requests.push({route,...data});return {json:async()=>state.tour};}});
  ui.render(state);await Promise.resolve();
  assert.deepEqual(seeks,[...(startAt?[startAt]:[]),{layer:1,fallback:true}],'human layer 2 is zero-based layer 1');
  const initialSeeks=seeks.length;
  assert.match(element('tour-status').textContent,/Press Play/);
  await ui.playback('play');
  assert.deepEqual(requests,[{route:'tour-playback',event:'play'}],
    'the first Play is the only event needed to unlock the lesson');
  state.tour={...state.tour,startAt:{layer:12}};ui.render(state);await Promise.resolve();
  assert.equal(seeks.length,initialSeeks,'late agent layer does not move playback after Play');
  assert.equal(tabs.length,1,'late layer does not reset the playing viewer through setTab');
  await ui.playback('pause');state.tour={...state.tour,startAt:{layer:18}};ui.render(state);await Promise.resolve();
  assert.equal(seeks.length,initialSeeks,'pausing after the first Play does not reopen automatic seeking');
});

test('browser fallback seeks deposited layer 2 or the only layer while explicit agent layers require sparse infill',async()=>{
  const app=await readFile(new URL('../../studio/app.mjs',import.meta.url),'utf8');
  const registration=app.slice(app.indexOf('tourUI=createTourUI('),app.indexOf("\nworking('Opening Studio"));
  const scrub={},noop=()=>{},context=vm.createContext({createTourUI:({seek})=>seek,
    api:noop,refresh:noop,working:noop,setTab:noop,stop:noop,layerFade:{reset:noop},requestDraw:noop,$:()=>scrub,
    state:{program:{moves:[{layer:1,extruding:false,startSeconds:0},
      {layer:0,extruding:true,operation:'walls',startSeconds:1},
      {layer:1,extruding:true,operation:'solid-infill',startSeconds:4},
      {layer:1,extruding:true,operation:'planar-infill',startSeconds:8}]}}});
  vm.runInContext(registration,context);
  assert.equal(context.tourUI({layer:1,fallback:true}).layer,1);
  assert.equal(scrub.value,4,'fallback starts at solid deposited material on human layer 2');
  assert.equal(context.tourUI({layer:1}).layer,1);assert.equal(scrub.value,8,'explicit choice skips solid infill');
  context.state.program.moves=context.state.program.moves.slice(0,3);
  assert.throws(()=>context.tourUI({layer:1}),/no sparse infill/);
  context.state.program.moves=[{layer:0,extruding:true,operation:'walls',startSeconds:2}];
  assert.equal(context.tourUI({layer:1,fallback:true}).layer,0);assert.equal(scrub.value,2,'single-layer print remains playable');
});

test('edit cues are limited to the first two slides and Play stops blinking on first use',async t=>{
  const saved={document:globalThis.document,setInterval:globalThis.setInterval};
  t.after(()=>Object.assign(globalThis,saved));
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id)){const classes=new Set();elements.set(id,{id,classes,parentElement:{dataset:{}},querySelectorAll:()=>[],
      classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),toggle:(name,on)=>on?classes.add(name):classes.delete(name)}});}
    return elements.get(id);
  };
  globalThis.document={getElementById:element,addEventListener(){},querySelectorAll:selector=>selector==='.tour-highlight'?[...elements.values()].filter(e=>e.classes.has('tour-highlight')):[]};
  globalThis.setInterval=()=>0;
  const state={localPrintDirectory:'part',printId:'part',program:{},tour:{active:true,directory:'part',step:0,canNext:false,gates:{}}};
  const ui=createTourUI({state:()=>state,isBusy:()=>false,setTab(){},seek(){},post:async()=>({json:async()=>state.tour})});
  const highlighted=id=>element(id).classes.has('tour-highlight');
  ui.render(state);assert.equal(highlighted('tour-next'),false);
  state.tour.canNext=true;state.tour.gates[0]=true;ui.render(state);assert.equal(highlighted('tour-next'),true);
  state.tour.step=1;ui.render(state);assert.equal(element('tour-next').disabled,false);assert.equal(highlighted('tour-next'),false);
  ui.activity(true);assert.equal(element('tour-next').disabled,true,'locks in the same update as dots/fade');
  state.tour.gates[1]=true;ui.render(state);assert.equal(highlighted('tour-next'),false,'a saved result still loading must not blink');
  ui.activity(false);assert.equal(element('tour-next').disabled,false);assert.equal(highlighted('tour-next'),true);
  state.tour.step=2;ui.render(state);assert.equal(highlighted('tour-next'),false);
  state.tour.step=3;ui.render(state);
  assert.equal(element('tour-next').textContent,'Continue with this part');
  assert.equal(element('import-stl').disabled,true);
  assert.equal(highlighted('import-stl'),true);assert.equal(highlighted('tour-next'),true);
  element('import-stl').onpointerenter();
  assert.equal(highlighted('import-stl'),false);assert.equal(highlighted('tour-next'),true);
  state.tour.step=4;state.tour.startAt={layer:12};ui.render(state);await Promise.resolve();
  assert.equal(highlighted('play'),true);
  await ui.playback('play');assert.equal(highlighted('play'),false);
  await ui.playback('pause');ui.render(state);assert.equal(highlighted('play'),false,'pausing does not restart the cue');
  state.tour.step=5;state.tour.gates[5]=true;ui.render(state);assert.equal(highlighted('tour-next'),false);
});
