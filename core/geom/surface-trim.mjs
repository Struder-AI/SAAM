// Native face regions. UV curves bound a retained NURBS surface; they are never
// a tessellation of its interior. All consumers use this same trim predicate.
import {clipLineToRegion} from './curve-region.mjs';
import {evaluate} from './nurbs.mjs';
import {ROUNDING_RELATIVE} from '../dimensions.mjs';

export function patchDomain(patch){
  const [u0,u1]=patch.domainU,[v0,v1]=patch.domainV;
  return [[[u0,v0],[u1,v0],[u1,v1],[u0,v1]]];
}

export function faceContainsUv(patch,u,v){
  if(u<patch.domainU[0]||u>patch.domainU[1]||v<patch.domainV[0]||v>patch.domainV[1])return false;
  if(!patch.trimLoops)return true;
  const clipped=clipLineToRegion([u,v],[1,0],patch.trimLoops,{range:[0,0]});
  return clipped.spans.length>0||clipped.contacts.length>0;
}

export function segmentTrimSpans(a,b,loops){
  if(!loops)return [[0,1]];
  const direction=b.map((v,k)=>v-a[k]);
  if(Math.hypot(...direction)<=ROUNDING_RELATIVE)return [];
  const cut=clipLineToRegion(a,direction,loops,{range:[0,1]});
  const spans=[...cut.spans,...cut.contacts].filter(([lo,hi])=>hi>lo).sort((p,q)=>p[0]-q[0]),merged=[];
  for(const span of spans){
    const last=merged.at(-1);
    if(last&&span[0]<=last[1])last[1]=Math.max(last[1],span[1]);else merged.push([...span]);
  }
  return merged;
}

// Plane-section samples already retain their native parameters. Clip those
// parameters and evaluate only the retained ends on the original surface.
export function trimSectionChains(patch,chains){
  if(!patch.trimLoops)return chains;
  const result=[];
  for(const chain of chains){
    const state={current:null};
    for(let i=1;i<chain.length;i++){
      const a=chain[i-1],b=chain[i];
      for(const [lo,hi] of segmentTrimSpans([a.u,a.v],[b.u,b.v],patch.trimLoops)){
        const first=sectionVertex(patch,a,b,lo),last=sectionVertex(patch,a,b,hi);
        if(state.current&&Math.hypot(state.current.at(-1).u-first.u,state.current.at(-1).v-first.v)<=ROUNDING_RELATIVE)state.current.push(last);
        else{state.current=[first,last];result.push(state.current);}
      }
    }
  }
  return result;
}

function sectionVertex(patch,a,b,t){
  if(t===0)return a;
  if(t===1)return b;
  const u=a.u+t*(b.u-a.u),v=a.v+t*(b.v-a.v);
  return {u,v,point:evaluate(patch,u,v,false).point};
}
