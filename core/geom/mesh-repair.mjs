// Exact triangle cleanup and output validation shared by import and native repair.
import {decodeSTL,makeMesh,parseSTL} from './mesh.mjs';
import {checkAdjacentContacts} from './mesh-spatial.mjs';
import {subtract as sub,cross,dot,requireThat} from './tolerance.mjs';
import {checkMeshCapacity} from './mesh-capacity.mjs';

export function cleanTriangleSoup(input) {
  requireThat(Array.isArray(input.vertices)&&Array.isArray(input.triangles),'Repair needs vertices and triangles.');
  checkMeshCapacity(input.vertices.length,input.triangles.length);
  const vertices=[],lookup=new Map(),mapping=input.vertices.map(p=>{
    requireThat(Array.isArray(p)&&p.length===3&&p.every(Number.isFinite),'Repair coordinates must be finite XYZ.');
    const key=p.join(',');if(!lookup.has(key)){lookup.set(key,vertices.length);vertices.push([...p]);}return lookup.get(key);
  });
  const triangles=[],seen=new Set();let degenerate=0,duplicates=0;
  for(const face of input.triangles){
    requireThat(Array.isArray(face)&&face.length===3&&face.every(i=>Number.isInteger(i)&&i>=0&&i<mapping.length),'Invalid repair triangle indices.');
    const t=face.map(i=>mapping[i]),n=cross(sub(vertices[t[1]],vertices[t[0]]),sub(vertices[t[2]],vertices[t[0]]));
    if(new Set(t).size!==3||Math.hypot(...n)<=1e-10){degenerate++;continue;}
    const key=[...t].sort((a,b)=>a-b).join(',');if(seen.has(key)){duplicates++;continue;}seen.add(key);triangles.push(t);
  }
  requireThat(triangles.length>=4,'Repair has no usable solid surface.');
  const stitching=degenerate?stitchCollapsedEdges(vertices,triangles):{triangles,stitchedEdges:0,addedTriangles:0};
  const compact=compactMesh(vertices,stitching.triangles);
  return {...compact,removed:{degenerate,duplicates,unusedOrDuplicateVertices:input.vertices.length-compact.vertices.length},
    stitching:{edges:stitching.stitchedEdges,addedTriangles:stitching.addedTriangles,toleranceMm:1e-9}};
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
    if(length<=1e-9)continue;
    const direction=ab.map(v=>v/length),chain=[edge.b];let at=edge.b,previous=length;
    const visited=new Set(chain);
    while(at!==edge.a){
      const next=(outgoing.get(at)??[]).filter(e=>{
        if(e===edge||visited.has(e.b))return false;
        const offset=sub(vertices[e.b],a),position=dot(offset,direction);
        return position>=-1e-9&&position<previous&&Math.hypot(...cross(offset,direction))<=1e-9;
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
  for(const t of mesh.triangles){const [a,b,c]=t.map(i=>mesh.vertices[i]),n=cross(sub(b,a),sub(c,a)),length=Math.hypot(...n);requireThat(length>1e-10,'Repair produced a degenerate triangle.');chunk+=`facet normal ${n.map(v=>v/length).join(' ')}\nouter loop\n`+t.map(i=>`vertex ${mesh.vertices[i].join(' ')}\n`).join('')+'endloop\nendfacet\n';if(chunk.length>=65536){yield chunk;chunk='';}}
  yield chunk+'endsolid saam_repaired\n';
}

export function validateRepair(mesh) {
  makeMesh(mesh.vertices,mesh.triangles);
  checkAdjacentContacts(mesh);
  const bytes=encodeRepairSTL(mesh);parseSTL(bytes,{units:'mm'});return bytes;
}

export {decodeSTL};
