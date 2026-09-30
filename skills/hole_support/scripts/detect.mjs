import {createSectionQuery} from '../../../core/geom/query.mjs';
import {loopArea} from '../../../core/region/region2d.mjs';

// Fit a circle through distributed contour vertices, then reject polygonal or
// partial openings using both vertex and edge-midpoint radial residuals.
export function circularHole(loop,toleranceMm=0.05){
  if(loopArea(loop)>=0||loop.length<12)return null;
  const [a,b,c]=[loop[0],loop[Math.floor(loop.length/3)],loop[Math.floor(2*loop.length/3)]];
  const u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]),d=2*(u[0]*v[1]-u[1]*v[0]);
  if(Math.abs(d)<1e-8)return null;
  const uu=u[0]**2+u[1]**2,vv=v[0]**2+v[1]**2;
  const center=[a[0]+(uu*v[1]-vv*u[1])/d,a[1]+(u[0]*vv-v[0]*uu)/d],radius=Math.hypot(a[0]-center[0],a[1]-center[1]);
  for(let i=0;i<loop.length;i++){
    const p=loop[i],q=loop[(i+1)%loop.length];
    for(const t of [0,0.5])if(Math.abs(Math.hypot(p[0]*(1-t)+q[0]*t-center[0],p[1]*(1-t)+q[1]*t-center[1])-radius)>toleranceMm)return null;
  }
  // Report dimensions on a 0.00001 mm grid, below the fitting tolerance and
  // above Float32 noise, so exact tangencies do not acquire microscopic slivers.
  const dimension=n=>Math.round(n*1e5)/1e5;
  return {center:center.map(dimension),radius:dimension(radius)};
}
export function detectHoles(shell,{layerMm=0.2,toleranceMm=0.05}={}){
  if(Math.abs(shell.bounds.min[2])>1e-6)return [];
  const query=createSectionQuery(shell),min=0,max=shell.bounds.max[2],levels=new Set([min,max]);
  if(shell.kind==='triangle-mesh')for(const p of shell.vertices)levels.add(p[2]);
  for(let z=min+layerMm;z<max;z+=layerMm)levels.add(z);
  const heights=[...levels].sort((a,b)=>a-b),sections=new Map();
  const holes=z=>{if(!sections.has(z))sections.set(z,query(z).loops.map(l=>circularHole(l,toleranceMm)).filter(Boolean));return sections.get(z);};
  const same=(a,b)=>Math.hypot(a.center[0]-b.center[0],a.center[1]-b.center[1])<=toleranceMm;
  const found=[];
  for(let i=1;i<heights.length-1;i++){
    const z=heights[i],below=(heights[i-1]+z)/2,above=(z+heights[i+1])/2;
    for(const upper of holes(above)){
      const lower=holes(below).find(h=>same(h,upper)&&h.radius>upper.radius+2*toleranceMm);
      if(!lower)continue;
      // A true step changes at one plane, rather than narrowing over a taper.
      const nearLow=holes(z-1e-4).find(h=>same(h,lower)),nearHigh=holes(z+1e-4).find(h=>same(h,upper));
      if(!nearLow||!nearHigh||Math.abs(nearLow.radius-lower.radius)>toleranceMm||Math.abs(nearHigh.radius-upper.radius)>toleranceMm)continue;
      const clear=heights.slice(0,i).every((h,j)=>holes((h+heights[j+1])/2).some(c=>same(c,lower)&&c.radius>=lower.radius-toleranceMm));
      if(!clear||found.some(f=>Math.abs(f.centerMm[2]-z)<toleranceMm&&Math.hypot(f.centerMm[0]-upper.center[0],f.centerMm[1]-upper.center[1])<toleranceMm))continue;
      found.push({id:'hole-'+(found.length+1),centerMm:[...upper.center,z],boreRadiusMm:upper.radius,counterboreRadiusMm:lower.radius});
    }
  }
  return found;
}
