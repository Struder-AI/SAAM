import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanPlanarLoop} from '../geom/polyline.mjs';
import {offsetRegion} from '../region/offset.mjs';
import {regionArea,loopArea,pointSegmentDistance} from '../region/region2d.mjs';

const checkSpans=(before,after,tolerance)=>{
  for(let i=0;i<after.length;i++){
    const a=after[i],b=after[(i+1)%after.length],start=before.indexOf(a),end=before.indexOf(b);
    assert.ok(start>=0&&end>=0,'retained endpoints come from the original contour');
    for(let j=start;j!==end;j=(j+1)%before.length)
      assert.ok(pointSegmentDistance(before[j],a,b)<=tolerance+1e-9,'every original span vertex is within the finite replacement segment bound');
  }
  assert.equal(Math.sign(loopArea(after)),Math.sign(loopArea(before)));
};

test('finished-wall simplification bounds complete spans on circles, translated curves and sharp corners',()=>{
  for(const shift of [0,1000000]){
    const circle=Array.from({length:1600},(_,i)=>[shift+10*Math.cos(i*Math.PI/800),shift+10*Math.sin(i*Math.PI/800)]);
    const result=cleanPlanarLoop(circle,0.01);
    assert.ok(result.length<circle.length/4);
    checkSpans(circle,result,0.01);
    const square=[[shift,shift],[shift+3,shift],[shift+6,shift],[shift+6,shift+6],[shift,shift+6]];
    assert.deepEqual(cleanPlanarLoop(square,.01),[square[0],square[2],square[3],square[4]]);
  }
});


test('wall simplification leaves inputs unchanged across seam rotations and reversed winding',()=>{
  const source=Array.from({length:180},(_,i)=>[6*Math.cos(i*Math.PI/90),4*Math.sin(i*Math.PI/90)]);
  for(const seam of [0,31,89])for(const reverse of [false,true]){
    const loop=[...source.slice(seam),...source.slice(0,seam)];if(reverse)loop.reverse();
    loop.forEach(Object.freeze);Object.freeze(loop);
    const before=JSON.stringify(loop),result=cleanPlanarLoop(loop,.01);
    assert.equal(JSON.stringify(loop),before);checkSpans(loop,result,.01);
    assert.ok(result.length<loop.length);
  }
});


test('numerical triangle seams are removed before offsetting, independent of short edge length',()=>{
  const loop=[[0,0],[1e-5,2e-9],[5,0],[5.000001,-2e-9],[10,0],[10,10],[0,10]];
  const expected=[[0,0],[10,0],[10,10],[0,10]];
  assert.deepEqual(cleanPlanarLoop(loop),expected);
  assert.deepEqual(offsetRegion([cleanPlanarLoop(loop)],-.2),offsetRegion([expected],-.2));
  assert.equal(regionArea([cleanPlanarLoop([...loop].reverse())]),-100);
});

test('contour cleanup retains corners, narrow features, reversals and accumulated curvature',()=>{
  const reversal=[[0,0],[2,0],[1,0],[4,0],[4,4],[0,4]];
  assert.deepEqual(cleanPlanarLoop(reversal),reversal);
  const narrow=[[0,0],[4,0],[4,4],[2,4],[2,3],[1.99999,3],[1.99999,4],[0,4]];
  assert.deepEqual(cleanPlanarLoop(narrow),narrow);
  const circle=Array.from({length:2000},(_,i)=>[10*Math.cos(i*Math.PI/1000),10*Math.sin(i*Math.PI/1000)]);
  assert.equal(cleanPlanarLoop(circle).length,circle.length);
  const curved=Array.from({length:101},(_,i)=>[i*.1,1e-7*i*i]);
  const loop=[...curved,[10,10],[0,10]];
  assert.ok(cleanPlanarLoop(loop).length>50,'whole-run distance prevents incremental curve flattening');
});
