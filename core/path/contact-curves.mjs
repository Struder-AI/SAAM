import {requireThat,distance,normalize,dot,cross} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';

import {prepareExtrudedSegmentQuery} from '../geom/extruded-segments.mjs';

// A geometric query over final beads, shared by contact gaps and contact charts.
// The outward ray starts beyond the actual material bounds, not at a nominal
// CAD surface that may now lie inside or behind displaced material.
export function depositedContact(segments,{toleranceMm=0}={}){
  requireThat(segments.length>0,'Deposited contact needs actual material.');
  const query=prepareExtrudedSegmentQuery(segments,{toleranceMm}),bounds=query.bounds;
  return {bounds,at(point,direction){
    const normal=normalize(direction),ceiling=normal.reduce((sum,n,i)=>sum+n*(n>=0?bounds.max[i]:bounds.min[i]),0)+toleranceMm;
    const start=point.map((p,i)=>p+normal[i]*(ceiling-dot(point,normal)));
    const hit=query.cast(start,normal.map(value=>-value));
    return hit?{...hit,operationId:segments[hit.segmentIndex].operationId}:null;
  }};
}

// Spans of one sampled course whose contact is not ordinary: 'unsupported' (no
// deposited material below; the authored height and nominal bead stand) or
// 'penetrating' (the course runs into existing material; nothing is deposited
// there). samples: [{point,status}] in course order, status null where ordinary.
// A span ends halfway to its ordinary neighbours.
export function contactSpans(samples){
  const along=[0],spans=[];
  for(let i=1;i<samples.length;i++)along.push(along[i-1]+distance(samples[i-1].point,samples[i].point));
  const edge=(i,j)=>samples[j]?{point:samples[i].point.map((v,k)=>(v+samples[j].point[k])/2),alongMm:(along[i]+along[j])/2}:{point:samples[i].point,alongMm:along[i]};
  samples.forEach(({status},i)=>{
    if(!status||samples[i-1]?.status===status)return;
    const next=samples.findIndex((sample,k)=>k>i&&sample.status!==status),last=(next<0?samples.length:next)-1;
    const from=edge(i,i-1),to=edge(last,last+1);
    spans.push({kind:status,fromMm:from.point,toMm:to.point,lengthMm:to.alongMm-from.alongMm});
  });
  return spans;
}

const SPAN_OUTCOME={unsupported:'has no deposited material below; it prints at its authored height with the nominal bead',
  penetrating:'runs into existing material; nothing is deposited there'};
export function contactSpanNote(id,{kind,fromMm,toMm,lengthMm}){
  const at=point=>`(${point.map(v=>v.toFixed(2)).join(', ')})`;
  return `${id}: ${lengthMm.toFixed(2)} mm from ${at(fromMm)} to ${at(toMm)} mm ${SPAN_OUTCOME[kind]}.`;
}

// Evaluated substrate chart: its points and metric both come from final beads.
// Finite differences shrink until their physical change meets the authored
// tolerance. Where no material lies below, the nominal reference sample and
// frame stand; interpolation never bridges a hole.
// Process scale: default contact chord tolerance, a fortieth of a 0.4 mm line.
const CONTACT_CHORD_MM=.01;
export function depositedContactChart(chart,segments,{toleranceMm=CONTACT_CHORD_MM}={}){
  requireThat(toleranceMm>0,'Contact chart needs positive tolerance.');
  const contact=depositedContact(segments),positions=new Map(),frames=new Map();
  const position=(u,v)=>{
    const key=`${u},${v}`;if(positions.has(key))return positions.get(key);
    const reference=chart.at(u,v),hit=contact.at(reference.point,reference.normal);
    const sample=hit?{deposited:true,frame:{...reference,...hit,normal:reference.normal,contactNormal:hit.normal}}:{deposited:false,frame:reference};
    positions.set(key,sample);return sample;
  };
  const at=(u,v)=>{
    const key=`${u},${v}`;if(frames.has(key))return frames.get(key);
    const {deposited,frame:center}=position(u,v);
    if(!deposited){frames.set(key,center);return center;}
    const derivative=axis=>{
      const coordinate=axis===0?u:v,nominal=axis===0?center.du:center.dv;
      // Finite-difference step: square root of the tolerance over the chart scale, capped.
      let h=Math.min(.01,Math.sqrt(toleranceMm/Math.max(1,Math.hypot(...nominal))));
      // A probe beyond the deposited material has no deposited difference: null.
      const estimate=step=>{
        // A periodic seam is interior to the surface. Keep the differentiation
        // interval unwrapped and wrap only its probes, so both seam sides use
        // the same centered frame instead of disagreeing one-sided normals.
        const periodic=axis===0&&chart.periodicU;
        const a=periodic?coordinate-step:Math.max(0,coordinate-step),b=periodic?coordinate+step:Math.min(1,coordinate+step);
        requireThat(b>a,'Contact chart derivative cannot progress.');
        const probeA=periodic?a-Math.floor(a):a,probeB=periodic?b-Math.floor(b):b;
        const pa=position(axis===0?probeA:u,axis===1?probeA:v),pb=position(axis===0?probeB:u,axis===1?probeB:v);
        return pa.deposited&&pb.deposited?pb.frame.point.map((p,i)=>(p-pa.frame.point[i])/(b-a)):null;
      };
      let previous=estimate(h);
      if(!previous)return nominal;
      for(;;){
        const next=estimate(h/2);
        if(!next)return previous;
        if(distance(previous,next)*h<=toleranceMm)return next;
        requireThat(coordinate+h/2!==coordinate,'Deposited contact chart has an unresolved discontinuity.');
        h/=2;previous=next;
      }
    };
    const du=derivative(0),dv=derivative(1),oriented=cross(du,dv);
    requireThat(Math.hypot(...oriented)>ROUNDING_MM**2,'Deposited contact chart is locally singular.');
    const normal=normalize(oriented),side=dot(normal,center.normal)<0?-1:1;
    const frame={...center,du,dv,normal:normal.map(n=>n*side)};frames.set(key,frame);return frame;
  };
  return {...chart,at,contactGeometry:'final-deposited-beads',contactMetric:'adaptive-finite-difference',toleranceMm};
}

