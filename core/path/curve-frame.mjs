import {requireThat,distance,normalize,dot,cross} from '../geom/tolerance.mjs';

// A rotation-minimizing frame for a spatial centerline. The least-parallel
// coordinate axis supplies the automatic initial normal. Closed curves spread
// their holonomy correction over arc length, with an identical seam frame.
export function transportCurveFrames(points,{closed=false,initialNormal=null}={}){
  const duplicate=points.length>2&&distance(points[0],points.at(-1))<1e-9,source=duplicate?points.slice(0,-1):points,cyclic=closed||duplicate,n=source.length;
  requireThat(n>=2,'A curve frame needs at least two points.');
  const lengths=[0];for(let i=1;i<n;i++)lengths.push(lengths.at(-1)+distance(source[i-1],source[i]));
  const total=lengths.at(-1)+(cyclic?distance(source.at(-1),source[0]):0);
  const tangents=source.map((p,i)=>{
    const before=i?source[i-1]:cyclic?source.at(-1):null,after=i<n-1?source[i+1]:cyclic?source[0]:null;
    requireThat((!before||distance(p,before)>1e-12)&&(!after||distance(p,after)>1e-12),'A curve frame cannot resolve a zero-length segment.');
    const a=before?normalize(p.map((v,k)=>v-before[k])):null,b=after?normalize(after.map((v,k)=>v-p[k])):null;
    requireThat(!a||!b||Math.hypot(...a.map((v,k)=>v+b[k]))>1e-12,'A curve frame cannot resolve a reversing cusp.');
    return normalize(a&&b?a.map((v,k)=>v+b[k]):a??b);
  });
  const seed=initialNormal??[0,1,2].map(axis=>({axis,value:Math.abs(tangents[0][axis])})).sort((a,b)=>a.value-b.value).map(({axis})=>[0,1,2].map(i=>i===axis?1:0))[0];
  requireThat(Array.isArray(seed)&&seed.length===3&&seed.every(Number.isFinite),'Initial normal must be an XYZ vector.');
  const rotate=(v,axis,angle)=>{const c=Math.cos(angle),s=Math.sin(angle),perpendicular=cross(axis,v);return v.map((x,k)=>x*c+perpendicular[k]*s+axis[k]*dot(axis,v)*(1-c));};
  const transport=(side,before,after)=>{
    const axis=cross(before,after),sine=Math.hypot(...axis),cosine=dot(before,after);
    requireThat(sine>1e-12||cosine>0,'A curve frame cannot resolve antiparallel tangents.');
    return sine>1e-12?normalize(rotate(side,axis.map(v=>v/sine),Math.atan2(sine,cosine))):[...side];
  };
  const initialSide=cross(seed,tangents[0]);
  requireThat(Math.hypot(...initialSide)>1e-12,'Initial normal must not be parallel to the curve tangent.');
  const sides=[normalize(initialSide)];for(let i=1;i<n;i++)sides.push(transport(sides[i-1],tangents[i-1],tangents[i]));
  let seamCorrectionRad=0;
  if(cyclic){const terminal=transport(sides.at(-1),tangents.at(-1),tangents[0]);seamCorrectionRad=Math.atan2(dot(tangents[0],cross(terminal,sides[0])),dot(terminal,sides[0]));}
  const frames=source.map((p,i)=>{const u=tangents[i],v=rotate(sides[i],u,seamCorrectionRad*lengths[i]/total);return {point:[lengths[i],0,0],u,v,normal:normalize(cross(u,v))};});
  return {frames:duplicate?[...frames,{...frames[0],point:[total,0,0]}]:frames,lengthMm:total,seamCorrectionRad,closed:cyclic};
}
