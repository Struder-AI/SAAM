import {distance,requireThat} from '../geom/tolerance.mjs';
import {validateModulationField,evaluateScalarField,fieldSampleStep} from './modulation-field.mjs';

const positive=n=>Number.isFinite(n)&&n>0;
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const unit=v=>{const length=Math.hypot(...v);requireThat(length>1e-12,'Modulation direction is ambiguous at a reversing corner.');return v.map(n=>n/length);};
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
export const defaultModulations=()=>({version:1,modifiers:[]});

export function validateModulations(record,{assignmentIds}={}) {
  requireThat(record&&Object.keys(record).sort().join()==='modifiers,version'&&record.version===1&&Array.isArray(record.modifiers),'Modulations need version:1 and modifiers.');
  const ids=new Set();
  for(const m of record.modifiers){
    const expected=['id','assignments','roles','channel','amplitude','field','sampleStepMm','tolerance',...(m?.channel==='displacement'?['direction']:[])].sort().join();
    requireThat(m&&Object.keys(m).sort().join()===expected,'Invalid modulation fields.');
    requireThat(typeof m.id==='string'&&/^[a-z][a-z0-9-]*$/.test(m.id)&&!ids.has(m.id),'Invalid or duplicate modulation id.');ids.add(m.id);
    for(const key of ['assignments','roles'])requireThat(m[key]===null||Array.isArray(m[key])&&m[key].length>0&&new Set(m[key]).size===m[key].length&&m[key].every(id=>typeof id==='string'&&id.length>0),`Modulation ${key} must be null or distinct nonempty names.`);
    requireThat(!assignmentIds||m.assignments===null||m.assignments.every(id=>assignmentIds.includes(id)),`Modulation ${m.id} targets an unknown slice assignment.`);
    requireThat(['displacement','flow','width'].includes(m.channel)&&Number.isFinite(m.amplitude)&&positive(m.sampleStepMm)&&positive(m.tolerance),'Modulation needs a supported channel, finite amplitude, positive sampleStepMm and tolerance.');
    if(m.channel==='displacement')requireThat(m.direction==='lateral'||vector(m.direction)&&Math.hypot(...m.direction)>0,'Displacement direction must be lateral or a nonzero XYZ vector.');
    validateModulationField(m.field);
  }
  return record;
}

export function matchingModulations(result,role,record) {
  const assignment=result.report?.owner??result.id;
  return record.modifiers.filter(m=>m.amplitude!==0&&(m.assignments===null||m.assignments.includes(assignment))&&(m.roles===null||m.roles.includes(role)));
}

// Both ends of a closed curve use this same averaged source tangent. Neither
// corner directions nor modulation sampling change its authored ordering.
function lateralDirections(points,closed) {
  const duplicate=distance(points[0],points.at(-1))<1e-12;
  const count=duplicate?points.length-1:points.length,cyclic=closed||duplicate,result=[];
  for(let i=0;i<count;i++){
    const previous=i>0?points[i-1]:cyclic?points[count-1]:null,next=i+1<count?points[i+1]:cyclic?points[0]:null;
    const incoming=previous?unit([points[i][0]-previous[0],points[i][1]-previous[1],0]):null;
    const outgoing=next?unit([next[0]-points[i][0],next[1]-points[i][1],0]):null;
    const tangent=incoming&&outgoing?unit(incoming.map((v,a)=>v+outgoing[a])):incoming??outgoing;
    result.push([tangent[1],-tangent[0],0]);
  }
  return duplicate?[...result,result[0]]:result;
}

function evaluateModulatedPoint(a,b,t,modifiers,directions) {
  const source=mix(a,b,t),point=[...source];let flow=1,width=1;
  for(const m of modifiers){
    const amount=m.amplitude*evaluateScalarField(m.field,source);
    requireThat(Number.isFinite(amount),`Modulation ${m.id} produced a nonfinite value.`);
    if(m.channel==='displacement'){
      const direction=m.direction==='lateral'?unit(mix(directions[0],directions[1],t)):unit(m.direction);
      for(let axis=0;axis<3;axis++)point[axis]+=direction[axis]*amount;
    }else{
      requireThat(1+amount>0,`Modulation ${m.id} produced a nonpositive ${m.channel} factor.`);
      if(m.channel==='flow')flow*=1+amount;else width*=1+amount;
    }
  }
  requireThat(point.every(Number.isFinite)&&Number.isFinite(flow)&&Number.isFinite(width),'Modulation overflowed the numeric representation.');
  return {t,point,source,flow,width};
}

