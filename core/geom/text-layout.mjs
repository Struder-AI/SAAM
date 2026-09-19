// Shared flat text layout, before mapping its solid to a surface.
import {requireThat,distance} from './tolerance.mjs';
import {flattenBezier} from './text-outline.mjs';

function baselineMapper(spec,toleranceMm){
  if(spec===null)return (x,y)=>[x,y];
  if(spec?.kind==='circle'){
    requireThat(Object.keys(spec).every(k=>['kind','radiusMm','startAngleDeg','clockwise'].includes(k)),'Unknown circular baseline field.');
    const {radiusMm:r,startAngleDeg=90,clockwise=true}=spec;
    requireThat(Number.isFinite(r)&&r>0&&Number.isFinite(startAngleDeg)&&typeof clockwise==='boolean','Circular baseline needs a positive radiusMm, finite startAngleDeg and boolean clockwise.');
    const direction=clockwise?-1:1,start=startAngleDeg*Math.PI/180;
    return (x,y)=>{
      const radius=r-direction*y;
      requireThat(radius>0,'Circular lettering crosses its centre; increase radiusMm or reduce the text size.');
      const angle=start+direction*x/r;
      return [radius*Math.cos(angle),radius*Math.sin(angle)];
    };
  }
  requireThat(spec&&Object.keys(spec).every(k=>['controlPoints','startMm'].includes(k))&&Array.isArray(spec.controlPoints)&&[3,4].includes(spec.controlPoints.length)&&spec.controlPoints.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)),'Baseline needs three or four XY Bezier control points.');
  const start=spec.startMm??0;requireThat(Number.isFinite(start)&&start>=0,'Baseline startMm must be nonnegative.');
  const points=[spec.controlPoints[0]],parameters=[0];flattenBezier(spec.controlPoints,toleranceMm/4,points,parameters);
  const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+distance(points[i],points[i-1]));
  requireThat(lengths.at(-1)>0,'Text baseline has zero length.');
  return (x,y)=>{
    const s=x+start;requireThat(s>=0&&s<=lengths.at(-1),'Text exceeds baseline length; change size or startMm.');
    let i=1;while(i<lengths.length-1&&lengths[i]<s)i++;
    const len=lengths[i]-lengths[i-1];
    requireThat(len>1e-10,'Text baseline has a degenerate segment.');
    const t=parameters[i-1]+(parameters[i]-parameters[i-1])*(s-lengths[i-1])/len;
    const at=cp=>{let row=cp;while(row.length>1)row=row.slice(1).map((p,i)=>p.map((v,k)=>row[i][k]+(v-row[i][k])*t));return row[0];};
    const p=at(spec.controlPoints),d=at(spec.controlPoints.slice(1).map((p,i)=>p.map((v,k)=>(v-spec.controlPoints[i][k])*(spec.controlPoints.length-1)))),norm=Math.hypot(...d);
    requireThat(norm>1e-10,'Text baseline has a singular tangent.');
    return [p[0]-d[1]*y/norm,p[1]+d[0]*y/norm];
  };
}

export function textLayout(feature,toleranceMm){
  const along=baselineMapper(feature.baseline,toleranceMm),angle=feature.rotationDeg*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  return (x,y)=>{
    const [a,b]=along(feature.mirror?-x:x,y);
    return [feature.positionMm[0]+a*c-b*s,feature.positionMm[1]+a*s+b*c];
  };
}
