// Indexed triangle backend. No CAD kernel or display proxy participates in slicing.
import { requireThat, cross } from './tolerance.mjs';
import { orientLoops } from './shell.mjs';
import { cleanPlanarLoop } from './polyline.mjs';
import {createHash} from 'node:crypto';
import {checkMeshCapacity,meshAllocation} from './mesh-capacity.mjs';
import {meshTopology,meshEdgeMap} from './mesh-topology.mjs';
import {triangleBVH} from './triangle-bvh.mjs';
import {decodeSTLBuffer} from './stl-decoder.mjs';

const sub = (a,b) => a.map((v,i)=>v-b[i]);
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const edgeKey = (a,b) => a<b ? `${a}:${b}` : `${b}:${a}`;

// Geometry is validated at ingestion. Reusing identical coordinates and indices
// must not rerun topology/intersection checks at every plan/preview boundary.
// Exact content keys also detect mutations of previously supplied arrays. Keep
// derived data private and copy it on return; callers cannot poison the cache.
const validatedMeshes=new Map();

// Route rejected mesh input to its recovery manual at the existing checks.
// Successful loads retain the same validation and cache path.
function requireMeshInput(condition,message) {
  if(!condition)throw meshInputError(message);
}
export function meshInputError(message){return new Error(`${message} Import through Studio or the normal import tool to attempt repair; malformed input needs a corrected source.`);}

function meshResult(vertices,triangles,name,derived){
  const mesh={kind:'triangle-mesh',name,vertices,triangles,
    bounds:{min:[...derived.bounds.min],max:[...derived.bounds.max]}};
  // Planar sectioning needs neither field. Copy private derived data only when
  // a caller uses it; each makeMesh result owns its independent mutable copy.
  for(const key of ['normals','edges']){
    let copied=false,value;
    Object.defineProperty(mesh,key,{enumerable:true,configurable:true,
      get(){if(!copied){value=key==='edges'?meshEdgeMap(derived.edgeData):Array.from({length:derived.normals.length/3},(_,i)=>Array.from(derived.normals.subarray(i*3,i*3+3)));copied=true;}return value;},
      set(next){Object.defineProperty(this,key,{value:next,writable:true,enumerable:true,configurable:true});}});
  }
  return mesh;
}

function meshIdentity(vertices,triangles){
  const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(65536);let offset=0;
  const put=v=>{if(offset===buffer.length){hash.update(buffer);offset=0;}buffer.writeDoubleLE(v,offset);offset+=8;};
  put(vertices.length);put(triangles.length);for(const p of vertices)for(const v of p)put(v);for(const t of triangles)for(const v of t)put(v);hash.update(buffer.subarray(0,offset));return hash.digest('hex');
}
export function makeMesh(vertices,triangles,{name='mesh'}={}){
  const input=validateMeshInput(vertices,triangles);
  const identity=meshIdentity(input.vertices,input.triangles);
  if(validatedMeshes.has(identity))return meshResult(vertices,triangles,name,validatedMeshes.get(identity));
  const faceGeometry=meshFaceGeometry(input);
  const derived=validateMeshGeometry(input,faceGeometry);
  const retained=retainValidatedMesh(identity,derived);
  return meshResult(vertices,triangles,name,retained);
}

function validateMeshInput(vertices,triangles){
  requireMeshInput(Array.isArray(vertices)&&vertices.length>=4,'Mesh needs at least 4 vertices.');
  requireMeshInput(vertices.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)),'Mesh vertices must be finite XYZ millimeters.');
  requireMeshInput(Array.isArray(triangles)&&triangles.length>=4,'Mesh needs at least 4 triangles.');
  checkMeshCapacity(vertices.length,triangles.length);
  for(const t of triangles)requireMeshInput(Array.isArray(t)&&t.length===3&&t.every(v=>Number.isInteger(v)&&v>=0&&v<vertices.length)&&t[0]!==t[1]&&t[1]!==t[2]&&t[0]!==t[2],'Invalid mesh triangle indices.');
  return {vertices,triangles};
}

