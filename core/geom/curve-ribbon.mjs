// Ribbons: a 3D curve or polyline displaced horizontally, perpendicular to its
// XY tangent, with Z kept. There is no reference surface to resolve collisions
// in, so only folds are removed: where the displaced curve runs backwards in
// plan view, the loop is cut out at the plan-view crossing that closes it,
// leaving a small Z step there. Crossings between distant parts, such as a
// helix's turns, stay.
import {evaluateCurve} from './nurbs.mjs';
import {requireThat} from './tolerance.mjs';
import {requireCurve,looseCurveField,sideAt} from './curve-offset.mjs';
import {extract,join,curveCrossings} from './curve-ops.mjs';

// Parameter intervals where f < 0, from sign changes at 32 samples per knot
// span refined by bisection. A reversal narrower than a sample is not seen.
function negativeIntervals(curve,f){
  const {knots,domain}=curve,breaks=[...new Set([...knots].filter(x=>x>=domain[0]&&x<=domain[1]))],ts=[];
  for(let b=1;b<breaks.length;b++)for(let j=0;j<32;j++)ts.push(breaks[b-1]+(breaks[b]-breaks[b-1])*j/32);
  ts.push(domain[1]);
  const edge=(a,b)=>{const fa=f(a)<0;for(let m=(a+b)/2;m>a&&m<b;m=(a+b)/2){if((f(m)<0)===fa)a=m;else b=m;}return (a+b)/2;};
  const out=[];let start=f(ts[0])<0?ts[0]:null;
  for(let i=1;i<ts.length;i++){
    const inside=f(ts[i])<0;
    if(inside&&start===null)start=edge(ts[i-1],ts[i]);
    if(!inside&&start!==null){out.push([start,edge(ts[i-1],ts[i])]);start=null;}
  }
  if(start!==null)out.push([start,domain[1]]);
  return out;
}

// Plan-view turning of the curve's tangent over [a, b], in radians, from 32
// samples per knot span.
function turning(curve,a,b){
  const {knots}=curve,ts=[a];
  for(let i=0;i+1<knots.length;i++){const k0=Math.max(a,knots[i]),k1=Math.min(b,knots[i+1]);if(k1>k0)for(let j=1;j<=32;j++)ts.push(k0+(k1-k0)*j/32);}
  let total=0,last=null;
  for(const t of ts){
    const d=evaluateCurve(curve,t).derivative,angle=Math.atan2(d[1],d[0]);
    if(last!==null){let step=angle-last;step-=2*Math.PI*Math.round(step/(2*Math.PI));total+=Math.abs(step);}
    last=angle;
  }
  return total;
}

// The parameter intervals to cut from a displaced curve (moved) to remove its
// folds against its source, sorted and merged: where moved runs backwards in
// plan view, the loop is cut at the plan-view crossing that closes it; a
// fold's loop spans less than a half turn of the source, and past that, or at
// an open curve's ends, only the backwards part is cut. A closed curve's fold
// may straddle its seam: its search runs on three copies of the curve and its
// cut is returned split at the seam.
export function foldCuts(moved,source,closed=false){
  const [d0,d1]=moved.domain,P=d1-d0;
  const found=negativeIntervals(moved,t=>{
    const a=evaluateCurve(moved,t).derivative,b=evaluateCurve(source,t).derivative;
    return a[0]*b[0]+a[1]*b[1];
  });
  if(!found.length)return [];
  // Around a closed curve a reversal through the seam is one interval.
  const reversals=closed&&found.length>1&&found[0][0]===d0&&found.at(-1)[1]===d1?[[found.at(-1)[0],found[0][1]+P],...found.slice(1,-1)]:found;
  const tripled=c=>{const one=extract(c,d0,d1);return join(join(one,one,P),one,2*P);};
  const search=closed?tripled(moved):moved,turns=closed?tripled(source):source,shift=closed?P:0,[s0,s1]=search.domain;
  let extent=0;
  for(let i=0;i<moved.n;i++)for(let j=0;j<moved.n;j+=Math.max(1,moved.n>>4))extent=Math.max(extent,Math.hypot(moved.cp[i*4]/moved.cp[i*4+3]-moved.cp[j*4]/moved.cp[j*4+3],moved.cp[i*4+1]/moved.cp[i*4+3]-moved.cp[j*4+1]/moved.cp[j*4+3]));
  const tol=1e-9*Math.max(extent,1e-9),cuts=[];
  for(const [q0,q1] of reversals){
    const r0=q0+shift,r1=q1+shift;
    // Widen windows before and after the reversal until the loop's closing
    // crossing appears.
    let cut=null;
    for(let width=Math.max(r1-r0,P*1e-6);;width*=2){
      const a0=Math.max(s0,r0-width),b1=Math.min(s1,r1+width);
      if(a0<r0&&b1>r1){
        // A pair lists its curves in either order.
        const hits=curveCrossings([extract(search,a0,r0),extract(search,r1,b1)],tol).pairs.filter(h=>h.a!==h.b).map(h=>h.a===0?h:{s:h.t,t:h.s});
        if(hits.length){const h=hits.reduce((x,y)=>(r0-y.s)+(y.t-r1)<(r0-x.s)+(x.t-r1)?y:x);cut=[h.s,h.t];break;}
      }
      if(a0===s0&&b1===s1||turning(turns,a0,b1)>=Math.PI){cut=[r0,r1];break;}
    }
    const [a,b]=[cut[0]-shift,cut[1]-shift];
    if(!closed||a>=d0&&b<=d1)cuts.push([a,b]);
    else if(b-a>=P)cuts.push([d0,d1]);
    else if(a<d0)cuts.push([a+P,d1],[d0,b]);
    else cuts.push([a,d1],[d0,b-P]);
  }
  cuts.sort((x,y)=>x[0]-y[0]);
  const merged=[];
  for(const c of cuts){if(merged.length&&c[0]<=merged.at(-1)[1])merged.at(-1)[1]=Math.max(merged.at(-1)[1],c[1]);else merged.push([...c]);}
  return merged;
}

// Positive depth is to the right of travel seen from +Z. The result is the
// displaced curve in order, cut where folds were removed.
export function prepareCurveRibbon({curve,closed=false}){
  requireCurve(curve);
  requireThat(typeof closed==='boolean','Ribbon needs an explicit closed flag.');
  const field=looseCurveField(curve,closed,t=>sideAt(curve,t,closed,tangent=>{
    const size=Math.hypot(tangent[0],tangent[1]);
    requireThat(size>1e-12,'Ribbon reference has a vertical or collapsed tangent.');
    return [tangent[1]/size,-tangent[0]/size,0];
  }));
  function ribbon(depth){
    const moved=field(depth),[d0,d1]=curve.domain;
    if(depth===0)return {pieces:[moved],folds:0};
    const merged=foldCuts(moved,curve,closed);
    const keep=[];let from=d0;
    for(const [a,b] of merged){if(a>from)keep.push([from,a]);from=Math.max(from,b);}
    if(from<d1)keep.push([from,d1]);
    const pieces=merged.length?keep.map(([a,b])=>extract(moved,a,b)):[moved];
    // A closed curve's cut through its seam is one fold.
    const acrossSeam=closed&&merged.length>1&&merged[0][0]===d0&&merged.at(-1)[1]===d1;
    return {pieces,folds:merged.length-(acrossSeam?1:0)};
  }
  return {ribbon};
}
