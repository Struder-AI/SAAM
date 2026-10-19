import assert from 'node:assert/strict';
import {splineBox,cylinder} from './shapes.mjs';
// Reuse retained face regions after making a pocket, then join a taller post.
export default async function(G){
 const block=await G.buildGeometry(splineBox({runMm:20,widthMm:20,heightMm:5})),tool=await G.buildGeometry(cylinder(G,{radius:3,length:3,origin:[10,10,3]}));
 const pocket=G.combineSolids('difference',[block,tool]),post=await G.buildGeometry(cylinder(G,{radius:1,length:8,origin:[10,10,0]}));
 return {name:'A post rising through the floor of a blind pocket',operation:'union',operands:[pocket,post],verify(Geometry,body){assert.ok(Math.abs(Geometry.topAt(body,10,10).zMm-8)<1e-9,'The exactly authored post height must survive without an unnecessary adjustment.');}};
}
