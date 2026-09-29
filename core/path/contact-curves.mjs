import {requireThat,distance,normalize,dot,cross} from '../geom/tolerance.mjs';
import {beadContactAlong,depositedBeadBounds} from './deposited-curves.mjs';

// A geometric query over final beads, shared by contact gaps and contact charts.
// The outward ray starts beyond the actual material bounds, not at a nominal
// CAD surface that may now lie inside or behind displaced material.
export function depositedContact(segments,{toleranceMm=0}={}){
  requireThat(segments.length>0,'Deposited contact needs actual material.');
  const bounds=depositedBeadBounds(segments);
  return {bounds,at(point,direction){
    const normal=normalize(direction),ceiling=normal.reduce((sum,n,i)=>sum+n*(n>=0?bounds.max[i]:bounds.min[i]),0)+toleranceMm;
    const start=point.map((p,i)=>p+normal[i]*(ceiling-dot(point,normal)));
    return beadContactAlong(segments,start,normal,{toleranceMm});
  }};
}

// Evaluated substrate chart: its points and metric both come from final beads.
// Finite differences shrink until their physical change meets the authored
// tolerance. Missing material is a real hole, never bridged by interpolation.
export function depositedContactChart(chart,segments,{toleranceMm=.01}={}){
  requireThat(toleranceMm>0,'Contact chart needs positive tolerance.');
  const contact=depositedContact(segments);
  const position=(u,v)=>{
    const reference=chart.at(u,v),hit=contact.at(reference.point,reference.normal);
    requireThat(hit,`Deposited substrate has no contact at chart (${u}, ${v}).`);
    return {...reference,...hit,normal:reference.normal,contactNormal:hit.normal};
  };
  const at=(u,v)=>{
    const center=position(u,v);
    const derivative=axis=>{
      const coordinate=axis===0?u:v,nominal=axis===0?center.du:center.dv;
      let h=Math.min(.01,Math.sqrt(toleranceMm/Math.max(1,Math.hypot(...nominal))));
      const estimate=step=>{
        const a=Math.max(0,coordinate-step),b=Math.min(1,coordinate+step);
        requireThat(b>a,'Contact chart derivative cannot progress.');
        const pa=position(axis===0?a:u,axis===1?a:v).point,pb=position(axis===0?b:u,axis===1?b:v).point;
        return pb.map((p,i)=>(p-pa[i])/(b-a));
      };
      let previous=estimate(h);
      for(;;){
        const next=estimate(h/2);
        if(distance(previous,next)*h<=toleranceMm)return next;
        requireThat(coordinate+h/2!==coordinate,'Deposited contact chart has an unresolved discontinuity.');
        h/=2;previous=next;
      }
    };
    const du=derivative(0),dv=derivative(1),oriented=cross(du,dv);
    requireThat(Math.hypot(...oriented)>1e-12,'Deposited contact chart is locally singular.');
    const normal=normalize(oriented),side=dot(normal,center.normal)<0?-1:1;
    return {...center,du,dv,normal:normal.map(n=>n*side)};
  };
  return {...chart,at,contactGeometry:'final-deposited-beads',contactMetric:'adaptive-finite-difference',toleranceMm};
}

// Curves on an existing deposition: retain lateral coordinates, find the final
// supporting bead surface, and raise each sample by the declared normal gap.
export function contactCurveCourses(curves,{segments,direction=[0,0,1],gapMm,ceilingMm,sampleStepMm=.2,toleranceMm=.01,footprintRadiusMm=0}){
  requireThat(gapMm>0&&sampleStepMm>0&&toleranceMm>0&&Number.isFinite(ceilingMm),'Contact curves need positive gap/sampling and a finite ceiling.');
  const normal=normalize(direction);
  const contact=p=>{
    const along=p.reduce((sum,v,i)=>sum+v*normal[i],0),start=p.map((v,i)=>v+normal[i]*(ceilingMm-along)),hit=beadContactAlong(segments,start,normal,{toleranceMm:footprintRadiusMm+toleranceMm});
    requireThat(hit,'A requested curve leaves finalized deposited support; reduce the offset or add an explicit supporting course.');
    return hit.point.map((v,i)=>v+normal[i]*gapMm);
  };
  return curves.map(curve=>{
    const source=curve.closed?[...curve.points,curve.points[0]]:curve.points,points=[contact(source[0])];
    for(let i=1;i<source.length;i++){
      const stack=[[source[i-1],source[i],points.at(-1),contact(source[i])]];
      while(stack.length){
        const [a,b,pa,pb]=stack.pop(),mid=a.map((v,k)=>(v+b[k])/2),pm=contact(mid),error=distance(pm,pa.map((v,k)=>(v+pb[k])/2));
        if(distance(pa,pb)<=sampleStepMm&&error<=toleranceMm){points.push(pb);continue;}
        requireThat(mid.some((v,k)=>v!==a[k])&&mid.some((v,k)=>v!==b[k]),'Deposited contact curve cannot resolve a support discontinuity at requested tolerance.');
        stack.push([mid,b,pm,pb],[a,mid,pa,pm]);
      }
    }
    // Contact validation may sample densely without changing a flat curve's
    // authored seam candidates or connector choices in the composer.
    const planar=normal[0]===0&&normal[1]===0&&points.every(p=>Math.abs(p[2]-points[0][2])<1e-9);
    const mapped=planar?source.map(p=>[p[0],p[1],points[0][2]]):points;
    return {...curve,closed:curve.closed,points:curve.closed?mapped.slice(0,-1):mapped,heightMm:gapMm,segmentMetadata:mapped.slice(1).map(()=>({surfaceNormal:normal,beadHeightMm:gapMm}))};
  });
}
