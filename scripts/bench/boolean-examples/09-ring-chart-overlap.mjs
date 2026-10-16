import {torus} from './shapes.mjs';
export default async function(G){return {name:'Coincident toroidal skins with shifted periodic charts',operation:'union',operands:[await G.buildGeometry(torus()),await G.buildGeometry(torus({phase:1.13}))]};}
