import {ROUNDING_RELATIVE} from '../dimensions.mjs';
import {selectedSplinePatch} from './surface-region.mjs';
// A proven affine chart needs no curvature subdivision. This is a geometry
// property, independent of which representation the author supplied.
export function affineSurface(surface){
  if(!surface)return false;
  if(surface.kind==='slice-chart')return affineSurface(surface.slice);
  if(surface.kind==='plane')return true;
  const record=surface.referenceRecord??surface;
  if(['mapped-surface','offset-chart'].includes(record.representation))return affineSurface(record.source);
  if(record.representation==='tangent-extension')return affineSurface(record.patch);
  if(record.representation==='surface-region'&&record.selection.kind==='spline')return affineSurface(selectedSplinePatch(record.geometry,record.selection));
  const patch=surface?.patch??surface;
  if(!patch)return false;
  const {nu,nv,orderU,orderV,knotsU,knotsV,cp}=patch;
  if(!cp||orderU<2||orderV<2)return false;
  const greville=(knots,n,order)=>Array.from({length:n},(_,i)=>knots.slice(i+1,i+order).reduce((a,b)=>a+b,0)/(order-1));
  const us=greville(knotsU,nu,orderU),vs=greville(knotsV,nv,orderV),weight=cp[3];
  const point=(i,j)=>[0,1,2].map(k=>cp[(i*nv+j)*4+k]/weight),origin=point(0,0);
  const du=point(nu-1,0).map((x,k)=>(x-origin[k])/(us.at(-1)-us[0])),dv=point(0,nv-1).map((x,k)=>(x-origin[k])/(vs.at(-1)-vs[0]));
  const scale=Math.max(1,...origin.map(Math.abs),...du.map(Math.abs),...dv.map(Math.abs));
  // Constant-weight B-splines reproduce affine coordinates at their Greville
  // abscissae, including degree-elevated and multi-span planar charts.
  for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){
    if(cp[(i*nv+j)*4+3]!==weight||!point(i,j).every((x,k)=>Math.abs(x-origin[k]-du[k]*(us[i]-us[0])-dv[k]*(vs[j]-vs[0]))<=ROUNDING_RELATIVE*scale))return false;
  }
  return true;
}
