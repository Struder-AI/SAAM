import {torus,splineBox} from './shapes.mjs';
export default async function(G){const key=await G.buildGeometry(splineBox({runMm:2.2,widthMm:.83,heightMm:5}));return {name:'Narrow rectangular keyway through a ring',operation:'difference',operands:[await G.buildGeometry(torus({major:3.7,minor:.8,origin:[0,0,2.2]})),G.translateShell(key,2.6,-.21,0)]};}
