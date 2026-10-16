import {requireThat,distance,normalize,dot,cross} from './tolerance.mjs';
import {ROUNDING_MM} from '../dimensions.mjs';
import {prepareExtrudedSegmentQuery} from './extruded-segments.mjs';
import {surfaceReferenceRecord} from './surface-record.mjs';

// Geometric ray access from outside the actual segment bounds.
export function prepareSurfaceContact(segments,{toleranceMm=0}={}){
  requireThat(segments.length>0,'Surface contact needs actual geometry.');
  const query=prepareExtrudedSegmentQuery(segments,{toleranceMm}),bounds=query.bounds;
  return {bounds,at(point,direction){
    const normal=normalize(direction),ceiling=normal.reduce((sum,n,i)=>sum+n*(n>=0?bounds.max[i]:bounds.min[i]),0)+toleranceMm;
    const start=point.map((p,i)=>p+normal[i]*(ceiling-dot(point,normal)));
    return query.cast(start,normal.map(value=>-value));
  }};
}

// Evaluated substrate chart: its points and metric both come from final beads.
// Finite differences shrink until their physical change meets the authored
// tolerance. Where no material lies below, the nominal reference sample and
// frame stand; interpolation never bridges a hole.
// Process scale: default contact chord tolerance, a fortieth of a 0.4 mm line.
const CONTACT_CHORD_MM=.01;
export function contactChart(chart,segments,{toleranceMm=CONTACT_CHORD_MM}={}){
  requireThat(toleranceMm>0,'Contact chart needs positive tolerance.');
  const contact=prepareSurfaceContact(segments),positions=new Map(),frames=new Map();
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
  return {...chart,at,contactGeometry:'final-deposited-beads',contactMetric:'adaptive-finite-difference',toleranceMm,referenceRecord:{representation:'contact-chart',source:surfaceReferenceRecord(chart),segments,toleranceMm}};
}

