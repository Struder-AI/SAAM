// Ordinary closed planar curve loops: legacy vertices or chains of points/NURBS.
// Preparation retains native parameters. Polygonal views are derived per query.
import {authoredNurbs,evaluateCurve} from './nurbs.mjs';
import {bezierSpans,bezierRoots,prepareWinding} from './curve-ops.mjs';
import {sampleCurveIntervals} from './curve-sampling.mjs';
import {requireThat,distance} from './tolerance.mjs';
import {ROUNDING_RELATIVE} from '../dimensions.mjs';

const preparations=new WeakMap();
export function prepareCurveLoops(loops){
  if(preparations.has(loops))return preparations.get(loops);
  requireThat(Array.isArray(loops),'Curve regions need a list of closed loops.');
  const native=loops.map(loop=>{
    if(Array.isArray(loop))return polylineCurves(loop,true);
    requireThat(loop&&Object.keys(loop).join()==='curves'&&Array.isArray(loop.curves)&&loop.curves.length>0,'A curve loop needs curves containing points or nurbs.');
    const curves=loop.curves.flatMap(preparePlanarCurve);
    for(const [i,curve] of curves.entries()){
      const next=curves[(i+1)%curves.length],end=evaluateCurve(curve,curve.domain[1]).point,start=evaluateCurve(next,next.domain[0]).point;
      const scale=Math.max(...end.map(Math.abs),...start.map(Math.abs),...curve.cp.map(Math.abs),Number.MIN_VALUE);
      requireThat(distance(end,start)<=ROUNDING_RELATIVE*scale,'Boundary curves must form a closed, connected loop.');
    }
    return curves;
  });
  const flat=native.flat(),result={loops:native,winding:prepareWinding(flat),spans:flat.flatMap(curve=>bezierSpans(curve).map(span=>({...span,curve})))};
  preparations.set(loops,result);return result;
}
export function preparePlanarCurve(curve){
  requireThat(curve&&Object.keys(curve).length===1,'A boundary curve needs exactly points or nurbs.');
  if(curve.nurbs)return [authoredNurbs(curve.nurbs,2)];
  return polylineCurves(curve.points,false);
}
function polylineCurves(points,closed){
  requireThat(Array.isArray(points)&&points.length>=(closed?3:2)&&points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)),'Boundary polylines need finite XY pairs.');
  const curves=[];
  for(let i=0;i<points.length-(closed?0:1);i++){
    const a=points[i],b=points[(i+1)%points.length];if(a.every((v,k)=>v===b[k]))continue;
    curves.push(authoredNurbs({degree:1,knots:[0,0,1,1],controlPoints:[a,b]},2));
  }
  requireThat(curves.length,'Boundary loop is stationary.');return curves;
}
export function curveLoopSamples(loops,at,{toleranceMm,stepMm=Infinity}={}){
  return prepareCurveLoops(loops).loops.map(curves=>curves.flatMap(curve=>{
    const cuts=[...new Set(curve.knots)].filter(t=>t>=curve.domain[0]&&t<=curve.domain[1]);
    const samples=sampleCurveIntervals({at:t=>{const uv=evaluateCurve(curve,t).point.slice(0,2);return {point:at(uv),uv};},cuts,stepMm,toleranceMm});
    return samples.slice(0,-1).map(sample=>sample.uv);
  }));
}

// Native line/curve intersections, including tangent roots and collinear spans.
// The line sweep's winding decision uses retained rational curves, not a polygon.
export function curveLoopLineCuts(origin,direction,loops){
  const prepared=prepareCurveLoops(loops),length2=direction[0]**2+direction[1]**2,cuts=[],contacts=[];
  const project=p=>((p[0]-origin[0])*direction[0]+(p[1]-origin[1])*direction[1])/length2;
  for(const span of prepared.spans){
    const values=Array.from({length:span.cp.length/4},(_,i)=>direction[0]*(span.cp[i*4+1]-origin[1]*span.cp[i*4+3])-direction[1]*(span.cp[i*4]-origin[0]*span.cp[i*4+3]));
    if(values.every(v=>v===0)){
      // A collinear rational span's extrema bound its actual contact interval.
      const p=values.length-1,weights=Array.from({length:p+1},(_,i)=>span.cp[i*4+3]);
      const along=Array.from({length:p+1},(_,i)=>(span.cp[i*4]*direction[0]+span.cp[i*4+1]*direction[1])/length2);
      const derivative=rationalDerivativeCoefficients(along,weights),roots=[];
      bezierRoots(derivative,span.a,span.b,roots);
      const parameters=[span.a,...roots,span.b],positions=parameters.map(t=>project(evaluateCurve(span.curve,t).point));
      const interval=[Math.min(...positions),Math.max(...positions)];contacts.push(interval);cuts.push(...interval);continue;
    }
    const roots=[];bezierRoots(values,span.a,span.b,roots);
    for(const t of roots){const position=project(evaluateCurve(span.curve,t).point);cuts.push(position);contacts.push([position,position]);}
  }
  return {cuts,contacts,winding:prepared.winding};
}
function rationalDerivativeCoefficients(values,weights){
  const p=values.length-1,result=Array(2*p).fill(0);
  const choose=(n,k)=>{const state={v:1};for(let i=1;i<=k;i++)state.v*= (n-i+1)/i;return state.v;};
  for(let i=0;i<p;i++)for(let j=0;j<=p;j++)result[i+j]+=p*((values[i+1]-values[i])*weights[j]-(weights[i+1]-weights[i])*values[j])*choose(p-1,i)*choose(p,j)/choose(2*p-1,i+j);
  return result;
}
