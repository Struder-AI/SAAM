import {cylinder} from './shapes.mjs';
export default async function(G){return {name:'Eccentric bore kissing its host wall from inside',operation:'difference',operands:[await G.buildGeometry(cylinder(G,{radius:2})),await G.buildGeometry(cylinder(G,{radius:1,origin:[1,0,0]}))]};}
