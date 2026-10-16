import {splineBlock,splineBox} from './shapes.mjs';
// An interior intersection loop much smaller than the former 0.4 mm seed.
export default async function(G){const q=[.25,-.25,.25],r=.025,a=await G.buildGeometry(splineBlock({runMm:1,widthMm:1,heightsMm:q.map(x=>q.map(y=>1+x+y-r*r))})),b=await G.buildGeometry(splineBox({runMm:1,widthMm:1,heightMm:1}));return {name:'Sub-seed closed pocket in a quadratic bowl',operation:'intersection',operands:[a,G.translateShell(b,0,0,1)]};}