function meshFaceGeometry({vertices,triangles}){
  const counts=[vertices.length,triangles.length];
  const normals=meshAllocation('Mesh face normals',...counts,()=>new Float64Array(triangles.length*3)),bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  for(const p of vertices)for(let k=0;k<3;k++){bounds.min[k]=Math.min(bounds.min[k],p[k]);bounds.max[k]=Math.max(bounds.max[k],p[k]);}
  for(let i=0;i<triangles.length;i++){const t=triangles[i],n=cross(sub(vertices[t[1]],vertices[t[0]]),sub(vertices[t[2]],vertices[t[0]])),length=Math.hypot(...n);requireMeshInput(length>1e-10,'Degenerate mesh triangle.');for(let k=0;k<3;k++)normals[i*3+k]=n[k]/length;}
  return {normals,bounds};
}

function validateMeshGeometry({vertices,triangles},{normals,bounds}){
  const counts=[vertices.length,triangles.length];
  const edgeData=meshAllocation('Mesh edge topology',...counts,()=>meshTopology(vertices,triangles,requireMeshInput));
  meshAllocation('Mesh intersection index',...counts,()=>rejectIntersections(vertices,triangles,normals));
  return {normals,edgeData,bounds};
}

function retainValidatedMesh(identity,derived){
  // Keep at most 32 MiB of compact derived data, never a full JSON mesh key.
  const bytes=derived.normals.byteLength+derived.edgeData.byteLength;
  if(bytes<=32*1048576){while(validatedMeshes.size&&[...validatedMeshes.values()].reduce((sum,v)=>sum+v.normals.byteLength+v.edgeData.byteLength,bytes)>32*1048576)validatedMeshes.delete(validatedMeshes.keys().next().value);validatedMeshes.set(identity,derived);if(validatedMeshes.size>4)validatedMeshes.delete(validatedMeshes.keys().next().value);}
  return derived;
}
function rejectIntersections(vertices,triangles,normals){
  const tree=triangleBVH(vertices,triangles);
  for(let i=0;i<triangles.length;i++){const ta=triangles[i],pa=ta.map(v=>vertices[v]),min=[0,1,2].map(k=>Math.min(pa[0][k],pa[1][k],pa[2][k])),max=[0,1,2].map(k=>Math.max(pa[0][k],pa[1][k],pa[2][k]));
    const inspectCandidate=j=>{if(j<=i)return;const tb=triangles[j];if(ta.some(v=>tb.includes(v)))return;
      const pb=tb.map(v=>vertices[v]);if([0,1,2].some(k=>Math.max(pb[0][k],pb[1][k],pb[2][k])<min[k]-1e-9||Math.min(pb[0][k],pb[1][k],pb[2][k])>max[k]+1e-9))return;
      if(!separatedTriangles(pa,pb,normals.subarray(i*3,i*3+3),normals.subarray(j*3,j*3+3))){try{requireMeshInput(false,'Intersecting or touching nonadjacent mesh triangles; repair the source before importing.');}catch(error){error.meshDiagnostic={kind:'triangle-intersection',indices:[i,j],points:[pa,pb]};throw error;}}
    };
    tree.query(min,max,inspectCandidate);
  }
}

// Shared closed-triangle separation predicate.
export function separatedTriangles(pa,pb,normalA,normalB) {
  const ea=pa.map((p,k)=>sub(pa[(k+1)%3],p)),eb=pb.map((p,k)=>sub(pb[(k+1)%3],p));
  const normal=edges=>{const n=cross(edges[0],edges[1]),length=Math.hypot(...n);return n.map(v=>v/length);};
  const na=normalA??normal(ea),nb=normalB??normal(eb);
  const axes=[na,nb,...ea.flatMap(e=>eb.map(f=>cross(e,f))),...ea.map(e=>cross(na,e)),...eb.map(e=>cross(nb,e))];
  return axes.some(axis=>{
    const length=Math.hypot(...axis);if(length<1e-12)return false;
    const unit=axis.map(v=>v/length),aa=pa.map(p=>dot(p,unit)),bb=pb.map(p=>dot(p,unit));
    return Math.max(...aa)<Math.min(...bb)-1e-9||Math.max(...bb)<Math.min(...aa)-1e-9;
  });
}

export function translateMesh(mesh,dx,dy,dz=0) {
  // Preserve lazy derived fields and all other metadata without invoking
  // getters. As before, translated meshes share already-owned derived values.
  const data=value=>({value,writable:true,enumerable:true,configurable:true});
  const descriptors=Object.getOwnPropertyDescriptors(mesh);
  for(const descriptor of Object.values(descriptors)){
    descriptor.configurable=true;if('value' in descriptor)descriptor.writable=true;
  }
  return Object.defineProperties({}, {...descriptors,
    vertices:data(mesh.vertices.map(p=>[p[0]+dx,p[1]+dy,p[2]+dz])),
    bounds:data({min:mesh.bounds.min.map((v,i)=>v+[dx,dy,dz][i]),max:mesh.bounds.max.map((v,i)=>v+[dx,dy,dz][i])})});
}

