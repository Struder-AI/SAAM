// Narrow authoring boundary for an open, nonrational tensor-product B-spline.
// U follows the assigned edge; V runs from its base to its supported edge.
import {evaluate} from './nurbs.mjs';
import {sectionPatch} from './section.mjs';
import {requireThat} from './tolerance.mjs';

export function supportSurface(spec,placement={xMm:0,yMm:0}) {
  const {degreeU,degreeV,controlPoints}=spec;
  requireThat(Array.isArray(controlPoints)&&controlPoints.length>=2,'Rimming surface needs a control net.');
  const nu=controlPoints.length,nv=controlPoints[0]?.length;
  for(const [degree,count] of [[degreeU,nu],[degreeV,nv]])requireThat(Number.isInteger(degree)&&degree>=1&&degree<=3&&count>degree,'Rimming spline degrees must be 1–3 with enough control points.');
  requireThat(controlPoints.every(row=>Array.isArray(row)&&row.length===nv&&row.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))),'Rimming control points must form a rectangular XYZ net.');
  // Positive V height derivatives make horizontal sections single-valued in U,
  // needed by offset refinement. This is not an overhang-angle restriction.
  requireThat(controlPoints.every(row=>row.every((p,j)=>p[2]>=0&&(j===0||p[2]>row[j-1][2]))),'Rimming surface must rise monotonically from its base along V, above the bed.');
  const knots=(count,degree)=>Float64Array.from(Array.from({length:count+degree+1},(_,i)=>i<=degree?0:i>=count?1:(i-degree)/(count-degree)));
  const cp=new Float64Array(nu*nv*4),bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  controlPoints.forEach((row,i)=>row.forEach((p,j)=>{
    const xyz=[p[0]+placement.xMm,p[1]+placement.yMm,p[2]];cp.set([...xyz,1],(i*nv+j)*4);
    xyz.forEach((v,k)=>{bounds.min[k]=Math.min(bounds.min[k],v);bounds.max[k]=Math.max(bounds.max[k],v);});
  }));
  return {name:spec.id,nu,nv,orderU:degreeU+1,orderV:degreeV+1,knotsU:knots(nu,degreeU),knotsV:knots(nv,degreeV),cp,domainU:[0,1],domainV:[0,1],bounds};
}

export function supportSurfaceSection(patch,z,options={}) {
  // Match the existing shell convention at a horizontal top boundary. There is
  // no area above it to change sign against; the displacement is numerical only.
  const atTop=Math.abs(z-patch.bounds.max[2])<1e-9;
  const sectionZ=atTop?z-1e-8:z;
  return sectionPatch(patch,{normal:[0,0,1],offset:sectionZ},options).chains;
}

export const supportBoundaryAt=(patch,u,edge)=>evaluate(patch,u,edge==='base'?0:1,false).point;
