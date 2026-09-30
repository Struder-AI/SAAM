// Loose NURBS curve offsets within a reference surface (the XY plane or a
// spline patch), resolved as a region offset: every curve is offset by moving
// its controls, then the offset curves are cut where they cross and only the
// pieces bounding the offset region are kept. Pieces keep their curve's knots,
// degree and weights; control counts change only where a piece is cut.
import {basisDerivatives,findSpan,evaluate,evaluateCurve} from './nurbs.mjs';
import {requireThat,cross,dot} from './tolerance.mjs';
import {extract,join,reverseCurve,arcCurve,translateCurve,insideIntervals,curveCrossings,periodicCurveCrossings,prepareWinding,preparePeriodicWinding} from './curve-ops.mjs';

export function requireCurve(curve){
  const {n,order,knots,cp,domain}=curve??{};
  requireThat(Number.isInteger(n)&&Number.isInteger(order)&&order>=2&&n>=order&&knots?.length===n+order&&cp?.length===n*4&&domain?.[1]>domain[0],
    'Curve offsets need a NURBS curve record; build one with referenceCurve.');
  for(let i=0;i<n;i++)requireThat(Number.isFinite(cp[i*4+3])&&cp[i*4+3]>0,'Curve offset reference weights must be positive and finite.');
}
const wrap=(t,[a,b],closed)=>closed?a+(((t-a)/(b-a)%1+1)%1)*(b-a):Math.max(a,Math.min(b,t));

