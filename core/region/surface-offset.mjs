// Experimental intrinsic (geodesic) region offset on one regular, injective,
// C2 NURBS patch. Positive expands, negative erodes. Input boundaries are UV
// polylines on this patch. Rhino is a behavioural reference, NOT copied source.
//
// SAAM generates geodesic boundary strips and vertex disks. Clipper2's
// unchanged winding/union/difference machinery resolves overlaps, holes and
// collapse. This is not a constant UV offset. UV is retained throughout; there
// are no closest-point searches, global flattening or inverse remapping passes.
// Numerical integration/subdivision are construction work, not an independent
// runtime validation pass. See DEVELOP.md for limits and reference status.
import { requireThat, dot, cross, normalize } from '../geom/tolerance.mjs';
import { surfaceDerivatives } from '../geom/surface-derivatives.mjs';
import { clipperContext, clipPaths } from './clipper.mjs';

const plus=(a,b,s=1)=>a.map((x,k)=>x+b[k]*s);
const midpoint=(a,b)=>a.map((x,k)=>(x+b[k])/2);
const distance=(a,b)=>Math.hypot(...a.map((x,k)=>x-b[k]));

export function offsetSurfaceRegion(patch, loopsUv, deltaMm, {
  toleranceMm=0.01, maxStepMm=0.5, precisionUv=1e-10, maxEvaluations=250000
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
    const key=uv.join(','); if(cache.has(key))return cache.get(key);
    requireThat(++evaluations<=maxEvaluations,`Surface offset exhausted maxEvaluations=${maxEvaluations}; increase maxEvaluations to retain the requested tolerance.`);
    const result=surfaceDerivatives(patch,...uv);cache.set(key,result);return result;
  };
  const initial=clipperContext([loopsUv],precisionUv);
  const source=initial.decode(clipPaths(initial.encode(loopsUv)));
  const radius=Math.abs(deltaMm), bands=[];
  const triangle=(a,b,c)=>{
    const signed=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    if(signed!==0)bands.push(signed>0?[a,b,c]:[a,c,b]);
  };
  const rhs=state=>{
    const frame=at(state.slice(0,2)), [p,q]=state.slice(2);
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
      const a=at(full.slice(0,2)),b=at(half.slice(0,2));
      const err=distance(a.point,b.point);
      if(err>toleranceMm*h/Math.max(radius,1)*0.05) {
        h/=2; requireThat(travel+h>travel,'Surface offset integration cannot resolve the requested tolerance.');continue;
      }
      state=half;travel+=h;integrations++;ray.push(state.slice(0,2));
      if(err<toleranceMm*h/Math.max(radius,1)*0.001)h=Math.min(h*2,maxStepMm);
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
      const lerpRay=(ray,t)=>{const x=t*(ray.length-1),i=Math.min(Math.floor(x),ray.length-2);return plus(ray[i],plus(ray[i+1],ray[i],-1),x-i);};
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
      if(error>toleranceMm/4||distance(l.point,r.point)>maxStepMm) {
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
      if(distance(at(m).point,at(midpoint(p,q)).point)>toleranceMm/4) {
        requireThat(depth<20,'Surface offset disk cannot resolve the requested tolerance.');
        subdivisions++;sector(a,(a+b)/2,depth+1);sector((a+b)/2,b,depth+1);
      }else {
        // Radial fan strips retain the geodesic sweep if its UV rays bend.
        const l=ray(a),r=ray(b),n=Math.max(l.length,r.length)-1;
        const interp=(s,t)=>{const v=t*(s.length-1),i=Math.min(Math.floor(v),s.length-2);return plus(s[i],plus(s[i+1],s[i],-1),v-i);};
        for(let i=0;i<n;i++){const p0=interp(l,i/n),q0=interp(r,i/n),p1=interp(l,(i+1)/n),q1=interp(r,(i+1)/n);triangle(p0,q0,q1);triangle(p0,q1,p1);}
      }
    };
    const count=Math.max(1,Math.ceil(Math.abs(sweep)/(Math.PI/4)));
    for(let i=0;i<count;i++)sector(i*sweep/count,(i+1)*sweep/count);
  };
  if(radius>0)for(const loop of source)for(let i=0;i<loop.length;i++) {
    const a=loop[i],b=loop[(i+1)%loop.length];
    if(distance(a,b)===0)continue;
    addStrip(a,b);addDisk(a,loop[(i+loop.length-1)%loop.length],b);
  }
  const context=clipperContext([source,bands],precisionUv);
  const region=context.encode(source), buffer=clipPaths(context.encode(bands));
  const result=radius===0?source:context.decode(deltaMm>0?clipPaths([...region,...buffer]):clipPaths(region,buffer,'difference'));
  const loops=result.map(loop=>loop.map(uv=>[...at(uv).point]));
  return {loopsUv:result,loops,report:{status:'experimental',method:'geodesic-bands-clipper2',
    toleranceMm,precisionUv,evaluations,maxEvaluations,integrationSteps:integrations,subdivisions,
    inverseMappings:0,bandTriangles:bands.length}};
}
