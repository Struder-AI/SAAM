// Experimental intrinsic (geodesic) region offset on one regular, injective,
// C2 NURBS patch. Positive expands, negative erodes. Input boundaries are UV
// polylines on this patch. Rhino is a behavioural reference, NOT copied source.
//
// SAAM generates geodesic boundary strips and vertex disks. Clipper2's
// unchanged winding/union/difference machinery resolves overlaps, holes and
// collapse. This is not a constant UV offset. UV is retained throughout; there
// are no closest-point searches, global flattening or inverse remapping passes.
// Numerical integration/subdivision are construction work, not an independent
// runtime validation pass. See BUILDERS.md for limits and reference status.
import { requireThat, dot, cross, normalize } from '../geom/tolerance.mjs';
import {evaluateCurve} from '../geom/nurbs.mjs';
import {sampleCurveIntervals} from '../geom/curve-sampling.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import { surfaceDerivatives } from '../geom/surface-derivatives.mjs';
import { evaluatedSurfaceDerivatives } from '../geom/evaluated-surface.mjs';
import { clipperContext, clipPaths, simplifyPaths } from './clipper.mjs';
import {intersect,difference,union,clipOpenPaths} from './intersection.mjs';
import {pointSegmentDistance} from './region2d.mjs';
import {piecewiseChart,piecewiseChartFrame,piecewiseChartRay,splitPiecewiseChartPath} from '../geom/piecewise-chart.mjs';
import {PROGRAM_STEP_MM,ROUNDING_MM,ROUNDING_RELATIVE,PRINT_RESOLUTION_MM} from '../dimensions.mjs';

// Native spline parameters carry no metric: points coincide or touch an edge within
// the dimensionless rounding tolerance, and booleans snap to a grid a tenth of it so
// that snapping stays inside that tolerance.
export const UV_ROUNDING=ROUNDING_RELATIVE,UV_GRID=UV_ROUNDING/10;
// Process scale: the default construction chord of a surface offset (callers pass
// their own, usually from the print's line width).
const SURFACE_OFFSET_CHORD_MM=0.01;

const plus=(a,b,s=1)=>a.map((x,k)=>x+b[k]*s);
const midpoint=(a,b)=>a.map((x,k)=>(x+b[k])/2);
const distance=(a,b)=>Math.hypot(...a.map((x,k)=>x-b[k]));

export function offsetSurfaceRegion(patch,loopsUv,deltaMm,settings={}){
  const prepared=prepareSurfaceOffset(patch,loopsUv,deltaMm,settings);
  const swept=sweepSurfaceOffset(patch,prepared);
  return finishSurfaceOffset(patch,prepared,swept);
}

// Physical geodesic buffer of open or closed chart centerlines. Both sides
// and full vertex disks are unioned by the same offset topology stage.
export function strokeSurfaceRegion(patch,paths,radiusMm,settings={}){
  requireThat(Number.isFinite(radiusMm)&&radiusMm>0&&Array.isArray(paths)&&paths.every(p=>p.points?.length>=2),'Surface stroke buffer needs paths and a positive radius.');
  const base=prepareSurfaceOffset(patch,[],radiusMm,settings);
  requireSurfacePaths(patch,paths.map(path=>path.points),base.settings.precisionUv);
  const prepared={...base,strokePaths:base.atlas?paths.map(path=>splitPiecewiseChartPath(base.atlas,path)):paths};
  return finishSurfaceOffset(patch,prepared,sweepSurfaceOffset(patch,prepared));
}

