// Exact triangle cleanup, solid repair and output validation for explicit repair.
import {decodeSTL,makeMesh,parseSTL,triangleNormal} from './mesh.mjs';
import {reconstructSolid} from './mesh-autorefine.mjs';
import {checkMeshTopology} from './mesh-topology.mjs';
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

// Makes a cleaned soup (vertex indices are exact coordinates) a closed outward
// solid. Faces are oriented consistently across edges with exactly two faces, each
// connected component keeping the orientation of most of its area; every edge must
// then balance (as many faces along it as against it), and the whole is reversed
// when it encloses negative volume. A surface that crosses itself is replaced by
// the boundary of its solid (mesh-autorefine.mjs), which must be a manifold.
export function repairSolid(mesh,{progress=()=>{}}={}){
  progress({stage:'orient'});
  const xyz=Float64Array.from(mesh.vertices.flat()),tri=Int32Array.from(mesh.triangles.flat()),n=tri.length/3;
  const lo=new Int32Array(3*n),hi=new Int32Array(3*n),edges=new Uint32Array(3*n),next=e=>3*((e/3)|0)+(e%3+1)%3;
  for(let e=0;e<3*n;e++){lo[e]=Math.min(tri[e],tri[next(e)]);hi[e]=Math.max(tri[e],tri[next(e)]);edges[e]=e;}
  edges.sort((x,y)=>lo[x]-lo[y]||hi[x]-hi[y]||x-y);
  // Edge e's twin across a two-face edge, else -1.
  const twin=new Int32Array(3*n).fill(-1);
  for(let i=0;i<3*n;){let j=i+1;while(j<3*n&&lo[edges[j]]===lo[edges[i]]&&hi[edges[j]]===hi[edges[i]])j++;if(j-i===2){twin[edges[i]]=edges[i+1];twin[edges[i+1]]=edges[i];}i=j;}
  const flip=new Int8Array(n).fill(-1),area=f=>{const p=k=>3*tri[3*f+k],a=p(0),b=p(1),c=p(2),u=[0,1,2].map(k=>xyz[b+k]-xyz[a+k]),v=[0,1,2].map(k=>xyz[c+k]-xyz[a+k]);return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]);};
  const orientation={components:0,flippedFaces:0,reversedOrientation:false};
  for(let seed=0;seed<n;seed++){if(flip[seed]>=0)continue;orientation.components++;flip[seed]=0;const component=[seed],kept=[0,0];
    for(let c=0;c<component.length;c++){const f=component[c];kept[flip[f]]+=area(f);
      for(let k=0;k<3;k++){const t=twin[3*f+k];if(t<0)continue;const g=(t/3)|0;
        // Twins run opposite ways once oriented: g keeps its winding when they already do.
        if(flip[g]<0){flip[g]=flip[f]^(tri[3*f+k]===tri[t]?1:0);component.push(g);}}}
    const reverse=kept[1]>kept[0]?1:0;for(const f of component)flip[f]^=reverse;}
  progress({stage:'boundaries'});
  let open=0,unbalanced=0;
  for(let i=0;i<3*n;){let j=i,balance=0;while(j<3*n&&lo[edges[j]]===lo[edges[i]]&&hi[edges[j]]===hi[edges[i]]){const e=edges[j++];balance+=(tri[e]<tri[next(e)]?1:-1)*(flip[(e/3)|0]?-1:1);}
    if(balance){unbalanced++;if(j-i===1)open++;}i=j;}
  if(open)throw Object.assign(Error(`Open boundaries remain (${open} edges); hole filling requires explicit maxHoleEdges and maxHoleDiameterMm.`),{code:'MESH_REPAIR_FAILED'});
  if(unbalanced)throw Object.assign(Error(`${unbalanced} mesh edges cannot be oriented consistently; no result accepted.`),{code:'MESH_REPAIR_FAILED'});
  for(let f=0;f<n;f++)if(flip[f]){const b=tri[3*f+1];tri[3*f+1]=tri[3*f+2];tri[3*f+2]=b;orientation.flippedFaces++;}
  let volume=0;for(let f=0;f<n;f++){const [a,b,c]=[0,1,2].map(k=>3*tri[3*f+k]);volume+=xyz[a]*(xyz[b+1]*xyz[c+2]-xyz[b+2]*xyz[c+1])+xyz[a+1]*(xyz[b+2]*xyz[c]-xyz[b]*xyz[c+2])+xyz[a+2]*(xyz[b]*xyz[c+1]-xyz[b+1]*xyz[c]);}
  if(volume<0){orientation.reversedOrientation=true;for(let f=0;f<n;f++){const b=tri[3*f+1];tri[3*f+1]=tri[3*f+2];tri[3*f+2]=b;}}
  const solid=reconstructSolid({xyz,tri},{progress}),out=solid??{xyz,tri},vertices=[],triangles=[];
  for(let i=0;i<out.xyz.length;i+=3)vertices.push([out.xyz[i],out.xyz[i+1],out.xyz[i+2]]);
  for(let i=0;i<out.tri.length;i+=3)triangles.push([out.tri[i],out.tri[i+1],out.tri[i+2]]);
  checkMeshTopology(vertices,triangles,ok=>{if(!ok)throw Object.assign(Error('The repaired solid touches itself along an edge or at a vertex, so its boundary is not a manifold; no result accepted.'),{code:'MESH_REPAIR_FAILED'});});
  const summary=pass=>{const {refine,snapGridMm,maxSnapMm,roundingMergedPoints,roundingDroppedTriangles,roundingCancelledPairs,remaining,...counts}=pass;return counts;};
  const reconstruction=solid&&{...summary(solid.passes[0]),snapGridMm:solid.passes[0].snapGridMm,maxSnapMm:Math.max(...solid.passes.map(p=>p.maxSnapMm)),
    ...(solid.passes.length>1?{roundingPasses:solid.passes.slice(1).map(summary)}:{})};
  return {vertices,triangles,report:{method:'saam-solid-repair/1',orientation,selfIntersectionsRepaired:!!solid,reconstruction}};
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
