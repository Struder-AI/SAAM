// Trimmed-surface records (D-041): a patch and the boundary of its kept
// region in (u, v), as chains of curves in the curve-offset format
// ({ closed, wraps, pieces }). The domain edges are part of the boundary
// (counterclockwise on a nonperiodic patch; on a patch periodic in U a +U loop
// at the bottom edge and a -U loop at the top), holes run clockwise, and
// material is to the left of travel. A periodic chart's curves are unwrapped:
// a hole may cross the seam. Surface ribbons and offsets produce them by
// resolving their folds.
import {findSpan,basisFunctions,evaluate} from './nurbs.mjs';
import {requireThat,cross,dot} from './tolerance.mjs';
import {foldCuts} from './curve-ribbon.mjs';

// A degree-1 curve through (u, v) points, uniformly parameterized on [0, 1].
function polylineCurve(points){
  const n=points.length,knots=Float64Array.from([0,...Array.from({length:n},(_,i)=>i/(n-1)),1]);
  return {n,order:2,knots,cp:Float64Array.from(points.flatMap(([u,v])=>[u,v,0,1])),domain:[0,1]};
}

function domainBoundary({domainU:[u0,u1],domainV:[v0,v1]},periodicU,periodicV){
  if(periodicU)return [{closed:true,wraps:1,pieces:[polylineCurve([[u0,v0],[u1,v0]])]},{closed:true,wraps:-1,pieces:[polylineCurve([[u1,v1],[u0,v1]])]}];
  if(periodicV)return [{closed:true,wraps:-1,pieces:[polylineCurve([[u0,v1],[u0,v0]])]},{closed:true,wraps:1,pieces:[polylineCurve([[u1,v0],[u1,v1]])]}];
  return [{closed:true,wraps:0,pieces:[polylineCurve([[u0,v0],[u1,v0],[u1,v1],[u0,v1],[u0,v0]])]}];
}

export function trimmedSurface({patch,periodicU=false,periodicV=false,holes=[]}){
  requireThat(patch?.cp&&patch.domainU&&patch.domainV&&!(periodicU&&periodicV),'A trimmed surface needs a patch periodic in at most one direction.');
  return {kind:'trimmed-surface',version:1,patch,periodicU,periodicV,
    boundary:[...domainBoundary(patch,periodicU,periodicV),...holes.map(points=>({closed:true,wraps:0,pieces:[polylineCurve([...points,points[0]])]}))]};
}

// The U isocurve of a patch at v: a NURBS curve over U whose controls are the
// patch's control columns combined by the V basis at v.
function isoCurveU({nu,nv,orderU,orderV,knotsU,knotsV,cp,domainU},v){
  const span=findSpan(knotsV,nv,orderV,v),basis=basisFunctions(knotsV,span,v,orderV),out=new Float64Array(nu*4);
  for(let i=0;i<nu;i++)for(let k=0;k<orderV;k++)for(let c=0;c<4;c++)out[i*4+c]+=basis[k]*cp[(i*nv+span-orderV+1+k)*4+c];
  return {n:nu,order:orderU,knots:knotsU,cp:out,domain:[...domainU]};
}

// A sleeve here: every control column's Z depends on its V index only and the
// weights are separable, so each U isocurve lies at one Z.
export function isSleeve({nu,nv,cp}){
  for(let j=0;j<nv;j++)for(let i=1;i<nu;i++){
    const a=j*4,b=(i*nv+j)*4;
    if(Math.abs(cp[b+2]/cp[b+3]-cp[a+2]/cp[a+3])>1e-9||Math.abs(cp[b+3]*cp[(0*nv)*4+3]-cp[(i*nv)*4+3]*cp[a+3])>1e-12)return false;
  }
  return true;
}

// Mean chart-to-millimetre scales of a patch, from a 9 x 9 sample grid.
function chartScales(patch){
  let su=0,sv=0;
  for(let a=0;a<9;a++)for(let b=0;b<9;b++){
    const e=evaluate(patch,patch.domainU[0]+(patch.domainU[1]-patch.domainU[0])*(a+.5)/9,patch.domainV[0]+(patch.domainV[1]-patch.domainV[0])*(b+.5)/9);
    su+=Math.hypot(...e.du)/81;sv+=Math.hypot(...e.dv)/81;
  }
  return [su,sv];
}

