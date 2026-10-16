import assert from 'node:assert/strict';
import {splineBlock,splineBox} from './shapes.mjs';
// A quartic roof has unequal enclosed low spots under a flat lid. One
// traced component must not hide the other during interior-loop discovery.
export default async function(G){
 const quartic=[.0256,-.0544,.0856,-.0544,.0256],across=[.25,-.25,.25];
 const roof=splineBlock({runMm:1,widthMm:1,heightsMm:quartic.map((x,i)=>across.map(y=>9.98+64*x+16*y-.5*i/4))});
 // The general block fixture defaults to cubic spans; this roof is one
 // quartic Bezier span, including the matching ruled front and back walls.
 for(const patch of roof.patches.filter(patch=>['top','front','back'].includes(patch.name))){
  patch.degreeU=4;patch.knotsU=[0,0,0,0,0,1,1,1,1,1];
  for(const [i,row] of patch.controlPoints.entries())for(const point of row)point[0]=i/4;
 }
 return {name:'Unequal twin dimples under a flat lid',operation:'intersection',operands:[await G.buildGeometry(roof),await G.buildGeometry(splineBox({runMm:1,widthMm:1,heightMm:10}))],
 verify(_G,body){assert.ok(body.patches.filter(patch=>patch.sourceFace===0).flatMap(patch=>patch.trimLoops).length===2,'Both interior low spots must retain separate native face regions.');}};
}
