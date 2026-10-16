import {torus,cylinder} from './shapes.mjs';
export default async function(G){return {name:'Bore tangent to the ring inner equator',operation:'difference',operands:[await G.buildGeometry(torus()),await G.buildGeometry(cylinder(G,{length:6,origin:[0,0,-.5]}))]};}
