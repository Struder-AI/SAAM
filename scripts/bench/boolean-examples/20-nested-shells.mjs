import {cylinder} from './shapes.mjs';
export default async function(G){return {name:'Concentric cylinders with fully coincident cap planes',operation:'union',operands:[await G.buildGeometry(cylinder(G,{radius:2})),await G.buildGeometry(cylinder(G,{radius:1}))]};}
