import test from 'node:test';
import assert from 'node:assert/strict';
import {createViewerRenderer} from '../../studio/viewer-renderer.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function recordingCanvas() {
  const operations=[],gradient={addColorStop:(...args)=>operations.push(['colorStop',...args])};
  const ctx=new Proxy({}, {get(target,key){if(key in target)return target[key];if(key==='createRadialGradient')return (...args)=>(operations.push(['radial',...args]),gradient);
    return (...args)=>operations.push([key,...args]);},set(target,key,value){operations.push(['set',key,value]);target[key]=value;return true;}});
  return {canvas:{width:0,height:0,clientWidth:240,clientHeight:160,getContext:()=>ctx},operations};
}

test('async material publication keeps the newest scene and disposes owned renderers',async()=>{
  const first=deferred(),second=deferred(),afterDispose=deferred(),disposed=[],frames=new Map(),cancelled=[];let frameId=0,applied=0;
  const {canvas}=recordingCanvas();
  const viewer=createViewerRenderer({canvas,requestFrame:fn=>(frames.set(++frameId,fn),frameId),cancelFrame:id=>{cancelled.push(id);frames.delete(id);},setTimer:()=>1,clearTimer:()=>{},
    buildPathView:moves=>({moves,groups:[]}),buildMaterialView:moves=>moves[0].id===1?first.promise:moves[0].id===2?second.promise:afterDispose.promise,
    createMaterial:()=>({renderer:'fake',dispose:()=>disposed.push('material')}),createGeometry:()=>({dispose:()=>disposed.push('geometry')}),
    buildGeometry:()=>({edgeFeatures:new Map(),topology:{edgeMasks:[]}})});
  viewer.publishGeometry({geometry:{}});
  const old=viewer.publishProgram({moves:[{id:1}],plan:{},geometry:{}}),latest=viewer.publishProgram({moves:[{id:2}],plan:{},geometry:{}});
  second.resolve({moves:[{id:2}],unsupported:[],supported:[]});await latest;
  first.resolve({moves:[{id:1}],unsupported:[],supported:[]});await old;
  assert.equal(viewer.sceneState().materialMoves[0].id,2);
  viewer.requestDraw(()=>({state:null,target:canvas}),()=>applied++);
  const stale=viewer.publishProgram({moves:[{id:3}],plan:{},geometry:{}});viewer.dispose();
  afterDispose.resolve({moves:[{id:3}],unsupported:[],supported:[]});await stale;
  assert.deepEqual(cancelled,[1]);assert.equal(viewer.sceneState().materialMoves,undefined,'disposed async publication stays invalid');
  assert.deepEqual(disposed.sort(),['geometry','material']);
  assert.equal(viewer.sceneState().hasGeometry,false);assert.equal(viewer.sceneState().pathView,null);assert.equal(viewer.sceneState().materialMoves,undefined);
  viewer.publishGeometry({geometry:{}});await viewer.publishProgram({moves:[{id:4}],plan:{},geometry:{},previewMaterial:{unsupported:[],supported:[]}});
  viewer.requestDraw(()=>({state:null,target:canvas}),()=>applied++);assert.equal(frames.size,1);[...frames.values()][0]();assert.equal(applied,1);
  assert.equal(viewer.sceneState().hasGeometry,true);assert.equal(viewer.sceneState().materialMoves[0].id,4);
});

test('preview material consumption is explicit for adopted, unavailable, failed and superseded publications',async()=>{
  const moves=[{id:1}],base={moves,plan:{},geometry:{},previewMaterial:{unsupported:[],supported:[]}};
  const renderer=()=>({renderer:'fake',dispose(){}}),path=m=>({moves:m,groups:[]});
  const adopted=createViewerRenderer({canvas:recordingCanvas().canvas,createMaterial:renderer,buildPathView:path});
  const success=await adopted.publishProgram(base);
  assert.equal(success.previewMaterialConsumed,true);assert.equal(success.scene.materialMoves,moves);

  const unavailable=createViewerRenderer({canvas:recordingCanvas().canvas,createMaterial:()=>null,buildPathView:path});
  assert.equal((await unavailable.publishProgram(base)).previewMaterialConsumed,false);

  const failed=createViewerRenderer({canvas:recordingCanvas().canvas,createMaterial:renderer,buildPathView:path});
  const broken={get unsupported(){throw Error('bad preview');},supported:[]};
  assert.equal((await failed.publishProgram({...base,previewMaterial:broken})).previewMaterialConsumed,false);

  let superseded;const stale=createViewerRenderer({canvas:recordingCanvas().canvas,createMaterial:renderer,buildPathView:path});
  superseded={get unsupported(){stale.clearProgram();return [];},supported:[]};
  const staleResult=await stale.publishProgram({...base,previewMaterial:superseded});
  assert.equal(staleResult.previewMaterialConsumed,false);assert.equal(staleResult.scene.materialMoves,undefined);
});