// Keep authored positions; only marked contact segments acquire their actual
// normal gap. Contact-field integration refines independently of the geometry
// chord, preserving authored positions and every existing per-segment channel.
// Without material below, a sample keeps its nominal height; where the course
// runs into material, its gap is zero. heightMm: the nominal height of curves
// without their own. -> {curves, spans} (contactSpans).
export function contactCurveGaps(curves,{segments,direction=[0,0,1],toleranceMm=PRINT_RESOLUTION_MM,contactRole='foundation',heightMm}){
  requireThat(toleranceMm>0&&Number.isFinite(toleranceMm),'Foundation contact needs a positive physical tolerance.');
  const contact=depositedContact(segments),spans=[];
  const stepMm=segments.reduce((smallest,s)=>Math.min(smallest,s.radius),Infinity);
  const adapted=curves.map(curve=>{
    const heightsMm=curve.heightsMm?[...curve.heightsMm]:curve.points.slice(1).map(()=>curve.heightMm??heightMm),course=[];
    const segmentMetadata=curve.points.slice(1).map((b,i)=>{
      const metadata=curve.segmentMetadata?.[i]??{};
      if(contactRole!==null&&metadata.contactRole!==contactRole){course.push({point:curve.points[i],status:null},{point:b,status:null});return {...metadata};}
      const a=curve.points[i],normal=normalize(metadata.surfaceNormal??direction),nominal=heightsMm[i];
      const samples=new Map();
      const gap=t=>{
        if(samples.has(t))return samples.get(t).gapMm;
        const p=a.map((v,k)=>v+(b[k]-v)*t),hit=contact.at(p,normal),h=hit?dot(p.map((v,k)=>v-hit.point[k]),normal):null;
        const sample=!hit?{point:p,gapMm:nominal,status:'unsupported'}:h>0?{point:p,gapMm:h,status:null}:{point:p,gapMm:0,status:'penetrating'};
        samples.set(t,sample);return sample.gapMm;
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
      course.push(...[...samples].sort(([s],[t])=>s-t).map(([,sample])=>sample));
      return {...metadata,surfaceNormal:normal,beadHeightMm:heightsMm[i]};
    });
    spans.push(...contactSpans(course));
    return {...curve,heightsMm,segmentMetadata};
  });
  return {curves:adapted,spans};
}

// Curves on an existing deposition: retain lateral coordinates, find the final
// supporting bead surface, and raise each sample by the declared normal gap.
// Without material below, a sample keeps its authored position. A step in the
// supporting surface, or its edge, is located to the tolerance and crossed.
// -> {curves, spans} (contactSpans).
export function contactCurveCourses(curves,{segments,direction=[0,0,1],gapMm,ceilingMm,sampleStepMm=.2,toleranceMm=CONTACT_CHORD_MM,footprintRadiusMm=0}){ // process-scale defaults
  requireThat(gapMm>0&&sampleStepMm>0&&toleranceMm>0&&Number.isFinite(ceilingMm),'Contact curves need positive gap/sampling and a finite ceiling.');
  const normal=normalize(direction),spans=[];
  const contact=p=>{
    const along=p.reduce((sum,v,i)=>sum+v*normal[i],0),start=p.map((v,i)=>v+normal[i]*(ceilingMm-along)),hit=beadContactAlong(segments,start,normal,{toleranceMm:footprintRadiusMm+toleranceMm});
    return hit?{point:hit.point.map((v,i)=>v+normal[i]*gapMm),status:null}:{point:p,status:'unsupported'};
  };
  const placed=curves.map(curve=>{
    const source=curve.closed?[...curve.points,curve.points[0]]:curve.points,samples=[contact(source[0])];
    for(let i=1;i<source.length;i++){
      const stack=[[source[i-1],source[i],samples.at(-1),contact(source[i])]];
      while(stack.length){
        const [a,b,pa,pb]=stack.pop(),mid=a.map((v,k)=>(v+b[k])/2),pm=contact(mid),error=distance(pm.point,pa.point.map((v,k)=>(v+pb.point[k])/2));
        if(distance(pa.point,pb.point)<=sampleStepMm&&error<=toleranceMm||distance(a,b)<=toleranceMm){samples.push(pb);continue;}
        stack.push([mid,b,pm,pb],[a,mid,pa,pm]);
      }
    }
    spans.push(...contactSpans(samples));
    const points=samples.map(sample=>sample.point);
    // Contact validation may sample densely without changing a flat curve's
    // authored seam candidates or connector choices in the composer.
    const planar=normal[0]===0&&normal[1]===0&&points.every(p=>Math.abs(p[2]-points[0][2])<PRINT_RESOLUTION_MM);
    const mapped=planar?source.map(p=>[p[0],p[1],points[0][2]]):points;
    return {...curve,closed:curve.closed,points:curve.closed?mapped.slice(0,-1):mapped,heightMm:gapMm,segmentMetadata:mapped.slice(1).map(()=>({surfaceNormal:normal,beadHeightMm:gapMm}))};
  });
  return {curves:placed,spans};
}
