// Explicit spline-to-mesh conversion for solid modifiers; ordinary slicing stays native.
import {evaluate} from './nurbs.mjs';
import {makeMesh} from './mesh.mjs';
import {requireThat,distance} from './tolerance.mjs';

const lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
function closest(curve,p){
  let best=0,score=Infinity;
  for(let i=0;i<=32;i++){const d=distance(curve(i/32),p);if(d<score){best=i/32;score=d;}}
  let lo=Math.max(0,best-1/32),hi=Math.min(1,best+1/32);
  for(let i=0;i<45;i++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3;if(distance(curve(a),p)<distance(curve(b),p))hi=b;else lo=a;}
  const t=(lo+hi)/2;
  return distance(curve(best),p)<distance(curve(t),p)?best:t;
}

export function tessellateShell(shell,{toleranceMm=0.02}={}){
  if(shell.kind==='triangle-mesh')return shell;
  requireThat(shell.patches&&shell.closure?.unmatched.length===0,'Text target requires a closed mesh or supported spline shell.');
  const edges=shell.closure.edges;
  // The grid doubles until the sampled chord error meets the tolerance. A
  // doubling that no longer reduces that error will never reach it.
  let previousError=Infinity;
  for(let count=2;;count*=2){
    const boundarySamples=sampleSharedBoundaries(edges,count);
    const candidate=sampleTessellationCandidate(shell.patches,edges,boundarySamples,count);
    if(candidate.sampledErrorMm>toleranceMm){
      requireThat(candidate.sampledErrorMm<previousError*0.9,'Spline tessellation stops improving before it reaches toleranceMm; the shell needs a coarser tolerance or simpler patches.');
      previousError=candidate.sampledErrorMm;
    }else{
      const orientedTriangles=orientTriangles(candidate.vertices,candidate.triangles);
      return {...makeMesh(candidate.vertices,orientedTriangles),tessellation:{toleranceMm,sampledErrorMm:candidate.sampledErrorMm,steps:count}};
    }
  }
}

function sampleSharedBoundaries(edges,count){
  const curves=new Map(),paired=new Set();
  for(const edge of edges){
    if(paired.has(edge))continue;
    const points=Array.from({length:count+1},(_,i)=>edge.curve(i/count));
    curves.set(edge,{points,parameters:points.map((_,i)=>i/count)});paired.add(edge);
    if(edge.degenerate)continue;
    const partner=edges.find(other=>other!==edge&&!paired.has(other)&&!other.degenerate&&
      [0,0.25,0.5,0.75,1].every(t=>distance(other.curve(closest(other.curve,edge.curve(t))),edge.curve(t))<1e-5));
    requireThat(partner,'Could not match spline boundaries for text tessellation.');
    const ordered=distance(points[0],partner.curve(0))<distance(points.at(-1),partner.curve(0))?points:[...points].reverse();
    curves.set(partner,{points:ordered,parameters:ordered.map(p=>closest(partner.curve,p))});paired.add(partner);
  }
  return curves;
}

function sampleTessellationCandidate(patches,edges,boundarySamples,count){
  const vertices=[],triangles=[],index=new Map();let error=0;
  const vertex=p=>{
    const key=p.map(v=>Math.round(v/1e-7)).join(',');
    if(!index.has(key)){index.set(key,vertices.length);vertices.push(p);}
    return index.get(key);
  };
  for(const patch of patches){
    const e=edges.filter(e=>e.patch===patch.name).map(e=>boundarySamples.get(e));
    const uv=(i,j)=>{
      const u=i/count,v=j/count;
      return [e[0].parameters[i]*(1-v)+e[2].parameters[i]*v,e[3].parameters[j]*(1-u)+e[1].parameters[j]*u];
    };
    const at=([u,v])=>evaluate(patch,patch.domainU[0]+u*(patch.domainU[1]-patch.domainU[0]),patch.domainV[0]+v*(patch.domainV[1]-patch.domainV[0]),false).point;
    const rows=[];
    for(let i=0;i<=count;i++){rows[i]=[];for(let j=0;j<=count;j++){
      const p=j===0?e[0].points[i]:j===count?e[2].points[i]:i===0?e[3].points[j]:i===count?e[1].points[j]:at(uv(i,j));
      rows[i][j]=vertex(p);
    }}
    for(let i=0;i<count;i++)for(let j=0;j<count;j++){
      const corners=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]];
      for(const ids of [[0,1,2],[0,2,3]]){
        const tri=ids.map(k=>rows[corners[k][0]][corners[k][1]]);
        if(new Set(tri).size===3)triangles.push(tri);
        const coords=ids.map(k=>uv(...corners[k]));
        for(const weights of [[1/3,1/3,1/3],[0.5,0.5,0],[0,0.5,0.5],[0.5,0,0.5]]){
          const param=[0,1].map(k=>coords.reduce((s,p,n)=>s+p[k]*weights[n],0));
          const chord=[0,1,2].map(k=>tri.reduce((s,id,n)=>s+vertices[id][k]*weights[n],0));
          error=Math.max(error,distance(at(param),chord));
        }
      }
    }
  }
  return {vertices,triangles,sampledErrorMm:error};
}

// Patch parameterizations do not encode shell orientation. Propagate edge
// orientation, then orient each connected boundary by signed enclosed volume.
function orientTriangles(vertices,sourceTriangles){
  // The accepted candidate stays reusable; orientation owns only this final copy.
  const triangles=sourceTriangles.map(triangle=>[...triangle]);
  const edges=new Map();
  triangles.forEach((t,i)=>t.forEach((a,j)=>{const b=t[(j+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(':');if(!edges.has(key))edges.set(key,[]);edges.get(key).push({i,sign:a<b?1:-1});}));
  requireThat([...edges.values()].every(e=>e.length===2),'Spline tessellation has unmatched edges; this shell needs a conforming mesh before text modification.');
  const adjacent=triangles.map(()=>[]);
  for(const [a,b] of edges.values()){adjacent[a.i].push([b.i,-a.sign*b.sign]);adjacent[b.i].push([a.i,-a.sign*b.sign]);}
  const signs=new Map();
  for(let seed=0;seed<triangles.length;seed++){
    if(signs.has(seed))continue;
    const queue=[seed];signs.set(seed,1);
    for(let j=0;j<queue.length;j++)for(const [next,relative] of adjacent[queue[j]]){
      const sign=signs.get(queue[j])*relative;
      if(signs.has(next))requireThat(signs.get(next)===sign,'Spline boundary is not orientable.');
      else {signs.set(next,sign);queue.push(next);}
    }
    let volume=0;
    for(const i of queue){if(signs.get(i)<0)triangles[i].reverse();const [a,b,c]=triangles[i].map(id=>vertices[id]);volume+=a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]);}
    if(volume<0)for(const i of queue)triangles[i].reverse();
  }
  return triangles;
}
