import {splineBox} from './shapes.mjs';
export default async function(G){const foot=await G.buildGeometry(splineBox({runMm:7,widthMm:3,heightMm:2})),rib=await G.buildGeometry(splineBox({runMm:3,widthMm:1.4,heightMm:4}));return {name:'Narrow rib joined flush to part of a foot face',operation:'union',operands:[foot,G.translateShell(rib,1.2,.8,2)]};}
