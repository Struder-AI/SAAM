// Quadric edge collapse for reconstructed meshes. Final intersection validation
// is mandatory: local link/normal checks alone do not prove an embedded surface.
import {subtract as sub,cross,dot,requireThat} from './tolerance.mjs';
import {compactMesh} from './mesh-repair.mjs';
import {trianglesContact} from './mesh-spatial.mjs';

class MinHeap {
  items=[];
  push(item){const a=this.items;let i=a.length;a.push(item);while(i){const p=(i-1)>>1;if(a[p].cost<=item.cost)break;a[i]=a[p];i=p;}a[i]=item;}
  pop(){const a=this.items,first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1].cost<a[j].cost)j++;if(last.cost<=a[j].cost)break;a[i]=a[j];i=j;}a[i]=last;}return first;}
}

export function simplifyRepair(input,{targetTriangles=80000,maxPlaneErrorMm=0.05,progress=()=>{}}={}) {
  requireThat(Number.isSafeInteger(targetTriangles)&&targetTriangles>=4&&targetTriangles<=100000,'Repair targetTriangles must be 4–100000.');
  requireThat(Number.isFinite(maxPlaneErrorMm)&&maxPlaneErrorMm>0,'Repair maxPlaneErrorMm must be positive.');
  const vertices=input.vertices.map(p=>[...p]),faces=input.triangles.map(t=>[...t]),incident=vertices.map(()=>new Set()),quadrics=vertices.map(()=>new Float64Array(10)),versions=new Uint32Array(vertices.length),alive=new Uint8Array(vertices.length).fill(1);
  const normal=t=>cross(sub(vertices[t[1]],vertices[t[0]]),sub(vertices[t[2]],vertices[t[0]]));
  for(const [i,t]of faces.entries()){
    const n=normal(t),len=Math.hypot(...n);requireThat(len>1e-10,'Cannot simplify a degenerate triangle.');const [a,b,c]=n.map(v=>v/len),d=-dot([a,b,c],vertices[t[0]]),q=[a*a,a*b,a*c,a*d,b*b,b*c,b*d,c*c,c*d,d*d];
    for(const v of t){incident[v].add(i);for(let k=0;k<10;k++)quadrics[v][k]+=q[k];}
  }
  const neighbors=v=>{const set=new Set();for(const i of incident[v])for(const p of faces[i])if(p!==v)set.add(p);return set;};
  // Mutable spatial buckets keep collision checks local as faces are replaced.
  const cellSize=input.report?.resolutionMm?2*input.report.resolutionMm:1,buckets=new Map(),faceCells=new Map(),boxes=new Map();
  const bounds=p=>({min:[0,1,2].map(k=>Math.min(...p.map(v=>v[k]))),max:[0,1,2].map(k=>Math.max(...p.map(v=>v[k])))});
  function cells(box){const lo=box.min.map(v=>Math.floor((v-1e-9)/cellSize)),hi=box.max.map(v=>Math.floor((v+1e-9)/cellSize)),keys=[];if(hi.reduce((s,v,k)=>s*(v-lo[k]+1),1)>10000)return null;for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++)keys.push(`${x},${y},${z}`);return keys;}
  function removeFace(i){for(const key of faceCells.get(i)??[]){const set=buckets.get(key);set.delete(i);if(!set.size)buckets.delete(key);}faceCells.delete(i);boxes.delete(i);}
  function addFace(i){const box=bounds(faces[i].map(v=>vertices[v])),keys=cells(box);requireThat(keys,'Repair face spans too many collision cells.');boxes.set(i,box);faceCells.set(i,keys);for(const key of keys){const set=buckets.get(key)??new Set();set.add(i);buckets.set(key,set);}}
  for(let i=0;i<faces.length;i++)addFace(i);
  const heap=new MinHeap();let faceCount=faces.length,collapses=0,rejected=0;
  function candidate(a,b){
    if(a>b)[a,b]=[b,a];const q=quadrics[a].map((v,k)=>v+quadrics[b][k]);
    const evaluate=([x,y,z])=>q[0]*x*x+2*q[1]*x*y+2*q[2]*x*z+2*q[3]*x+q[4]*y*y+2*q[5]*y*z+2*q[6]*y+q[7]*z*z+2*q[8]*z+q[9];
    const positions=[vertices[a],vertices[b],vertices[a].map((v,k)=>(v+vertices[b][k])/2)];
    // Symmetric 3x3 inverse. Singular planar quadrics use endpoints/midpoint.
    const [A,B,C,D,E,F,G,H,I]=[q[0],q[1],q[2],q[1],q[4],q[5],q[2],q[5],q[7]],det=A*(E*I-F*H)-B*(D*I-F*G)+C*(D*H-E*G);
    if(Math.abs(det)>1e-10){const [x,y,z]=[-q[3],-q[6],-q[8]];const p=[((E*I-F*H)*x+(C*H-B*I)*y+(B*F-C*E)*z)/det,((F*G-D*I)*x+(A*I-C*G)*y+(C*D-A*F)*z)/det,((D*H-E*G)*x+(B*G-A*H)*y+(A*E-B*D)*z)/det];
      const length=Math.hypot(...sub(vertices[a],vertices[b]));if(p.every(Number.isFinite)&&Math.min(...positions.slice(0,2).map(v=>Math.hypot(...sub(p,v))))<=2*length)positions.push(p);
    }
    let point=positions[0],cost=evaluate(point);for(const p of positions.slice(1)){const value=evaluate(p);if(value<cost){cost=value;point=p;}}
    return {a,b,point:[...point],cost:Math.max(0,cost),va:versions[a],vb:versions[b]};
  }
  for(let a=0;a<vertices.length;a++)for(const b of neighbors(a))if(a<b)heap.push(candidate(a,b));
  progress({stage:'simplify',triangles:faceCount,targetTriangles,maxPlaneErrorMm});
  while(faceCount>targetTriangles&&heap.items.length){
    const item=heap.pop(),{a,b,point,va,vb}=item;if(!alive[a]||!alive[b]||va!==versions[a]||vb!==versions[b])continue;
    if(item.cost>maxPlaneErrorMm**2)break;
    const na=neighbors(a),nb=neighbors(b);if(!na.has(b))continue;
    const common=[...na].filter(v=>nb.has(v)),shared=[...incident[a]].filter(i=>incident[b].has(i));
    if(common.length!==2||shared.length!==2){rejected++;continue;}
    const affected=new Set([...incident[a],...incident[b]]),keys=new Set();let valid=true;
    for(const i of affected){const t=faces[i];if(t.includes(a)&&t.includes(b))continue;
      // Common-neighbor counts alone miss tetrahedron collapse to two duplicate
      // faces. Check the face part of the link condition as well.
      const key=t.map(v=>v===b?a:v).sort((a,b)=>a-b).join(':');if(keys.has(key)){valid=false;break;}keys.add(key);
      const before=normal(t),p=t.map(v=>v===a||v===b?point:vertices[v]),after=cross(sub(p[1],p[0]),sub(p[2],p[0]));if(Math.hypot(...after)<=1e-10||dot(before,after)<=0.1*Math.hypot(...before)*Math.hypot(...after)){valid=false;break;}}
    if(!valid){rejected++;continue;}
    const proposed=[];
    for(const i of affected){const old=faces[i];if(old.includes(a)&&old.includes(b))continue;const t=old.map(v=>v===b?a:v),p=t.map(v=>v===a?point:vertices[v]),box=bounds(p),keys=cells(box);if(!keys){valid=false;break;}const candidates=new Set(keys.flatMap(key=>[...(buckets.get(key)??[])]));
      for(const j of candidates){if(affected.has(j))continue;const other=boxes.get(j);if([0,1,2].some(k=>box.min[k]>other.max[k]+1e-9||box.max[k]<other.min[k]-1e-9))continue;const f=faces[j],shared=t.filter(v=>f.includes(v)).map(v=>vertices[v]);if(trianglesContact(p,f.map(v=>vertices[v]),shared)){valid=false;break;}}
      if(!valid)break;for(const prior of proposed){const shared=t.filter(v=>prior.t.includes(v)).map(v=>v===a?point:vertices[v]);if(trianglesContact(p,prior.p,shared)){valid=false;break;}}if(!valid)break;proposed.push({t,p});
    }
    if(!valid){rejected++;continue;}
    for(const i of affected){removeFace(i);const t=faces[i];for(const v of t)incident[v].delete(i);if(t.includes(a)&&t.includes(b)){faces[i]=null;faceCount--;}else{faces[i]=t.map(v=>v===b?a:v);for(const v of faces[i])incident[v].add(i);}}
    vertices[a]=point;alive[b]=0;for(let k=0;k<10;k++)quadrics[a][k]+=quadrics[b][k];
    for(const i of affected)if(faces[i])addFace(i);
    // Only these two vertices changed their position/quadric. Other candidates
    // retain their costs; link and collision conditions are checked when popped.
    versions[a]++;versions[b]++;
    for(const n of neighbors(a))heap.push(candidate(a,n));
    collapses++;
    if(collapses%10000===0&&heap.items.length>6*faceCount){heap.items=[];for(let v=0;v<vertices.length;v++)if(alive[v])for(const n of neighbors(v))if(v<n)heap.push(candidate(v,n));}
    if(collapses%20000===0)progress({stage:'simplify-progress',triangles:faceCount,collapses});
  }
  const mesh=compactMesh(vertices,faces.filter(Boolean));
  return {...mesh,report:{...input.report,simplification:{method:'quadric-edge-collapse/1',targetTriangles,maxPlaneErrorMm,triangles:faceCount,collapses,rejectedLocalCollapses:rejected,targetReached:faceCount<=targetTriangles,limitation:'Quadric plane residual is not a certified distance to the source; final mesh validation is required.'}}};
}
