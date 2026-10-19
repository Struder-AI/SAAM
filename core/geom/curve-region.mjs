// Parameter-space clipping of a planar line p(t) = origin + t * direction.
// One edge sweep serves parity chords, winding fill and material contact queries.
import {requireThat} from './tolerance.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';
import {curveLoopLineCuts} from './curve-loops.mjs';

export function clipLineToRegion(origin,direction,loops,{range=[-Infinity,Infinity],fillRule='nonzero'}={}){
  requireThat([origin,direction].every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)),
    'Line clipping needs finite 2D origin and direction.');
  const length2=direction[0]**2+direction[1]**2;
  requireThat(Number.isFinite(length2)&&length2>0,'Line clipping needs a nonzero finite direction.');
  requireThat(Array.isArray(range)&&range.length===2&&range.every(t=>typeof t==='number'&&!Number.isNaN(t))&&range[0]<=range[1]
    &&range[0]<Infinity&&range[1]>-Infinity,'Line clipping needs an ordered parameter range.');
  requireThat(fillRule==='nonzero'||fillRule==='evenodd','Line clipping needs nonzero or evenodd fill.');
  requireThat(Array.isArray(loops),'Line clipping needs finite 2D region loops.');
  if(loops.some(loop=>!Array.isArray(loop)))return clipNativeLoopLine(origin,direction,loops,range,fillRule);
  requireThat(loops.every(loop=>Array.isArray(loop)&&loop.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))),
    'Line clipping needs finite 2D region loops.');
  const project=p=>{
    const x=p[0]-origin[0],y=p[1]-origin[1];
    return [(x*direction[0]+y*direction[1])/length2,direction[0]*y-direction[1]*x];
  };
  const crossings=[],contacts=[];
  const contact=(a,b=a)=>{
    const lo=Math.max(range[0],Math.min(a,b)),hi=Math.min(range[1],Math.max(a,b));
    if(lo<=hi)contacts.push([lo,hi]);
  };
  for(const loop of loops){
    if(loop.length<2)continue;
    let a=project(loop.at(-1));
    for(const point of loop){
      const b=project(point);
      if(a[1]===0&&b[1]===0)contact(a[0],b[0]);
      else if((a[1]<=0&&b[1]>=0)||(a[1]>=0&&b[1]<=0)){
        const t=a[0]+(b[0]-a[0])*(-a[1])/(b[1]-a[1]);
        contact(t);
        // Half-open vertices: include the lower side, exclude the upper side.
        // Tangencies/collinear edges remain contacts, not invented crossings.
        if((a[1]>0)!==(b[1]>0))crossings.push({t,winding:b[1]>a[1]?1:-1});
      }
      a=b;
    }
  }
  crossings.sort((a,b)=>a.t-b.t);
  const spans=[];
  let winding=0;
  for(let i=0;i<crossings.length-1;i++){
    winding+=crossings[i].winding;
    if(fillRule==='nonzero'?winding===0:Math.abs(winding)%2===0)continue;
    const a=crossings[i].t,b=crossings[i+1].t,lo=Math.max(a,range[0]),hi=Math.min(b,range[1]);
    // Keep subdivisions at crossings (infill's cell collector needs them).
    // A singleton range is a point-membership query with the same half-open rule.
    if(lo<hi||(range[0]===range[1]&&a<=range[0]&&range[0]<b))spans.push([lo,hi]);
  }
  return {spans,contacts:mergedLineContacts(contacts)};
}
function mergedLineContacts(contacts){
  contacts.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const merged=[];
  for(const span of contacts){
    const last=merged.at(-1);
    if(last&&span[0]<=last[1])last[1]=Math.max(last[1],span[1]);
    else merged.push(span);
  }
  return merged;
}

