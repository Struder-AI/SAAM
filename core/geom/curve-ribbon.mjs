// Ribbons: a 3D curve or polyline displaced horizontally, perpendicular to its
// XY tangent, with Z kept. There is no reference surface to resolve collisions
// in, so only folds are removed: where the displaced curve runs backwards in
// plan view, the loop is cut out at the plan-view crossing that closes it,
// leaving a small Z step there. Crossings between distant parts, such as a
// helix's turns, stay.
import {evaluateCurve} from './nurbs.mjs';
import {requireThat} from './tolerance.mjs';
import {requireCurve,looseCurveField,sideAt} from './curve-offset.mjs';
import {extract,curveCrossings} from './curve-ops.mjs';

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
    const reversals=negativeIntervals(moved,t=>{
      const a=evaluateCurve(moved,t).derivative,b=evaluateCurve(curve,t).derivative;
      return a[0]*b[0]+a[1]*b[1];
    });
    let extent=0;
    for(let i=0;i<moved.n;i++)for(let j=0;j<moved.n;j+=Math.max(1,moved.n>>4))extent=Math.max(extent,Math.hypot(moved.cp[i*4]/moved.cp[i*4+3]-moved.cp[j*4]/moved.cp[j*4+3],moved.cp[i*4+1]/moved.cp[i*4+3]-moved.cp[j*4+1]/moved.cp[j*4+3]));
    const tol=1e-9*Math.max(extent,1e-9),cuts=[];
    for(const [r0,r1] of reversals){
      // Widen windows before and after the reversal until the loop's closing
      // crossing appears. A fold's loop spans less than a half turn of the
      // source; past that, or at the curve's ends, nothing closes it and only
      // the backwards-running part is cut.
      let cut=null;
      for(let width=Math.max(r1-r0,(d1-d0)*1e-6);;width*=2){
        const a0=Math.max(d0,r0-width),b1=Math.min(d1,r1+width);
        if(a0<r0&&b1>r1){
          const hits=curveCrossings([extract(moved,a0,r0),extract(moved,r1,b1)],tol).pairs.filter(h=>h.a===0&&h.b===1);
          if(hits.length){const h=hits.reduce((x,y)=>(r0-y.s)+(y.t-r1)<(r0-x.s)+(x.t-r1)?y:x);cut=[h.s,h.t];break;}
        }
        if(a0===d0&&b1===d1||turning(curve,a0,b1)>=Math.PI){cut=[r0,r1];break;}
      }
      cuts.push(cut);
    }
    cuts.sort((x,y)=>x[0]-y[0]);
    const merged=[];
    for(const c of cuts){if(merged.length&&c[0]<=merged.at(-1)[1])merged.at(-1)[1]=Math.max(merged.at(-1)[1],c[1]);else merged.push([...c]);}
    const keep=[];let from=d0;
    for(const [a,b] of merged){if(a>from)keep.push([from,a]);from=Math.max(from,b);}
    if(from<d1)keep.push([from,d1]);
    const pieces=merged.length?keep.map(([a,b])=>extract(moved,a,b)):[moved];
    return {pieces,folds:merged.length};
  }
  return {ribbon};
}