export function prepareSurfaceOffset(patch, loopsUv, deltaMm, {
  toleranceMm=SURFACE_OFFSET_CHORD_MM, maxStepMm=Math.max(Math.abs(deltaMm),toleranceMm), precisionUv=UV_GRID,
  constraintLoopsUv=null,normalMm=0
}={}) {
  requireThat(Number.isFinite(deltaMm), 'Surface offset distance must be finite.');
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0&&Number.isFinite(maxStepMm)&&maxStepMm>0,
    'Surface offset toleranceMm and maxStepMm must be positive and finite.');
  requireThat((patch?.cp||['slice-chart','sleeve-chart','surface-chart'].includes(patch?.kind)) && patch.domainU && patch.domainV, 'Surface offset requires a native patch or evaluated chart.');
  const piecewise=patch.kind==='sleeve-chart'||patch.kind==='slice-chart'&&patch.slice?.reference?.kind==='roof';
  const atlas=patch.atlas??(piecewise?piecewiseChart(patch,{toleranceMm:toleranceMm/4,normalMm}):null);
  if(atlas)patch={...patch,atlas};
  // Geodesic ODE needs a continuous second derivative through internal knots.
  const native=patch.cp?patch:patch.slice?.reference?.patch;
  for(const [knots,order,domain] of native?[[native.knotsU,native.orderU,native.domainU],[native.knotsV,native.orderV,native.domainV]]:[]) {
    const counts=new Map(); for(const t of knots)if(t>domain[0]&&t<domain[1])counts.set(t,(counts.get(t)??0)+1);
    requireThat([...counts.values()].every(n=>order-1-n>=2),'Surface offset currently requires C2 continuity across internal knots.');
  }
  loopsUv=loopsUv.map(loop=>{
    if(Array.isArray(loop))return loop;
    const curve=loop.curve;
    requireThat(curve?.domain&&curve.knots&&curve.cp,'Surface region boundaries need UV loops or closed native chart curves.');
    const samples=sampleCurveIntervals({at:t=>{const uv=evaluateCurve(curve,t).point.slice(0,2);return {point:evaluateSurface(patch,uv,normalMm).point,uv};},
      cuts:[curve.domain[0],...curve.knots.filter(t=>t>curve.domain[0]&&t<curve.domain[1]),curve.domain[1]],stepMm:maxStepMm,toleranceMm:toleranceMm/8});
    requireThat(distance(samples[0].uv,samples.at(-1).uv)<=UV_ROUNDING,'Surface region boundaries must close in chart coordinates; use a surface stroke for open centerlines.');
    return samples.slice(0,-1).map(sample=>sample.uv);
  });
  requireSurfacePaths(patch,loopsUv,precisionUv);
  const origin=constraintLoopsUv===null?null:[patch.domainU[0],patch.domainV[0]];
  const initial=clipperContext([loopsUv],precisionUv,0,origin);
  const source=initial.decode(clipPaths(initial.encode(loopsUv)));
  const domain=[[patch.domainU[0],patch.domainV[0]],[patch.domainU[1],patch.domainV[0]],
    [patch.domainU[1],patch.domainV[1]],[patch.domainU[0],patch.domainV[1]]];
  const options={precisionMm:precisionUv,origin};
  const constraint=constraintLoopsUv===null?null:intersect(constraintLoopsUv,[domain],options);
  requireThat(constraint===null||deltaMm>=0,'Constrained surface offsets currently support outward growth only.');
  // Erosion is bounded by the chart just like an atlas ray. No synthetic
  // surface continuation is needed for the part of a band discarded outside it.
  const boundary=constraint??(deltaMm<0?[domain]:null);
  const settings={deltaMm,toleranceMm,maxStepMm,precisionUv,origin,normalMm,bounded:boundary!==null};
  const {at,samples}=createSurfaceSampler(patch,settings);
  const simplified=deltaMm===0?{loops:source,simplificationUv:0,collapsedContours:0}:
    simplifySurfaceLoops(source,{constraint,initial,toleranceMm,precisionUv},at);
  return {source:simplified.loops,constraint,boundary,initial,settings,atlas,surfaceSamples:samples,
    work:{evaluations:samples.size,simplificationUv:simplified.simplificationUv,collapsedContours:simplified.collapsedContours}};
}