function sampleModulatedSegment(a,b,modifiers,directions) {
  const step=modifiers.reduce((value,m)=>Math.min(value,m.sampleStepMm,fieldSampleStep(m.field)),Infinity),tolerance=modifiers.reduce((value,m)=>Math.min(value,m.tolerance),Infinity);
  const first=evaluateModulatedPoint(a,b,0,modifiers,directions),last=evaluateModulatedPoint(a,b,1,modifiers,directions),stack=[[first,last]],samples=[first];
  while(stack.length){
    const [left,right]=stack.pop(),midpoint=(left.t+right.t)/2;
    const middle=evaluateModulatedPoint(a,b,midpoint,modifiers,directions);
    const probes=[.25,.5,.75].map(t=>t===.5?middle:evaluateModulatedPoint(a,b,left.t+(right.t-left.t)*t,modifiers,directions));
    const error=Math.max(...probes.map((probe,i)=>{
      const t=(i+1)/4;
      return Math.max(distance(probe.point,mix(left.point,right.point,t)),Math.abs(probe.flow-(left.flow+(right.flow-left.flow)*t)),Math.abs(probe.width-(left.width+(right.width-left.width)*t)));
    }));
    if(distance(left.source,right.source)<=step&&error<=tolerance){samples.push(right);continue;}
    requireThat(midpoint>left.t&&midpoint<right.t,'Modulation subdivision cannot progress at the requested tolerance.');
    stack.push([middle,right],[left,middle]);
  }
  return samples;
}

export function modulateStroke(stroke,modifiers) {
  if(!modifiers.length)return {stroke,changed:false,maxExcursionMm:0};
  requireThat(!stroke.poses&&!stroke.stationaryExtrusion,'Modulation currently requires moving strokes without tool poses; oriented and point deposition need their own process construction.');
  requireThat(stroke.points.length>=2,'Modulation needs a curve with at least two points.');
  const points=stroke.closed?[...stroke.points,stroke.points[0]]:stroke.points;
  requireThat(!stroke.volumesMm3||stroke.volumesMm3.length===points.length-1,'Modulation needs one source volume per segment.');
  requireThat(!stroke.segmentMetadata||stroke.segmentMetadata.length===points.length-1,'Modulation needs one source metadata record per segment.');
  const directions=modifiers.some(m=>m.direction==='lateral')?lateralDirections(points,stroke.closed):null;
  const output=[],volumes=[],metadata=[];let maxExcursionMm=0,changed=false;
  for(let i=0;i<points.length-1;i++){
    const length=distance(points[i],points[i+1]);
    requireThat(length>0,'Modulation requires nonzero source segments.');
    const volume=stroke.volumesMm3?.[i]??length*stroke.beadAreaMm2;
    const width=stroke.segmentMetadata?.[i]?.beadWidthMm??stroke.beadWidthMm;
    requireThat(Number.isFinite(volume)&&volume>=0&&positive(width),'Modulation needs deposited segment volume and bead width.');
    const samples=sampleModulatedSegment(points[i],points[i+1],modifiers,directions?[directions[i],directions[i+1]]:null);
    if(!output.length)output.push(samples[0].point);
    for(let j=1;j<samples.length;j++){
      const left=samples[j-1],right=samples[j],mid=evaluateModulatedPoint(points[i],points[i+1],(left.t+right.t)/2,modifiers,directions?[directions[i],directions[i+1]]:null);
      const excursion=Math.max(distance(left.point,left.source),distance(right.point,right.source),distance(mid.point,mid.source));
      maxExcursionMm=Math.max(maxExcursionMm,excursion);changed ||= excursion>0||mid.flow!==1||mid.width!==1;
      output.push(right.point);volumes.push(volume/length*distance(left.point,right.point)*mid.flow*mid.width);
      metadata.push({...stroke.segmentMetadata?.[i],beadWidthMm:width*mid.width});
    }
  }
  if(!changed)return {stroke,changed:false,maxExcursionMm:0};
  // Sampling arrays describe the producer's original vertices. The final
  // segment metadata retains its frozen surfaceNormal, but these vertex/chart
  // samples and the former uniform area must not describe subdivided output.
  const {normals,chartPoints,beadAreaMm2,...retained}=stroke;
  return {stroke:{...retained,closed:false,points:output,volumesMm3:volumes,segmentMetadata:metadata},changed:true,maxExcursionMm};
}

export function finalizeModulatedResult(result,record) {
  const changedOperations=[],used=new Set();let maxExcursionMm=0;
  const operations=result.operations.map(operation=>{
    let changed=false;
    const strokes=operation.strokes.map(stroke=>{
      const modifiers=matchingModulations(result,stroke.role,record);
      requireThat(!modifiers.length||!stroke.segmentMetadata?.some(m=>m?.role!==undefined&&m.role!==stroke.role),'Modulation of a stroke with mixed segment roles requires separate role strokes.');
      const answer=modulateStroke(stroke,modifiers);
      if(answer.changed){changed=true;for(const m of modifiers)used.add(m.id);}
      maxExcursionMm=Math.max(maxExcursionMm,answer.maxExcursionMm);return answer.stroke;
    });
    if(!changed)return operation;
    changedOperations.push(operation.id);
    return {...operation,strokes,order:operation.order==='nearest'?'given':operation.order,modulationPendingPublication:true};
  });
  const changed=changedOperations.length>0,report={changed,maxExcursionMm,changedOperations,modifiers:[...used]};
  return {result:changed?{...result,operations,modulationPendingPublication:true}:result,report,invalidatedPublications:changed};
}
