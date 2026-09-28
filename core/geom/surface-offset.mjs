// Loose surface ribbons and surface offsets (D-041). A ribbon displaces a
// patch horizontally, along the plan-view projection of its unit normal, with
// Z kept exactly; an offset displaces it along its unit normal. Both move
// controls only (count, knots, degrees and weights are kept). The direction net
// is collocated: at every Greville point the moved patch is the source point
// moved exactly the depth along the unit direction there, so planes, cylinders
// and spheres move exactly at those points. Nothing limits the depth: past a
// curvature radius the moved patch folds, and trimming folds is left to
// trimmed-surface records.
import {evaluate,findSpan,basisFunctions} from './nurbs.mjs';
import {requireThat} from './tolerance.mjs';
import {leastSquares} from './least-squares.mjs';
import {trimmedSurface,isSleeve,sleeveFoldHoles,rejectFolds} from './trimmed-surface.mjs';

const wrapped=(t,[a,b])=>a+(((t-a)/(b-a))%1+1)%1*(b-a);

// One parameter direction's collocation: the distinct control groups (a
// periodic net's seam duplicates share one, by wrapped Greville parameter),
// their Greville parameters (clamped to a nonperiodic domain) and a solver of
// the square collocation system.
function collocationAxis(knots,count,order,domain,periodic){
  const groups=new Int32Array(count),params=[],seen=new Map();
  for(let i=0;i<count;i++){
    let t=0;for(let k=1;k<order;k++)t+=knots[i+k];t/=order-1;
    t=periodic?wrapped(t,domain):Math.max(domain[0],Math.min(domain[1],t));
    const key=periodic?Math.round((t-domain[0])/(domain[1]-domain[0])*1e10)%1e10:i;
    if(!seen.has(key)){seen.set(key,params.length);params.push(t);}
    groups[i]=seen.get(key);
  }
  requireThat(new Set(params).size===params.length,'Surface offset collocation needs distinct Greville parameters; an unclamped nonperiodic net repeats one at its domain edge.');
  const rows=params.map(t=>{
    const span=findSpan(knots,count,order,t),basis=basisFunctions(knots,span,t,order),row=new Array(params.length).fill(0);
    for(let k=0;k<order;k++)row[groups[span-order+1+k]]+=basis[k];
    return row;
  });
  return {groups,params,solve:leastSquares(rows)};
}

// The rational denominator W(u, v) of a patch.
function weightAt({nu,nv,orderU,orderV,knotsU,knotsV,cp},u,v){
  const su=findSpan(knotsU,nu,orderU,u),sv=findSpan(knotsV,nv,orderV,v),bu=basisFunctions(knotsU,su,u,orderU),bv=basisFunctions(knotsV,sv,v,orderV);
  let w=0;
  for(let i=0;i<orderU;i++)for(let j=0;j<orderV;j++)w+=bu[i]*bv[j]*cp[((su-orderU+1+i)*nv+sv-orderV+1+j)*4+3];
  return w;
}

// The unit displacement direction of a ribbon (horizontal) or an offset
// (normal) at an evaluated patch point.
function unitDirection(kind,evaluated){
  const n=evaluated.normal;
  requireThat(n?.every(Number.isFinite),'Surface offset reference has a collapsed normal (a pole or degenerate point).');
  if(kind==='offset')return n;
  const size=Math.hypot(n[0],n[1]);
  requireThat(size>1e-12,'Surface ribbon reference is horizontal here: its normal has no plan-view direction.');
  return [n[0]/size,n[1]/size,0];
}

// Homogeneous direction controls E (w times the control's direction) with
// sum N_i(u_a) N_j(v_b) E_ij = W(u_a, v_b) d(u_a, v_b) on the Greville grid.
// The tensor system is separable: one small square solve along U per (v_b,
// coordinate), then one along V per (u_a, coordinate).
function looseSurfaceField(patch,periodicU,periodicV,kind){
  const U=collocationAxis(patch.knotsU,patch.nu,patch.orderU,patch.domainU,periodicU);
  const V=collocationAxis(patch.knotsV,patch.nv,patch.orderV,patch.domainV,periodicV);
  const R=U.params.map(u=>V.params.map(v=>{const w=weightAt(patch,u,v);return unitDirection(kind,evaluate(patch,u,v)).map(x=>x*w);}));
  const alongU=V.params.map((_,b)=>[0,1,2].map(k=>U.solve(R.map(row=>row[b][k]))));
  const E=U.params.map((_,a)=>[0,1,2].map(k=>V.solve(alongU.map(column=>column[k][a]))));
  const directions=new Float64Array(patch.cp.length);
  for(let i=0;i<patch.nu;i++)for(let j=0;j<patch.nv;j++){
    const at=(i*patch.nv+j)*4,e=E[U.groups[i]];
    // A ribbon's direction net has no Z, so Z is kept exactly.
    for(let k=0;k<3;k++)directions[at+k]=kind==='ribbon'&&k===2?0:e[k][V.groups[j]];
    directions[at+3]=patch.cp[at+3];
  }
  return directions;
}

