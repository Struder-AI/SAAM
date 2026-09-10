import test from 'node:test';
import assert from 'node:assert/strict';
import {buildToolpathView,toolpathFrame} from '../../studio/toolpath-view.mjs';
const move=(from,to,layer=0,extruding=true)=>({from,to,layer,phase:'planar',operation:'fill',extruding});
test('viewer reduction is bounded, keeps bends and transitions, and never changes source moves',()=>{
 const moves=[];
 for(let layer=0;layer<20;layer++){
   for(let x=0;x<30;x++)moves.push(move([x,0,layer],[x+1,0,layer],layer));
   moves.push(move([30,0,layer],[30,5,layer],layer));
   moves.push(move([30,5,layer],[0,0,layer+1],layer,false));
 }
 const original=structuredClone(moves),view=buildToolpathView(moves);
 const small=toolpathFrame(view,5,false,{pointCap:100});assert.equal(small.reduced,false);assert.equal(small.segments.length,5);
 for(const count of [0,15,31,33,321,moves.length])for(const travel of [false,true]){
   const f=toolpathFrame(view,count,travel,{pointCap:40});
   assert.ok(2*(f.segments.length+(f.partial?1:0)+1)<=40);
   for(const edge of f.segments){
     assert.ok(edge.last<count);assert.equal(edge.move.layer,moves[edge.last].layer);
     assert.equal(edge.move.extruding,moves[edge.last].extruding);
     assert.deepEqual(edge.from,moves[edge.first].from);assert.deepEqual(edge.to,moves[edge.last].to);
     assert.ok(travel||edge.move.extruding);
   }
 }
 const reduced=toolpathFrame(view,32,false,{pointCap:20});
 assert.equal(reduced.reduced,true);
 assert.ok(reduced.segments.some(e=>e.from[0]===30&&e.from[1]===0&&e.to[1]===5),'right-angle corner remains');
 const middle=toolpathFrame(view,15,false,{pointCap:20});assert.equal(middle.partial.last,29);
 assert.deepEqual(moves,original,'display preparation must not change the print');
});
test('a dense single layer respects the budget and retains detail at playback',()=>{
 const moves=Array.from({length:5000},(_,i)=>move([i,0,0],[i,.5,0]));
 const view=buildToolpathView(moves);
 for(const count of [100,1000,5000]){
   const f=toolpathFrame(view,count,false,{pointCap:100});
   assert.equal(f.overview,true);assert.ok(f.segments.length*2+4<=100);
   assert.ok(f.segments.some(e=>e.last===count-1));
   for(const edge of f.segments)assert.equal(edge.first,edge.last,'disconnected strokes cannot be joined');
 }
});
test('simplified curves stay within display tolerance, including the playback prefix',()=>{
 const points=Array.from({length:501},(_,i)=>[i*.1,2*Math.sin(i*.01),.1*Math.cos(i*.01)]);
 const moves=points.slice(1).map((p,i)=>move(points[i],p)),view=buildToolpathView(moves);
 function distance(p,a,b){const v=b.map((x,i)=>x-a[i]),w=p.map((x,i)=>x-a[i]),d=v.reduce((s,x)=>s+x*x,0),t=Math.max(0,Math.min(1,w.reduce((s,x,i)=>s+x*v[i],0)/d));return Math.hypot(...w.map((x,i)=>x-t*v[i]));}
 for(const count of [160,270,500]){
   const f=toolpathFrame(view,count,false,{pointCap:100});assert.equal(f.overview,false);
   const edges=f.partial?[...f.segments,{...f.partial,last:count-1,to:moves[count].from}]:f.segments;
   for(const edge of edges)for(let i=edge.first;i<=edge.last;i++)assert.ok(distance(moves[i].to,edge.from,edge.to)<=.020000001);
 }
});
