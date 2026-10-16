import {cylinder} from './shapes.mjs';
// A real penetrating lens, rather than a merely touching cylinder pair.
export default async function(G){const a=await G.buildGeometry(cylinder(G));return {name:'Diagonal thin lens',operation:'intersection',operands:[a,G.translateShell(a,3.99/Math.SQRT2,3.99/Math.SQRT2,0)]};}
