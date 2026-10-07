import {requireThat,distance,normalize,dot,cross} from '../private/toolpath/numeric.mjs';

import {beadContactAlong,depositedBeadBounds} from './deposited-curves.mjs';

// A geometric query over final beads, shared by contact gaps and contact charts.
// The outward ray starts beyond the actual material bounds, not at a nominal
// CAD surface that may now lie inside or behind displaced material.
export function depositedContact(segments,{toleranceMm=0}={}){
  requireThat(segments.length>0,'Deposited contact needs actual material.');
  const bounds=depositedBeadBounds(segments);
  // Dependency-local bounding hierarchy indexes the existing fragments; it is
  // not a reconstructed surface and carries no new material representation.
  const entries=segments.map((segment,index)=>({segment,index,bounds:depositedBeadBounds([segment])}));
  const build=items=>{
    const box=items.reduce((b,e)=>({min:b.min.map((v,k)=>Math.min(v,e.bounds.min[k])),max:b.max.map((v,k)=>Math.max(v,e.bounds.max[k]))}),{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
    if(items.length<=8)return {bounds:box,items};
    const axis=[0,1,2].sort((a,b)=>(box.max[b]-box.min[b])-(box.max[a]-box.min[a]))[0];
    const ordered=[...items].sort((a,b)=>(a.bounds.min[axis]+a.bounds.max[axis])-(b.bounds.min[axis]+b.bounds.max[axis])),mid=Math.floor(items.length/2);
    return {bounds:box,left:build(ordered.slice(0,mid)),right:build(ordered.slice(mid))};
  };
  const tree=build(entries);
  const intersects=(box,point,normal)=>{
    let low=0,high=Infinity;
    for(let k=0;k<3;k++){
      const epsilon=64*Number.EPSILON*Math.max(1,Math.abs(point[k]),Math.abs(box.min[k]),Math.abs(box.max[k]))+toleranceMm;
      if(Math.abs(normal[k])<1e-14){if(point[k]<box.min[k]-epsilon||point[k]>box.max[k]+epsilon)return false;continue;}
      const a=(point[k]-box.max[k]-epsilon)/normal[k],b=(point[k]-box.min[k]+epsilon)/normal[k];
      low=Math.max(low,Math.min(a,b));high=Math.min(high,Math.max(a,b));if(high<low)return false;
    }
    return true;
  };
  return {bounds,at(point,direction){
    const normal=normalize(direction),ceiling=normal.reduce((sum,n,i)=>sum+n*(n>=0?bounds.max[i]:bounds.min[i]),0)+toleranceMm;
    const start=point.map((p,i)=>p+normal[i]*(ceiling-dot(point,normal)));
    const candidates=[],pending=[tree];
    while(pending.length){const node=pending.pop();if(!intersects(node.bounds,start,normal))continue;if(node.items)candidates.push(...node.items.filter(entry=>intersects(entry.bounds,start,normal)));else pending.push(node.left,node.right);}
    const hit=beadContactAlong(candidates.map(e=>e.segment),start,normal,{toleranceMm});
    return hit?{...hit,segmentIndex:candidates[hit.segmentIndex].index}:null;
  }};
}

// Evaluated substrate chart: its points and metric both come from final beads.
// Finite differences shrink until their physical change meets the authored
// tolerance. Missing material is a real hole, never bridged by interpolation.
export function depositedContactChart(chart,segments,{toleranceMm=.01}={}){
  requireThat(toleranceMm>0,'Contact chart needs positive tolerance.');
  const contact=depositedContact(segments),positions=new Map(),frames=new Map();
  const position=(u,v)=>{
    const key=`${u},${v}`;if(positions.has(key))return positions.get(key);
    const reference=chart.at(u,v),hit=contact.at(reference.point,reference.normal);
    requireThat(hit,`Deposited substrate has no contact at chart (${u}, ${v}), reference ${reference.point.join(', ')} within deposited bounds ${JSON.stringify(contact.bounds)}.`);
    const sample={...reference,...hit,normal:reference.normal,contactNormal:hit.normal};positions.set(key,sample);return sample;
  };
  const at=(u,v)=>{
    const key=`${u},${v}`;if(frames.has(key))return frames.get(key);
    const center=position(u,v);
    const derivative=axis=>{
      const coordinate=axis===0?u:v,nominal=axis===0?center.du:center.dv;
      let h=Math.min(.01,Math.sqrt(toleranceMm/Math.max(1,Math.hypot(...nominal))));
      const estimate=step=>{
        // A periodic seam is interior to the surface. Keep the differentiation
        // interval unwrapped and wrap only its probes, so both seam sides use
        // the same centered frame instead of disagreeing one-sided normals.
        const periodic=axis===0&&chart.periodicU;
        const a=periodic?coordinate-step:Math.max(0,coordinate-step),b=periodic?coordinate+step:Math.min(1,coordinate+step);
        requireThat(b>a,'Contact chart derivative cannot progress.');
        const probeA=periodic?a-Math.floor(a):a,probeB=periodic?b-Math.floor(b):b;
        const pa=position(axis===0?probeA:u,axis===1?probeA:v).point,pb=position(axis===0?probeB:u,axis===1?probeB:v).point;
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
    const frame={...center,du,dv,normal:normal.map(n=>n*side)};frames.set(key,frame);return frame;
  };
  return {...chart,at,contactGeometry:'final-deposited-beads',contactMetric:'adaptive-finite-difference',toleranceMm};
}

// Keep authored positions; only marked contact segments acquire their actual
// normal gap. Contact-field integration refines independently of the geometry
// chord, preserving authored positions and every existing per-segment channel.
export function contactCurveGaps(curves,{segments,direction=[0,0,1],toleranceMm=.001,contactRole='foundation'}){
  requireThat(toleranceMm>0&&Number.isFinite(toleranceMm),'Foundation contact needs a positive physical tolerance.');
  const contact=depositedContact(segments);
  const stepMm=segments.reduce((smallest,s)=>Math.min(smallest,s.radius),Infinity);
  return curves.map(curve=>{
    const heightsMm=curve.heightsMm?[...curve.heightsMm]:curve.points.slice(1).map(()=>curve.heightMm);
    const segmentMetadata=curve.points.slice(1).map((b,i)=>{
      const metadata=curve.segmentMetadata?.[i]??{};
      if(contactRole!==null&&metadata.contactRole!==contactRole)return {...metadata};
      const a=curve.points[i],normal=normalize(metadata.surfaceNormal??direction);
      const samples=new Map();
      const gap=t=>{
        if(samples.has(t))return samples.get(t);
        const p=a.map((v,k)=>v+(b[k]-v)*t),hit=contact.at(p,normal);
        requireThat(hit,'Authored foundation curve has no final deposited support.');
        const h=dot(p.map((v,k)=>v-hit.point[k]),normal);
        requireThat(h>0,`Foundation normal gap ${h} mm is not positive; revise the authored course or supporting deposition.`);
        samples.set(t,h);return h;
      };
      const length=distance(a,b),pending=[[0,1,gap(0),gap(.5),gap(1)]],integrals=[];
      while(pending.length){
        const [lo,hi,left,middle,right]=pending.pop(),mid=(lo+hi)/2;
        const q1=gap((lo+mid)/2),q3=gap((mid+hi)/2);
        const coarse=(left+4*middle+right)/6,fine=(left+4*q1+2*middle+4*q3+right)/12;
        // An integral alone can conceal equal positive/negative errors. Also
        // resolve the field's departure from its linear interpolant.
        const fieldError=Math.max(Math.abs(q1-(3*left+right)/4),Math.abs(middle-(left+right)/2),Math.abs(q3-(left+3*right)/4));
        if(length*(hi-lo)<=toleranceMm||length*(hi-lo)<=stepMm&&Math.abs(fine-coarse)<=toleranceMm/16&&fieldError<=toleranceMm){
          integrals.push((hi-lo)*fine);continue;
        }
        requireThat(mid>lo&&mid<hi,'Foundation contact integration cannot progress at requested tolerance.');
        pending.push([mid,hi,middle,q3,right],[lo,mid,left,q1,middle]);
      }
      heightsMm[i]=integrals.reduce((sum,h)=>sum+h,0);
      return {...metadata,surfaceNormal:normal,beadHeightMm:heightsMm[i]};
    });
    return {...curve,heightsMm,segmentMetadata};
  });
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
