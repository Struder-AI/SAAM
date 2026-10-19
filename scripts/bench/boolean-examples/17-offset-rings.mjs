import {torus} from './shapes.mjs';
export default async function(G){return {name:'Offset interlocking ring volumes',operation:'intersection',operands:[await G.buildGeometry(torus({major:3.2,minor:1.1})),await G.buildGeometry(torus({major:2.7,minor:.9,origin:[1.35,.6,2.45],phase:.23}))]};}