function prepareLooseSurface(kind,{patch,periodicU=false,periodicV=false}){
  requireThat(patch?.cp&&patch.domainU&&patch.domainV&&typeof periodicU==='boolean'&&typeof periodicV==='boolean',
    'Surface ribbons and offsets need a NURBS patch and explicit periodic flags.');
  for(let i=3;i<patch.cp.length;i+=4)requireThat(Number.isFinite(patch.cp[i])&&patch.cp[i]>0,'Surface offset reference weights must be positive and finite.');
  const parameter=(value,domain,periodic)=>{
    requireThat(Number.isFinite(value),'Surface offset parameters must be finite.');
    if(periodic)return wrapped(value,domain);
    requireThat(value>=domain[0]-1e-12&&value<=domain[1]+1e-12,'Surface offset parameter is outside its patch domain.');
    return Math.max(domain[0],Math.min(domain[1],value));
  };
  const parameters=(u,v)=>[parameter(u,patch.domainU,periodicU),parameter(v,patch.domainV,periodicV)];
  const directions=looseSurfaceField(patch,periodicU,periodicV,kind),directionPatch={...patch,cp:directions};
  let queries=0,minLength=Infinity,maxLength=0;
  // The loose moved patch at a depth.
  const offsetPatch=depth=>{
    requireThat(Number.isFinite(depth),'Surface offset depth must be finite.');
    const cp=patch.cp.slice();
    for(let i=0;i<cp.length;i+=4)for(let k=0;k<3;k++)cp[i+k]+=depth*directions[i+k];
    return {...patch,cp};
  };
  // A point of the loose moved patch, without building it.
  const at=(u,v,depth=0)=>{
    requireThat(Number.isFinite(depth),'Surface offset depth must be finite.');
    [u,v]=parameters(u,v);
    const point=evaluate(patch,u,v,false).point,direction=evaluate(directionPatch,u,v,false).point,size=Math.hypot(...direction);
    queries++;minLength=Math.min(minLength,size);maxLength=Math.max(maxLength,size);
    return point.map((p,k)=>p+depth*direction[k]);
  };
  // The source point moved exactly the depth along the unit direction there.
  const exactAt=(u,v,depth=0)=>{
    requireThat(Number.isFinite(depth),'Surface offset depth must be finite.');
    [u,v]=parameters(u,v);
    const evaluated=evaluate(patch,u,v),direction=unitDirection(kind,evaluated);
    return evaluated.point.map((p,k)=>p+depth*direction[k]);
  };
  // The loose moved patch as a trimmed-surface record with its folds resolved:
  // a sleeve's ribbon (every U isocurve at one Z) has them trimmed per level;
  // any other patch is rejected where it folds.
  const trimmed=(depth,{toleranceMm=0.01}={})=>{
    requireThat(toleranceMm>0,'Surface fold trimming needs a positive toleranceMm.');
    const moved=offsetPatch(depth);
    const holes=kind==='ribbon'&&!periodicV&&isSleeve(patch)?sleeveFoldHoles({source:patch,moved,periodic:periodicU,toleranceMm}):rejectFolds({source:patch,moved,kind});
    return trimmedSurface({patch:moved,periodicU,periodicV,holes});
  };
  return {at,exactAt,offsetPatch,trimmed,report:()=>({offsetKind:kind,offsetQueries:queries,offsetControlCount:patch.nu*patch.nv,offsetOrderU:patch.orderU,offsetOrderV:patch.orderV,periodicU,periodicV,
    sampledDirectionLengthRange:queries?[minLength,maxLength]:null,
    offsetScope:kind==='ribbon'
      ?'Loose surface ribbon: controls move horizontally along directions collocated with the unit plan-view normal at Greville points; Z is kept exactly. Depth is exact at Greville points and approximate between them. Folds are not limited or trimmed.'
      :'Loose surface offset: controls move along directions collocated with the unit normal at Greville points. Depth is exact at Greville points and approximate between them. Folds are not limited or trimmed.'})};
}

// A patch displaced horizontally with Z kept: { at(u, v, depth), exactAt,
// offsetPatch(depth), report }. Positive depth is along the normal's
// plan-view projection.
export function prepareSurfaceRibbon(options){return prepareLooseSurface('ribbon',options);}

// A patch displaced along its unit normal, with the same interface.
export function prepareSurfaceOffset(options){return prepareLooseSurface('offset',options);}