export function sweepSurfaceOffset(patch,prepared){
  if(prepared.atlas)patch={...patch,atlas:prepared.atlas};
  const {source,boundary:constraint,settings}=prepared;
  const {deltaMm,toleranceMm,maxStepMm,precisionUv,origin}=settings;
  const options={precisionMm:precisionUv,origin};
  const {at,samples}=createSurfaceSampler(patch,settings,[prepared.surfaceSamples]);
  let integrations=0,subdivisions=0;
  let boundaryStops=0;
  // A constrained ray ends at its first boundary crossing, never at a later
  // re-entry across a hole. All topology/clipping remains in the shared kernel.
  const stopAtBoundary=(a,b)=>{
    if(prepared.constraint===null){
      // Natural rectangular chart edges need no polygon-kernel allocation.
      let fraction=1;
      for(const [k,[lo,hi]] of [patch.domainU,patch.domainV].entries()){
        const d=b[k]-a[k];
        if(b[k]<lo&&d<0)fraction=Math.min(fraction,(lo-a[k])/d);
        if(b[k]>hi&&d>0)fraction=Math.min(fraction,(hi-a[k])/d);
      }
      return fraction===1?b:plus(a,plus(b,a,-1),Math.max(0,fraction));
    }
    const pieces=clipOpenPaths([[a,b]],constraint,options),epsilon=precisionUv*8;
    for(const loop of constraint)for(let i=0;i<loop.length;i++){
      const p=loop[i],q=loop[(i+1)%loop.length];
      if(pointSegmentDistance(a,p,q)<=epsilon&&pointSegmentDistance(b,p,q)<=epsilon)return b;
      if(pointSegmentDistance(a,p,q)<=epsilon){
        const ends=[p,q].filter(end=>distance(end,a)>epsilon&&pointSegmentDistance(end,a,b)<=epsilon);
        if(ends.length)return ends.sort((p,q)=>distance(q,a)-distance(p,a))[0];
      }
    }
    for(const piece of pieces){
      if(distance(piece[0],a)<=epsilon)return piece.at(-1);
      if(distance(piece.at(-1),a)<=epsilon)return piece[0];
    }
    return a;
  };
  // An outward edge already coincident with the allowed boundary has no
  // growing side. Repeated fronts must not re-integrate these fixed edges.
  const blockedEdge=(a,b)=>deltaMm>0&&constraint!==null&&constraint.some(loop=>loop.some((p,i)=>{
    const q=loop[(i+1)%loop.length];
    return (b[0]-a[0])*(q[0]-p[0])+(b[1]-a[1])*(q[1]-p[1])>0&&
      pointSegmentDistance(a,p,q)<=precisionUv*8&&pointSegmentDistance(b,p,q)<=precisionUv*8;
  }));
  const frameAtState=uv=>at(constraint===null?uv:uv.map((x,k)=>Math.max([patch.domainU,patch.domainV][k][0],Math.min([patch.domainU,patch.domainV][k][1],x))));
  const radius=Math.abs(deltaMm), bands=[];
  // A sweep cell is bounded by its original rays. Resampling or triangulating
  // it adds internal edges whose quantized intersections can enclose false
  // holes. Give the region kernel the actual boundary, shared with its neighbours.
  const connectRays=(one,two)=>{
    const boundary=[...one,...two.slice().reverse()];
    const area=boundary.reduce((sum,p,i)=>{const q=boundary[(i+1)%boundary.length];return sum+p[0]*q[1]-q[0]*p[1];},0);
    if(area!==0)bands.push(area>0?boundary:boundary.reverse());
  };
  const rhs=state=>{
    const frame=frameAtState(state.slice(0,2)), [p,q]=state.slice(2);
    const acceleration=frame.duu.map((x,k)=>x*p*p+2*frame.duv[k]*p*q+frame.dvv[k]*q*q);
    const uv=frame.uvOf(acceleration); return [p,q,-uv[0],-uv[1]];
  };
  const rk4=(s,h)=>{
    const a=rhs(s),b=rhs(plus(s,a,h/2)),c=rhs(plus(s,b,h/2)),d=rhs(plus(s,c,h));
    return s.map((x,k)=>x+h*(a[k]+2*b[k]+2*c[k]+d[k])/6);
  };
  const shoot=(uv,direction,hint=null)=>{
    if(prepared.atlas){
      const walked=piecewiseChartRay(prepared.atlas,uv,direction,radius,hint),ray=[walked[0]];
      integrations+=walked.length-1;
      for(const point of walked.slice(1)){
        const end=constraint===null?point:stopAtBoundary(ray.at(-1),point);
        if(distance(end,ray.at(-1))>precisionUv*8)ray.push(end);
        if(distance(end,point)>precisionUv*8){boundaryStops++;break;}
      }
      return ray;
    }
    const frame=at(uv);let velocity=frame.uvOf(normalize(direction));
    // Source simplification may leave an unprintably small tilt at a boundary
    // contact. Normalize that initial tangent within the full ray's physical
    // budget, rather than stopping a nominally tangent ray after half a step.
    if(constraint!==null){
      const physical=v=>frame.du.map((x,k)=>x*v[0]+frame.dv[k]*v[1]);
      let error=toleranceMm/4,snapped=null;
      for(const loop of constraint)for(let i=0;i<loop.length;i++){
        const a=loop[i],b=loop[(i+1)%loop.length];if(pointSegmentDistance(uv,a,b)>precisionUv*8)continue;
        const tangent=plus(b,a,-1),mapped=physical(tangent),length=Math.hypot(...mapped);if(length===0)continue;
        const sign=dot(mapped,physical(velocity))<0?-1:1,candidate=tangent.map(v=>v*sign/length),deviation=radius*distance(physical(velocity),physical(candidate));
        if(deviation<error){error=deviation;snapped=candidate;}
      }
      if(snapped)velocity=snapped;
    }
    if(constraint!==null&&distance(stopAtBoundary(uv,plus(uv,velocity,Math.min(maxStepMm,radius))),uv)<=precisionUv*8){boundaryStops++;return [uv];}
    let state=[...uv,...velocity],travel=0,h=Math.min(maxStepMm,radius);
    const ray=[uv];
    // The remaining arc length bounds endpoint error. Finish a sub-rounding
    // residual within the caller's error budget before RK state increments
    // disappear at coordinate precision.
    const completionTolerance=Math.min(ROUNDING_MM,toleranceMm/8);
    while(radius-travel>completionTolerance) {
      h=Math.min(h,radius-travel);
      requireThat(travel+h>travel,'Surface offset integration cannot advance at floating-point precision.');
      const full=rk4(state,h),middle=rk4(state,h/2),half=rk4(middle,h/2);
      requireThat(half.some((value,k)=>value!==state[k]),'Surface offset integration cannot advance at coordinate precision (step '+h+' mm, remaining '+(radius-travel)+' mm).');
      if(constraint!==null){
        const start=state.slice(0,2);
        let end=stopAtBoundary(start,half.slice(0,2));
        if(distance(start,end)<=precisionUv*8){
          let extent=0;
          for(const loop of constraint)for(let i=0;i<loop.length;i++){
            const a=loop[i],b=loop[(i+1)%loop.length];
            if(pointSegmentDistance(start,a,b)>precisionUv*8)continue;
            const v=plus(b,a,-1),len2=v[0]**2+v[1]**2;
            if(len2===0)continue;
            const t=Math.max(0,Math.min(1,((half[0]-a[0])*v[0]+(half[1]-a[1])*v[1])/len2)),candidate=plus(a,v,t);
            const advance=distance(candidate,start);
            if(advance>extent&&distance(frameAtState(half.slice(0,2)).point,at(candidate).point)<=toleranceMm/4){end=candidate;extent=advance;}
          }
        }
        if(distance(end,half.slice(0,2))>precisionUv*8){
          if(distance(end,ray.at(-1))>precisionUv)ray.push(end);
          boundaryStops++;break;
        }
      }
      const a=frameAtState(full.slice(0,2)),b=frameAtState(half.slice(0,2));
      // RK4 step doubling: the two half steps have 1/15 of their difference
      // as local error. Include tangent error's remaining endpoint influence;
      // position alone can accept a ray with a wrong continuing direction.
      const velocity=(frame,state)=>frame.du.map((x,k)=>x*state[2]+frame.dv[k]*state[3]);
      const err=(distance(a.point,b.point)+Math.max(0,radius-travel-h)*distance(velocity(a,full),velocity(b,half)))/15;
      const allowance=toleranceMm/8*h/radius;
      requireThat(Number.isFinite(err),'Surface offset integration produced a non-finite position.');
      // Rays become UV polygon edges. Bound their mapped chord separately
      // from endpoint integration error, including straight XYZ directions on
      // nonlinear charts. Deposition sampling does not choose solver steps.
      const chordError=distance(frameAtState(middle.slice(0,2)).point,frameAtState(midpoint(state.slice(0,2),half.slice(0,2))).point);
      if(err>allowance||chordError>toleranceMm/8) {
        h/=2; requireThat(travel+h>travel,'Surface offset integration cannot resolve the requested tolerance.');continue;
      }
      state=half;travel+=h;integrations++;ray.push(state.slice(0,2));
      // RK4 local error scales with the fifth power of step length.
      if(err<allowance/32&&chordError<toleranceMm/32)h=Math.min(h*2,maxStepMm);
    }
    if(constraint!==null&&ray.length>1){
      // Keep boundary-tangent fronts attached to the same boundary. A tiny
      // inward geodesic drift otherwise leaves a long, almost zero-width tail
      // back to the old endpoint, which becomes a cusp in the next wave.
      const last=ray.at(-1);
      let best=toleranceMm/4,snapped=null;
      for(const loop of constraint)for(let i=0;i<loop.length;i++){
        const a=loop[i],b=loop[(i+1)%loop.length];
        if(pointSegmentDistance(uv,a,b)>precisionUv*8)continue;
        const v=plus(b,a,-1),len2=v[0]**2+v[1]**2;
        if(len2===0)continue;
        const t=Math.max(0,Math.min(1,((last[0]-a[0])*v[0]+(last[1]-a[1])*v[1])/len2)),candidate=plus(a,v,t);
        const error=distance(frameAtState(last).point,at(candidate).point);
        if(error<best){best=error;snapped=candidate;}
      }
      if(snapped)ray[ray.length-1]=snapped;
    }
    return ray;
  };
  // Tangent directions are independent of an edge's parameter length. Map a
  // unit UV direction through the metric so a regular microscopic edge is not
  // mistaken for a singular surface by the physical vector rounding guard.
  const mappedDirection=(frame,deltaUv)=>{
    const span=Math.hypot(...deltaUv);
    requireThat(span>0,'Surface offset tangent requires distinct chart points.');
    return frame.du.map((x,k)=>x*(deltaUv[0]/span)+frame.dv[k]*(deltaUv[1]/span));
  };
  const addStrip=(a,b)=>{
    const tangentUv=plus(b,a,-1), samples=new Map();
    const sample=t=>{
      if(samples.has(t))return samples.get(t);
      const uv=plus(a,tangentUv,t),hint=midpoint(a,b),frame=at(uv,hint);
      const tangent=mappedDirection(frame,tangentUv);
      const normal=cross(tangent,frame.normal).map(x=>x*Math.sign(deltaMm));
      const value={uv,point:frame.point,offset:shoot(uv,normal,hint)};
      samples.set(t,value);return value;
    };
    const chordError=(uv,a,b)=>{
      if(prepared.atlas)return physicalChordError(at(uv).point,at(a).point,at(b).point);
      const delta=plus(b,a,-1),length2=delta[0]**2+delta[1]**2;
      const t=length2?Math.max(0,Math.min(1,((uv[0]-a[0])*delta[0]+(uv[1]-a[1])*delta[1])/length2)):0;
      return distance(at(uv).point,at(plus(a,delta,t)).point);
    };
    const subdivide=(lo,hi)=>{
      const l=sample(lo),r=sample(hi),mid=(lo+hi)/2;
      const probes=[.25,.5,.75].map(f=>sample(lo+(hi-lo)*f));
      // The input edge is exactly a line in UV, even when its XYZ image curves.
      // Only the newly constructed front needs approximation here; mapping owns
      // the later physical chord subdivision of the finished deposition.
      const error=Math.max(...probes.map(m=>chordError(m.offset.at(-1),l.offset.at(-1),r.offset.at(-1))));
      if(error>toleranceMm/4&&!((constraint!==null||prepared.atlas)&&distance(l.point,r.point)<=PROGRAM_STEP_MM)) {
        requireThat(mid>lo&&mid<hi,'Surface offset subdivision cannot resolve the requested tolerance: the strip parameter is one representable step wide.');
        subdivisions++;subdivide(lo,mid);subdivide(mid,hi);
      }else {connectRays(l.offset,r.offset);}
    };
    // Native knot/chart breaks bound the smooth spans to refine. The maximum
    // integration step is not a minimum density for a straight boundary strip.
    const cuts=[0,1];
    for(const [k,knots] of [patch.knotsU??patch.breaksU??[],patch.knotsV??patch.breaksV??[]].entries())
      if(tangentUv[k]!==0)for(const knot of knots){const t=(knot-a[k])/tangentUv[k];if(t>0&&t<1)cuts.push(t);}
    const ordered=[...new Set(cuts)].sort((a,b)=>a-b);
    for(let i=1;i<ordered.length;i++)subdivide(ordered[i-1],ordered[i]);
  };
  const addDisk=(uv,previous,next,full=false)=>{
    const frame=at(uv), incoming=plus(uv,previous,-1),outgoing=plus(next,uv,-1);
    const tangent=t=>normalize(mappedDirection(frame,t));
    const before=tangent(incoming),after=tangent(outgoing);
    const turn=dot(cross(before,after),frame.normal);
    // Same corner distinction as Clipper: closing sides overlap in the strips;
    // only opening sides require a round join. No disks outside an inward
    // offset's material side, including when the source is the patch boundary.
    if(!full&&turn*Math.sign(deltaMm)<=ROUNDING_RELATIVE)return; // the sine of the turn, within rounding
    const x=cross(before,frame.normal).map(v=>v*Math.sign(deltaMm)),y=cross(frame.normal,x);
    const end=cross(after,frame.normal).map(v=>v*Math.sign(deltaMm));
    const sweep=full?2*Math.PI:Math.atan2(dot(end,y),dot(end,x)),rays=new Map();
    const ray=angle=>{
      if(full&&angle===sweep)angle=0;
      if(!rays.has(angle))rays.set(angle,shoot(uv,x.map((v,k)=>v*Math.cos(angle)+y[k]*Math.sin(angle))));
      return rays.get(angle);
    };
    const sector=(a,b)=>{
      const middle=ray((a+b)/2),p=ray(a).at(-1),q=ray(b).at(-1),m=middle.at(-1);
      // Incident obstacle tangents split this fan into angular sectors. A
      // stopped sector has no arc to refine; its boundary rays bound only the
      // clipped band, not a discontinuous endpoint curve outside the domain.
      if(constraint!==null&&middle.length===1){connectRays(ray(a),ray(b));return;}
      if(distance(at(m).point,prepared.atlas?midpoint(at(p).point,at(q).point):at(midpoint(p,q)).point)>toleranceMm/4&&!((constraint!==null||prepared.atlas)&&radius*Math.abs(b-a)<=PROGRAM_STEP_MM)) { // an arc below one program step
        requireThat((a+b)/2!==a&&(a+b)/2!==b,'Surface offset disk cannot resolve the requested tolerance: the sector is one representable step of angle.');
        subdivisions++;sector(a,(a+b)/2);sector((a+b)/2,b);
      }else {
        connectRays(ray(a),ray(b));
      }
    };
    const count=Math.max(1,Math.ceil(Math.abs(sweep)/(Math.PI/4)));
    const angles=Array.from({length:count+1},(_,i)=>i*sweep/count);
    // Obstacle tangents are discontinuities of the clipped fan. Sample them
    // explicitly: an arbitrary angular grid can miss the ray reaching an
    // exact boundary corner and leave a permanent triangular gap there.
    if(constraint!==null)for(const loop of constraint)for(let i=0;i<loop.length;i++){
      const a=loop[i],b=loop[(i+1)%loop.length];
      if(pointSegmentDistance(uv,a,b)>precisionUv*8)continue;
      for(const direction of [plus(b,a,-1),plus(a,b,-1)]){
        const physical=tangent(direction),angle=Math.atan2(dot(physical,y),dot(physical,x));
        if(angle/sweep>0&&angle/sweep<1)angles.push(angle);
      }
    }
    angles.sort((a,b)=>(a-b)*Math.sign(sweep));
    for(let i=1;i<angles.length;i++)if(Math.abs(angles[i]-angles[i-1])>ROUNDING_RELATIVE)sector(angles[i-1],angles[i]);
  };
  if(radius>0)for(const loop of source)for(let i=0;i<loop.length;i++) {
    const a=loop[i],b=loop[(i+1)%loop.length];
    if(distance(a,b)===0)continue;
    const previous=loop[(i+loop.length-1)%loop.length],blocked=blockedEdge(a,b);
    if(!blocked)addStrip(a,b);
    if(!blocked||!blockedEdge(previous,a))addDisk(a,previous,b);
  }
  if(radius>0)for(const path of prepared.strokePaths??[]){
    const points=path.closed?[...path.points,path.points[0]]:path.points;
    for(let i=1;i<points.length;i++)if(distance(points[i-1],points[i])>0){addStrip(points[i-1],points[i]);addStrip(points[i],points[i-1]);}
    for(let i=0;i<path.points.length;i++){
      const point=path.points[i],next=path.points[i+1]??path.points[i-1];
      if(distance(point,next)>0)addDisk(point,plus(point,plus(point,next,-1)),next,true);
    }
  }
  return {bands,surfaceSamples:samples,work:{evaluations:samples.size,
    integrationSteps:integrations,subdivisions,boundaryStops}};
}

