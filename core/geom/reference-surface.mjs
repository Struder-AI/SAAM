// Open spline references are independent of printable, closed part geometry.
import {evaluate} from './nurbs.mjs';
import {requireThat,cross,normalize} from './tolerance.mjs';

export function referencePatch(spec){
  const {degreeU,degreeV,controlPoints}=spec;
  requireThat(Array.isArray(controlPoints)&&controlPoints.length>=2,'Reference needs a rectangular control net.');
  const nu=controlPoints.length,nv=controlPoints[0]?.length;
  for(const [d,n] of [[degreeU,nu],[degreeV,nv]])requireThat(Number.isInteger(d)&&d>=1&&d<=5&&n>d,'Reference spline degree must be 1–5 and less than its control count.');
  requireThat(controlPoints.every(row=>Array.isArray(row)&&row.length===nv&&row.every(p=>Array.isArray(p)&&[3,4].includes(p.length)&&p.every(Number.isFinite)&&(p.length===3||p[3]>0))),'Reference points must be XYZ or XYZ plus positive weight.');
  const knots=(n,d,supplied)=>{
    const k=supplied??Array.from({length:n+d+1},(_,i)=>i<=d?0:i>=n?1:(i-d)/(n-d));
    requireThat(Array.isArray(k)&&k.length===n+d+1&&k.every((v,i)=>Number.isFinite(v)&&(i===0||v>=k[i-1]))&&k[d]<k[n],'Invalid full reference knot vector.');
    return Float64Array.from(k);
  };
  const knotsU=knots(nu,degreeU,spec.knotsU),knotsV=knots(nv,degreeV,spec.knotsV);
  const cp=Float64Array.from(controlPoints.flatMap(row=>row.flatMap(p=>{const w=p[3]??1;return [p[0]*w,p[1]*w,p[2]*w,w];})));
  return {name:'text-reference',nu,nv,orderU:degreeU+1,orderV:degreeV+1,knotsU,knotsV,cp,domainU:[knotsU[degreeU],knotsU[nu]],domainV:[knotsV[degreeV],knotsV[nv]]};
}

export function referenceSurface(spec,part){
  requireThat(spec&&['plane','spline','part'].includes(spec.kind),'Text reference must be plane, spline or part.');
  const fields={plane:['kind','origin','xAxis','yAxis','normalSide'],part:['kind','patch','sizeMm','uvBounds','normalSide'],spline:['kind','degreeU','degreeV','controlPoints','knotsU','knotsV','sizeMm','uvBounds','normalSide']};
  requireThat(Object.keys(spec).every(k=>fields[spec.kind].includes(k)),'Unknown text reference field.');
  const normalSide=spec.normalSide??1;
  requireThat([1,-1].includes(normalSide),'Reference normalSide must be 1 or -1.');
  if(spec.kind==='plane'){
    const {origin,xAxis,yAxis}=spec;
    requireThat([origin,xAxis,yAxis].every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)),'Plane needs origin, xAxis and yAxis XYZ vectors.');
    const x=normalize(xAxis),y=normalize(yAxis);
    requireThat(Math.abs(x.reduce((sum,v,i)=>sum+v*y[i],0))<1e-8,'Plane axes must be perpendicular.');
    const n=normalize(cross(x,y)).map(v=>v*normalSide);
    return (a,b)=>({point:origin.map((v,i)=>v+a*x[i]+b*y[i]),normal:n});
  }
  const patch=spec.kind==='spline'?referencePatch(spec):part?.patches?.find(p=>p.name===spec.patch);
  requireThat(patch,'Selected text reference patch is missing; mesh parts need an independent plane or spline reference.');
  const size=spec.sizeMm;
  requireThat(Array.isArray(size)&&size.length===2&&size.every(v=>Number.isFinite(v)&&v>0),'Spline mapping needs positive sizeMm [width,height].');
  const bounds=spec.uvBounds??[patch.domainU,patch.domainV];
  requireThat(Array.isArray(bounds)&&bounds.length===2&&bounds.every((b,i)=>Array.isArray(b)&&b.length===2&&b.every(Number.isFinite)&&b[1]>b[0]&&b[0]>=[patch.domainU,patch.domainV][i][0]&&b[1]<=[patch.domainU,patch.domainV][i][1]),'Text reference UV bounds exceed the patch.');
  return (x,y)=>{
    const u=x/size[0],v=y/size[1];
    requireThat(u>=-1e-9&&u<=1+1e-9&&v>=-1e-9&&v<=1+1e-9,'Text extends outside its spline reference; change placement, sizeMm or the control surface.');
    const e=evaluate(patch,bounds[0][0]+Math.max(0,Math.min(1,u))*(bounds[0][1]-bounds[0][0]),bounds[1][0]+Math.max(0,Math.min(1,v))*(bounds[1][1]-bounds[1][0]));
    requireThat(e.normal,'Text reference has a singular tangent.');
    return {point:e.point,normal:e.normal.map(n=>n*normalSide)};
  };
}
