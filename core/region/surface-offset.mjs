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
import { surfaceDerivatives } from '../geom/surface-derivatives.mjs';
import { clipperContext, clipPaths } from './clipper.mjs';
import {simplifyPaths} from './clipper2.mjs';
import {intersect,difference,clipOpenPaths} from './intersection.mjs';
import {pointSegmentDistance} from './region2d.mjs';

const plus=(a,b,s=1)=>a.map((x,k)=>x+b[k]*s);
const midpoint=(a,b)=>a.map((x,k)=>(x+b[k])/2);
const distance=(a,b)=>Math.hypot(...a.map((x,k)=>x-b[k]));

export function offsetSurfaceRegion(patch, loopsUv, deltaMm, {
  toleranceMm=0.01, maxStepMm=0.5, precisionUv=1e-10, maxEvaluations=250000,
  constraintLoopsUv=null
}={}) {
  requireThat(Number.isFinite(deltaMm), 'Surface offset distance must be finite.');
  requireThat(Number.isFinite(toleranceMm)&&toleranceMm>0&&Number.isFinite(maxStepMm)&&maxStepMm>0,
    'Surface offset toleranceMm and maxStepMm must be positive and finite.');
  requireThat(Number.isSafeInteger(maxEvaluations)&&maxEvaluations>0, 'Surface offset maxEvaluations must be a positive integer.');
  requireThat(patch?.cp && patch.domainU && patch.domainV, 'Surface offset requires a native NURBS patch.');
  // Geodesic ODE needs a continuous second derivative through internal knots.
  for(const [knots,order,domain] of [[patch.knotsU,patch.orderU,patch.domainU],[patch.knotsV,patch.orderV,patch.domainV]]) {
    const counts=new Map(); for(const t of knots)if(t>domain[0]&&t<domain[1])counts.set(t,(counts.get(t)??0)+1);
    requireThat([...counts.values()].every(n=>order-1-n>=2),'Surface offset currently requires C2 continuity across internal knots.');
  }
  let evaluations=0, integrations=0, subdivisions=0;
  const cache=new Map();
  const at=uv=>{
    if(constraintLoopsUv!==null)uv=uv.map((x,k)=>{
      const [lo,hi]=[patch.domainU,patch.domainV][k];
      return x>=lo-precisionUv*8&&x<=hi+precisionUv*8?Math.max(lo,Math.min(hi,x)):x;
    });
    const key=uv.join(','); if(cache.has(key))return cache.get(key);
    requireThat(++evaluations<=maxEvaluations,`Surface offset exhausted maxEvaluations=${maxEvaluations}; increase maxEvaluations to retain the requested tolerance.`);
    const result=surfaceDerivatives(patch,...uv);cache.set(key,result);return result;
  };
  const origin=constraintLoopsUv===null?null:[patch.domainU[0],patch.domainV[0]];
  const initial=clipperContext([loopsUv],precisionUv,0,origin);
  let source=initial.decode(clipPaths(initial.encode(loopsUv)));
  let simplificationUv=0;
  const simplify=loops=>{
    if(!loops.length)return loops;
    // Repeated offsets amplify normals of redundant microscopic segments.
    // Use the kernel's recommended simplification between offsets, with UV
    // epsilon scaled by sampled surface derivatives (not by parameter units).
    let stretch=0;
    for(const loop of loops)for(let i=0;i<loop.length;i++)for(const uv of [loop[i],midpoint(loop[i],loop[(i+1)%loop.length])]){
      const frame=at(uv);
      stretch=Math.max(stretch,Math.hypot(...frame.du)+Math.hypot(...frame.dv));
    }
    const epsilon=toleranceMm/(8*stretch);
    simplificationUv=Math.max(simplificationUv,epsilon);
    const contact=uv=>constraint.some(loop=>loop.some((a,i)=>pointSegmentDistance(uv,a,loop[(i+1)%loop.length])<=precisionUv*8));
    const result=[];
    for(const loop of loops){
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
    return result;
  };
  const domain=[[patch.domainU[0],patch.domainV[0]],[patch.domainU[1],patch.domainV[0]],
    [patch.domainU[1],patch.domainV[1]],[patch.domainU[0],patch.domainV[1]]];
  const options={precisionMm:precisionUv,origin};
  const constraint=constraintLoopsUv===null?null:intersect(constraintLoopsUv,[domain],options);
  requireThat(constraint===null||deltaMm>=0,'Constrained surface offsets currently support outward growth only.');
  if(constraint!==null)source=simplify(source);
  let boundaryStops=0;
  // A constrained ray ends at its first boundary crossing, never at a later
  // re-entry across a hole. All topology/clipping remains in the shared kernel.
  const stopAtBoundary=(a,b)=>{
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
  const frameAtState=uv=>at(constraint===null?uv:uv.map((x,k)=>Math.max([patch.domainU,patch.domainV][k][0],Math.min([patch.domainU,patch.domainV][k][1],x))));
  const radius=Math.abs(deltaMm), bands=[];
  const triangle=(a,b,c)=>{
    const signed=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    if(signed!==0)bands.push(signed>0?[a,b,c]:[a,c,b]);
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
  const shoot=(uv,direction)=>{
    const frame=at(uv),velocity=frame.uvOf(normalize(direction));
    let state=[...uv,...velocity],travel=0,h=Math.min(maxStepMm,radius);
    const ray=[uv];
    while(travel<radius) {
      h=Math.min(h,radius-travel);
      const full=rk4(state,h),half=rk4(rk4(state,h/2),h/2);
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
      const err=distance(a.point,b.point);
      if(err>toleranceMm*h/Math.max(radius,1)*0.05) {
        h/=2; requireThat(travel+h>travel,'Surface offset integration cannot resolve the requested tolerance.');continue;
      }
      state=half;travel+=h;integrations++;ray.push(state.slice(0,2));
      if(err<toleranceMm*h/Math.max(radius,1)*0.001)h=Math.min(h*2,maxStepMm);
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
  const addStrip=(a,b)=>{
    const tangentUv=plus(b,a,-1), samples=new Map();
    const sample=t=>{
      if(samples.has(t))return samples.get(t);
      const uv=plus(a,tangentUv,t),frame=at(uv);
      const tangent=frame.du.map((x,k)=>x*tangentUv[0]+frame.dv[k]*tangentUv[1]);
      const normal=cross(tangent,frame.normal).map(x=>x*Math.sign(deltaMm));
      const value={uv,point:frame.point,offset:shoot(uv,normal)};
      samples.set(t,value);return value;
    };
    const connect=(l,r,side)=>{
      // Both rays can use different integration steps; interpolate their UV
      // polylines by normalized sample index to form a swept strip. Endpoints
      // carry the true integrated distance regardless of this interior mesh.
      const one=l[side],two=r[side],n=Math.max(one.length,two.length)-1;
      const lerpRay=(ray,t)=>{if(ray.length===1)return ray[0];const x=t*(ray.length-1),i=Math.min(Math.floor(x),ray.length-2);return plus(ray[i],plus(ray[i+1],ray[i],-1),x-i);};
      for(let i=0;i<n;i++) {
        const p=lerpRay(one,i/n),q=lerpRay(two,i/n),s=lerpRay(one,(i+1)/n),t=lerpRay(two,(i+1)/n);
        triangle(p,q,t);triangle(p,t,s);
      }
    };
    const subdivide=(lo,hi,depth=0)=>{
      const l=sample(lo),r=sample(hi),mid=(lo+hi)/2,m=sample(mid);
      let error=distance(m.point,midpoint(l.point,r.point));
      for(const side of ['offset']) {
        const p=l[side].at(-1),q=r[side].at(-1),s=m[side].at(-1);
        error=Math.max(error,distance(at(s).point,at(midpoint(p,q)).point));
      }
      if((error>toleranceMm/4||distance(l.point,r.point)>maxStepMm)&&!(constraint!==null&&distance(l.point,r.point)<=toleranceMm*1e-3)) {
        requireThat(depth<30,'Surface offset subdivision cannot resolve the requested tolerance.');
        subdivisions++;subdivide(lo,mid,depth+1);subdivide(mid,hi,depth+1);
      }else {connect(l,r,'offset');}
    };
    subdivide(0,1);
  };
  const addDisk=(uv,previous,next)=>{
    const frame=at(uv), incoming=plus(uv,previous,-1),outgoing=plus(next,uv,-1);
    const tangent=t=>normalize(frame.du.map((x,k)=>x*t[0]+frame.dv[k]*t[1]));
    const before=tangent(incoming),after=tangent(outgoing);
    const turn=dot(cross(before,after),frame.normal);
    // Same corner distinction as Clipper: closing sides overlap in the strips;
    // only opening sides require a round join. No disks outside an inward
    // offset's material side, including when the source is the patch boundary.
    if(turn*Math.sign(deltaMm)<=1e-14)return;
    const x=cross(before,frame.normal).map(v=>v*Math.sign(deltaMm)),y=cross(frame.normal,x);
    const end=cross(after,frame.normal).map(v=>v*Math.sign(deltaMm));
    const sweep=Math.atan2(dot(end,y),dot(end,x)),rays=new Map();
    const ray=angle=>{
      if(!rays.has(angle))rays.set(angle,shoot(uv,x.map((v,k)=>v*Math.cos(angle)+y[k]*Math.sin(angle))));
      return rays.get(angle);
    };
    const sector=(a,b,depth=0)=>{
      const p=ray(a).at(-1),q=ray(b).at(-1),m=ray((a+b)/2).at(-1);
      if(distance(at(m).point,at(midpoint(p,q)).point)>toleranceMm/4&&!(constraint!==null&&radius*Math.abs(b-a)<=toleranceMm*1e-3)) {
        requireThat(depth<20,'Surface offset disk cannot resolve the requested tolerance.');
        subdivisions++;sector(a,(a+b)/2,depth+1);sector((a+b)/2,b,depth+1);
      }else {
        // Radial fan strips retain the geodesic sweep if its UV rays bend.
        const l=ray(a),r=ray(b),n=Math.max(l.length,r.length)-1;
        const interp=(s,t)=>{if(s.length===1)return s[0];const v=t*(s.length-1),i=Math.min(Math.floor(v),s.length-2);return plus(s[i],plus(s[i+1],s[i],-1),v-i);};
        for(let i=0;i<n;i++){const p0=interp(l,i/n),q0=interp(r,i/n),p1=interp(l,(i+1)/n),q1=interp(r,(i+1)/n);triangle(p0,q0,q1);triangle(p0,q1,p1);}
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
    for(let i=1;i<angles.length;i++)if(Math.abs(angles[i]-angles[i-1])>1e-14)sector(angles[i-1],angles[i]);
  };
  if(radius>0)for(const loop of source)for(let i=0;i<loop.length;i++) {
    const a=loop[i],b=loop[(i+1)%loop.length];
    if(distance(a,b)===0)continue;
    addStrip(a,b);addDisk(a,loop[(i+loop.length-1)%loop.length],b);
  }
  const context=clipperContext([source,bands],precisionUv,0,origin);
  const region=context.encode(source), buffer=clipPaths(context.encode(bands));
  let result=radius===0?source:context.decode(deltaMm>0?clipPaths([...region,...buffer]):clipPaths(region,buffer,'difference'));
  if(constraint!==null){
    result=intersect(result,constraint,options);
    if(difference(constraint,result,options).length)result=intersect(simplify(result),constraint,options);
  }
  const loops=result.map(loop=>loop.map(uv=>[...at(uv).point]));
  return {loopsUv:result,loops,report:{status:'experimental',method:'geodesic-bands-clipper2',
    toleranceMm,precisionUv,evaluations,maxEvaluations,integrationSteps:integrations,subdivisions,
    inverseMappings:0,bandTriangles:bands.length,boundaryStops,simplificationUv}};
}