// Rational basis values R_i(t) = N_i(t) w_i / w(t) of the controls supporting t.
function rationalBasis({n,order,knots,cp},t){
  const span=findSpan(knots,n,order,t),basis=basisDerivatives(knots,span,t,order,0),out=[];
  let w=0;
  for(let i=0;i<order;i++)w+=basis[0][i]*cp[(span-order+1+i)*4+3];
  for(let i=0;i<order;i++){const index=span-order+1+i;out.push({index,value:basis[0][i]*cp[index*4+3]/w});}
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
// basis and weights, equals the side direction at each distinct control's
// Greville parameter, so lines and circular arcs move exactly. The moved curve
// may fold or cross itself; callers resolve that.
export function looseCurveField(curve,closed,directionAt){
  const {n,order,knots,cp,domain}=curve,groups=new Int32Array(n),first=[],seen=new Map(),[d0,d1]=domain;
  const greville=i=>{let t=0;for(let k=1;k<order;k++)t+=knots[i+k];return wrap(t/(order-1),domain,closed);};
  for(let i=0;i<n;i++){
    // Controls of a closed curve at one wrapped Greville parameter are one
    // control repeated across the seam (moved by whole periods on a periodic
    // chart), and share one unknown.
    const key=closed?Math.round((greville(i)-d0)/(d1-d0)*1e10)%1e10:i;
    if(!seen.has(key)){seen.set(key,first.length);first.push(i);}groups[i]=seen.get(key);
  }
  const rhs=[],matrix=first.map(i=>{
    const t=greville(i);rhs.push([...directionAt(t)]);
    const row=new Map();
    for(const {index,value} of rationalBasis(curve,t))if(value!==0)row.set(groups[index],(row.get(groups[index])??0)+value);
    return row;
  });
  const solved=solveSparse(matrix,rhs),cache=new Map();
  return depth=>{
    requireThat(Number.isFinite(depth),'Curve offset depth must be finite.');
    if(cache.has(depth))return cache.get(depth);
    const out=cp.slice();
    for(let i=0;i<n;i++)for(let k=0;k<3;k++)out[i*4+k]+=depth*solved[groups[i]][k]*cp[i*4+3];
    const result={...curve,cp:out};
    if(cache.size>=128)cache.delete(cache.keys().next().value);
    cache.set(depth,result);return result;
  };
}

// The side direction at t: one unit direction where the curve is smooth, and
// at a kink (a polyline vertex) the vertex's move m with m.s = 1 for the unit
// side s of each tangent, so both adjoining pieces move by the depth. A closed
// curve's left tangent at its start is its end tangent.
export function sideAt(curve,t,closed,unitSide){
  const right=unitSide(evaluateCurve(curve,t).derivative);
  const left=t>curve.domain[0]?unitSide(evaluateCurve(curve,t,true).derivative):closed?unitSide(evaluateCurve(curve,curve.domain[1],true).derivative):right;
  const cosine=dot(left,right);
  if(1-cosine<1e-12)return right;
  requireThat(1+cosine>1e-9,'Curve offset reference reverses direction at a cusp.');
  return [0,1,2].map(k=>(left[k]+right[k])/(1+cosine));
}

// Kept pieces joined end to end. Consecutive pieces of one offset curve are
// rejoined into one piece of that curve. On a periodic chart ends meet modulo
// the period: each piece is moved by whole periods to continue the one before
// it, and wraps counts the periods a closed chain advances around the seam.
function chainPieces(pieces,tol,period){
  // The whole periods from q to p when they meet, else null.
  const meet=(p,q)=>{
    const d=[p[0]-q[0],p[1]-q[1]],k=period?Math.round(d[period.axis]/period.length):0;
    if(period)d[period.axis]-=k*period.length;
    return Math.hypot(d[0],d[1])<=tol?k:null;
  };
  const move=(curve,k)=>k===0?curve:translateCurve(curve,period.axis===0?[k*period.length,0]:[0,k*period.length]);
  const used=new Set(),chains=[];
  const ends=pieces.map(p=>[evaluateCurve(p.curve,p.curve.domain[0]).point,evaluateCurve(p.curve,p.curve.domain[1]).point]);
  const next=i=>pieces.findIndex((_,j)=>!used.has(j)&&meet(ends[i][1],ends[j][0])!==null);
  const starts=pieces.map((_,i)=>i).filter(i=>!pieces.some((_,j)=>j!==i&&meet(ends[j][1],ends[i][0])!==null));
  for(const i of [...starts,...pieces.map((_,i)=>i)]){
    if(used.has(i))continue;
    const chain=[{...pieces[i],index:i,shift:0}];used.add(i);
    for(let j=next(i),at=i;j>=0;at=j,j=next(j)){chain.push({...pieces[j],index:j,shift:chain.at(-1).shift+meet(ends[at][1],ends[j][0])});used.add(j);}
    const close=meet(ends[chain.at(-1).index][1],ends[i][0]);
    chains.push({closed:close!==null,wraps:close===null?0:chain.at(-1).shift+close,pieces:chain});
  }
  return chains.map(({closed,wraps,pieces})=>{
    const merged=[];
    for(const p of pieces){
      const last=merged.at(-1);
      if(last&&last.source===p.source&&last.b===p.a&&last.shift===p.shift){merged[merged.length-1]={...last,b:p.b,curve:extract(p.parent,last.a,p.b)};continue;}
      merged.push(p);
    }
    // Across a closed offset curve's seam; the whole curve is returned as is.
    if(closed&&merged.length>1){
      const first=merged[0],last=merged.at(-1),[d0,d1]=first.parent.domain;
      if(first.source===last.source&&last.b===d1&&first.a===d0){
        const whole=merged.length===2&&last.a===first.b,lastEnd=evaluateCurve(last.curve,last.curve.domain[1]).point;
        const around=move(first.curve,meet(lastEnd,evaluateCurve(first.curve,first.curve.domain[0]).point));
        merged.splice(0,1);merged[merged.length-1]=whole?{...first,curve:first.parent}:{...last,curve:join(last.curve,around,d1-d0)};
      }
    }
    return {closed,wraps,pieces:merged.map(p=>move(p.curve,p.shift))};
  });
}

// Where the exact offset has an inversion cusp, turning from running with its
// source to running against it, the loose curve may turn through a small loop
// instead of a point: a curl. It is a loop of one offset curve closed by one
// self-crossing, with no other crossing on it, entered running one way
// against the source and left running the other (the shorter such arc when
// both arcs of a closed curve qualify). Whatever its winding, it is the cusp
// and bounds no material. Returns, per system curve, tests of whether a
// parameter lies on one of its curls.
function curlArcs(system,{params,pairs},forward,tol){
  const out=system.map(()=>[]);
  for(const {a,s,b,t} of pairs){
    const S=system[a];
    if(a!==b||S.source===undefined)continue;
    const c=S.curve,[d0,d1]=c.domain,P=d1-d0,e=2e-10*P,p=evaluateCurve(c,s).point,q=evaluateCurve(c,t).point;
    // A crossing with the curve's own copy a period away closes no loop.
    if(Math.hypot(p[0]-q[0],p[1]-q[1])>2*tol)continue;
    const lo=Math.min(s,t),hi=Math.max(s,t),on=([x,y])=>r=>r>x&&r<y||r+P>x&&r+P<y;
    const arcs=S.closed?[[lo,hi],[hi,lo+P]]:[[lo,hi]],wrap=r=>r>d1?r-P:r;
    const curls=arcs.filter(([x,y])=>!params[a].some(on([x+e,y-e]))&&forward(S,wrap(x+(y-x)*1e-3))!==forward(S,wrap(y-(y-x)*1e-3)));
    if(curls.length)out[a].push(on(curls.sort((f,g)=>f[1]-f[0]-(g[1]-g[0]))[0]));
  }
  return out;
}

// Curves lie on the XY plane (at one Z) or, with a patch, in its (u,v).
// Closed curves bound a region: material to the left of travel, outer loops
// counterclockwise and holes clockwise, seen from +Z or the surface normal.
// Open curves offset one-sided. Positive depth is to the right of travel,
// growing a region. With a patch, depth is millimetres to first order and
// pieces past its edges are trimmed off.
//
// A patch periodic in U or V (periodicU/periodicV: its seam joins its two
// edges) takes curves in the unwrapped chart: a curve may cross the seam, and
// a closed curve may end whole periods from its start, wrapping around the
// seam (a course around a sleeve). Crossings and winding count every
// whole-period copy; results stay unwrapped, each chain continuing itself,
// with wraps the periods a closed chain advances. A region between wrapping
// loops follows the same convention: a loop running +U (periodic U) has its
// material above it in V.
export function prepareCurveOffsets({curves,patch=null,periodicU=false,periodicV=false}){
  requireThat(Array.isArray(curves)&&curves.length>0&&(patch===null||patch?.cp&&patch.domainU&&patch.domainV),
    'Curve offsets need a list of { curve, closed } and, on a surface, a patch.');
  requireThat(typeof periodicU==='boolean'&&typeof periodicV==='boolean'&&(patch||!periodicU&&!periodicV)&&!(periodicU&&periodicV),
    'A periodic curve offset needs a patch periodic in U or in V, not both.');
  const domains=patch&&[patch.domainU,patch.domainV];
  const period=periodicU||periodicV?{axis:periodicU?0:1,length:domains[periodicU?0:1][1]-domains[periodicU?0:1][0]}:null;
  // The chart gap from q to p with whole periods removed.
  const gap=(p,q)=>{
    const d=[p[0]-q[0],p[1]-q[1]];
    if(period)d[period.axis]-=Math.round(d[period.axis]/period.length)*period.length;
    return Math.hypot(d[0],d[1]);
  };
  const inputs=curves.map(({curve,closed=false})=>{
    requireCurve(curve);
    const [start,end]=curve.domain.map(t=>evaluateCurve(curve,t).point);
    requireThat(!closed||gap(start,end)<=1e-9,'A closed curve must end where it starts (or whole periods from it on a periodic patch).');
    return {curve,closed};
  });
  const bounds=patch?domains.flatMap((range,axis)=>period?.axis===axis?[]:range.map(value=>({axis,value}))):[];
  const inside=([u,v])=>[u,v].every((x,k)=>period?.axis===k||x>=domains[k][0]-1e-9&&x<=domains[k][1]+1e-9);
  // The patch at a chart point, wrapped across a periodic seam.
  const onPatch=(u,v)=>{
    const x=[u,v];
    if(period){const [a,b]=domains[period.axis];x[period.axis]=a+(((x[period.axis]-a)/(b-a))%1+1)%1*(b-a);}
    return evaluate(patch,x[0],x[1]);
  };
  if(patch)for(const {curve} of inputs){
    const parts=insideIntervals(curve,bounds,inside);
    requireThat(parts.length===1&&parts[0][0]===curve.domain[0]&&parts[0][1]===curve.domain[1],'A curve to offset must lie inside the patch domain.');
  }else{
    const z=inputs[0].curve.cp[2]/inputs[0].curve.cp[3];
    for(const {curve} of inputs)for(let i=0;i<curve.n;i++)
      requireThat(Math.abs(curve.cp[i*4+2]/curve.cp[i*4+3]-z)<=1e-9,'Curves offset without a patch lie in one XY plane; a 3D curve takes a ribbon.');
  }
  const fields=inputs.map(({curve,closed})=>looseCurveField(curve,closed,t=>{
    if(!patch)return sideAt(curve,t,closed,tangent=>{
      const size=Math.hypot(tangent[0],tangent[1]);
      requireThat(size>1e-12,'Curve offset reference has a collapsed tangent.');
      return [tangent[1]/size,-tangent[0]/size,0];
    });
    const e=onPatch(...evaluateCurve(curve,t).point.slice(0,2));
    requireThat(e.normal,'Surface curve offset reference crosses a singular surface point.');
    const side=sideAt(curve,t,closed,([tu,tv])=>{
      const s=cross([0,1,2].map(k=>e.du[k]*tu+e.dv[k]*tv),e.normal),size=Math.hypot(...s);
      requireThat(size>1e-12,'Surface curve offset reference has a collapsed tangent.');
      return s.map(v=>v/size);
    });
    // Solve [du dv] x = side through the first fundamental form.
    const E=dot(e.du,e.du),F=dot(e.du,e.dv),G=dot(e.dv,e.dv),det=E*G-F*F,a=dot(e.du,side),b=dot(e.dv,side);
    return [(G*a-F*b)/det,(E*b-F*a)/det,0];
  }));
  // The unit tangent at t, per millimetre on the surface for a patch.
  const tangentPerMm=(curve,t)=>{
    const {point,derivative}=evaluateCurve(curve,t);
    const length=patch?Math.hypot(...[0,1,2].map(k=>{const e=onPatch(point[0],point[1]);return e.du[k]*derivative[0]+e.dv[k]*derivative[1];})):Math.hypot(derivative[0],derivative[1]);
    requireThat(length>1e-12,'Curve offset reference has a collapsed tangent at an end.');
    return [derivative[0]/length,derivative[1]/length];
  };
  // The winding far toward the ray's end: 1 where loops wrapping the seam put
  // it inside the source region, found as one minus the base-free winding
  // just left of a source loop (always inside).
  const sources=inputs.filter(i=>i.closed).map(i=>i.curve);
  const base=period&&sources.length?(()=>{
    const c=sources[0],t=(c.domain[0]+c.domain[1])/2,{point,derivative}=evaluateCurve(c,t),size=Math.hypot(derivative[0],derivative[1]);
    const eps=1e-7*Math.max(domains[0][1]-domains[0][0],domains[1][1]-domains[1][0]);
    return 1-preparePeriodicWinding(sources,period)([point[0]-derivative[1]/size*eps,point[1]+derivative[0]/size*eps]);
  })():0;
  function offset(depth){
    requireThat(Number.isFinite(depth),'Curve offset depth must be finite.');
    if(depth===0)return {curves:inputs.map(({curve,closed})=>({closed,wraps:closed&&period?Math.round((evaluateCurve(curve,curve.domain[1]).point[period.axis]-evaluateCurve(curve,curve.domain[0]).point[period.axis])/period.length):0,pieces:[curve]})),report:{crossings:0,keptPieces:inputs.length}};
    // The oriented curves whose positive-winding region is the result: each
    // closed curve's offset, and around each open curve everything within the
    // depth of it (both offsets joined by round end caps), so an open curve's
    // offset keeps only what is at least the depth from every source curve.
    const system=[],size=Math.abs(depth),at=(c,t)=>evaluateCurve(c,t).point;
    const shift=(p,v,k)=>[p[0]+k*v[0],p[1]+k*v[1],p[2]];
    inputs.forEach(({curve,closed},i)=>{
      if(closed){const moved=fields[i](depth);system.push({curve:moved,closed,source:i,parent:moved,reference:curve});return;}
      const right=fields[i](size),left=fields[i](-size),sum=left.domain[0]+left.domain[1],[d0,d1]=curve.domain;
      const e0=at(curve,d0),e1=at(curve,d1),t0=tangentPerMm(curve,d0),t1=tangentPerMm(curve,d1);
      const [r0,r1,l0,l1]=[at(right,d0),at(right,d1),at(left,d0),at(left,d1)];
      system.push(depth>0?{curve:right,source:i,parent:right,reference:curve}:{curve:right},
        {curve:arcCurve(r1,shift(r1,t1,size),shift(e1,t1,size))},{curve:arcCurve(shift(e1,t1,size),shift(l1,t1,size),l1)},
        depth<0?{curve:reverseCurve(left),source:i,parent:left,reversed:sum,reference:curve}:{curve:reverseCurve(left)},
        {curve:arcCurve(l0,shift(l0,t0,-size),shift(e0,t0,-size))},{curve:arcCurve(shift(e0,t0,-size),shift(r0,t0,-size),r0)});
    });
    const all=system.map(s=>s.curve),mins=[Infinity,Infinity],maxs=[-Infinity,-Infinity];
    for(const c of all)for(let i=0;i<c.n;i++)for(let k=0;k<2;k++){const v=c.cp[i*4+k]/c.cp[i*4+3];mins[k]=Math.min(mins[k],v);maxs[k]=Math.max(maxs[k],v);}
    const scale=Math.max(maxs[0]-mins[0],maxs[1]-mins[1],1e-9),tol=1e-9*scale,eps=1e-7*scale;
    const crossings=period?periodicCurveCrossings(all,tol,system.map(s=>!!s.closed),period):curveCrossings(all,tol,system.map(s=>!!s.closed));
    const winding=period?preparePeriodicWinding(all,period,base):prepareWinding(all);
    // A piece running against its source is inverted (a collapse); it bounds
    // no material whatever the winding says.
    const forward=(s,sample)=>{const t=s.reversed===undefined?sample:s.reversed-sample;return dot(evaluateCurve(s.parent,t).derivative,evaluateCurve(s.reference,t).derivative)>0;};
    const curls=curlArcs(system,crossings,forward,tol);
    const kept=[];
    system.forEach((s,c)=>{
      if(s.source===undefined)return;
      const ts=[s.curve.domain[0],...crossings.params[c],s.curve.domain[1]];
      for(let k=1;k<ts.length;k++){
        // Sampled off the middle, which on a uniform polyline is a vertex.
        const sample=ts[k-1]+(ts[k]-ts[k-1])*.381966,{point,derivative}=evaluateCurve(s.curve,sample),size=Math.hypot(derivative[0],derivative[1]);
        if(!(size>0)||!forward(s,sample)||curls[c].some(inArc=>inArc(sample)))continue;
        const r=[derivative[1]/size*eps,-derivative[0]/size*eps];
        if(!(winding([point[0]-r[0],point[1]-r[1]])>=1&&winding([point[0]+r[0],point[1]+r[1]])<=0))continue;
        const piece=ts.length===2?s.curve:extract(s.curve,ts[k-1],ts[k]);
        // A band's reversed offset is returned in the curve's own direction.
        if(s.reversed===undefined)kept.push({source:s.source,parent:s.parent,a:ts[k-1],b:ts[k],curve:piece});
        else kept.push({source:s.source,parent:s.parent,a:s.reversed-ts[k],b:s.reversed-ts[k-1],curve:reverseCurve(piece,s.reversed)});
      }
    });
    kept.sort((p,q)=>p.source-q.source||p.a-q.a);
    let result=chainPieces(kept,Math.max(tol*1e3,eps),period);
    if(patch){
      const trimmed=[];
      for(const chain of result){
        const runs=[[]];let cut=false;
        for(const piece of chain.pieces){
          const parts=insideIntervals(piece,bounds,inside);
          if(parts.length===1&&parts[0][0]===piece.domain[0]&&parts[0][1]===piece.domain[1]){runs.at(-1).push(piece);continue;}
          cut=true;
          parts.forEach(([a,b],k)=>{
            if(k>0||a!==piece.domain[0])runs.push([]);
            runs.at(-1).push(extract(piece,a,b));
          });
          if(!parts.length||parts.at(-1)[1]!==piece.domain[1])runs.push([]);
        }
        if(!cut){trimmed.push(chain);continue;}
        // A closed chain's last run continues into its first, moved back by
        // the periods the chain wraps.
        if(chain.closed&&runs.length>1&&runs[0].length&&runs.at(-1).length)
          runs[0]=[...runs.pop().map(c=>chain.wraps?translateCurve(c,period.axis===0?[-chain.wraps*period.length,0]:[0,-chain.wraps*period.length]):c),...runs[0]];
        for(const run of runs)if(run.length)trimmed.push({closed:false,wraps:0,pieces:run});
      }
      result=trimmed;
    }
    return {curves:result,report:{crossings:crossings.points.length,keptPieces:kept.length}};
  }
  return {offset};
}
