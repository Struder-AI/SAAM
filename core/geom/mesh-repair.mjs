// Exact triangle cleanup and output validation shared by import and native repair.
import {decodeSTL,makeMesh,parseSTL,triangleNormal} from './mesh.mjs';
import {checkAdjacentContacts} from './mesh-spatial.mjs';
import {subtract as sub,cross,dot,requireThat} from './tolerance.mjs';
import {checkMeshCapacity} from './mesh-capacity.mjs';
import {NUMERIC_MM} from '../dimensions.mjs';

export function cleanTriangleSoup(input,{mergeToleranceMm=0}={}) {
  requireThat(Array.isArray(input.vertices)&&Array.isArray(input.triangles),'Repair needs vertices and triangles.');
  requireThat(Number.isFinite(mergeToleranceMm)&&mergeToleranceMm>=0,'mergeToleranceMm must be a finite nonnegative distance in millimetres.');
  checkMeshCapacity(input.vertices.length,input.triangles.length);
  const {vertices,mapping,merge}=indexRepairVertices(input.vertices,mergeToleranceMm);
  // Coincident triangles keep one copy facing their net orientation; an
  // opposed pair is a zero-thickness wall and cancels, so the surface stays closed.
  const kept=[],groups=new Map();let degenerate=0;
  for(const face of input.triangles){
    requireThat(Array.isArray(face)&&face.length===3&&face.every(i=>Number.isInteger(i)&&i>=0&&i<mapping.length),'Invalid repair triangle indices.');
    const t=face.map(i=>mapping[i]);
    if(new Set(t).size!==3||!triangleNormal(...t.map(i=>vertices[i]))){degenerate++;continue;}
    const s=[...t].sort((a,b)=>a-b),key=s.join(','),sign=(s.indexOf(t[1])-s.indexOf(t[0])+3)%3===1?1:-1;
    const group=groups.get(key);if(group)group.net+=sign;else{groups.set(key,{triangle:t,sign,net:sign});kept.push(key);}
  }
  const triangles=[];
  for(const key of kept){const {triangle:t,sign,net}=groups.get(key);if(net)triangles.push(Math.sign(net)===sign?t:[t[0],t[2],t[1]]);}
  const duplicates=input.triangles.length-degenerate-triangles.length;
  requireThat(triangles.length>=4,'Repair has no usable solid surface.');
  const stitching=degenerate?stitchCollapsedEdges(vertices,triangles):{triangles,stitchedEdges:0,addedTriangles:0};
  const compact=compactMesh(vertices,stitching.triangles);
  return {...compact,...(mergeToleranceMm>0?{merge}:{}),removed:{degenerate,duplicates,unusedOrDuplicateVertices:input.vertices.length-compact.vertices.length},
    stitching:{edges:stitching.stitchedEdges,addedTriangles:stitching.addedTriangles,toleranceMm:NUMERIC_MM}};
}

// Retained representatives never move: every snap is measured directly, not
// through a chain of neighbours. Repeated coordinates reuse the same decision.
function indexRepairVertices(points,toleranceMm){
  const magnitude=[0,0,0];
  for(const p of points){
    requireThat(Array.isArray(p)&&p.length===3&&p.every(Number.isFinite),'Repair coordinates must be finite XYZ.');
    for(let k=0;k<3;k++)magnitude[k]=Math.max(magnitude[k],Math.abs(p[k]));
  }
  // Power-of-two cells avoid rounding the tolerance into a coarser snap rule.
  // Widen only the search cells for extreme coordinate/tolerance ratios, keeping
  // integer neighbours representable; actual Euclidean distance still decides.
  const width=magnitude.map(m=>Math.min(Number.MAX_VALUE,2**Math.max(Math.ceil(Math.log2(toleranceMm)),Math.ceil(Math.log2(m||Number.MIN_VALUE))-48)));
  const vertices=[],mapping=[],exact=new Map(),cells=new Map();
  const merge={toleranceMm,method:'nearest-retained-vertex/1',mergedVertices:0,movedVertices:0,maxDisplacementMm:0};
  for(const point of points){
    const key=point.join(','),known=exact.get(key);
    const nearest={index:known??-1,distance:toleranceMm};
    const cell=toleranceMm>0?point.map((v,k)=>Math.floor(v/width[k])):null;
    if(known===undefined&&cell){
      for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
        const candidates=cells.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','));
        for(const index of candidates??[]){
          const p=vertices[index],distance=Math.hypot(point[0]-p[0],point[1]-p[1],point[2]-p[2]);
          if(distance<=toleranceMm&&(nearest.index<0||distance<nearest.distance||distance===nearest.distance&&index<nearest.index)){
            nearest.index=index;nearest.distance=distance;
          }
        }
      }
    }
    if(nearest.index<0){
      nearest.index=vertices.length;vertices.push([...point]);
      if(cell){const name=cell.join(','),bucket=cells.get(name)??[];bucket.push(nearest.index);cells.set(name,bucket);}
    }else{
      merge.mergedVertices++;
      const p=vertices[nearest.index],distance=Math.hypot(point[0]-p[0],point[1]-p[1],point[2]-p[2]);
      if(distance>0)merge.movedVertices++;
      merge.maxDisplacementMm=Math.max(merge.maxDisplacementMm,distance);
    }
    exact.set(key,nearest.index);mapping.push(nearest.index);
  }
  return {vertices,mapping,merge};
}

