// Topology operations on NURBS curve records { n, order, knots, cp, domain }
// (homogeneous [xw, yw, zw, w] controls), in their first two coordinates:
// trimming, joining, reversal, Bezier spans, root isolation, crossings and
// winding numbers.
import {findSpan,evaluateCurve} from './nurbs.mjs';
import {requireThat} from './tolerance.mjs';

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
export function extract(curve,a,b){
  const left=clampAt(curve,a),right=clampAt(left.curve,b),{order}=curve,n=right.at-left.at+1;
  const knots=Float64Array.from([...Array(order).fill(a),...right.curve.knots.filter(k=>k>a&&k<b),...Array(order).fill(b)]);
  requireThat(knots.length===n+order,'Curve trimming produced an inconsistent knot vector.');
  return {n,order,knots,cp:right.curve.cp.slice(left.at*4,(right.at+1)*4),domain:[a,b]};
}

// B continues A at A's end once its parameter is shifted; the joint is C0.
export function join(A,B,shift){
  const knots=Float64Array.from([...A.knots.subarray(0,A.n),...Array(A.order-1).fill(A.domain[1]),...[...B.knots.subarray(B.order)].map(k=>k+shift)]);
  const cp=new Float64Array((A.n+B.n-1)*4);cp.set(A.cp);cp.set(B.cp.subarray(4),A.n*4);
  return {n:A.n+B.n-1,order:A.order,knots,cp,domain:[A.domain[0],B.domain[1]+shift]};
}

// The same curve traversed backwards, parameter t mapped to sum - t.
export function reverseCurve(curve,sum=curve.domain[0]+curve.domain[1]){
  const {n,order,knots,cp,domain}=curve,out=new Float64Array(n*4);
  for(let i=0;i<n;i++)out.set(cp.subarray((n-1-i)*4,(n-i)*4),i*4);
  return {n,order,knots:Float64Array.from([...knots].reverse().map(t=>sum-t)),cp:out,domain:[sum-domain[1],sum-domain[0]]};
}

// The same curve moved by [du, dv] in its first two coordinates.
export function translateCurve(curve,[du,dv]){
  const cp=Float64Array.from(curve.cp);
  for(let i=0;i<curve.n;i++){cp[i*4]+=du*cp[i*4+3];cp[i*4+1]+=dv*cp[i*4+3];}
  return {...curve,cp};
}

// A rational quadratic from p to r with corner q: a quarter circle when
// p, q and r are the corners of a square's quarter.
export function arcCurve(p,q,r){
  const w=Math.SQRT1_2;
  return {n:3,order:3,knots:Float64Array.from([0,0,0,1,1,1]),cp:Float64Array.from([p[0],p[1],p[2]??0,1,q[0]*w,q[1]*w,(q[2]??0)*w,w,r[0],r[1],r[2]??0,1]),domain:[0,1]};
}

// The single-span curve over knot span i, with its supporting controls.
function spanCurve(curve,i){
  const {order,knots}=curve,p=order-1;
  return {n:order,order,knots:knots.slice(i-p,i+p+2),cp:curve.cp.slice((i-p)*4,(i+1)*4),domain:[knots[i],knots[i+1]]};
}

// Every nonempty knot span in Bezier form: { a, b, cp } on [a, b].
export function bezierSpans(curve){
  const out=[];
  for(let i=curve.order-1;i<curve.n;i++){
    const a=curve.knots[i],b=curve.knots[i+1];
    if(b>a)out.push({a,b,cp:extract(spanCurve(curve,i),a,b).cp});
  }
  return out;
}

// De Casteljau split of scalar Bezier coefficients at s.
function casteljau(h,s){
  const left=[],right=[];let row=[...h];
  while(row.length){left.push(row[0]);right.unshift(row.at(-1));row=row.slice(1).map((v,i)=>row[i]+(v-row[i])*s);}
  return [left,right];
}

// The same split for homogeneous Bezier controls.
function splitBezier(cp,s){
  const m=cp.length/4,left=new Float64Array(cp.length),right=new Float64Array(cp.length);
  let row=Array.from({length:m},(_,i)=>cp.slice(i*4,i*4+4));
  for(let level=0;level<m;level++){
    left.set(row[0],level*4);right.set(row.at(-1),(m-1-level)*4);
    row=row.slice(1).map((v,i)=>v.map((x,k)=>row[i][k]+(x-row[i][k])*s));
  }
  return [left,right];
}

