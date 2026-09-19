// Limit loose control displacements before a sampled surface Jacobian folds.
// The result remains one patch. This is local regularity, not Boolean trimming
// or a global self-intersection certificate.
import {basisDerivatives,findSpan,evaluate} from './nurbs.mjs';
import {requireThat} from './tolerance.mjs';
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const MARGIN=.05;
function firstRoot(b,c){
  requireThat(Number.isFinite(b)&&Number.isFinite(c),'Loose offset curvature coefficients must be finite.');
  if(c===0)return b<0?(MARGIN-1)/b:Infinity;
  const discriminant=b*b-4*c*(1-MARGIN);
  if(discriminant<0)return Infinity;
  const q=-.5*(b+(b>=0?1:-1)*Math.sqrt(discriminant));
  return Math.min(...[q/c,(1-MARGIN)/q].filter(x=>x>0),Infinity);
}
function samples(knots,domain){
  const breaks=[...new Set([...knots].filter(x=>x>=domain[0]&&x<=domain[1]))],out=[];
  for(let i=1;i<breaks.length;i++)for(let j=0;j<4;j++)out.push(breaks[i-1]+(breaks[i]-breaks[i-1])*j/4);
  out.push(domain[1]);return out;
}
export function prepareOffsetCurvature(patch,directions,{periodicU,periodicV}){
  const count=patch.nu*patch.nv,groups=new Int32Array(count),seen=new Map();let groupCount=0;
  for(let i=0;i<count;i++){
    // Repeated periodic seam controls must receive the same reduction.
    const key=(periodicU||periodicV)?patch.cp.slice(4*i,4*i+4).join(','):i;
    if(!seen.has(key))seen.set(key,groupCount++);groups[i]=seen.get(key);
  }
  const rows=[];let positive=Infinity,negative=Infinity;
  for(const u of samples(patch.knotsU,patch.domainU))for(const v of samples(patch.knotsV,patch.domainV)){
    const e=evaluate(patch,u,v),normal=cross(e.du,e.dv),area=dot(normal,normal);
    requireThat(Number.isFinite(area)&&area>1e-24,'Loose offset curvature limiting needs a regular reference patch.');
    const su=findSpan(patch.knotsU,patch.nu,patch.orderU,u),sv=findSpan(patch.knotsV,patch.nv,patch.orderV,v);
    const bu=basisDerivatives(patch.knotsU,su,u,patch.orderU,1),bv=basisDerivatives(patch.knotsV,sv,v,patch.orderV,1);
    const terms=[];let w=0,wu=0,wv=0;
    for(let i=0;i<patch.orderU;i++)for(let j=0;j<patch.orderV;j++){
      const index=(su-patch.orderU+1+i)*patch.nv+sv-patch.orderV+1+j;
      const n=bu[0][i]*bv[0][j],du=bu[1][i]*bv[0][j],dv=bu[0][i]*bv[1][j],weight=patch.cp[index*4+3];
      terms.push({index,n,du,dv});w+=n*weight;wu+=du*weight;wv+=dv*weight;
    }
    const entries=terms.map(({index,n,du,dv})=>({group:groups[index],
      du:[0,1,2].map(k=>(du-n*wu/w)/w*directions[index*4+k]),
      dv:[0,1,2].map(k=>(dv-n*wv/w)/w*directions[index*4+k])}));
    const coefficients=depths=>{
      const a=[0,0,0],b=[0,0,0];
      for(const entry of entries){const depth=depths?depths[entry.group]:1;
        for(let k=0;k<3;k++){a[k]+=entry.du[k]*depth;b[k]+=entry.dv[k]*depth;}}
      return [(dot(cross(a,e.dv),normal)+dot(cross(e.du,b),normal))/area,dot(cross(a,b),normal)/area];
    };
    const [b,c]=coefficients(null);positive=Math.min(positive,firstRoot(b,c));negative=Math.min(negative,firstRoot(-b,c));
    rows.push({entries,coefficients});
  }
  const cache=new Map(),report={curvatureSampleCount:rows.length,curvatureAreaRatioFloor:MARGIN,
    curvatureLimitedPatches:0,maxControlDepthReductionMm:0,
    curvatureScope:'Local control-depth reduction preserves the reference orientation through the offset at knot quarter-span samples. The fixed NURBS net stays smooth; unsampled folds and global self-intersections are not certified.'};
  const needsLimit=depth=>depth>positive||-depth>negative;
  function limitedPatch(depth){
    if(cache.has(depth))return cache.get(depth);
    const depths=new Float64Array(groupCount).fill(depth);
    // Every incomplete pass shrinks at least one control depth, so the passes
    // end on the fold criterion itself. A pass that changes no depth at all has
    // reached the floating-point floor and cannot unfold the patch.
    let complete=false;
    while(!complete){
      complete=true;const factors=new Float64Array(groupCount).fill(1);
      for(const row of rows){
        const [b,c]=row.coefficients(depths),root=firstRoot(b,c);
        if(root>=1)continue;
        complete=false;
        for(const entry of row.entries)factors[entry.group]=Math.min(factors[entry.group],root*(1-1e-8));
      }
      if(complete)break;
      let reduced=false;
      for(let i=0;i<groupCount;i++){const next=depths[i]*factors[i];if(next!==depths[i])reduced=true;depths[i]=next;}
      requireThat(reduced,'Loose offset local curvature limiting stopped reducing its control depths before the patch unfolded; no folded patch was returned.');
    }
    const cp=patch.cp.slice();let reduction=0;
    for(let i=0;i<count;i++){
      const applied=depths[groups[i]];reduction=Math.max(reduction,Math.abs(depth-applied));
      for(let k=0;k<3;k++)cp[i*4+k]+=applied*directions[i*4+k];
    }
    report.curvatureLimitedPatches++;report.maxControlDepthReductionMm=Math.max(report.maxControlDepthReductionMm,reduction);
    const result={...patch,cp};if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(depth,result);return result;
  }
  return {needsLimit,limitedPatch,report};
}
