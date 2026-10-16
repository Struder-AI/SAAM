// Native face regions. UV curves bound a retained NURBS surface; they are never
// a tessellation of its interior. All consumers use this same trim predicate.
import {clipLineToRegion} from './curve-region.mjs';
import {evaluate,authoredNurbs,evaluateCurve,nurbsCurveRecord} from './nurbs.mjs';
import {curvePlaneIntersections,extract,reverseCurve} from './curve-ops.mjs';
import {surfaceCurveImages} from './surface-curve-image.mjs';
import {distance} from './tolerance.mjs';
import {ROUNDING_RELATIVE,PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {curveLoopSamples,prepareCurveLoops} from './curve-loops.mjs';
import {prepareNumericalCurve,numericalCurveClosestParameter} from './curve-query.mjs';

const regionViews=new WeakMap();
// Polygon-only consumers request a derived view at physical construction
// accuracy. The patch continues to own its original line/spline trim curves.
export function faceTrimRegion(patch,{toleranceMm=PRINT_RESOLUTION_MM/4}={}){
  if(!patch.trimLoops)return patchDomain(patch);
  if(patch.trimLoops.every(Array.isArray))return patch.trimLoops;
  if(!regionViews.has(patch))regionViews.set(patch,new Map());
  const cache=regionViews.get(patch);
  if(!cache.has(toleranceMm))cache.set(toleranceMm,curveLoopSamples(patch.trimLoops,uv=>evaluate(patch,...uv,false).point,{toleranceMm}));
  return cache.get(toleranceMm);
}

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
export function trimSectionChains(patch,chains,{plane}={}){
  if(!patch.trimLoops)return chains;
  const planeCuts=plane&&patch.trimLoops.some(loop=>!Array.isArray(loop))?trimPlaneCuts(patch,plane):[];
  const result=[];
  for(const chain of chains){
    const state={current:null};
    for(let i=1;i<chain.length;i++){
      const a=chain[i-1],b=chain[i];
      for(const [lo,hi] of segmentTrimSpans([a.u,a.v],[b.u,b.v],patch.trimLoops)){
        const first=sectionVertex(patch,a,b,lo,planeCuts),last=sectionVertex(patch,a,b,hi,planeCuts);
        if(state.current&&Math.hypot(state.current.at(-1).u-first.u,state.current.at(-1).v-first.v)<=ROUNDING_RELATIVE)state.current.push(last);
        else{state.current=[first,last];result.push(state.current);}
      }
    }
  }
  return result;
}

function sectionVertex(patch,a,b,t,planeCuts){
  if(t===0)return a;
  if(t===1)return b;
  const u=a.u+t*(b.u-a.u),v=a.v+t*(b.v-a.v);
  const point=evaluate(patch,u,v,false).point;
  const nearest=planeCuts.toSorted((a,b)=>distance(a.point,point)-distance(b.point,point))[0];
  return nearest&&distance(nearest.point,point)<=distance(a.point,b.point)+PRINT_RESOLUTION_MM?nearest:{u,v,point};
}

const trimImages=new WeakMap();
function trimPlaneCuts(patch,plane){
  if(!trimImages.has(patch))trimImages.set(patch,patch.trimLoops.flatMap(loop=>{
    const definitions=Array.isArray(loop)?[{points:[...loop,loop[0]]}]:loop.curves;
    return definitions.flatMap(definition=>surfaceCurveImages(patch,definition)).map(image=>({curve:authoredNurbs(image.nurbs),uvCurve:authoredNurbs(image.uvNurbs,2)}));
  }));
  return trimImages.get(patch).flatMap(({curve,uvCurve})=>curvePlaneIntersections(curve,plane).parameters.map(t=>{
    const uv=evaluateCurve(uvCurve,t).point;
    return {u:uv[0],v:uv[1],point:evaluateCurve(curve,t).point};
  }));
}

const boundarySources=new WeakMap();
// Region operations may split existing trims. Restore those intervals from
// their source curves; only newly constructed boundaries remain polylines.
export function retainFaceTrimCurves(patch,loops,{toleranceMm}={}){
  if(!patch.trimLoops?.some(loop=>!Array.isArray(loop)))return loops;
  if(!boundarySources.has(patch))boundarySources.set(patch,prepareCurveLoops(patch.trimLoops).loops.flat().map(native=>{
    const controls=Array.from({length:native.n},(_,i)=>[0,1,2].map(k=>native.cp[i*4+k]/native.cp[i*4+3]));
    return {native,query:prepareNumericalCurve({kind:'nurbs',...nurbsCurveRecord(native)}),
      min:[0,1].map(k=>Math.min(...controls.map(p=>p[k]))),max:[0,1].map(k=>Math.max(...controls.map(p=>p[k])))};
  }));
  const sources=boundarySources.get(patch);
  return loops.map(loop=>{
    const pieces=[];
    for(let i=0;i<loop.length;i++){
      const a=loop[i],b=loop[(i+1)%loop.length],match=sourceTrimInterval(patch,a,b,sources,toleranceMm),previous=pieces.at(-1);
      if(match&&previous?.source===match.source&&Math.abs(previous.to-match.from)<=ROUNDING_RELATIVE){previous.to=match.to;previous.end=match.end;}
      else pieces.push(match??{start:a,end:b});
    }
    const boundary=pieces.filter(piece=>!piece.source||piece.from!==piece.to);
    return {curves:boundary.map((piece,i)=>{
      if(!piece.source)return {points:[boundary[(i+boundary.length-1)%boundary.length].end,boundary[(i+1)%boundary.length].start]};
      const {native}=piece.source,[lo,hi]=[piece.from,piece.to].sort((a,b)=>a-b),domain=native.domain;
      const part=extract(native,domain[0]+lo*(domain[1]-domain[0]),domain[0]+hi*(domain[1]-domain[0]));
      return {nurbs:nurbsCurveRecord(piece.to>piece.from?part:reverseCurve(part),2)};
    }).filter(curve=>!curve.points||curve.points[0].some((v,k)=>v!==curve.points[1][k]))};
  }).filter(loop=>loop.curves.length);
}
function sourceTrimInterval(patch,a,b,sources,toleranceMm){
  const frame=evaluate(patch,...a),uu=frame.du.reduce((sum,v,k)=>sum+v*frame.du[k],0),vv=frame.dv.reduce((sum,v,k)=>sum+v*frame.dv[k],0),uv=frame.du.reduce((sum,v,k)=>sum+v*frame.dv[k],0);
  const eigenvalue=(uu+vv-Math.hypot(uu-vv,2*uv))/2,guard=eigenvalue>0?toleranceMm/Math.sqrt(eigenvalue):Infinity;
  const queryTolerance=Math.max(ROUNDING_RELATIVE,toleranceMm/Math.max(Math.sqrt(uu),Math.sqrt(vv))/16);
  for(const source of sources){
    if([a,b].some(p=>p.some((v,k)=>v<source.min[k]-guard||v>source.max[k]+guard)))continue;
    const parameters=[a,b].map(uv=>{
      const first=evaluateCurve(source.native,source.native.domain[0]).point,last=evaluateCurve(source.native,source.native.domain[1]).point;
      if(distance(uv,first)<=guard)return 0;if(distance(uv,last)<=guard)return 1;
      return numericalCurveClosestParameter(source.query,0,1,[...uv,0],{toleranceMm:ROUNDING_RELATIVE,maxDistanceMm:guard});
    });
    if(parameters.some(t=>t===null))continue;
    if(Math.abs(parameters[1]-parameters[0])<=ROUNDING_RELATIVE)continue;
    const [start,end]=parameters.map(t=>{const d=source.native.domain;return evaluateCurve(source.native,d[0]+t*(d[1]-d[0])).point.slice(0,2);});
    const middle=a.map((v,k)=>(v+b[k])/2),d=source.native.domain;
    const middleParameter=numericalCurveClosestParameter(source.query,Math.min(...parameters),Math.max(...parameters),[...middle,0],{toleranceMm:queryTolerance,maxDistanceMm:guard});
    if(middleParameter===null)continue;
    const mid=evaluateCurve(source.native,d[0]+middleParameter*(d[1]-d[0])).point;
    if([[a,start],[b,end],[middle,mid]].some(([x,y])=>distance(evaluate(patch,...x,false).point,evaluate(patch,...y.slice(0,2),false).point)>toleranceMm))continue;
    return {source,from:parameters[0],to:parameters[1],start,end};
  }
  return null;
}
