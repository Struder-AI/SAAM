// Loose planar NURBS curve offsets, resolved as a region offset: every curve
// in one XY plane is offset by moving
// its controls, then the offset curves are cut where they cross and only the
// pieces bounding the offset region are kept. Pieces keep their curve's knots,
// degree and weights; control counts change only where a piece is cut.
import {basisDerivatives,findSpan,evaluateCurve} from './nurbs.mjs';
import {requireThat,dot} from './tolerance.mjs';
import {ROUNDING_MM,ROUNDING_RELATIVE,PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {extract,join,reverseCurve,arcCurve,curveCrossings,prepareWinding} from './curve-ops.mjs';

export function requireCurve(curve){
  const {n,order,knots,cp,domain}=curve??{};
  requireThat(Number.isInteger(n)&&Number.isInteger(order)&&order>=2&&n>=order&&knots?.length===n+order&&cp?.length===n*4&&domain?.[1]>domain[0],
    'Curve offsets need a NURBS curve record; build one with referenceCurve.');
  for(let i=0;i<n;i++)requireThat(Number.isFinite(cp[i*4+3])&&cp[i*4+3]>0,'Curve offset reference weights must be positive and finite.');
}
// Tolerances (core/README.md#dimensions-and-tolerances): chart coordinates are XY mm.
// Offset-curve crossings are found and matched to rounding relative to the chart's
// extent. Inside/outside probes step a hundred times that off a curve: clear of the
// crossing precision, far below any feature.
const PROBE_RELATIVE=100*ROUNDING_RELATIVE;
const wrap=(t,[a,b],closed)=>closed?a+(((t-a)/(b-a)%1+1)%1)*(b-a):Math.max(a,Math.min(b,t));

// Rational basis values R_i(t) = N_i(t) w_i / w(t) of the controls supporting t.
function rationalBasis({n,order,knots,cp},t){
  const span=findSpan(knots,n,order,t),basis=basisDerivatives(knots,span,t,order,0),out=[];
  let w=0;
  for(let i=0;i<order;i++)w+=basis[0][i]*cp[(span-order+1+i)*4+3];
  for(let i=0;i<order;i++){const index=span-order+1+i;out.push({index,value:basis[0][i]*cp[index*4+3]/w});}
  return out;
}

// Sparse collocation elimination with partial pivoting. Column incidence
// indexes the equations that actually contain a coefficient: a long banded
// spline costs work proportional to its support, rather than scanning every
// remaining equation for every control. Equation identity survives pivot swaps.
function solveSparse(rows,rhs){
  const equations=rows.map((values,position)=>({values,rhs:rhs[position],position}));
  const columns=Array.from({length:rows.length},()=>new Set());
  for(const equation of equations)for(const [column,value] of equation.values)if(value!==0)columns[column].add(equation);
  for(let k=0;k<equations.length;k++){
    const pivot={equation:null,magnitude:0};
    for(const equation of columns[k]){
      if(equation.position<k)continue;
      const magnitude=Math.abs(equation.values.get(k));
      if(magnitude>pivot.magnitude||magnitude===pivot.magnitude&&equation.position<pivot.equation.position){pivot.equation=equation;pivot.magnitude=magnitude;}
    }
    requireThat(pivot.magnitude>ROUNDING_RELATIVE,'Loose curve offset collocation is singular: two controls share a Greville parameter.');
    const head=pivot.equation,previous=equations[k],position=head.position;
    equations[k]=head;equations[position]=previous;head.position=k;previous.position=position;
    for(const equation of [...columns[k]]){
      if(equation.position<=k)continue;
      const factor=equation.values.get(k)/head.values.get(k);
      for(const [column,value] of head.values){
        const next=(equation.values.get(column)??0)-factor*value;
        if(next===0){equation.values.delete(column);columns[column].delete(equation);}
        else{equation.values.set(column,next);columns[column].add(equation);}
      }
      equation.values.delete(k);columns[k].delete(equation);
      equation.rhs=equation.rhs.map((v,c)=>v-factor*head.rhs[c]);
    }
  }
  const x=new Array(equations.length);
  for(let k=equations.length-1;k>=0;k--){
    const equation=equations[k],sum=equation.rhs.slice();
    for(const [column,value] of equation.values)if(column>k)for(let c=0;c<3;c++)sum[c]-=value*x[column][c];
    x[k]=sum.map(v=>v/equation.values.get(k));
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
  // A degree-1 basis is 1 at its own control's Greville parameter and 0 at
  // every other, so a polyline's collocation is the identity.
  const solved=curve.order===2?rhs:solveSparse(matrix,rhs);
  return {curve,groups,solved,cache:new Map()};
}

// The curve moved by depth along a loose curve field; recent depths are cached.
export function curveAtDepth(field,depth){
  requireThat(Number.isFinite(depth),'Curve offset depth must be finite.');
  const {curve,groups,solved,cache}=field,{n,cp}=curve;
  if(cache.has(depth))return cache.get(depth);
  const out=cp.slice();
  for(let i=0;i<n;i++)for(let k=0;k<3;k++)out[i*4+k]+=depth*solved[groups[i]][k]*cp[i*4+3];
  const result={...curve,cp:out};
  if(cache.size>=128)cache.delete(cache.keys().next().value);
  cache.set(depth,result);return result;
}

// The side direction at t: one unit direction where the curve is smooth, and
// at a kink (a polyline vertex) the vertex's move m with m.s = 1 for the unit
// side s of each tangent, so both adjoining pieces move by the depth. A closed
// curve's left tangent at its start is its end tangent.
export function sideAt(curve,t,closed,unitSide){
  const right=unitSide(evaluateCurve(curve,t).derivative);
  const left=t>curve.domain[0]?unitSide(evaluateCurve(curve,t,true).derivative):closed?unitSide(evaluateCurve(curve,curve.domain[1],true).derivative):right;
  const cosine=dot(left,right);
  if(1-cosine<ROUNDING_RELATIVE)return right;
  requireThat(1+cosine>ROUNDING_RELATIVE,'Curve offset reference reverses direction at a cusp.');
  return [0,1,2].map(k=>(left[k]+right[k])/(1+cosine));
}

// Join retained pieces and merge adjacent spans of the same parent curve.
function chainPieces(pieces,tol){
  const meet=(p,q)=>Math.hypot(p[0]-q[0],p[1]-q[1])<=tol;
  const used=new Set(),chains=[];
  const ends=pieces.map(p=>[evaluateCurve(p.curve,p.curve.domain[0]).point,evaluateCurve(p.curve,p.curve.domain[1]).point]);
  const next=i=>pieces.findIndex((_,j)=>!used.has(j)&&meet(ends[i][1],ends[j][0]));
  const starts=pieces.map((_,i)=>i).filter(i=>!pieces.some((_,j)=>j!==i&&meet(ends[j][1],ends[i][0])));
  for(const i of [...starts,...pieces.map((_,i)=>i)]){
    if(used.has(i))continue;
    const chain=[{...pieces[i],index:i}];used.add(i);
    for(let j=next(i);j>=0;j=next(j)){chain.push({...pieces[j],index:j});used.add(j);}
    chains.push({closed:meet(ends[chain.at(-1).index][1],ends[i][0]),pieces:chain});
  }
  return chains.map(({closed,pieces})=>{
    const merged=[];
    for(const p of pieces){
      const last=merged.at(-1);
      if(last&&last.source===p.source&&last.b===p.a){merged[merged.length-1]={...last,b:p.b,curve:extract(p.parent,last.a,p.b)};continue;}
      merged.push(p);
    }
    if(closed&&merged.length>1){
      const first=merged[0],last=merged.at(-1),[d0,d1]=first.parent.domain;
      if(first.source===last.source&&last.b===d1&&first.a===d0){
        const whole=merged.length===2&&last.a===first.b;
        merged.splice(0,1);merged[merged.length-1]=whole?{...first,curve:first.parent}:{...last,curve:join(last.curve,first.curve,d1-d0)};
      }
    }
    return {closed,wraps:0,pieces:merged.map(p=>p.curve)};
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
    const c=S.curve,[d0,d1]=c.domain,P=d1-d0,e=ROUNDING_RELATIVE*P,p=evaluateCurve(c,s).point,q=evaluateCurve(c,t).point;
    // A crossing with the curve's own copy a period away closes no loop.
    if(Math.hypot(p[0]-q[0],p[1]-q[1])>2*tol)continue;
    const lo=Math.min(s,t),hi=Math.max(s,t),on=([x,y])=>r=>r>x&&r<y||r+P>x&&r+P<y;
    const arcs=S.closed?[[lo,hi],[hi,lo+P]]:[[lo,hi]],wrap=r=>r>d1?r-P:r;
    const curls=arcs.filter(([x,y])=>!params[a].some(on([x+e,y-e]))&&forward(S,wrap(x+(y-x)/1000))!==forward(S,wrap(y-(y-x)/1000)));
    if(curls.length)out[a].push(on(curls.sort((f,g)=>f[1]-f[0]-(g[1]-g[0]))[0]));
  }
  return out;
}

// Closed curves keep material to their left; positive depth grows the region.
// Open offsets are one-sided. This loose control-net operation is planar only;
// physical surface offsets belong to region/surface-offset.mjs.
export function preparePlanarCurveOffsets({curves,patch=null,periodicU=false,periodicV=false}){
  requireThat(patch===null&&!periodicU&&!periodicV,'Use offsetSurfaceRegion for physical chart offsets. Planar curve offsets require XY curves.');
  requireThat(Array.isArray(curves)&&curves.length>0,'Planar curve offsets need a list of {curve, closed}.');
  const inputs=curves.map(({curve,closed=false})=>{
    requireCurve(curve);
    const [start,end]=curve.domain.map(t=>evaluateCurve(curve,t).point);
    requireThat(!closed||Math.hypot(start[0]-end[0],start[1]-end[1])<=PRINT_RESOLUTION_MM,'A closed curve must end where it starts.');
    return {curve,closed};
  });
  const z=inputs[0].curve.cp[2]/inputs[0].curve.cp[3];
  for(const {curve} of inputs)for(let i=0;i<curve.n;i++)
    requireThat(Math.abs(curve.cp[i*4+2]/curve.cp[i*4+3]-z)<=PRINT_RESOLUTION_MM,'Planar curve offsets require one XY plane; a 3D curve takes a ribbon.');
  const fields=inputs.map(({curve,closed})=>looseCurveField(curve,closed,t=>sideAt(curve,t,closed,tangent=>{
    const size=Math.hypot(tangent[0],tangent[1]);
    requireThat(size>ROUNDING_MM,'Curve offset reference has a collapsed tangent.');
    return [tangent[1]/size,-tangent[0]/size,0];
  })));
  const tangentPerMm=(curve,t)=>{
    const {derivative}=evaluateCurve(curve,t),length=Math.hypot(derivative[0],derivative[1]);
    requireThat(length>ROUNDING_MM,'Curve offset reference has a collapsed tangent at an end.');
    return [derivative[0]/length,derivative[1]/length];
  };
  function offset(depth){
    requireThat(Number.isFinite(depth),'Curve offset depth must be finite.');
    if(depth===0)return {curves:inputs.map(({curve,closed})=>({closed,wraps:0,pieces:[curve]})),report:{crossings:0,keptPieces:inputs.length}};
    // The oriented curves whose positive-winding region is the result: each
    // closed curve's offset, and around each open curve everything within the
    // depth of it (both offsets joined by round end caps), so an open curve's
    // offset keeps only what is at least the depth from every source curve.
    const system=[],size=Math.abs(depth),at=(c,t)=>evaluateCurve(c,t).point;
    const shift=(p,v,k)=>[p[0]+k*v[0],p[1]+k*v[1],p[2]];
    inputs.forEach(({curve,closed},i)=>{
      if(closed){const moved=curveAtDepth(fields[i],depth);system.push({curve:moved,closed,source:i,parent:moved,reference:curve});return;}
      const right=curveAtDepth(fields[i],size),left=curveAtDepth(fields[i],-size),sum=left.domain[0]+left.domain[1],[d0,d1]=curve.domain;
      const e0=at(curve,d0),e1=at(curve,d1),t0=tangentPerMm(curve,d0),t1=tangentPerMm(curve,d1);
      const [r0,r1,l0,l1]=[at(right,d0),at(right,d1),at(left,d0),at(left,d1)];
      system.push(depth>0?{curve:right,source:i,parent:right,reference:curve}:{curve:right},
        {curve:arcCurve(r1,shift(r1,t1,size),shift(e1,t1,size))},{curve:arcCurve(shift(e1,t1,size),shift(l1,t1,size),l1)},
        depth<0?{curve:reverseCurve(left),source:i,parent:left,reversed:sum,reference:curve}:{curve:reverseCurve(left)},
        {curve:arcCurve(l0,shift(l0,t0,-size),shift(e0,t0,-size))},{curve:arcCurve(shift(e0,t0,-size),shift(r0,t0,-size),r0)});
    });
    const all=system.map(s=>s.curve),mins=[Infinity,Infinity],maxs=[-Infinity,-Infinity];
    for(const c of all)for(let i=0;i<c.n;i++)for(let k=0;k<2;k++){const v=c.cp[i*4+k]/c.cp[i*4+3];mins[k]=Math.min(mins[k],v);maxs[k]=Math.max(maxs[k],v);}
    const scale=Math.max(maxs[0]-mins[0],maxs[1]-mins[1],ROUNDING_MM),tol=ROUNDING_RELATIVE*scale,eps=PROBE_RELATIVE*scale;
    const crossings=curveCrossings(all,tol,system.map(s=>!!s.closed));
    const winding=prepareWinding(all);
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
    const result=chainPieces(kept,Math.max(tol*1e3,eps));
    return {curves:result,report:{crossings:crossings.points.length,keptPieces:kept.length}};
  }
  return {offset};
}
