// Fixed-size loose NURBS curve offsets: to one side of a reference normal, and
// within a spline surface as a (u,v) curve. Control count, knots, degree and
// weights are preserved; only control positions move.
import {basisDerivatives,findSpan,evaluate,evaluateCurve} from './nurbs.mjs';
import {requireThat,cross,dot} from './tolerance.mjs';
const MARGIN=.05;

function requireCurve(curve){
  const {n,order,knots,cp,domain}=curve??{};
  requireThat(Number.isInteger(n)&&Number.isInteger(order)&&order>=2&&n>=order&&knots?.length===n+order&&cp?.length===n*4&&domain?.[1]>domain[0],
    'Curve offsets need a NURBS curve record; build one with referenceCurve.');
  for(let i=0;i<n;i++)requireThat(Number.isFinite(cp[i*4+3])&&cp[i*4+3]>0,'Curve offset reference weights must be positive and finite.');
}
const wrap=(t,[a,b],periodic)=>periodic?a+(((t-a)/(b-a)%1+1)%1)*(b-a):Math.max(a,Math.min(b,t));

// Rational basis values R_i(t) = N_i(t) w_i / w(t) of the controls supporting t.
function rationalBasis({n,order,knots,cp},t){
  const span=findSpan(knots,n,order,t),basis=basisDerivatives(knots,span,t,order,1),out=[];
  let w=0,wt=0;
  for(let i=0;i<order;i++){const weight=cp[(span-order+1+i)*4+3];w+=basis[0][i]*weight;wt+=basis[1][i]*weight;}
  for(let i=0;i<order;i++){const index=span-order+1+i,weight=cp[index*4+3];
    out.push({index,value:basis[0][i]*weight/w,rate:(basis[1][i]-basis[0][i]*wt/w)*weight/w});}
  return out;
}

// Gaussian elimination with partial pivoting on sparse rows (Map column to
// value). Collocation rows are banded, so fill stays near the band.
function solveSparse(rows,rhs){
  const n=rows.length;
  for(let k=0;k<n;k++){
    let pivot=-1,best=0;
    for(let i=k;i<n;i++){const v=Math.abs(rows[i].get(k)??0);if(v>best){best=v;pivot=i;}}
    requireThat(best>1e-12,'Loose curve offset collocation is singular: two controls share a Greville parameter.');
    [rows[k],rows[pivot]]=[rows[pivot],rows[k]];[rhs[k],rhs[pivot]]=[rhs[pivot],rhs[k]];
    const head=rows[k].get(k);
    for(let i=k+1;i<n;i++){
      const factor=(rows[i].get(k)??0)/head;if(factor===0)continue;
      for(const [column,value] of rows[k])rows[i].set(column,(rows[i].get(column)??0)-factor*value);
      rows[i].delete(k);rhs[i]=rhs[i].map((v,c)=>v-factor*rhs[k][c]);
    }
  }
  const x=new Array(n);
  for(let k=n-1;k>=0;k--){
    const sum=rhs[k].slice();
    for(const [column,value] of rows[k])if(column>k)for(let c=0;c<3;c++)sum[c]-=value*x[column][c];
    x[k]=sum.map(v=>v/rows[k].get(k));
  }
  return x;
}

