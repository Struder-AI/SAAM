// Shared smooth section offsets for the two rimming skills. These are ambient
// normal offsets, not the intrinsic/geodesic offsetSurfaceRegion operation.
import {evaluate} from '../geom/nurbs.mjs';
import {prepareSurfaceOffsets} from '../geom/surface-offset.mjs';
import {findRoot,requireThat,distance} from '../geom/tolerance.mjs';

export function offsetSurfaceSection(patch,chain,deltaMm,{mode='horizontal',side=1,offsetTightness=1,toleranceMm=0.01,maxStepMm=0.5,maxPoints=100000}={}) {
  requireThat(['horizontal','normal'].includes(mode)&&[1,-1].includes(side),'Invalid section-offset mode or side.');
  requireThat(Number.isFinite(deltaMm)&&deltaMm>=0&&toleranceMm>0&&maxStepMm>0&&Number.isSafeInteger(maxPoints)&&maxPoints>0,'Invalid section-offset distance or sampling settings.');
  let count=0;
  requireThat(Number.isFinite(offsetTightness)&&offsetTightness>=0&&offsetTightness<=1,'Rimming offsetTightness must be between zero and one.');
  // Rimming's planar direction projects the full surface normal. A U tangent
  // can itself rise in Z, so its XY perpendicular is a different direction.
  const loose=offsetTightness<1?prepareSurfaceOffsets({patch,mode:mode==='horizontal'?'projected-normal':mode,periodicU:false,periodicV:false}):null;
  const at=p=>{
    requireThat(++count<=maxPoints,`Rimming offset exhausted maxPoints=${maxPoints}; increase the skill's maxPoints setting.`);
    const e=evaluate(patch,p.u,p.v),n=e.normal;
    requireThat(n&&n.every(Number.isFinite),'Rimming surface has a singular normal.');
    const length=mode==='horizontal'?Math.hypot(n[0],n[1]):Math.hypot(...n);
    requireThat(length>1e-12,'Rimming horizontal offset needs a non-horizontal reference surface.');
    const direction=mode==='horizontal'?[n[0]/length,n[1]/length,0]:n.map(v=>v/length);
    const point=loose?loose.at(p.u,p.v,side*deltaMm,offsetTightness):e.point.map((v,i)=>v+side*deltaMm*direction[i]);
    return {...p,reference:e.point,point};
  };
  const split=(a,b,depth=0)=>{
    if(Math.abs(a.u-b.u)<1e-12)return [b];
    const u=(a.u+b.u)/2,z=(a.reference[2]+b.reference[2])/2;
    const f=v=>evaluate(patch,u,v,false).point[2]-z;
    const fa=f(0),fb=f(1);
    // Endpoints come from one connected horizontal section. Refinement stays
    // on that section using the same bracketed root helper as native slicing.
    requireThat(fa<=1e-7&&fb>=-1e-7,'Rimming section refinement left the surface domain.');
    const v=Math.abs(fa)<1e-9?0:Math.abs(fb)<1e-9?1:findRoot(f,0,1,fa,fb);
    const mid=at({u,v}),chord=a.point.map((v,k)=>(v+b.point[k])/2);
    if(distance(mid.point,chord)<=toleranceMm&&distance(a.point,b.point)<=maxStepMm)return [b];
    requireThat(depth<30,'Rimming offset cannot resolve its requested tolerance.');
    return [...split(a,mid,depth+1),...split(mid,b,depth+1)];
  };
  if(chain.length<2)return [];
  let previous=at(chain[0]);const result=[previous];
  for(const p of chain.slice(1)){const next=at(p);result.push(...split(previous,next));previous=next;}
  return result;
}
