import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {startupHarness} from './studio-startup-harness.mjs';
import {loadFlow,flowPacket} from '../../dev-map/lib/flow.mjs';

const source=await readFile(new URL('../../studio/app.mjs',import.meta.url),'utf8');
const count=(h,name)=>h.trace.filter(event=>event[0]===name).length;
const timeouts=h=>[...h.timers.values()].filter(timer=>!timer.interval);

test('startup preserves registration order and starts exactly one preparation and revision heartbeat',async()=>{
  const h=startupHarness(source);await h.settle();
  assert.deepEqual(h.trace,[
    ['agent-ui'],['listen','window','pagehide'],['interval',250],
    ['tour-ui'],['working','Opening Studio…'],['tour-load'],
    ['listen','window','saam-studio-change'],['listen','window','saam-viewer-connection'],
    ['listen','document','visibilitychange'],['interval',15000],
    ['listen','window','pagehide'],['listen','window','pageshow'],['refresh']
  ]);
  h.tick(250);h.tick(15000);
  assert.equal(count(h,'poll-preparation'),1);assert.equal(count(h,'poll'),1);
});

test('change delivery filters inactive request changes and debounces until the current work settles',async()=>{
  const h=startupHarness(source);await h.settle();h.trace.length=0;
  h.emit('window','saam-studio-change',{detail:{kinds:['requests']}});
  assert.equal(timeouts(h).length,0);
  h.emit('window','saam-studio-change',{detail:{kinds:['print']}});
  h.emit('window','saam-studio-change',{detail:{kinds:['tour']}});
  assert.equal(timeouts(h).length,1);assert.equal(timeouts(h)[0].ms,75);
  h.context.busy=true;h.tick(75);assert.equal(count(h,'poll'),0);assert.equal(timeouts(h).length,1);
  h.context.busy=false;h.context.polling=true;h.tick(75);assert.equal(count(h,'poll'),0);
  h.context.polling=false;h.tick(75);assert.equal(count(h,'poll'),1);assert.equal(timeouts(h).length,0);
  h.context.state.tour.active=true;
  h.emit('window','saam-studio-change',{detail:{kinds:['requests']}});h.tick(75);
  assert.equal(count(h,'poll'),2);
  h.context.document.visibilityState='hidden';h.emit('document','visibilitychange');
  assert.equal(timeouts(h).length,0);
  h.context.document.visibilityState='visible';h.emit('document','visibilitychange');
  h.emit('window','saam-viewer-connection');assert.equal(timeouts(h).length,1);
  h.tick(75);assert.equal(count(h,'poll'),3);
});

test('page hiding saves the view before disposing its session; only persisted restoration refreshes',async()=>{
  const h=startupHarness(source);await h.settle();h.trace.length=0;
  h.emit('window','pagehide');assert.deepEqual(h.trace,[['save-view'],['dispose']]);
  h.trace.length=0;h.emit('window','pageshow',{persisted:false});await h.settle();
  assert.deepEqual(h.trace,[]);
  h.emit('window','pageshow',{persisted:true});await h.settle();
  assert.deepEqual(h.trace,[['working','Restoring your print…'],['refresh',false,true]]);
  assert.equal([...h.timers.values()].filter(timer=>timer.interval).length,2,'restoration must not install a second lifecycle');
});

test('failed initial tour load reports its error without refreshing or losing reconnect handlers',async()=>{
  const h=startupHarness(source,{loadError:'load failed'});await h.settle();
  assert.equal(count(h,'refresh'),0);
  assert.deepEqual(h.trace.filter(e=>e[0]==='message'),[['message','load failed',true]]);
  h.emit('window','saam-viewer-connection');h.tick(75);assert.equal(count(h,'poll'),1);
});

test('agent callbacks keep reading current state and stage after initialization',async()=>{
  const h=startupHarness(source);await h.settle();h.trace.length=0;
  h.controls.agent.onActivity(true);assert.deepEqual(h.trace,[['activity',true]]);
  const requests=[{id:'current'}];h.context.needsTourToolpath=()=>true;
  h.controls.agent.onRequests(requests);
  assert.equal(h.context.state.work.requests,requests);assert.equal(timeouts(h).length,1);
  h.context.tab='toolpath';assert.equal(h.controls.agent.getStage(),'toolpath');
  let acknowledged=0;h.context.acknowledgeDisplayedView=async()=>{acknowledged++;};
  h.context.busy=true;h.controls.agent.onPresentation();assert.equal(acknowledged,0);
  h.context.busy=false;h.controls.agent.onPresentation();assert.equal(acknowledged,1);
  h.context.state=null;assert.doesNotThrow(()=>h.controls.agent.onRequests([]));
});

test('startup orchestration and event boundaries have generated declaration pages',async()=>{
  const file='studio/app.mjs',context=await loadFlow({repo:'',files:[file],readSource:()=>source});
  const page=flowPacket(context,`${file}::initializeStudio`);
  for(const name of ['createStudioTour','working','connectStudioUpdates','connectStudioSession'])
    assert.ok(page.components.some(component=>component.label===name),name);
  for(const name of ['initializeAgentInterface','connectViewPersistence','startPreparationPolling','loadStudio',
    'studioChanged','studioVisible','disposeStudioSession','restoreStudioSession','seekTourLayer'])
    assert.equal(flowPacket(context,`${file}::${name}`).path,`${file}::${name}`);
});
