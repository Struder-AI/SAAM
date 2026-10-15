// Flat native boundary faces available to close a finite material regime.
// Curved exterior faces retain nominal clipping; slice references may be curved.
import {planeSlice} from '../../geom/slice.mjs';
import {evaluateSurface} from '../../geom/surface-evaluation.mjs';
import {affineSurface} from '../../geom/affine-surface.mjs';
import {dot,cross,normalize} from '../../geom/tolerance.mjs';
import {union} from '../intersection.mjs';
import {loopArea} from '../region2d.mjs';
import {ROUNDING_MM,ROUNDING_RELATIVE} from '../../dimensions.mjs';

export function boundaryCaps(geometries,{slabs=[],bounds}={}){
  const groups=new Map(),seen=new Set(),report={curvedFaces:0};
  const face=points=>{
    const a=points[0],u=points[1].map((v,k)=>v-a[k]),v=points[2].map((v,k)=>v-a[k]),area=cross(u,v);
    if(!Math.hypot(...area))return;
    const n=normalize(area),sign=n.find(v=>Math.abs(v)>ROUNDING_RELATIVE)<0?-1:1,normal=n.map(v=>v*sign),height=dot(normal,a);
    const key=normal.map(v=>Math.round(v/ROUNDING_RELATIVE)).join(',')+'|'+Math.round(height/ROUNDING_MM);
    if(!groups.has(key))groups.set(key,{slice:planeSlice({origin:a,normal}),loops:[]});
    const group=groups.get(key),slice=group.slice;
    const loop=points.map(p=>{const delta=p.map((v,k)=>v-slice.origin[k]);return [dot(delta,slice.xAxis),dot(delta,slice.yAxis)];});
    group.loops.push(loopArea(loop)<0?loop.toReversed():loop);
  };
  const collect=geometry=>{
    if(seen.has(geometry))return;seen.add(geometry);
    if(geometry.kind==='boolean'){for(const operand of geometry.operands)collect(operand);return;}
    if(geometry.kind==='triangle-mesh'){for(const triangle of geometry.triangles)face(triangle.map(i=>geometry.vertices[i]));return;}
    for(const patch of geometry.patches??[]){
      if(!affineSurface(patch)){report.curvedFaces++;continue;}
      const [u0,u1]=patch.domainU,[v0,v1]=patch.domainV;
      face([[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(uv=>evaluateSurface(patch,uv).point));
    }
  };
  for(const geometry of geometries)collect(geometry);
  for(const slab of slabs)for(const height of [slab.fromMm,slab.toMm]){
    if(!Number.isFinite(height))continue;
    const axis=slab.axis??[0,0,1],slice=planeSlice({origin:axis.map(v=>v*height/dot(axis,axis)),normal:axis});
    const corners=Array.from({length:8},(_,i)=>[0,1,2].map(k=>((i>>k)&1?bounds.max[k]:bounds.min[k])-slice.origin[k]));
    const ranges=[slice.xAxis,slice.yAxis].map(axis=>corners.map(p=>dot(axis,p))),lo=ranges.map(values=>Math.min(...values)),hi=ranges.map(values=>Math.max(...values));
    face([[lo[0],lo[1]],[hi[0],lo[1]],[hi[0],hi[1]],[lo[0],hi[1]]].map(uv=>evaluateSurface(slice,uv).point));
  }
  return {faces:[...groups.values()].map(({slice,loops})=>({slice,region:union(loops,[])})),report};
}
