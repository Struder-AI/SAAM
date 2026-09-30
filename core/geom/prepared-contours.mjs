// Build reusable contour correspondence before tracing the repeated pattern.
// Z and offset are interpolated together. Unresolved cells use exact queries;
// neither the source contours nor the requested toolpath tolerance is changed.
import {requireThat} from './tolerance.mjs';

// The discrepancy is piecewise linear in perimeter phase. Its Euclidean norm
// attains its maximum at one of the union breakpoints, including the seam.
function fits(corners,weights,actual,tolerance){
  const curves=[...corners,actual].map(c=>c.breakpoints()),indices=new Uint32Array(curves.length);
  const square=tolerance*tolerance;let u=0;
  for(;;){
    let dx=0,dy=0,next=1;
    for(let k=0;k<curves.length;k++){
      const nodes=curves[k];let i=indices[k];
      while(i<nodes.length-2&&nodes[i+1].u<=u)i++;
      indices[k]=i;
      const a=nodes[i],b=nodes[i+1],t=(u-a.u)/(b.u-a.u),weight=k===corners.length?-1:weights[k];
      dx+=weight*(a.p[0]+(b.p[0]-a.p[0])*t);dy+=weight*(a.p[1]+(b.p[1]-a.p[1])*t);
      if(b.u<next)next=b.u;
    }
    if(dx*dx+dy*dy>square)return false;
    if(u===1)return true;
    u=next;
  }
}

export function prepareContourFamily({curveAt,startMm,endMm,stepMm,toleranceMm,offsetStepMm=stepMm}){
  requireThat([startMm,endMm,stepMm,toleranceMm,offsetStepMm].every(Number.isFinite)&&stepMm>0&&offsetStepMm>0&&toleranceMm>0&&endMm>startMm,
    'Prepared contours need a finite positive height interval, step, offset step and tolerance.');
  const slabs=new Map();
  // Keep margin for variation between the construction samples. This reduces
  // measured held-out error; it does not turn sampling into a global proof.
  const acceptanceMm=toleranceMm/2;
  const report={preparedCurves:0,preparedCells:0,directFallbacks:0,mappingToleranceMm:toleranceMm,preparationTargetMm:acceptanceMm,maxCachedCurves:0};
  const weights=(z,o)=>[(1-z)*(1-o),z*(1-o),(1-z)*o,z*o];
  function cell(a,b,c,d,curve){
    report.preparedCells++;
    const corners=[curve(a,c),curve(b,c),curve(a,d),curve(b,d)];
    // Includes all edge quarter-points and nine interior checks. This is a
    // sampled Z/offset error bound, not a certificate for arbitrary surfaces.
    for(const z of [.5,.25,.75,0,1])for(const o of [.5,.25,.75,0,1]){
      if((z===0||z===1)&&(o===0||o===1))continue;
      if(!fits(corners,weights(z,o),curve(a+(b-a)*z,c+(d-c)*o),acceptanceMm))return null;
    }
    return corners;
  }
  function select(z,offset){
    requireThat([z,offset].every(Number.isFinite),'Prepared contour coordinates must be finite.');
    // Boundary arithmetic may differ by a few ulps. Never extrapolate outside
    // the prepared range; exact queries own their original range diagnostics.
    if(z<startMm||z>endMm){report.directFallbacks++;return {direct:curveAt(z,offset)};}
    const index=Math.min(Math.ceil((endMm-startMm)/stepMm)-1,Math.floor((z-startMm)/stepMm));
    let slab=slabs.get(index);
    if(!slab){
      if(slabs.size>=4)slabs.delete(slabs.keys().next().value);
      slab={cells:new Map(),curves:new Map()};slabs.set(index,slab);
    }
    const curve=(height,depth)=>{
      const key=height+':'+depth;
      if(slab.curves.has(key)){
        const value=slab.curves.get(key);slab.curves.delete(key);slab.curves.set(key,value);return value;
      }
      report.preparedCurves++;const result=curveAt(height,depth);
      if(slab.curves.size>=512)slab.curves.delete(slab.curves.keys().next().value);
      slab.curves.set(key,result);
      report.maxCachedCurves=Math.max(report.maxCachedCurves,[...slabs.values()].reduce((n,s)=>n+s.curves.size,0));
      return result;
    };
    const slabStart=startMm+index*stepMm,slabEnd=Math.min(endMm,slabStart+stepMm);
    for(let depth=0;depth<=8;depth++){
      const divisions=2**depth,zStep=(slabEnd-slabStart)/divisions,oStep=offsetStepMm/divisions;
      const zi=Math.min(divisions-1,Math.floor((z-slabStart)/zStep)),oi=Math.floor(offset/oStep);
      const a=slabStart+zi*zStep,b=a+zStep,c=oi*oStep,d=c+oStep,key=depth+':'+zi+':'+oi;
      if(!slab.cells.has(key)){
        // Off-path samples can cross a collapse/topology boundary. Refine the
        // requested cell; an unresolved query retains the exact diagnostic.
        let value;try{value=cell(a,b,c,d,curve);}catch{value=null;}
        if(slab.cells.size>=512)slab.cells.delete(slab.cells.keys().next().value);
        slab.cells.set(key,value);
      }
      const corners=slab.cells.get(key);
      // Failed parent cells are visited by every descendant lookup. Keep
      // those cheap routing decisions resident instead of rebuilding them
      // whenever a long pattern traverses many successful child cells.
      slab.cells.delete(key);slab.cells.set(key,corners);
      if(corners){
        return {corners,weights:weights((z-a)/(b-a),(offset-c)/(d-c))};
      }
    }
    report.directFallbacks++;return {direct:curveAt(z,offset)};
  }
  const point=(selected,u)=>{
    requireThat(Number.isFinite(u),'Prepared contour coordinates must be finite.');
    if(selected.direct)return selected.direct.at(u);
    let x=0,y=0;
    for(let k=0;k<4;k++){const p=selected.corners[k].at(u),w=selected.weights[k];x+=w*p[0];y+=w*p[1];}
    return [x,y];
  };
  function preparedCurveAt(z,offset=0){
    const selected=select(z,offset);if(selected.direct)return selected.direct;
    let nodes;
    const at=u=>point(selected,u),breakpoints=()=>nodes??=[...new Set(selected.corners.flatMap(c=>c.breakpoints().map(n=>n.u)))].sort((a,b)=>a-b).map(u=>({u,p:at(u)}));
    return {at,breakpoints,knots:()=>breakpoints().slice(0,-1).map(n=>n.u)};
  }
  return {at:(u,z,offset=0)=>point(select(z,offset),u),curveAt:preparedCurveAt,report:()=>({...report})};
}
