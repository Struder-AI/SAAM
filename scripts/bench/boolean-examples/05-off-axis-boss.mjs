import {cylinder} from './shapes.mjs';
export default async function(G){return {name:'Short tilted boss merging into a vertical post',operation:'union',operands:[await G.buildGeometry(cylinder(G,{length:7})),await G.buildGeometry(cylinder(G,{radius:1.15,length:4.2,origin:[.7,-.2,2.4],axis:[.8,.2,.5]}))]};}