function clipNativeLoopLine(origin,direction,loops,range,fillRule){
  const native=curveLoopLineCuts(origin,direction,loops),cuts=[...native.cuts,...range.filter(Number.isFinite)].sort((a,b)=>a-b),ordered=[];
  for(const t of cuts)if(!ordered.length||Math.abs(t-ordered.at(-1))>ROUNDING_RELATIVE*Math.max(1,Math.abs(t)))ordered.push(t);
  const contains=t=>{const winding=native.winding(origin.map((v,k)=>v+t*direction[k]));return fillRule==='nonzero'?winding!==0:Math.abs(winding)%2===1;};
  const spans=[];
  if(range[0]===range[1]){if(contains(range[0]))spans.push([...range]);}
  else for(let i=1;i<ordered.length;i++){
    const lo=Math.max(ordered[i-1],range[0]),hi=Math.min(ordered[i],range[1]);
    if(hi>lo&&contains((lo+hi)/2))spans.push([lo,hi]);
  }
  const contacts=native.contacts.flatMap(([a,b])=>{
    const lo=Math.max(a,range[0]),hi=Math.min(b,range[1]),guard=ROUNDING_RELATIVE*Math.max(1,Math.abs(a),Math.abs(b));
    if(lo<=hi)return [[lo,hi]];
    return lo-hi<=guard?[[Math.max(range[0],Math.min(range[1],(lo+hi)/2)),Math.max(range[0],Math.min(range[1],(lo+hi)/2))]]:[];
  });
  return {spans,contacts:mergedLineContacts(contacts)};
}

// Clip an authored planar centerline to material, retaining its traversal and
// closed seam. Native region operations keep geometry responsibility here;
// callers choose the region (including any bead/exterior standoff) themselves.
export function clipPlanarCurveToRegion(curve,loops,{toleranceMm=PRINT_RESOLUTION_MM}={}){
  return clipRegionCurve(curve,loops,toleranceMm);
}

// Chart units carry no physical distance; use their dimensionless rounding grid.
export function clipChartCurveToRegion(curve,loops,{precisionUv=ROUNDING_RELATIVE}={}){
  return clipRegionCurve(curve,loops,precisionUv);
}

function clipRegionCurve(curve,loops,precision){
  requireThat(curve&&typeof curve.closed==='boolean'&&Array.isArray(curve.points)&&curve.points.length>=(curve.closed?3:2),
    'Planar curve clipping needs points and closed true or false.');
  requireThat(curve.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)),
    'Planar curve clipping needs finite 2D points.');
  requireThat(Number.isFinite(precision)&&precision>0,'Curve clipping tolerance must be positive.');
  const near=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<=precision;
  const pieces=[],state={current:null};
  const segmentCount=curve.points.length-(curve.closed?0:1);
  for(let i=0;i<segmentCount;i++){
    const a=curve.points[i],b=curve.points[(i+1)%curve.points.length],direction=b.map((v,k)=>v-a[k]);
    if(Math.hypot(...direction)<=precision)continue;
    const clipped=clipLineToRegion(a,direction,loops,{range:[0,1]});
    const spans=[...clipped.spans,...clipped.contacts].filter(([from,to])=>to>from).sort((p,q)=>p[0]-q[0]),merged=[];
    for(const span of spans){
      const last=merged.at(-1);
      if(last&&span[0]<=last[1])last[1]=Math.max(last[1],span[1]);else merged.push([...span]);
    }
    for(const [from,to] of merged){
      const first=a.map((v,k)=>v+from*direction[k]),last=a.map((v,k)=>v+to*direction[k]);
      if(near(first,last))continue;
      if(state.current&&near(state.current.at(-1),first))state.current.push(last);
      else{const points=[first,last];pieces.push(points);state.current=points;}
    }
  }
  // A clipped closed path can straddle the authored start; join that one seam.
  if(curve.closed&&pieces.length>1&&near(pieces.at(-1).at(-1),pieces[0][0])){
    const tail=pieces.pop();pieces[0]=[...tail,...pieces[0].slice(1)];
  }
  return pieces.map(points=>{
    const closed=curve.closed&&points.length>3&&near(points[0],points.at(-1));
    return {closed,points:closed?points.slice(0,-1):points};
  });
}