// Mesh sections in a slice frame: three orthonormal axes [x, y, n]. The mesh is
// re-expressed as [x·p, y·p, n·p], so the plane n·p = h cuts it as the
// horizontal plane z = h cuts that copy and the loops come out in the frame's
// (x, y). The identity frame keeps the mesh's own coordinates. With search
// data (sorted vertex heights and a height-interval tree storing each triangle
// once, tall ones included) repeated cuts visit only the triangles they cross;
// a one-off cut scans every triangle instead of paying for the tree.
export function meshSectionIndex(mesh,axes,{search=true}={}) {
  const identity=axes.every((axis,i)=>axis.every((v,k)=>v===(i===k?1:0)));
  const vertices=identity?mesh.vertices:mesh.vertices.map(p=>[dot(p,axes[0]),dot(p,axes[1]),dot(p,axes[2])]);
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  if(identity){bounds.min=[...mesh.bounds.min];bounds.max=[...mesh.bounds.max];}
  else for(const p of vertices)for(let k=0;k<3;k++){bounds.min[k]=Math.min(bounds.min[k],p[k]);bounds.max[k]=Math.max(bounds.max[k],p[k]);}
  const framed={kind:'mesh-section-index',axes,vertices,triangles:mesh.triangles,bounds};
  if(!search)return {...framed,heights:null,tree:null};
  const heights=vertices.map(p=>p[2]).sort((a,b)=>a-b);
  const ranges=mesh.triangles.map((t,i)=>({i,
    min:Math.min(vertices[t[0]][2],vertices[t[1]][2],vertices[t[2]][2]),
    max:Math.max(vertices[t[0]][2],vertices[t[1]][2],vertices[t[2]][2])}));
  return {...framed,heights,tree:heightTree(ranges)};
}
function heightTree(items) {
  let min=Infinity,max=-Infinity;
  for(const item of items){min=Math.min(min,item.min);max=Math.max(max,item.max);}
  if(items.length<=16)return {min,max,items};
  items.sort((a,b)=>(a.min/2+a.max/2)-(b.min/2+b.max/2)||a.i-b.i);
  const middle=Math.floor(items.length/2);
  return {min,max,left:heightTree(items.slice(0,middle)),right:heightTree(items.slice(middle))};
}
function nearVertex(index,cut) {
  if(!index.heights)return index.vertices.some(p=>Math.abs(p[2]-cut)<1e-10);
  const heights=index.heights;let lo=0,hi=heights.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(heights[mid]<cut)lo=mid+1;else hi=mid;}
  return (lo<heights.length&&Math.abs(heights[lo]-cut)<1e-10)||(lo>0&&Math.abs(heights[lo-1]-cut)<1e-10);
}
// Triangles strictly spanning the cut, in index order: contour traversal and
// the shared-edge record below depend on that order.
function trianglesAt(index,cut) {
  if(!index.tree)return index.triangles;
  const found=[],pending=[index.tree];
  while(pending.length){
    const node=pending.pop();
    if(cut<=node.min||cut>=node.max)continue;
    if(node.items){for(const item of node.items)if(cut>item.min&&cut<item.max)found.push(item.i);}
    else pending.push(node.left,node.right);
  }
  return found.sort((a,b)=>a-b).map(i=>index.triangles[i]);
}

function meshContourEdges(vertices,cut,triangles){
  const edges=new Map(),graph=new Map();
  for(const t of triangles){
    const hits=[];
    for(let k=0;k<3;k++){
      const a=t[k],b=t[(k+1)%3],p=vertices[a],q=vertices[b];
      if((p[2]>cut)===(q[2]>cut))continue;
      const key=edgeKey(a,b);
      // Keep the last triangle's edge orientation and interpolation order.
      edges.set(key,[p,q]);hits.push(key);
    }
    if(hits.length===2)for(let k=0;k<2;k++){const list=graph.get(hits[k])??[];list.push(hits[1-k]);graph.set(hits[k],list);}
  }
  requireThat([...graph.values()].every(n=>n.length===2),'Mesh section is not a closed set of contours.');
  const remaining=new Set(graph.keys()),contours=[];
  while(remaining.size){
    const start=remaining.values().next().value,loop=[];let previous=null,current=start;
    do {
      requireThat(remaining.delete(current),'Ambiguous mesh contour.');loop.push(edges.get(current));
      const next=graph.get(current).find(k=>k!==previous);previous=current;current=next;
    } while(current!==start);
    contours.push(loop);
  }
  return contours;
}