export function finishSurfaceOffset(patch,prepared,swept){
  if(prepared.atlas)patch={...patch,atlas:prepared.atlas};
  const {source,constraint,initial,settings}=prepared,{bands}=swept;
  const {deltaMm,toleranceMm,precisionUv,origin}=settings,radius=Math.abs(deltaMm);
  const options={precisionMm:precisionUv,origin};
  const {at,samples}=createSurfaceSampler(patch,settings,[prepared.surfaceSamples,swept.surfaceSamples]);
  const context=clipperContext([source,bands],precisionUv,0,origin);
  const region=context.encode(source), buffer=clipPaths(context.encode(bands));
  let result=radius===0?source:context.decode(deltaMm>0?clipPaths([...region,...buffer]):clipPaths(region,buffer,'difference'));
  if(prepared.atlas&&result.length){
    const extent=result.reduce((range,loop)=>loop.reduce(([lo,hi],p)=>[Math.min(lo,p[0]),Math.max(hi,p[0])],range),[Infinity,-Infinity]);
    const first=prepared.atlas.periodic?Math.floor(extent[0]):0,last=prepared.atlas.periodic?Math.floor(extent[1]):0,domain=[];
    for(let shift=first;shift<=last;shift++)domain.push(...prepared.atlas.faces.map(face=>face.vertices.map(v=>[v.uv[0]+shift,v.uv[1]])));
    result=intersect(result,union(domain,[],options),options);
  }
  let simplificationUv=prepared.work.simplificationUv;
  const simplification={collapsedContours:prepared.work.collapsedContours};
  if(constraint!==null)result=intersect(result,constraint,options);
  if(radius>0&&(constraint===null||difference(constraint,result,options).length)){
    const simplified=simplifySurfaceLoops(result,{constraint,initial,toleranceMm,precisionUv,closeSubResolution:true},at);
    result=constraint===null?simplified.loops:intersect(simplified.loops,constraint,options);
    simplificationUv=Math.max(simplificationUv,simplified.simplificationUv);
    simplification.collapsedContours+=simplified.collapsedContours;
  }
  const loops=result.map(loop=>loop.map(uv=>[...at(uv).point]));
  return {loopsUv:result,loops,report:{status:'experimental',method:'geodesic-bands-clipper2',normalMm:settings.normalMm??0,metric:prepared.atlas?.method??(patch.at?.derivatives?'analytic-native-chart':patch.kind==='slice-chart'?'adaptive-numerical-slice-chart':patch.cp?(settings.normalMm?'analytic-rational-normal-offset':'native-patch'):'adaptive-numerical-surface-chart'),
    toleranceMm,precisionUv,evaluations:prepared.work.evaluations+swept.work.evaluations+samples.size,
    integrationSteps:swept.work.integrationSteps,subdivisions:swept.work.subdivisions,
    inverseMappings:0,bandPolygons:bands.length,boundaryStops:swept.work.boundaryStops,simplificationUv,collapsedContours:simplification.collapsedContours}};
}