// Control directions are collocated: the direction curve, with the curve's own
// basis and weights, equals the unit side direction at each distinct control's
// Greville parameter, so lines and circular arcs offset exactly. Tangent speed
// along the reference tangent must retain 5% of its value at knot quarter-span
// samples; it is linear in depth, so the endpoint check covers the whole
// displacement. Failing samples reduce the depths of their supporting controls
// together, as in offset-curvature.mjs.
function looseCurveField(curve,periodic,directionAt){
  const {n,order,knots,cp,domain}=curve,groups=new Int32Array(n),first=[],seen=new Map();
  for(let i=0;i<n;i++){
    // Repeated periodic seam controls share one unknown and one reduction.
    const key=periodic?cp.slice(4*i,4*i+4).join(','):i;
    if(!seen.has(key)){seen.set(key,first.length);first.push(i);}groups[i]=seen.get(key);
  }
  const groupCount=first.length,rhs=[],matrix=first.map(i=>{
    let t=0;for(let k=1;k<order;k++)t+=knots[i+k];
    t=wrap(t/(order-1),domain,periodic);rhs.push([...directionAt(t)]);
    const row=new Map();
    for(const {index,value} of rationalBasis(curve,t))if(value!==0)row.set(groups[index],(row.get(groups[index])??0)+value);
    return row;
  });
  const solved=solveSparse(matrix,rhs),directions=new Float64Array(n*3);
  for(let i=0;i<n;i++)directions.set(solved[groups[i]],i*3);
  const breaks=[...new Set([...knots].filter(x=>x>=domain[0]&&x<=domain[1]))],rows=[];
  for(let b=1;b<breaks.length;b++)for(let j=0;j<=4;j++){
    if(j===4&&b<breaks.length-1)continue;
    const t=breaks[b-1]+(breaks[b]-breaks[b-1])*j/4,tangent=evaluateCurve(curve,t).derivative,speed=dot(tangent,tangent);
    requireThat(Number.isFinite(speed)&&speed>1e-24,'Loose curve offset needs a regular reference curve.');
    const entries=rationalBasis(curve,t).map(({index,rate})=>({group:groups[index],rate:rate*dot(directions.subarray(index*3,index*3+3),tangent)/speed}));
    rows.push({entries,unit:entries.reduce((sum,e)=>sum+e.rate,0)});
  }
  const cache=new Map(),report={offsetControlCount:n,offsetOrder:order,periodic,curvatureSampleCount:rows.length,curvatureSpeedRatioFloor:MARGIN,
    curvatureLimitedCurves:0,maxControlDepthReductionMm:0,
    curvatureScope:'Local control-depth reduction keeps the reference direction of travel at knot quarter-span samples. Requested depth is approximate; unsampled cusps and global self-intersections are not certified.'};
  const rootOf=rate=>rate<0?(MARGIN-1)/rate:Infinity;
  function offsetCurve(depth){
    requireThat(Number.isFinite(depth),'Curve offset depth must be finite.');
    if(cache.has(depth))return cache.get(depth);
    const depths=new Float64Array(groupCount).fill(depth);
    if(rows.some(row=>1+depth*row.unit<MARGIN)){
      // Every incomplete pass shrinks at least one control depth; a pass that
      // changes none has reached the floating-point floor.
      for(let complete=false;!complete;){
        complete=true;const factors=new Float64Array(groupCount).fill(1);
        for(const row of rows){
          const root=rootOf(row.entries.reduce((sum,e)=>sum+e.rate*depths[e.group],0));
          if(root>=1)continue;
          complete=false;
          for(const e of row.entries)factors[e.group]=Math.min(factors[e.group],root*(1-1e-8));
        }
        if(complete)break;
        let reduced=false;
        for(let g=0;g<groupCount;g++){const next=depths[g]*factors[g];if(next!==depths[g])reduced=true;depths[g]=next;}
        requireThat(reduced,'Loose curve offset limiting stopped reducing its control depths before the curve unfolded; no folded curve was returned.');
      }
      report.curvatureLimitedCurves++;
      for(let g=0;g<groupCount;g++)report.maxControlDepthReductionMm=Math.max(report.maxControlDepthReductionMm,Math.abs(depth-depths[g]));
    }
    const out=cp.slice();
    for(let i=0;i<n;i++)for(let k=0;k<3;k++)out[i*4+k]+=depths[groups[i]]*directions[i*3+k]*cp[i*4+3];
    const result={...curve,cp:out};
    if(cache.size>=128)cache.delete(cache.keys().next().value);
    cache.set(depth,result);return result;
  }
  return {offsetCurve,report:()=>({...report})};
}

// The side direction at t: one unit direction where the curve is smooth, and
// at a kink (a polyline vertex) the miter m with m.s = 1 for the unit side s of
// each tangent, so both adjoining pieces stay parallel at the offset depth. A
// periodic curve's left tangent at its start is its end tangent.
function sideAt(curve,t,periodic,unitSide){
  const right=unitSide(evaluateCurve(curve,t).derivative);
  const left=t>curve.domain[0]?unitSide(evaluateCurve(curve,t,true).derivative):periodic?unitSide(evaluateCurve(curve,curve.domain[1],true).derivative):right;
  const cosine=dot(left,right);
  if(1-cosine<1e-12)return right;
  requireThat(1+cosine>1e-9,'Curve offset reference reverses direction at a cusp.');
  return [0,1,2].map(k=>(left[k]+right[k])/(1+cosine));
}

