import {requireThat,distance} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';

import {depositedCurveSegments,curveSupportsPoint} from './deposited-curves.mjs';

// Inspect finalized Trace batches in their construction order. This is one
// consumer of the common finalizer, never a separate finalization lifecycle.
export function traceContactNotes(result){
  if(!result.traceContact)return result;
  const {traceContact,...published}=result,{widthMm,maxExcursionMm}=traceContact;
  const segments=[...traceContact.segments],notes=[],inspectContact=result.operations.some(operation=>operation.strokes.some(curve=>curve.contact));
  for(const operation of result.operations){
    if(maxExcursionMm!==null){
      let low=Infinity,high=-Infinity;
      for(const curve of operation.strokes)for(const point of curve.points){low=Math.min(low,point[2]);high=Math.max(high,point[2]);}
      requireThat(high-low<=maxExcursionMm+PRINT_RESOLUTION_MM,
        'Final Trace repetition exceeds its authored Z excursion limit.');
    }
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