// Removing a collinear face can expose A--C opposite C--B--A. Split the
// surviving A--C face at B, preserving its orientation and existing coordinates.
// Only stitch a complete, oppositely directed boundary chain: never cap a hole
// or guess how to join branching/nonmanifold boundaries.
function stitchCollapsedEdges(vertices,triangles) {
  const key=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`,edges=new Map();
  triangles.forEach((face,i)=>face.forEach((a,k)=>{
    const b=face[(k+1)%3],id=key(a,b),entries=edges.get(id)??[];
    entries.push({a,b,face:i});edges.set(id,entries);
  }));
  const boundary=[...edges.values()].filter(e=>e.length===1).map(e=>e[0]);
  const outgoing=new Map();
  for(const e of boundary){const list=outgoing.get(e.a)??[];list.push(e);outgoing.set(e.a,list);}
  const splits=new Map();let stitchedEdges=0,addedTriangles=0;
  for(const edge of boundary){
    const a=vertices[edge.a],b=vertices[edge.b],ab=sub(b,a),length=Math.hypot(...ab);
    if(length<=NUMERIC_MM)continue;
    const direction=ab.map(v=>v/length),chain=[edge.b];let at=edge.b,previous=length;
    const visited=new Set(chain);
    while(at!==edge.a){
      const next=(outgoing.get(at)??[]).filter(e=>{
        if(e===edge||visited.has(e.b))return false;
        const offset=sub(vertices[e.b],a),position=dot(offset,direction);
        return position>=-NUMERIC_MM&&position<previous&&Math.hypot(...cross(offset,direction))<=NUMERIC_MM;
      });
      if(next.length!==1)break;
      at=next[0].b;chain.push(at);visited.add(at);previous=dot(sub(vertices[at],a),direction);
    }
    if(at!==edge.a||chain.length<=2)continue;
    const points=chain.reverse(),list=splits.get(edge.face)??[];
    list.push({...edge,points});splits.set(edge.face,list);stitchedEdges++;addedTriangles+=points.length-2;
  }
  if(!stitchedEdges)return {triangles,stitchedEdges,addedTriangles};
  const output=triangles.flatMap((face,i)=>{
    let pieces=[face];
    for(const {a,b,points} of splits.get(i)??[]){
      const index=pieces.findIndex(t=>t.some((v,k)=>v===a&&t[(k+1)%3]===b));
      requireThat(index>=0,'Cannot resolve collapsed-edge stitching adjacency.');
      const t=pieces[index],c=t.find(v=>v!==a&&v!==b);
      pieces.splice(index,1,...points.slice(1).map((v,k)=>[points[k],v,c]));
    }
    return pieces;
  });
  return {triangles:output,stitchedEdges,addedTriangles};
}

export function compactMesh(vertices,triangles) {
  const used=new Map(),points=[];
  return {vertices:points,triangles:triangles.map(t=>t.map(i=>{if(!used.has(i)){used.set(i,points.length);points.push(vertices[i]);}return used.get(i);}))};
}

// Decimal STL preserves JS coordinates through the shared decoder. Float32 STL
// can create new contacts when newly reconstructed vertices are rounded.
export function encodeRepairSTL(mesh) {
  return Buffer.concat([...encodeRepairSTLChunks(mesh)].map(chunk=>Buffer.from(chunk)));
}

export function* encodeRepairSTLChunks(mesh){
  let chunk='solid saam_repaired\n';
  for(const t of mesh.triangles){const n=triangleNormal(...t.map(i=>mesh.vertices[i]));requireThat(n,'Repair produced a degenerate triangle.');chunk+=`facet normal ${n.join(' ')}\nouter loop\n`+t.map(i=>`vertex ${mesh.vertices[i].join(' ')}\n`).join('')+'endloop\nendfacet\n';if(chunk.length>=65536){yield chunk;chunk='';}}
  yield chunk+'endsolid saam_repaired\n';
}

export function validateRepair(mesh) {
  makeMesh(mesh.vertices,mesh.triangles);
  checkAdjacentContacts(mesh);
  const bytes=encodeRepairSTL(mesh);parseSTL(bytes,{units:'mm'});return bytes;
}

export {decodeSTL};
