import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {loadFlow,flowPacket} from '../../dev-map/lib/flow.mjs';

const source=await readFile(new URL('../../studio/app.mjs',import.meta.url),'utf8');
function harness(){
  const trace=[],registrations=[];
  const canvas=new Proxy({focus(){trace.push(['focus']);},setPointerCapture(id){trace.push(['capture',id]);},
    getBoundingClientRect(){trace.push(['rect']);return {left:10,top:20};}},
    {set(target,key,value){registrations.push(key);target[key]=value;return true;}});
  const context=vm.createContext({canvas,drag:null,moved:false,pan:[0,0],yaw:0,tilt:0,lastMotion:0,tab:'geometry',
    geometryScene:'scene',geometryProject:'project',performance:{now:()=>100},requestDraw(){trace.push(['draw']);},
    viewPerformance:{flush(){trace.push(['flush']);}},pickGeometry(...args){trace.push(['pick',...args]);return 'face';},
    selectFeature(id){trace.push(['select',id]);}});
  const start=source.indexOf('function planCanvasDrag(');
  vm.runInContext(source.slice(start,source.indexOf("canvas.addEventListener('wheel'",start)),context);
  const emit=(name,values={})=>canvas['on'+name]({button:0,pointerId:7,clientX:10,clientY:20,shiftKey:false,
    preventDefault(){trace.push(['prevent']);},...values});
  return {context,trace,registrations,canvas,emit,state:()=>JSON.parse(JSON.stringify({drag:context.drag,moved:context.moved,
    pan:context.pan,yaw:context.yaw,tilt:context.tilt,lastMotion:context.lastMotion}))};
}

test('pointer registration preserves ordering and shared cancellation identity',()=>{
  const h=harness();
  assert.deepEqual(h.registrations,['onpointerdown','onpointermove','onpointerup','onlostpointercapture','onpointercancel','oncontextmenu']);
  assert.equal(h.canvas.onpointercancel,h.canvas.onlostpointercapture);
  h.emit('pointerdown',{button:3});assert.deepEqual(h.trace,[]);assert.equal(h.context.drag,null);
  h.emit('pointerdown');assert.deepEqual(h.trace,[['prevent'],['focus'],['capture',7]]);
  h.emit('contextmenu');assert.deepEqual(h.trace.at(-1),['prevent']);
  h.emit('pointercancel');assert.equal(h.context.drag,null);
  h.emit('pointermove');assert.equal(h.trace.filter(x=>x[0]==='draw').length,0);
});

test('drag planning consumes a frozen snapshot and returns values without host effects',()=>{
  const h=harness();
  const current=Object.freeze({drag:Object.freeze({x:10,y:20,startX:10,startY:20,pan:true}),
    pan:Object.freeze([3,4]),moved:false,yaw:.4,tilt:.5});
  const next=h.context.planCanvasDrag(current,Object.freeze({x:13,y:25}));
  assert.deepEqual(JSON.parse(JSON.stringify(next)),{drag:{x:13,y:25,startX:10,startY:20,pan:true},
    moved:true,pan:[6,9],yaw:.4,tilt:.5});
  assert.deepEqual(h.trace,[]);assert.equal(h.context.drag,null);
  assert.notEqual(next.drag,current.drag);assert.notEqual(next.pan,current.pan);
});

test('orbit movement preserves drag threshold, incremental deltas and tilt clamps',()=>{
  const h=harness();h.emit('pointerdown');h.emit('pointermove',{clientX:12});
  assert.equal(h.context.moved,false);assert.equal(h.context.yaw,.016);
  h.emit('pointermove',{clientX:13,clientY:1020});
  assert.equal(h.context.moved,true);assert.equal(h.context.yaw,.024);assert.equal(h.context.tilt,1.5);
  h.emit('pointermove',{clientX:10,clientY:-1020});assert.equal(h.context.tilt,-1.5);
  assert.equal(h.context.lastMotion,100);assert.deepEqual(h.state().pan,[0,0]);
  h.emit('pointerup');assert.equal(h.context.drag,null);assert.equal(h.trace.at(-1)[0],'flush');
  assert.equal(h.trace.filter(x=>x[0]==='draw').length,3);
});

test('middle, right and shift drag pan without changing orbit or selecting geometry',()=>{
  for(const trigger of [{button:1},{button:2},{shiftKey:true}]){
    const h=harness();h.emit('pointerdown',trigger);h.emit('pointermove',{clientX:15,clientY:13});
    h.emit('pointermove',{clientX:18,clientY:10});h.emit('pointerup');
    assert.deepEqual(h.state().pan,[8,-10]);assert.equal(h.context.yaw,0);assert.equal(h.context.tilt,0);
    assert.equal(h.trace.some(x=>x[0]==='pick'),false);
  }
});

test('pointer release flushes first and picks against live geometry only for an unmoved geometry click',()=>{
  const h=harness();h.emit('pointerdown');h.context.geometryScene='new-scene';h.context.geometryProject='new-project';
  h.emit('pointerup',{clientX:30,clientY:50});
  assert.deepEqual(h.trace.slice(3).map(x=>JSON.parse(JSON.stringify(x))),[
    ['flush'],['rect'],['pick','new-scene','new-project',20,30,{edges:true}],['select','face']]);
  for(const change of [{tab:'toolpath'},{geometryProject:null}]){
    const quiet=harness();quiet.emit('pointerdown');Object.assign(quiet.context,change);quiet.emit('pointerup');
    assert.equal(quiet.trace.some(x=>x[0]==='pick'),false);
  }
  const lost=harness();lost.emit('pointerdown');lost.emit('lostpointercapture');lost.emit('pointerup');
  assert.deepEqual(lost.trace.at(-1),['flush']);assert.equal(lost.trace.some(x=>x[0]==='pick'),false);
});

test('pointer map exposes snapshot planning and application without superseded handler routes',async()=>{
  const file='studio/app.mjs',context=await loadFlow({files:[file]});
  const page=flowPacket(context,`${file}::moveCanvasDrag`);
  const read=page.components.find(c=>c.file===file&&c.label==='readCanvasDrag');
  const planner=page.components.find(c=>c.file===file&&c.label==='planCanvasDrag');
  const apply=page.components.find(c=>c.file===file&&c.label==='applyCanvasDrag');
  assert.ok(read&&planner&&apply);
  assert.ok(page.wires.some(w=>w.from===read.index&&w.to===planner.index&&w.kind==='data'));
  assert.ok(page.wires.some(w=>w.from===planner.index&&w.to===apply.index&&w.kind==='data'));
  for(const name of ['onpointerdown','onpointermove','onpointerup','onlostpointercapture','oncontextmenu'])
    assert.equal(context.projection.nodes.has(`${file}::${name}`),false,`superseded ${name}`);
  const registered=flowPacket(context,`${file}::connectCanvasPointerEvents`);
  assert.equal(registered.path,`${file}::connectCanvasPointerEvents`);
});
