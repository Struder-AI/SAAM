import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMeshView} from '../../studio/mesh-view.mjs';
import {toolpathStyle,createLayerFade,layerKey} from '../../studio/toolpath-view.mjs';

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
test('current layer has stronger opacity and stroke weight, with phase identity retained',()=>{
  const current={layer:8,phase:'planar',extruding:true};
  const now=toolpathStyle(current,current),old=toolpathStyle({...current,layer:7},current);
  assert.ok(now.opacity>old.opacity&&now.width>old.width);assert.notEqual(now.color,old.color);
  assert.equal(toolpathStyle({...current,phase:'draped-skin'},current).active,false);
  assert.equal(toolpathStyle(current,null).active,false);
  for(const phase of ['inclined','draped-skin','vase-wall'])assert.equal(toolpathStyle({...current,phase},{...current,phase},phase).opacity,1);
});

test('outgoing layer fades continuously to its inactive style over two wall-clock seconds',()=>{
  for(const phase of ['planar','inclined','draped-skin','vase-wall']){
    const fade=createLayerFade(),old={layer:1,phase,extruding:true},next={...old,layer:2};
    fade.frame(old,0);
    const start=fade.frame(next,100),middle=fade.frame(next,1100),end=fade.frame(next,2100);
    const style=frame=>toolpathStyle(old,next,'inclined',frame.weights.get(layerKey(old))??0);
    const active=toolpathStyle(old,old,'inclined'),inactive=toolpathStyle(old,next,'inclined');
    assert.deepEqual({...style(start),active:true},active,'no color, opacity or width jump on departure');
    assert.ok(style(middle).opacity<active.opacity&&style(middle).opacity>inactive.opacity);
    assert.notEqual(style(middle).color,active.color);assert.notEqual(style(middle).color,inactive.color);
    assert.deepEqual(style(end),inactive);assert.equal(end.fading,false);
    assert.equal(start.weights.get(layerKey(next)),1,'incoming layer is immediately active');
  }
});

test('rapid layer changes overlap fades; seeking resets history and revisiting cancels a fade',()=>{
  const fade=createLayerFade(),a={phase:'planar',layer:1},b={phase:'planar',layer:2},c={phase:'inclined',layer:2};
  fade.frame(a,0);fade.frame(b,100);
  const overlap=fade.frame(c,600);
  assert.ok(overlap.weights.get(layerKey(a))>0);assert.equal(overlap.weights.get(layerKey(b)),1);
  assert.equal(fade.frame(a,700).weights.get(layerKey(a)),1);
  fade.reset();const seek=fade.frame(c,800);
  assert.equal(seek.fading,false);assert.deepEqual([...seek.weights],[[layerKey(c),1]]);
});
