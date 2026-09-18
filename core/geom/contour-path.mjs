// Arc-length phase needs no interior origin and therefore supports concavity.
// Project a fixed first-section seam onto each later contour. Equal-distance
// ties use coordinates rather than the sectioner's arbitrary vertex ordering.
import {distance,requireThat} from './tolerance.mjs';

export function contourPath(loop,anchor=null) {
  requireThat(loop.length>=3,'Contour path needs a closed contour.');
  anchor??=loop.reduce((best,p)=>p[0]>best[0]||(p[0]===best[0]&&p[1]<best[1])?p:best,loop[0]);
  const lengths=loop.map((p,i)=>distance(p,loop[(i+1)%loop.length])),cumulative=[0];
  for(const length of lengths)cumulative.push(cumulative.at(-1)+length);
  const total=cumulative.at(-1);requireThat(total>0,'Contour path collapsed.');
  let best=null;
  for(let i=0;i<loop.length;i++) {
    const a=loop[i],b=loop[(i+1)%loop.length],length=lengths[i];if(!length)continue;
    const t=Math.max(0,Math.min(1,((anchor[0]-a[0])*(b[0]-a[0])+(anchor[1]-a[1])*(b[1]-a[1]))/(length*length)));
    const point=a.map((v,k)=>v+t*(b[k]-v)),d=distance(point,anchor);
    if(!best||d<best.distance-1e-12||(Math.abs(d-best.distance)<=1e-12&&
      (point[0]>best.point[0]||(point[0]===best.point[0]&&point[1]<best.point[1]))))
      best={point,distance:d,offset:cumulative[i]+t*length};
  }
  const at=phase=>{
    const s=((phase%1+1)%1*total+best.offset)%total;
    let lo=0,hi=lengths.length;
    while(lo+1<hi){const mid=(lo+hi)>>1;if(cumulative[mid]<=s)lo=mid;else hi=mid;}
    const t=lengths[lo]?(s-cumulative[lo])/lengths[lo]:0;
    return loop[lo].map((v,k)=>v+t*(loop[(lo+1)%loop.length][k]-v));
  };
  let knots,nodes;
  const parameters=()=>knots??=(cumulative.slice(0,-1).map(s=>((s-best.offset)%total+total)%total/total));
  const breakpoints=()=>nodes??=[{u:0,p:at(0)},...parameters().map((u,i)=>({u,p:loop[i]})).filter(n=>n.u>0).sort((a,b)=>a.u-b.u),{u:1,p:at(0)}];
  return {at,seam:best.point,length:total,knots:parameters,breakpoints};
}
