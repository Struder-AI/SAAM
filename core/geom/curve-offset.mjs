// Fixed-size loose NURBS curve offsets, horizontally in XY or within a spline
// surface as a (u,v) curve. Control count, knots, degree and weights are
// preserved; only control positions move. A surface offset is trimmed to the
// patch, and each trimmed end adds controls.
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

// Boehm knot insertion of t up to multiplicity degree. The control at index
// `at` is then the curve point at t.
function clampAt(curve,t){
  let {n,knots,cp}=curve;const {order}=curve,p=order-1;
  for(let s=knots.filter(k=>k===t).length;s<p;s++){
    const k=findSpan(knots,n,order,t),next=new Float64Array((n+1)*4);
    next.set(cp.subarray(0,(k-p+1)*4));next.set(cp.subarray(k*4),(k+1)*4);
    for(let i=k-p+1;i<=k;i++){
      const alpha=(t-knots[i])/(knots[i+p]-knots[i]);
      for(let c=0;c<4;c++)next[i*4+c]=alpha*cp[i*4+c]+(1-alpha)*cp[(i-1)*4+c];
    }
    knots=Float64Array.from([...knots.subarray(0,k+1),t,...knots.subarray(k+1)]);cp=next;n++;
  }
  return {curve:{...curve,n,knots,cp},at:Math.min(knots.lastIndexOf(t)-p,n-1)};
}

// The clamped piece of a curve on [a, b].
function extract(curve,a,b){
  const left=clampAt(curve,a),right=clampAt(left.curve,b),{order}=curve,n=right.at-left.at+1;
  const knots=Float64Array.from([...Array(order).fill(a),...right.curve.knots.filter(k=>k>a&&k<b),...Array(order).fill(b)]);
  requireThat(knots.length===n+order,'Curve trimming produced an inconsistent knot vector.');
  return {n,order,knots,cp:right.curve.cp.slice(left.at*4,(right.at+1)*4),domain:[a,b]};
}

// B continues A at A's end once its parameter is shifted; the joint is C0.
function join(A,B,shift){
  const knots=Float64Array.from([...A.knots.subarray(0,A.n),...Array(A.order-1).fill(A.domain[1]),...[...B.knots.subarray(B.order)].map(k=>k+shift)]);
  const cp=new Float64Array((A.n+B.n-1)*4);cp.set(A.cp);cp.set(B.cp.subarray(4),A.n*4);
  return {n:A.n+B.n-1,order:A.order,knots,cp,domain:[A.domain[0],B.domain[1]+shift]};
}

// De Casteljau split of scalar Bezier coefficients at s.
function casteljau(h,s){
  const left=[],right=[];let row=[...h];
  while(row.length){left.push(row[0]);right.unshift(row.at(-1));row=row.slice(1).map((v,i)=>row[i]+(v-row[i])*s);}
  return [left,right];
}

// Roots of a scalar Bezier polynomial on [a, b]: no sign change in the
// coefficients means no root; exactly one, with opposite ends, means one root,
// bisected to the floating-point floor; otherwise split and recurse.
function bezierRoots(h,a,b,out){
  const signs=h.filter(x=>x!==0).map(Math.sign);
  let changes=0;for(let i=1;i<signs.length;i++)if(signs[i]!==signs[i-1])changes++;
  if(changes===0)return;
  const m=(a+b)/2;
  if(m<=a||m>=b){out.push(m);return;}
  if(changes===1&&h[0]*h.at(-1)<0){
    let lo=a,hi=b;
    for(let mid=m;mid>lo&&mid<hi;mid=(lo+hi)/2){
      const v=casteljau(h,(mid-a)/(b-a))[0].at(-1);
      if(v===0){lo=hi=mid;break;}
      if(Math.sign(v)===Math.sign(h[0]))lo=mid;else hi=mid;
    }
    out.push((lo+hi)/2);return;
  }
  const [l,r]=casteljau(h,.5);bezierRoots(l,a,m,out);bezierRoots(r,m,b,out);
}

// Parameter intervals where a (u,v) curve lies inside the nonperiodic domain
// bounds. Each knot span whose controls straddle a bound is converted to Bezier
// form for exact root isolation; touching a bound counts as inside.
function insideIntervals(curve,bounds,inside){
  const {n,order,knots,domain}=curve,p=order-1,roots=[];
  const values=(c,axis,value)=>Array.from({length:order},(_,j)=>c.cp[j*4+axis]-value*c.cp[j*4+3]);
  for(let i=p;i<n;i++){
    const a=knots[i],b=knots[i+1];if(!(b>a))continue;
    const local={n:order,order,knots:knots.slice(i-p,i+p+2),cp:curve.cp.slice((i-p)*4,(i+1)*4),domain:[a,b]};
    let bezier=null;
    for(const {axis,value} of bounds){
      const g=values(local,axis,value);
      if(g.every(x=>x>=0)||g.every(x=>x<=0))continue;
      bezier??=extract(local,a,b);bezierRoots(values(bezier,axis,value),a,b,roots);
    }
  }
  const ts=[domain[0],...roots.filter(t=>t>domain[0]&&t<domain[1]).sort((x,y)=>x-y),domain[1]],out=[];
  for(let i=1;i<ts.length;i++){
    const a=ts[i-1],b=ts[i];
    if(!(b>a)||!inside(evaluateCurve(curve,(a+b)/2).point))continue;
    if(out.length&&out.at(-1)[1]===a)out.at(-1)[1]=b;else out.push([a,b]);
  }
  return out;
}

