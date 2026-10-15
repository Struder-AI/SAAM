import {requireThat,distance} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {authoredNurbs} from './spatial.mjs';
import {curvePoint} from './surface-curves.mjs';
import {evaluateSurface} from './surface-evaluation.mjs';
import {sampleCurveIntervals} from './curve-sampling.mjs';

// Polyline vertices as read: a segment whose ends repeat a vertex has no length
// and is dropped with its metadata (segments: the source indices kept).
export function distinctPolyline(points,closed){
  const segments=[];
  for(let j=0;j<points.length-(closed?0:1);j++){const a=points[j],b=points[(j+1)%points.length];if(a.some((v,k)=>v!==b[k]))segments.push(j);}
  return {points:closed?segments.map(j=>points[j]):[points[0],...segments.map(j=>points[j+1])],segments};
}
// Native t is normalized over the active knot domain; polylines use cumulative
// source chord length. Refinement retains profile knots and native knot spans.
function authoredSegment(lengths,distanceMm){
  let lo=1,hi=lengths.length-1;
  while(lo<hi){const mid=Math.floor((lo+hi)/2);if(lengths[mid]<distanceMm)lo=mid+1;else hi=mid;}
  return lo;
}
// Source curve sampling retains native parameters and chord-length polyline parameters.
// The caller supplies resolved surfaces and additional parameter cuts, without process records.
export function sampleSpatialCurve({points,nurbs,closed=false,surface=null,normalMm=0},
  {offset=[0,0,0],toleranceMm,sampleStepMm,cuts=[],chartSteps=[]}){
  const dimension=surface?2:3,native=nurbs?authoredNurbs(nurbs,dimension):null;
  if(native&&closed)requireThat(distance(curvePoint(native,0),curvePoint(native,1))<PRINT_RESOLUTION_MM,'Closed NURBS must meet at their domain endpoints.');
  const source=native?null:(closed?[...points,points[0]]:points),lengths=[0];
  if(source)for(let i=1;i<source.length;i++)lengths.push(lengths.at(-1)+Math.hypot(...source[i].map((x,k)=>x-source[i-1][k])));
  const local=t=>{if(native)return curvePoint(native,t).slice(0,dimension);const d=t*lengths.at(-1),i=authoredSegment(lengths,d),f=(d-lengths[i-1])/(lengths[i]-lengths[i-1]);return source[i-1].map((v,k)=>v+(source[i][k]-v)*f);};
  const at=t=>{const chart=local(t),e=surface?evaluateSurface(surface,chart,normalMm):{point:chart};requireThat(!surface||e.normal,'Curve reference has a singular tangent.');return {t,chart,...e,point:e.point.map((v,i)=>v+offset[i])};};
  const breaks=[0,1,...(native?[...native.knots].filter(k=>k>native.domain[0]&&k<native.domain[1]).map(k=>(k-native.domain[0])/(native.domain[1]-native.domain[0])):lengths.map(l=>l/lengths.at(-1))),...cuts];
  const samples=sampleCurveIntervals({at,cuts:breaks,stepMm:sampleStepMm,toleranceMm,chartSteps});
  const sourceSegments=samples.slice(1).map((sample,i)=>authoredSegment(lengths,(sample.t+samples[i].t)/2*lengths.at(-1))-1);
  return {samples,sourceSegments};
}

export function curveLength(points){
  return points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0);
}
