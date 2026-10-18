import {requireThat,distance,normalize,dot,cross} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';

import {prepareSurfaceContact} from '../geom/contact-chart.mjs';
import {depositedCurveSegments,curveSupportsPoint} from './deposited-curves.mjs';

// Inspect finalized Trace batches in their construction order. This is one
// consumer of the common finalizer, never a separate finalization lifecycle.
export function traceContactNotes(result){
  if(!result.traceContact)return result;
  const {traceContact,...published}=result,{widthMm,maxExcursionMm}=traceContact;
  const segments=[...traceContact.segments],notes=[],inspectContact=result.operations.some(operation=>operation.strokes.some(curve=>curve.contact));
  for(const operation of result.operations){
    const heights=operation.strokes.flatMap(curve=>curve.points.map(point=>point[2]));
    if(maxExcursionMm!==null)requireThat(Math.max(...heights)-Math.min(...heights)<=maxExcursionMm+PRINT_RESOLUTION_MM,
      'Final Trace repetition exceeds its authored Z excursion limit.');
    for(const curve of operation.strokes){
      const c=curve.contact;if(!c)continue;
      const height=curve.beadHeightMm??curve.segmentMetadata?.[0]?.beadHeightMm??operation.process.layerMm;
      const spans=contactSpans(curve.points.slice(1).flatMap((b,i)=>{
        const a=curve.points[i],n=Math.max(1,Math.ceil(distance(a,b)/c.sampleStepMm));
        return Array.from({length:i?n:n+1},(_,j)=>{
          const point=a.map((v,k)=>v+(b[k]-v)*(i?j+1:j)/n);
          return {point,status:curveSupportsPoint(segments,point,(c.referenceZMm??point[2])-(c.gapMm??height),{source:c.source})?null:'unsupported'};
        });
      }));
      notes.push(...spans.map(span=>contactSpanNote(`Trace ${result.id}`,span)));
    }
    if(inspectContact)segments.push(...depositedCurveSegments([{...operation,strokes:operation.strokes.filter(curve=>!curve.depositionAction)}],{widthMm,source:operation.id}));
  }
  return {...published,report:{...result.report,...(notes.length?{notes:[...(result.report.notes??[]),...notes]}:{})}};
}

// A geometric query over final beads, shared by contact gaps and contact charts.
// The outward ray starts beyond the actual material bounds, not at a nominal
// CAD surface that may now lie inside or behind displaced material.
export function depositedContact(segments,options={}){
  const query=prepareSurfaceContact(segments,options);
  return {bounds:query.bounds,at(point,direction){
    const hit=query.at(point,direction);
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
