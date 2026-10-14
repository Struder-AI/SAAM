import {ROUNDING_RELATIVE} from '../dimensions.mjs';
// A proven affine chart needs no curvature subdivision. This is a geometry
// property, independent of which representation the author supplied.
export function affineSurface(surface){
  if(surface.kind==='slice-chart')return affineSurface(surface.slice);
  if(surface.kind==='plane')return true;
  const patch=surface.patch??surface;
  if(patch.nu!==2||patch.nv!==2||patch.orderU!==2||patch.orderV!==2)return false;
  const weights=[3,7,11,15].map(i=>patch.cp[i]);
  if(!weights.every(w=>w===weights[0]))return false;
  const p=Array.from({length:4},(_,i)=>[0,1,2].map(k=>patch.cp[i*4+k]/weights[i]));
  const scale=Math.max(1,...p.flat().map(Math.abs));
  return p[3].every((v,k)=>Math.abs(v-p[1][k]-p[2][k]+p[0][k])<=ROUNDING_RELATIVE*scale);
}
