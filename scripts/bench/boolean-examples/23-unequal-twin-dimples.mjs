import assert from 'node:assert/strict';
import {splineBlock,splineBox} from './shapes.mjs';
// A piecewise cubic roof has unequal enclosed low spots under a flat lid. One
// traced component must not hide the other during interior-loop discovery.
export default async function(G){
 const heights=[11,7,7,11,7.3,7.3,11],across=[.25,-.25,.25];
 const roof=splineBlock({runMm:1,widthMm:1,heightsMm:heights.map((z,i)=>across.map(y=>z+16*y-.5*i/6))});
 // Two cubic spans share the central ridge and matching ruled walls.
 for(const patch of roof.patches.filter(patch=>['top','front','back'].includes(patch.name))){
  patch.knotsU=[0,0,0,0,.5,.5,.5,1,1,1,1];
  for(const [i,row] of patch.controlPoints.entries())for(const point of row)point[0]=i/6;
 }
 return {name:'Unequal twin dimples under a flat lid',operation:'intersection',operands:[await G.buildGeometry(roof),await G.buildGeometry(splineBox({runMm:1,widthMm:1,heightMm:10}))],
 verify(_G,body){assert.ok(body.patches.filter(patch=>patch.sourceFace===0).flatMap(patch=>patch.trimLoops).length===2,'Both interior low spots must retain separate native face regions.');}};
}
