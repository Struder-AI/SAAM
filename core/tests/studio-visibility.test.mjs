import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMeshView} from '../../studio/mesh-view.mjs';
import {toolpathStyle,createLayerFade,layerKey,CURRENT_LAYER_GAP_MM,LAYER_FADE_MS,buildToolpathView,remainingLayerMs} from '../../studio/toolpath-view.mjs';

test('mesh display removes coplanar and sub-three-degree edges but preserves creases and boundaries',()=>{
  for(const angle of [0,1,2.99,3,3.01,45,90]) {
    const a=angle*Math.PI/180;
    const g={vertices:[[0,0,0],[1,0,0],[0,1,0],[0,-Math.cos(a),Math.sin(a)]],faces:[[0,1,2],[1,0,3]]};
    const {edgeMasks}=buildMeshView(g);
    assert.equal(edgeMasks[0][0],angle>=3,`${angle} degrees`);
    assert.equal(edgeMasks[1][0],angle>=3);
    assert.ok(edgeMasks.every(m=>m[1]&&m[2]));
  }
  const duplicate={vertices:[[0,0,0],[1,0,0],[0,1,0],[1,0,0],[0,0,0],[0,-1,0]],faces:[[0,1,2],[3,4,5]]};
  assert.equal(buildMeshView(duplicate).edgeMasks[0][0],false,'coincident patch seams share edge visibility');
});
test('older layers use 50 percent opacity and gentler color fading without thinning the bead',()=>{
  const current={layer:8,phase:'planar',extruding:true};
  const now=toolpathStyle(current,current),old=toolpathStyle({...current,layer:7},current);
  assert.equal(now.opacity,1);assert.equal(old.opacity,.5);assert.equal(now.width,old.width-CURRENT_LAYER_GAP_MM);
  assert.equal(now.color,'#5b9fd3');assert.equal(old.color,'#7ab1dc');
  assert.equal(toolpathStyle({...current,phase:'draped-skin'},current).active,false);
  assert.equal(toolpathStyle(current,null).active,false);
  for(const phase of ['inclined','draped-skin','vase-wall'])assert.equal(toolpathStyle({...current,phase},{...current,phase},phase).opacity,1);
});

test('outgoing layer restores full width and normally fades over two seconds',()=>{
  for(const phase of ['planar','inclined','draped-skin','vase-wall']){
    const fade=createLayerFade(),old={layer:1,phase,extruding:true},next={...old,layer:2};
    fade.frame(old,0);
    const start=fade.frame(next,100),middle=fade.frame(next,100+LAYER_FADE_MS/2),end=fade.frame(next,100+LAYER_FADE_MS);
    const style=frame=>toolpathStyle(old,next,'inclined',frame.weights.get(layerKey(old))??0);
    const active=toolpathStyle(old,old,'inclined'),inactive=toolpathStyle(old,next,'inclined');
    assert.equal(style(start).color,active.color);assert.equal(style(start).opacity,active.opacity);
    assert.equal(style(start).width,inactive.width,'only the current layer has display gaps');
    assert.ok(style(middle).opacity<active.opacity&&style(middle).opacity>inactive.opacity);
    assert.equal(style(middle).opacity,.75);assert.notEqual(style(middle).color,active.color);assert.notEqual(style(middle).color,inactive.color);assert.equal(style(middle).width,inactive.width);
    assert.deepEqual(style(end),inactive);assert.equal(end.fading,false);
    assert.equal(start.weights.get(layerKey(next)),1,'incoming layer is immediately active');
  }
});

test('fade shortens only to fit the next layer at the selected speed, including offline movie clocks',()=>{
  const a={phase:'planar',layer:1},b={...a,layer:2},c={...a,layer:3};
  const moves=[{...a,startSeconds:0},{...b,startSeconds:10},{...b,startSeconds:12},{...c,startSeconds:20}];
  const view=buildToolpathView(moves);
  for(const speed of [1,2,10,30]){
    const fade=createLayerFade();fade.frame(a,0);
    const window=remainingLayerMs(view,1,10,speed),expected=Math.min(2000,10000/speed);
    fade.frame(b,100,window);
    const halfway=fade.frame(b,100+expected/2,remainingLayerMs(view,1,10+speed*expected/2000,speed));
    assert.ok(Math.abs(halfway.weights.get(layerKey(a))-.5)<1e-9);
    assert.equal(fade.frame(b,100+expected,Math.max(0,window-expected)).fading,false);
  }
  assert.equal(remainingLayerMs(view,1,10,0),Infinity,'paused viewing retains the normal fade');
  assert.equal(remainingLayerMs(view,3,20,30),Infinity,'last layer has no upcoming deadline');
  const fade=createLayerFade();fade.frame(a,0);fade.frame(b,100,1000);
  const fast=fade.frame(b,600,500).weights.get(layerKey(a));
  assert.ok(fade.frame(b,650,Infinity).weights.get(layerKey(a))<=fast,'pausing never reverses a fade');
});

test('rapid transitions finish all but one outgoing fade; seeking resets and revisiting stays active',()=>{
  const fade=createLayerFade(),a={phase:'planar',layer:1},b={phase:'planar',layer:2},c={phase:'inclined',layer:2};
  fade.frame(a,0);fade.frame(b,100);
  const next=fade.frame(c,110);
  assert.equal(next.weights.has(layerKey(a)),false);assert.equal(next.weights.get(layerKey(b)),1);
  assert.equal(fade.frame(a,120).weights.get(layerKey(a)),1);
  for(let i=0;i<100;i++){
    const current={phase:'planar',layer:i},frame=fade.frame(current,130+i*5);
    assert.ok([...frame.weights].filter(([key])=>key!==layerKey(current)).length<=1,'even a layer every 5 ms has only one outgoing fade');
  }
  fade.reset();const seek=fade.frame(c,800);
  assert.equal(seek.fading,false);assert.deepEqual([...seek.weights],[[layerKey(c),1]]);
});