test('scheduled UI draws coalesce and fallback geometry emits canvas operations and annotations',()=>{
  const {canvas,operations}=recordingCanvas(),frames=[];let applied=0;
  const viewer=createViewerRenderer({canvas,requestFrame:fn=>(frames.push(fn),frames.length),cancelFrame:()=>{},setTimer:()=>1,clearTimer:()=>{},
    createGeometry:()=>null,buildGeometry:()=>({edgeFeatures:new Map(),topology:{edgeMasks:[[true,true,true]]}})});
  viewer.requestDraw(()=>({state:null,target:canvas}),()=>applied++);frames.shift()();assert.equal(applied,1,'an early resize draw is harmless');applied=0;
  const geometry={vertices:[[0,0,0],[10,0,0],[0,10,0]],faces:[[0,1,2]],labels:['top']};viewer.publishGeometry({geometry});
  const snapshot=()=>({state:{geometry,plan:{process:{lineWidthMm:.4}}},shown:{geometry,plan:{process:{lineWidthMm:.4}}},tab:'geometry',selected:'top',selectionLabel:'Top',showGeometry:true,
    camera:{yaw:0,tilt:.5,zoom:1,pan:[0,0],fitBounds:null},bounds:{min:[0,0,0],max:[10,10,10]},settings:{followPlate:true,showTravel:false,previousLayerOpacity:.5},
    skinPhase:null,machineColors:{},updateUI:true,performanceContext:{tab:'geometry'}});
  viewer.requestDraw(snapshot,()=>applied++);viewer.requestDraw(snapshot,()=>applied++);assert.equal(frames.length,1);frames[0]();
  assert.equal(applied,1);assert.ok(operations.some(([op])=>op==='radial'));assert.ok(operations.some(([op])=>op==='fill'));
  assert.ok(operations.some(([op,text])=>op==='fillText'&&text==='5 mm grid'));
  assert.equal(viewer.draw({...snapshot(),updateUI:false}).selectionText,'Top');
});

test('scene publication preserves a coalesced redraw and a disposed callback cannot clear its replacement',async()=>{
  const {canvas}=recordingCanvas(),frames=new Map(),cancelled=[];let id=0;
  const viewer=createViewerRenderer({canvas,requestFrame:fn=>(frames.set(++id,fn),id),cancelFrame:at=>cancelled.push(at),setTimer:()=>1,clearTimer:()=>{},
    buildPathView:moves=>({moves,groups:[]}),createMaterial:()=>null});
  const applied=[];
  viewer.requestDraw(()=>({state:null,target:canvas}),()=>applied.push('A'));
  await viewer.publishProgram({moves:[{id:1}],plan:{},geometry:{},buildMaterial:false});
  viewer.requestDraw(()=>({state:null,target:canvas}),()=>applied.push('B'));
  frames.get(1)();assert.deepEqual(applied,['B'],'latest coalesced snapshot draws across ordinary publication');

  viewer.requestDraw(()=>({state:null,target:canvas}),()=>applied.push('stale'));const stale=frames.get(2);
  viewer.dispose();viewer.requestDraw(()=>({state:null,target:canvas}),()=>applied.push('C'));
  stale();viewer.requestDraw(()=>({state:null,target:canvas}),()=>applied.push('D'));
  assert.equal(id,3,'stale callback did not clear the replacement handle');frames.get(3)();
  assert.deepEqual(applied,['B','D']);assert.deepEqual(cancelled,[2]);
});
