import {cylinder} from './shapes.mjs';
export default async function(G){return {name:'Exactly aligned telescoping sleeves with partially shared side faces',operation:'union',operands:[await G.buildGeometry(cylinder(G)),await G.buildGeometry(cylinder(G,{origin:[0,0,2]}))]};}