// A phase owns only new samples. Earlier completed phase maps are read-only;
// their records are reused without copying the accumulated cache per ray.
function createSurfaceSampler(patch,{bounded,precisionUv,normalMm=0,toleranceMm=SURFACE_OFFSET_CHORD_MM},priorSamples=[]){
  const samples=new Map();
  const at=(uv,hint=null)=>{
    if(bounded)uv=uv.map((x,k)=>{
      const [lo,hi]=[patch.domainU,patch.domainV][k];
      return x>=lo-precisionUv*8&&x<=hi+precisionUv*8?Math.max(lo,Math.min(hi,x)):x;
    });
    const key=uv.join(',')+(patch.atlas&&hint?`:${hint.join(',')}`:'');
    if(samples.has(key))return samples.get(key);
    for(const prior of priorSamples)if(prior.has(key))return prior.get(key);
    const result=patch.atlas?piecewiseChartFrame(patch.atlas,uv,hint):patch.cp?surfaceDerivatives(patch,...uv,{normalMm}):evaluatedSurfaceDerivatives(patch,...uv,{normalMm,toleranceMm});
    samples.set(key,result);return result;
  };
  return {at,samples};
}

function physicalChordError(point,a,b){
  const v=plus(b,a,-1),length2=dot(v,v),t=length2?Math.max(0,Math.min(1,dot(plus(point,a,-1),v)/length2)):0;
  return distance(point,plus(a,v,t));
}

