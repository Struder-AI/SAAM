// Directional unilateral contact in a horizontal section. A smooth interior
// anchor defines radial rays; only the forbidden side moves toward the target.
// One simple CCW contour star-shaped about that anchor is required. This avoids
// nearest-projection jumps at concave medial axes without deforming loop backs.
import {requireThat} from './tolerance.mjs';
const TAU=2*Math.PI;
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];

export function prepareSleeveContact({loopsAt,anchorAt,side='inside'}) {
  requireThat(typeof loopsAt==='function'&&typeof anchorAt==='function'&&['inside','outside'].includes(side),
    'Sleeve contact needs boundary/anchor queries and an inside/outside side.');
  const cache=new Map(),report={contactSections:0,contactSamples:0,compressedSamples:0,maxCompressionMm:0};
  function boundary(z) {
    let result=cache.get(z);if(result)return result;
    const loops=loopsAt(z),anchor=anchorAt(z);
    requireThat(Array.isArray(loops)&&loops.length===1&&loops[0].length>=3&&loops[0].every(p=>p.length>=2&&p.slice(0,2).every(Number.isFinite)),
      `Sleeve contact boundary is empty, invalid or has multiple loops at Z ${z} mm.`);
    requireThat(Array.isArray(anchor)&&anchor.length===2&&anchor.every(Number.isFinite),'Sleeve contact anchor must be a finite XY point.');
    const loop=loops[0],segments=[];
    let angle=Math.atan2(loop[0][1]-anchor[1],loop[0][0]-anchor[0]),firstAngle=angle;
    for(let i=0;i<loop.length;i++){
      const a=loop[i],b=loop[(i+1)%loop.length],q=[a[0]-anchor[0],a[1]-anchor[1]],r=[b[0]-anchor[0],b[1]-anchor[1]];
      const e=[b[0]-a[0],b[1]-a[1]],length=Math.hypot(...e);
      if(length<1e-12)continue;
      // The anchor must lie strictly inside every edge half-plane (the kernel
      // of this simple polygon). Thus angle advances strictly and each ray has
      // exactly one crossing. Radial folds/edges cannot be silently selected.
      requireThat(cross(q,r)>1e-10*length,
        `Directional sleeve contact requires a star-shaped section about its fitted center at Z ${z} mm; a radial fold or exterior center is unsupported.`);
      const delta=Math.atan2(cross(q,r),q[0]*r[0]+q[1]*r[1]);
      segments.push({a,q,e,start:angle,end:angle+delta});angle+=delta;
    }
    requireThat(segments.length>=3&&Math.abs(angle-firstAngle-TAU)<1e-8,
      `Directional sleeve contact needs one simple counterclockwise boundary at Z ${z} mm.`);
    result={anchor,segments,firstAngle};report.contactSections++;
    if(cache.size>=128)cache.delete(cache.keys().next().value);
    cache.set(z,result);return result;
  }
  return {report,at(point,fidelity=1){
    requireThat(point.length===3&&point.every(Number.isFinite)&&Number.isFinite(fidelity)&&fidelity>=0&&fidelity<=1,
      'Sleeve contact needs a finite XYZ point and continuous fidelity from 0 to 1.');
    if(fidelity===0)return [...point];
    report.contactSamples++;
    const {anchor,segments,firstAngle}=boundary(point[2]),dx=point[0]-anchor[0],dy=point[1]-anchor[1],radius=Math.hypot(dx,dy);
    if(radius<1e-12){
      requireThat(side==='inside','Outside sleeve contact has no radial direction at the fitted center.');
      return [...point];
    }
    const direction=[dx/radius,dy/radius];
    let angle=Math.atan2(dy,dx);angle=firstAngle+((angle-firstAngle)%TAU+TAU)%TAU;
    let lo=0,hi=segments.length-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(angle<segments[mid].end)hi=mid;else lo=mid+1;}
    const segment=segments[lo],targetRadius=cross(segment.q,segment.e)/cross(direction,segment.e);
    requireThat(Number.isFinite(targetRadius)&&targetRadius>0,'Directional sleeve contact could not resolve its boundary crossing.');
    const forbidden=side==='inside'?radius>targetRadius:radius<targetRadius;
    if(!forbidden)return [...point];
    const delta=(targetRadius-radius)*fidelity,amount=Math.abs(delta);
    if(amount>0){report.compressedSamples++;report.maxCompressionMm=Math.max(report.maxCompressionMm,amount);}
    return [point[0]+direction[0]*delta,point[1]+direction[1]*delta,point[2]];
  }};
}
