import {cylinder,turn} from './shapes.mjs';
// Two physically identical sleeves have unrelated periodic chart cuts.
export default async function(G){return {name:'Indexed sleeves with a 0.37 radian seam mismatch',operation:'union',operands:[await G.buildGeometry(cylinder(G)),await G.buildGeometry(turn(cylinder(G),.37))]};}