// Signed area of the curve in its first two coordinates, from knot
// quarter-span samples: the orientation of a closed loop.
function signedArea(curve){
  const {knots,domain}=curve,breaks=[...new Set([...knots].filter(x=>x>=domain[0]&&x<=domain[1]))],points=[];
  for(let b=1;b<breaks.length;b++)for(let j=0;j<4;j++)points.push(evaluateCurve(curve,breaks[b-1]+(breaks[b]-breaks[b-1])*j/4).point);
  return points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+(p[0]*q[1]-q[0]*p[1])/2;},0);
}

// Without a patch the curve is XYZ and offsets horizontally, perpendicular to
// its XY tangent. With a patch it is a (u,v) curve offset within the surface;
// depth is millimetres to first order, and the result keeps only what lies
// inside the patch, as (u,v) curves on the reference's parameters (a piece
// joined across a periodic curve's seam runs past its end by one period).
// Positive depth is outward from a closed loop (periodic, with coinciding
// ends) and otherwise to the right of travel, seen from +Z or from the
// surface normal's side.
export function prepareCurveOffsets({curve,patch=null,periodic=false,periodicU=false,periodicV=false}){
  requireCurve(curve);
  requireThat([periodic,periodicU,periodicV].every(p=>typeof p==='boolean')&&(patch===null||patch?.cp&&patch.domainU&&patch.domainV),
    'Curve offsets need explicit periodic flags and, on a surface, a patch.');
  const [start,end]=curve.domain.map(t=>evaluateCurve(curve,t).point);
  const loop=periodic&&Math.hypot(start[0]-end[0],start[1]-end[1],start[2]-end[2])<=1e-9;
  requireThat(!periodic||loop||patch,'A periodic curve must end where it starts.');
  const area=loop?signedArea(curve):0;
  requireThat(!loop||Math.abs(area)>1e-12,'A closed curve with no enclosed area has no outward side.');
  const sign=area<0?-1:1;
  if(!patch){
    const field=looseCurveField(curve,periodic,t=>sideAt(curve,t,periodic,tangent=>{
      const side=[tangent[1],-tangent[0],0],size=Math.hypot(...side);
      requireThat(size>1e-12,'Curve offset reference has a vertical or collapsed tangent.');
      return side.map(v=>v/size);
    }).map(v=>v*sign));
    return {offsetCurves:depth=>[field.offsetCurve(depth)],report:field.report,
      at:(t,depth=0)=>({point:evaluateCurve(field.offsetCurve(depth),wrap(t,curve.domain,periodic)).point})};
  }
  const domains=[[patch.domainU,periodicU],[patch.domainV,periodicV]];
  const bounds=domains.flatMap(([range,wraps],axis)=>wraps?[]:range.map(value=>({axis,value})));
  const inside=([u,v])=>[u,v].every((x,k)=>domains[k][1]||x>=domains[k][0][0]-1e-9&&x<=domains[k][0][1]+1e-9);
  const surfaceUv=([u,v])=>[wrap(u,...domains[0]),wrap(v,...domains[1])];
  const whole=(c,parts)=>parts.length===1&&parts[0][0]===c.domain[0]&&parts[0][1]===c.domain[1];
  requireThat(whole(curve,insideIntervals(curve,bounds,inside)),'The reference curve must lie inside the patch domain.');
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
    return [sign*(G*a-F*b)/det,sign*(E*b-F*a)/det,0];
  });
  function offsetCurves(depth){
    const offset=field.offsetCurve(depth),parts=insideIntervals(offset,bounds,inside),[d0,d1]=offset.domain;
    if(whole(offset,parts))return [offset];
    const pieces=parts.map(([a,b])=>extract(offset,a,b));
    if(periodic&&pieces.length>1&&parts[0][0]===d0&&parts.at(-1)[1]===d1)pieces.unshift(join(pieces.pop(),pieces.shift(),d1-d0));
    return pieces;
  }
  return {offsetCurves,report:field.report,at:(t,depth=0)=>{
    const uv=evaluateCurve(field.offsetCurve(depth),wrap(t,curve.domain,periodic)).point.slice(0,2);
    return inside(uv)?{uv:surfaceUv(uv),point:evaluate(patch,...surfaceUv(uv),false).point}:null;
  }};
}