// The fold holes of a sleeve ribbon (moved from source horizontally, Z kept):
// each U isocurve of the moved patch is a curve ribbon of the source's, so its
// folds are cut at the plan-view crossing that closes them (foldCuts). Levels
// are refined in V until the cut ends are within toleranceMm of linear between
// levels and each fold's start and end height within toleranceMm. A hole that
// meets a V domain edge runs along it. Folds that merge or split between
// levels are rejected, naming the height.
export function sleeveFoldHoles({source,moved,periodic,toleranceMm}){
  const [u0,u1]=source.domainU,P=u1-u0,[su,sv]=chartScales(source);
  const cutsAt=v=>{
    const cuts=foldCuts(isoCurveU(moved,v),isoCurveU(source,v),periodic);
    // Around the seam a cut split at it is one unwrapped interval.
    if(periodic&&cuts.length>1&&cuts[0][0]===u0&&cuts.at(-1)[1]===u1)return [[cuts.at(-1)[0],cuts[0][1]+P],...cuts.slice(1,-1)];
    return cuts;
  };
  const overlaps=(x,y)=>[0,P,-P].some(k=>periodic||k===0?x[0]<y[1]+k&&y[0]+k<x[1]:false);
  const breaks=[...new Set([...source.knotsV].filter(v=>v>=source.domainV[0]&&v<=source.domainV[1]))];
  const levels=[];
  for(let b=1;b<breaks.length;b++)for(let k=b===1?0:1;k<=8;k++){const v=breaks[b-1]+(breaks[b]-breaks[b-1])*k/8;levels.push({v,cuts:cutsAt(v)});}
  // Refine between two levels while their folds change in count beyond the
  // height tolerance or a cut end bends away from linear.
  const refined=[levels[0]];
  const visit=(a,b)=>{
    const m=(a.v+b.v)/2;
    if(!(m>a.v&&m<b.v)||(b.v-a.v)*sv<=toleranceMm/4)return refined.push(b);
    const mid={v:m,cuts:cutsAt(m)};
    const bent=a.cuts.length!==b.cuts.length||mid.cuts.length!==a.cuts.length||mid.cuts.some((c,i)=>[0,1].some(e=>Math.abs(c[e]-(a.cuts[i][e]+b.cuts[i][e])/2)*su>toleranceMm));
    if(!bent)return refined.push(b);
    visit(a,mid);visit(mid,b);
  };
  for(let i=1;i<levels.length;i++)visit(refined.at(-1),levels[i]);
  const holes=[],open=[];
  for(let k=0;k<refined.length;k++){
    const {v,cuts}=refined[k],prev=k?refined[k-1]:null,next=[];
    for(const cut of cuts){
      const from=open.filter(h=>overlaps(h.last,cut));
      requireThat(from.length<=1,`Surface ribbon folds merge near v ${v}; trimming merging folds is not supported yet.`);
      if(from.length){requireThat(!next.includes(from[0]),`Surface ribbon fold splits near v ${v}; trimming splitting folds is not supported yet.`);
        const h=from[0],shift=Math.round(((h.last[0]+h.last[1])-(cut[0]+cut[1]))/(2*P))*P;
        h.left.push([cut[0]+shift,v]);h.right.push([cut[1]+shift,v]);h.last=[cut[0]+shift,cut[1]+shift];next.push(h);continue;}
      // A fold appearing between levels starts at a tip; at the bottom edge it runs along it.
      const h={left:[[cut[0],v]],right:[[cut[1],v]],last:cut,tip:prev?[[(cut[0]+cut[1])/2,prev.v]]:[]};next.push(h);
    }
    for(const h of open)if(!next.includes(h)){
      const top=[[(h.last[0]+h.last[1])/2,v]];
      holes.push([...h.tip,...h.left,...top,...h.right.reverse()]);
    }
    open.splice(0,open.length,...next);
  }
  for(const h of open)holes.push([...h.tip,...h.left,...h.right.reverse()]);
  return holes;
}

// On a general patch, a fold is where the moved patch's orientation reverses
// against the source: (M_u x M_v) . (S_u x S_v) <= 0, sampled 8 x 8 per knot
// span. Trimming it is not supported yet; the first found is named.
export function rejectFolds({source,moved,kind}){
  const grid=(knots,[a,b])=>{const breaks=[...new Set([...knots].filter(t=>t>=a&&t<=b))],out=[];for(let i=1;i<breaks.length;i++)for(let k=0;k<8;k++)out.push(breaks[i-1]+(breaks[i]-breaks[i-1])*(k+.5)/8);return out;};
  for(const u of grid(source.knotsU,source.domainU))for(const v of grid(source.knotsV,source.domainV)){
    const s=evaluate(source,u,v),m=evaluate(moved,u,v);
    requireThat(dot(cross(m.du,m.dv),cross(s.du,s.dv))>0,
      `Surface ${kind} folds near (u ${+u.toFixed(6)}, v ${+v.toFixed(6)}), at [${m.point.map(x=>+x.toFixed(3)).join(', ')}] mm; trimming folds is supported only for a sleeve's ribbon, so reduce the depth.`);
  }
  return [];
}
