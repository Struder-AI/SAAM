import {splineBox} from './shapes.mjs';
export default async function(G){const a=await G.buildGeometry(splineBox({runMm:3,widthMm:4,heightMm:2})),b=await G.buildGeometry(splineBox({runMm:2,widthMm:1,heightMm:3}));return {name:'Two solids sharing exactly one corner',operation:'union',operands:[a,G.translateShell(b,3,4,2)]};}
