// Bounded evaluated-chart ray queries. Native plane/patch queries retain
// their existing kernels; other regular charts use a sampled projected mesh.
import {evaluateSurface} from './surface-evaluation.mjs';
import {surfaceChartBounds,surfaceChartStep} from '../region/surface-operations.mjs';
import {prepareSliceRay,sliceRayIntersections} from './slice.mjs';
import {dot,cross,normalize} from './tolerance.mjs';

export function prepareSurfaceRay(surface,direction,{points=[],sampleStepMm=.2}={}){
  const d=normalize(direction);
  if(['plane','patch'].includes(surface.kind))return {native:prepareSliceRay(surface,d),direction:d};
  const bounds=surfaceChartBounds(surface,points),steps=surfaceChartStep(surface,bounds,sampleStepMm);
  const seed=Math.abs(d[0])<.9?[1,0,0]:[0,1,0],x=normalize(seed.map((v,k)=>v-dot(seed,d)*d[k])),axes=[x,cross(d,x),d];
  const counts=bounds.map(([a,b],k)=>Math.max(2,Math.ceil((b-a)/steps[k])));
  const grid=Array.from({length:counts[0]+1},(_,i)=>Array.from({length:counts[1]+1},(_,j)=>{
    const uv=bounds.map(([a,b],k)=>a+(b-a)*[i,j][k]/counts[k]),p=evaluateSurface(surface,uv).point;
    return {uv,p:axes.map(axis=>dot(axis,p))};
  }));
  const triangles=[];
  for(let i=0;i<counts[0];i++)for(let j=0;j<counts[1];j++){
    const a=grid[i][j],b=grid[i+1][j],c=grid[i+1][j+1],e=grid[i][j+1];triangles.push([a,b,c],[a,c,e]);
  }
  return {axes,triangles,direction:d};
}

export function surfaceRayIntersections(query,point){
  if(query.native)return sliceRayIntersections(query.native,point);
  const p=query.axes.map(axis=>dot(axis,point)),hits=[];
  for(const [a,b,c] of query.triangles){
    const v=b.p.map((n,k)=>n-a.p[k]),w=c.p.map((n,k)=>n-a.p[k]),q=p.map((n,k)=>n-a.p[k]),det=v[0]*w[1]-v[1]*w[0];
    if(!det)continue;
    const u=(q[0]*w[1]-q[1]*w[0])/det,t=(v[0]*q[1]-v[1]*q[0])/det;
    if(u<0||t<0||u+t>1)continue;
    hits.push({distanceMm:p[2]-a.p[2]-u*v[2]-t*w[2],chartPoint:a.uv.map((n,k)=>n+u*(b.uv[k]-n)+t*(c.uv[k]-n))});
  }
  return hits;
}