function requireSurfacePaths(patch,paths,precisionUv){
  const periodicU=patch.kind==='sleeve-chart'||patch.atlas?.periodic;
  requireThat(paths.every(path=>path.every(uv=>uv.length>=2&&[patch.domainU,patch.domainV].every(([lo,hi],k)=>Number.isFinite(uv[k])&&(k===0&&periodicU||uv[k]>=lo-precisionUv*8&&uv[k]<=hi+precisionUv*8)))),
    'Surface offset input lies outside its chart domain.');
}

function simplifySurfaceLoops(loops,{constraint,initial,toleranceMm,precisionUv,closeSubResolution=false},at){
    if(!loops.length)return {loops,simplificationUv:0,collapsedContours:0};
    // Repeated offsets amplify normals of redundant microscopic segments.
    // Use the kernel's recommended simplification between offsets, with UV
    // epsilon scaled by sampled surface derivatives (not by parameter units).
    let stretch=0;
    for(const loop of loops)for(let i=0;i<loop.length;i++)for(const uv of [loop[i],midpoint(loop[i],loop[(i+1)%loop.length])]){
      const frame=at(uv);
      stretch=Math.max(stretch,Math.hypot(...frame.du)+Math.hypot(...frame.dv));
    }
    const epsilon=toleranceMm/(8*stretch);
    const contact=uv=>constraint!==null&&constraint.some(loop=>loop.some((a,i)=>pointSegmentDistance(uv,a,loop[(i+1)%loop.length])<=precisionUv*8));
    const result=[],collapsed={count:0};
    for(const loop of loops){
      // A closed contour wholly inside a sub-resolution strip encloses no
      // printable feature. Close it here and report it, before another offset
      // spends geodesic work on its artificial corner normals. Authored seeds
      // remain intact: their next outward offset can be a printable region.
      if(surfaceLoopWidthBound(loop)*stretch<PRINT_RESOLUTION_MM/4){
        if(closeSubResolution)collapsed.count++;else result.push(loop);
        continue;
      }
      const start=loop.findIndex(contact);
      if(start<0){result.push(...initial.decode(simplifyPaths(initial.encode([loop]),epsilon/precisionUv)));continue;}
      // Preserve boundary contacts exactly. Simplifying a nearly straight
      // corner across two domain edges can otherwise remove a reached corner
      // and leave the same artificial residual on every later offset.
      let chain=[loop[start]],joined=[];
      for(let i=1;i<=loop.length;i++){
        const uv=loop[(start+i)%loop.length];chain.push(uv);
        if(contact(uv)){
          const simplified=initial.decodeOpen(simplifyPaths(initial.encode([chain]),epsilon/precisionUv,false))[0];
          if(simplified)joined.push(...simplified.slice(0,-1));
          chain=[uv];
        }
      }
      if(joined.length>=3)result.push(joined);
    }
    return {loops:result,simplificationUv:epsilon,collapsedContours:collapsed.count};
}

// Twice the radius of a capsule containing this entire UV polygon is an upper
// bound on its strip width. Two farthest-point surveys choose its axis; no
// area cancellation or projected world-space area judges curved surfaces.
function surfaceLoopWidthBound(loop){
  const furthest=point=>loop.reduce((best,next)=>distance(point,next)>distance(point,best)?next:best,loop[0]);
  const a=furthest(loop[0]),b=furthest(a);
  return 2*loop.reduce((width,point)=>Math.max(width,pointSegmentDistance(point,a,b)),0);
}
