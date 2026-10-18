// Tangent continuation retains native UV and the original patch exactly.
// Beyond both edges, the mixed derivative supplies the bilinear corner.
import {evaluate} from './nurbs.mjs';
import {surfaceDerivatives} from './surface-derivatives.mjs';
import {evaluatedSurfaceDerivatives} from './evaluated-surface.mjs';
import {numericalGeometryRecord} from './surface-record.mjs';
import {requireThat,cross,dot} from './tolerance.mjs';
import {ROUNDING_RELATIVE} from '../dimensions.mjs';

export function extendSurface(patch,boundsUv){
  requireThat(patch?.cp&&patch.domainU&&patch.domainV,'Tangent extension needs a numerical spline patch.');
  requireThat(!patch.trimLoops,'Tangent extension needs an untrimmed patch.');
  const domains=[patch.domainU,patch.domainV];
  requireThat(Array.isArray(boundsUv)&&boundsUv.length===2&&boundsUv.every((b,k)=>Array.isArray(b)&&b.length===2&&b.every(Number.isFinite)&&b[0]<=domains[k][0]&&b[1]>=domains[k][1]),
    'Extension UV bounds must contain the original patch domain.');
  const bounds=boundsUv.map(b=>[...b]);
  const at=(u,v)=>{
    requireThat([u,v].every((x,k)=>Number.isFinite(x)&&x>=bounds[k][0]&&x<=bounds[k][1]),'Surface sample outside tangent extension.');
    const a=Math.max(domains[0][0],Math.min(domains[0][1],u)),b=Math.max(domains[1][0],Math.min(domains[1][1],v)),x=u-a,y=v-b;
    if(x===0&&y===0)return evaluate(patch,u,v);
    const e=surfaceDerivatives(patch,a,b);
    const point=e.point.map((p,k)=>p+x*e.du[k]+y*e.dv[k]+x*y*e.duv[k]);
    const du=e.du.map((p,k)=>p+y*e.duv[k]),dv=e.dv.map((p,k)=>p+x*e.duv[k]);
    const area=cross(du,dv),det=dot(area,area);
    requireThat(Number.isFinite(det)&&det>dot(du,du)*dot(dv,dv)*ROUNDING_RELATIVE**2,'Tangent extension has a singular physical metric; change its bounds or reference.');
    return {point,du,dv,normal:area.map(n=>n/Math.sqrt(det))};
  };
  // Difference stencils stay on one side of a tangent join. The native
  // interior retains its analytic metric, including exact normal offsets.
  const sample=(u,v)=>at(u,v);
  at.derivatives=(u,v,options)=>{
    if([u,v].every((x,k)=>x>=domains[k][0]&&x<=domains[k][1]))return surfaceDerivatives(patch,u,v,options);
    const cell=[u,v].map((x,k)=>x<domains[k][0]?[bounds[k][0],domains[k][0]]:x>domains[k][1]?[domains[k][1],bounds[k][1]]:domains[k]);
    return evaluatedSurfaceDerivatives({at:sample,domainU:cell[0],domainV:cell[1]},u,v,options);
  };
  const breaks=(knots,domain,b)=>[...new Set([b[0],...knots.filter(t=>t>=domain[0]&&t<=domain[1]),b[1]])].sort((a,b)=>a-b);
  return {at,domainU:bounds[0],domainV:bounds[1],breaksU:breaks(patch.knotsU,domains[0],bounds[0]),breaksV:breaks(patch.knotsV,domains[1],bounds[1]),
    referenceRecord:{representation:'tangent-extension',patch:numericalGeometryRecord(patch),boundsUv:bounds}};
}