// Roots of a scalar Bezier polynomial on [a, b]: no sign change in the
// coefficients means no root; exactly one, with opposite ends, means one root,
// bisected to the floating-point floor; otherwise split and recurse.
export function bezierRoots(h,a,b,out){
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

// Parameter intervals where a curve lies inside axis-aligned bounds in its
// first two coordinates ({ axis, value } lines, inside by `inside`). Each knot
// span whose controls straddle a bound is converted to Bezier form for exact
// root isolation; touching a bound counts as inside.
export function insideIntervals(curve,bounds,inside){
  const {n,order,knots,domain}=curve,roots=[];
  const values=(c,axis,value)=>Array.from({length:order},(_,j)=>c.cp[j*4+axis]-value*c.cp[j*4+3]);
  for(let i=order-1;i<n;i++){
    const a=knots[i],b=knots[i+1];if(!(b>a))continue;
    const local=spanCurve(curve,i);let bezier=null;
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

const planar=(cp,j)=>[cp[j*4]/cp[j*4+3],cp[j*4+1]/cp[j*4+3]];
function box(cp){
  const min=[Infinity,Infinity],max=[-Infinity,-Infinity];
  for(let j=0;j<cp.length/4;j++){const p=planar(cp,j);for(let k=0;k<2;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}}
  return {min,max};
}
const size=b=>Math.max(b.max[0]-b.min[0],b.max[1]-b.min[1]);

// A rational Bezier's tangent is a positive combination of its control
// differences P_j - P_i (j > i). When those all lie in an open half-plane the
// piece is monotone in some direction and cannot cross itself.
function monotone(cp){
  const m=cp.length/4,angles=[];
  for(let i=0;i<m;i++)for(let j=i+1;j<m;j++){
    const p=planar(cp,i),q=planar(cp,j),d=[q[0]-p[0],q[1]-p[1]];
    if(d[0]!==0||d[1]!==0)angles.push(Math.atan2(d[1],d[0]));
  }
  if(angles.length<2)return true;
  angles.sort((x,y)=>x-y);
  let gap=angles[0]+2*Math.PI-angles.at(-1);
  for(let i=1;i<angles.length;i++)gap=Math.max(gap,angles[i]-angles[i-1]);
  return gap>Math.PI;
}

// A curve cut into Bezier pieces that cannot cross themselves.
function monotonePieces(curve){
  const out=[];
  const visit=(a,b,cp)=>{
    const m=(a+b)/2;
    if(monotone(cp)||!(m>a&&m<b)){out.push({a,b,cp,box:box(cp)});return;}
    const [l,r]=splitBezier(cp,.5);visit(a,m,l);visit(m,b,r);
  };
  for(const s of bezierSpans(curve))visit(s.a,s.b,s.cp);
  return out;
}

// Newton on A(s) = B(t) in the first two coordinates, from the middle of two
// small pieces and within them. It stops a thousand times inside the crossing
// tolerance, or when a step cuts the residual by less than a tenth: a tangent
// contact converges only linearly and a curve against itself not at all.
function refine(A,B,s,t,tol,x,y){
  let best=null;
  for(;;){
    if(!(s>=x.a&&s<=x.b&&t>=y.a&&t<=y.b))return best;
    const a=evaluateCurve(A,s),b=evaluateCurve(B,t),r=[a.point[0]-b.point[0],a.point[1]-b.point[1]],residual=Math.hypot(...r);
    if(best&&!(residual<.9*best.residual))return best;
    best={s,t,residual,point:a.point};
    const det=-a.derivative[0]*b.derivative[1]+a.derivative[1]*b.derivative[0];
    if(residual<=tol*1e-3||Math.abs(det)<1e-300)return best;
    s-=(-b.derivative[1]*r[0]+b.derivative[0]*r[1])/det;
    t-=(-a.derivative[1]*r[0]+a.derivative[0]*r[1])/det;
    if(!Number.isFinite(s)||!Number.isFinite(t))return best;
  }
}

// Every crossing between the curves (each with itself and with the others),
// in their first two coordinates, as parameters per curve. Crossings at a
// curve's own point (adjacent pieces), at a closed curve's seam, and where two
// curves meet end to end are not crossings. tol is a coordinate length.
export function curveCrossings(curves,tol,closed=curves.map(()=>false)){
  const pieces=curves.flatMap((curve,ci)=>monotonePieces(curve).map(p=>({...p,ci})));
  pieces.sort((p,q)=>p.box.min[0]-q.box.min[0]);
  const params=curves.map(()=>[]),points=[],pairs=[];
  // Where a curve meets itself or another end to end its tangents are
  // parallel, so Newton converges only linearly and the parameters it returns
  // are good to the coordinate tolerance, not to the floating-point floor:
  // such a contact is recognised by arc length (parameter gap times speed)
  // within the tolerance, never by a parameter tolerance.
  const arc=(c,t,gap)=>{const d=evaluateCurve(curves[c],t).derivative;return gap*Math.hypot(d[0],d[1])<=2*tol;};
  const end=(c,t)=>{const [d0,d1]=curves[c].domain;return arc(c,t,Math.min(t-d0,d1-t));};
  const record=(p,q,hit)=>{
    const [d0,d1]=curves[p.ci].domain,gap=Math.abs(hit.s-hit.t);
    // A closed curve continues across its seam, so the gap there wraps.
    if(p.ci===q.ci&&arc(p.ci,hit.s,closed[p.ci]?Math.min(gap,d1-d0-gap):gap))return;
    if(p.ci!==q.ci&&end(p.ci,hit.s)&&end(q.ci,hit.t))return;
    params[p.ci].push(hit.s);params[q.ci].push(hit.t);points.push(hit.point);pairs.push({a:p.ci,s:hit.s,b:q.ci,t:hit.t});
  };
  const overlap=(x,y)=>x.min[0]<=y.max[0]+tol&&y.min[0]<=x.max[0]+tol&&x.min[1]<=y.max[1]+tol&&y.min[1]<=x.max[1]+tol;
  const halves=x=>{const m=(x.a+x.b)/2;if(!(m>x.a&&m<x.b))return null;const [l,r]=splitBezier(x.cp,.5);return [{a:x.a,b:m,cp:l,box:box(l)},{a:m,b:x.b,cp:r,box:box(r)}];};
  const pair=(p,q)=>{
    const hits=[];
    const visit=(x,y)=>{
      if(!overlap(x.box,y.box))return;
      const sx=size(x.box),sy=size(y.box),split=sx>tol||sy>tol?(sx>=sy?[halves(x),null]:[null,halves(y)]):[null,null];
      if(split[0])return split[0].forEach(h=>visit(h,y));
      if(split[1])return split[1].forEach(h=>visit(x,h));
      const hit=refine(curves[p.ci],curves[q.ci],(x.a+x.b)/2,(y.a+y.b)/2,tol,p,q);
      const within=(t,piece)=>t>=piece.a-1e-12*(piece.b-piece.a+1)&&t<=piece.b+1e-12*(piece.b-piece.a+1);
      if(hit&&hit.residual<=tol&&within(hit.s,p)&&within(hit.t,q)&&!hits.some(h=>Math.hypot(h.point[0]-hit.point[0],h.point[1]-hit.point[1])<=tol))hits.push(hit);
    };
    visit(p,q);for(const hit of hits)record(p,q,hit);
  };
  for(let i=0;i<pieces.length;i++)for(let j=i;j<pieces.length&&pieces[j].box.min[0]<=pieces[i].box.max[0]+tol;j++){
    if(i===j||!overlap(pieces[i].box,pieces[j].box))continue;
    pair(pieces[i],pieces[j]);
  }
  return {params:distinctParams(curves,params),points,pairs};
}

// Sorted interior crossing parameters per curve, repeats merged.
function distinctParams(curves,params){
  return params.map((list,c)=>{
    const [d0,d1]=curves[c].domain,e=1e-10*(d1-d0),out=[];
    for(const t of list.sort((x,y)=>x-y))if(t>d0+e&&t<d1-e&&!(out.length&&t-out.at(-1)<=e))out.push(t);
    return out;
  });
}

// The range of a curve's controls along one axis.
function axisRange(curve,axis){
  let lo=Infinity,hi=-Infinity;
  for(let j=0;j<curve.n;j++){const x=curve.cp[j*4+axis]/curve.cp[j*4+3];lo=Math.min(lo,x);hi=Math.max(hi,x);}
  return [lo,hi];
}

// On a chart periodic along one axis (period {axis, length}: a seam), a curve
// also meets the others' and its own copies moved by whole periods. Every copy
// reaching the curves' span is intersected with the originals, and crossings
// are listed on the originals as by curveCrossings.
export function periodicCurveCrossings(curves,tol,closed,{axis,length}){
  const ranges=curves.map(c=>axisRange(c,axis)),lo=Math.min(...ranges.map(r=>r[0])),hi=Math.max(...ranges.map(r=>r[1])),copies=[];
  curves.forEach((curve,index)=>{
    const [a,b]=ranges[index];
    for(let k=Math.ceil((lo-b)/length);k<=Math.floor((hi-a)/length);k++)
      if(k!==0)copies.push({index,curve:translateCurve(curve,axis===0?[k*length,0]:[0,k*length])});
  });
  const n=curves.length,all=curveCrossings([...curves,...copies.map(c=>c.curve)],tol,[...closed,...copies.map(c=>closed[c.index])]);
  const source=i=>i<n?i:copies[i-n].index,params=curves.map(()=>[]),points=[],pairs=[];
  all.pairs.forEach((p,i)=>{
    // A crossing between two copies repeats one between a copy and an original.
    if(p.a>=n&&p.b>=n)return;
    params[source(p.a)].push(p.s);params[source(p.b)].push(p.t);points.push(all.points[i]);pairs.push({a:source(p.a),s:p.s,b:source(p.b),t:p.t});
  });
  return {params:distinctParams(curves,params),points,pairs};
}

// Winding number of the oriented curves about q, by a ray toward +x. The
// curves' spans are prepared once by prepareWinding. The ray is raised by a
// tiny irrational fraction of the extent so it never passes exactly through a
// knot, a seam or a joint between curves, where a crossing would be missed or
// counted twice.
export function prepareWinding(curves){
  const spans=curves.map(curve=>bezierSpans(curve).map(s=>({...s,box:box(s.cp)})));
  const extent=Math.max(1e-9,...spans.flat().map(s=>size(s.box))),lift=extent*1e-11*Math.SQRT1_2;
  return point=>{
    const q=[point[0],point[1]+lift];let w=0;
    curves.forEach((curve,c)=>{
      const roots=[];
      for(const s of spans[c]){
        if(s.box.max[0]<q[0]||s.box.min[1]>q[1]||s.box.max[1]<q[1])continue;
        bezierRoots(Array.from({length:s.cp.length/4},(_,j)=>s.cp[j*4+1]-q[1]*s.cp[j*4+3]),s.a,s.b,roots);
      }
      const [d0,d1]=curve.domain,e=1e-12*(d1-d0);let last=-Infinity;
      for(const t of roots.sort((x,y)=>x-y)){
        if(t-last<=e)continue;last=t;
        const {point,derivative}=evaluateCurve(curve,t);
        if(point[0]>q[0])w+=Math.sign(derivative[1]);
      }
    });
    return w;
  };
}

// Winding number on a chart periodic along one axis, counted along a ray
// toward the other axis's low side (toward -v when U is periodic, -u when V
// is) through every whole-period copy of the curves, plus base: the winding
// far along that ray, which loops wrapping around the seam make 0 or 1.
export function preparePeriodicWinding(curves,{axis,length},base=0){
  // A quarter (U periodic) or half (V periodic) turn puts the ray on +x and
  // the period on y, keeping orientation.
  const turn=c=>{
    const cp=Float64Array.from(c.cp);
    for(let j=0;j<c.n;j++){const x=c.cp[j*4],y=c.cp[j*4+1];[cp[j*4],cp[j*4+1]]=axis===0?[-y,x]:[-x,-y];}
    return {...c,cp};
  };
  const turned=curves.map(turn),winding=prepareWinding(turned),ranges=turned.map(c=>axisRange(c,1));
  const lo=Math.min(...ranges.map(r=>r[0])),hi=Math.max(...ranges.map(r=>r[1]));
  return ([u,v])=>{
    const q=axis===0?[-v,u]:[-u,-v];let w=base;
    for(let k=Math.ceil((q[1]-hi)/length);k<=Math.floor((q[1]-lo)/length);k++)w+=winding([q[0],q[1]-k*length]);
    return w;
  };
}
