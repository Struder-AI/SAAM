import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMeshView} from '../../studio/mesh-view.mjs';
import {toolpathStyle} from '../../studio/toolpath-view.mjs';

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
