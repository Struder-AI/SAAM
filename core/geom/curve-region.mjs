// Parameter-space clipping of a planar line p(t) = origin + t * direction.
// One edge sweep serves parity chords, winding fill and material contact queries.
import {requireThat} from './tolerance.mjs';

export function clipLineToRegion(origin,direction,loops,{range=[-Infinity,Infinity],fillRule='nonzero'}={}){
  requireThat([origin,direction].every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)),
    'Line clipping needs finite 2D origin and direction.');
  const length2=direction[0]**2+direction[1]**2;
  requireThat(Number.isFinite(length2)&&length2>0,'Line clipping needs a nonzero finite direction.');
  requireThat(Array.isArray(range)&&range.length===2&&range.every(t=>typeof t==='number'&&!Number.isNaN(t))&&range[0]<=range[1]
    &&range[0]<Infinity&&range[1]>-Infinity,'Line clipping needs an ordered parameter range.');
  requireThat(fillRule==='nonzero'||fillRule==='evenodd','Line clipping needs nonzero or evenodd fill.');
  requireThat(Array.isArray(loops)&&loops.every(loop=>Array.isArray(loop)&&loop.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))),
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
  contacts.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const merged=[];
  for(const span of contacts){
    const last=merged.at(-1);
    if(last&&span[0]<=last[1])last[1]=Math.max(last[1],span[1]);
    else merged.push(span);
  }
  return {spans,contacts:merged};
}