// The section at frame height h: loops in the frame's (x, y), outer loops
// counterclockwise and holes clockwise, and the nudge that moved the cut off
// a vertex.
export function sectionMeshIndex(index,h) {
  requireThat(Number.isFinite(h),'Section height must be finite.');
  const [min,max]=[index.bounds.min[2],index.bounds.max[2]];
  // Layer-grid arithmetic can land a few floating-point ulps beyond an exact
  // boundary (0.2 + 29 * 0.2 > 6). Keep that numerical error distinct from the
  // geometric nudge below; genuinely outside layers must still be empty.
  const roundoff=16*Number.EPSILON*Math.max(1,Math.abs(h),Math.abs(min),Math.abs(max));
  if(h<min-roundoff||h>max+roundoff)return {loops:[],nudgedByMm:0};
  // Move a cut off vertices/edges; prefer the interior side at the top bound.
  for(const nudge of [0,-1e-6,1e-6,-1e-5,1e-5]) {
    const cut=h+nudge;
    if(cut<=min||cut>=max||nearVertex(index,cut))continue;
    const loops=[];
    for(const edges of meshContourEdges(index.vertices,cut,trianglesAt(index,cut))){
      const loop=edges.map(([p,q])=>{const f=(cut-p[2])/(q[2]-p[2]);return [p[0]+f*(q[0]-p[0]),p[1]+f*(q[1]-p[1])];});
      // Remove collinear triangle seams before offsetting regions.
      const clean=cleanPlanarLoop(loop);
      requireThat(clean.length>=3,'Mesh section collapsed below tolerance.');loops.push(clean);
    }
    return {loops:orientLoops(loops),nudgedByMm:nudge};
  }
  throw new Error('Mesh cut is ambiguous within section tolerance.');
}

// Every non-vertical triangle the vertical line through (x, y) crosses.
export function meshCrossingsAt(mesh,x,y) {
  const crossings=[];
  for(const [i,t] of mesh.triangles.entries()) {
    const [a,b,c]=t.map(k=>mesh.vertices[k]);
    const det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
    if(Math.abs(det)<1e-12)continue;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/det;
    const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/det,w=1-u-v;
    if(Math.min(u,v,w)<-1e-9)continue;
    const n=mesh.normals[i],normal=n[2]<0?n.map(v=>-v):n;
    crossings.push({zMm:u*a[2]+v*b[2]+w*c[2],normal,slopeDeg:Math.acos(Math.min(1,normal[2]))*180/Math.PI,feature:`triangle:${i}`,patch:`triangle:${i}`});
  }
  return crossings;
}

export function meshTopAt(mesh,x,y) {
  let best=null;
  for(const [i,t] of mesh.triangles.entries()) {
    const [a,b,c]=t.map(k=>mesh.vertices[k]);
    const det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
    if(Math.abs(det)<1e-12)continue;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/det;
    const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/det,w=1-u-v;
    if(Math.min(u,v,w)<-1e-9)continue;
    const zMm=u*a[2]+v*b[2]+w*c[2],n=mesh.normals[i],normal=n[2]<0?n.map(v=>-v):n;
    const slopeDeg=Math.acos(Math.min(1,normal[2]))*180/Math.PI;
    if(!best||zMm>best.zMm+1e-8||(Math.abs(zMm-best.zMm)<=1e-8&&slopeDeg>best.slopeDeg))best={zMm,normal,slopeDeg,feature:`triangle:${i}`,patch:`triangle:${i}`};
  }
  return best;
}

// STL has no units. Exact duplicate coordinates are indexed without moving them.
// Decoding is also used by explicit repair. Ordinary import still validates below.
export function decodeSTL(bytes,{units,scale=1}={}) {
  try{return decodeSTLBuffer(bytes,{units,scale});}
  catch(error){
    if(!error.code&&error.name==='Error'&&!error.message.startsWith('STL import needs')&&!error.message.includes('capacity'))
      throw meshInputError(error.message);
    throw error;
  }
}

export function parseSTL(bytes,options) {
  const mesh=decodeSTL(bytes,options);
  makeMesh(mesh.vertices,mesh.triangles);
  return mesh;
}