// Positive depth is to the right of travel seen from the normal's side: for an
// XY curve and the default +Z normal, outward from a counterclockwise loop. A
// space curve offsets perpendicular to both its tangent and the normal.
export function prepareCurveOffsets({curve,normal=[0,0,1],periodic=false}){
  requireCurve(curve);
  requireThat(Array.isArray(normal)&&normal.length===3&&normal.every(Number.isFinite)&&Math.hypot(...normal)>0&&typeof periodic==='boolean',
    'Curve offsets need a finite nonzero normal and an explicit periodic flag.');
  const axis=normal.map(v=>v/Math.hypot(...normal));
  const field=looseCurveField(curve,periodic,t=>sideAt(curve,t,periodic,tangent=>{
    const side=cross(tangent,axis),size=Math.hypot(...side);
    requireThat(size>1e-12,'Curve offset reference has a collapsed tangent or one parallel to its normal.');
    return side.map(v=>v/size);
  }));
  return {offsetCurve:field.offsetCurve,report:field.report,
    at:(t,depth=0)=>evaluateCurve(field.offsetCurve(depth),wrap(t,curve.domain,periodic)).point};
}

// A (u,v) curve on a patch, offset within the surface. Positive depth is to the
// right of travel seen from the surface normal's side. The collocated side
// directions are (u,v) images of in-surface millimetre directions, so depth is
// millimetres to first order. The offset stays a (u,v) curve of the
// same size; its 3D image is the surface evaluated along it.
export function prepareSurfaceCurveOffsets({patch,curve,periodic=false,periodicU=false,periodicV=false}){
  requireCurve(curve);
  requireThat(patch?.cp&&patch.domainU&&patch.domainV&&[periodic,periodicU,periodicV].every(p=>typeof p==='boolean'),
    'Surface curve offsets need a patch and explicit periodic flags.');
  const domains=[[patch.domainU,periodicU],[patch.domainV,periodicV]];
  const inside=([u,v])=>[u,v].every((x,k)=>domains[k][1]||x>=domains[k][0][0]-1e-9&&x<=domains[k][0][1]+1e-9);
  const surfaceUv=([u,v])=>[wrap(u,...domains[0]),wrap(v,...domains[1])];
  for(let i=0;i<curve.n;i++)requireThat(inside([0,1].map(k=>curve.cp[i*4+k]/curve.cp[i*4+3])),'Surface curve controls must lie inside the patch domain.');
  const field=looseCurveField(curve,periodic,t=>{
    const e=evaluate(patch,...surfaceUv(evaluateCurve(curve,t).point));
    requireThat(e.normal,'Surface curve offset reference crosses a singular surface point.');
    const side=sideAt(curve,t,periodic,([tu,tv])=>{
      const s=cross([0,1,2].map(k=>e.du[k]*tu+e.dv[k]*tv),e.normal),size=Math.hypot(...s);
      requireThat(size>1e-12,'Surface curve offset reference has a collapsed tangent.');
      return s.map(v=>v/size);
    });
    // Solve [du dv] x = side through the first fundamental form.
    const E=dot(e.du,e.du),F=dot(e.du,e.dv),G=dot(e.dv,e.dv),det=E*G-F*F,a=dot(e.du,side),b=dot(e.dv,side);
    return [(G*a-F*b)/det,(E*b-F*a)/det,0];
  });
  const offsetCurveUv=depth=>{
    const result=field.offsetCurve(depth);
    // Controls inside the domain keep the curve inside it (convex hull).
    for(let i=0;i<result.n;i++)requireThat(inside([0,1].map(k=>result.cp[i*4+k]/result.cp[i*4+3])),
      `Surface curve offset at depth ${depth} mm leaves the patch domain; reduce the depth.`);
    return result;
  };
  return {offsetCurveUv,report:field.report,at:(t,depth=0)=>{
    const uv=surfaceUv(evaluateCurve(offsetCurveUv(depth),wrap(t,curve.domain,periodic)).point);
    return {uv,point:evaluate(patch,...uv,false).point};
  }};
}
