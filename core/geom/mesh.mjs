// Indexed triangle backend. No CAD kernel or display proxy participates in slicing.
import {pointTriangleDistanceSquared} from './mesh-distance.mjs';
import { requireThat, cross } from './tolerance.mjs';
import { PRINT_RESOLUTION_MM, ROUNDING_MM, ROUNDING_RELATIVE, PROGRAM_STEP_MM } from '../dimensions.mjs';
import { orientLoops, closeOpenChains } from './shell.mjs';
import { cleanPlanarLoop } from './polyline.mjs';
import {createHash} from 'node:crypto';
import {checkMeshCapacity,meshAllocation} from './mesh-capacity.mjs';
import {checkMeshTopology} from './mesh-topology.mjs';
import {overlappingBoxPairs,triangleBoxes,triangleBVH} from './triangle-bvh.mjs';
import {decodeSTLBuffer} from './stl-decoder.mjs';

const sub = (a,b) => a.map((v,i)=>v-b[i]);
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const edgeKey = (a,b) => a<b ? `${a}:${b}` : `${b}:${a}`;

// Mesh tolerances by class (core/README.md#dimensions-and-tolerances). Print resolution
// judges shape where a mesh enters: import merges closer vertices and
// repair closes thinner features (mesh-repair.mjs). The contract
// below certifies with rounding guards: generated surfaces (lettering, blob fields) and
// repair results legitimately keep triangles lower than print resolution and faces
// closer than it that share no vertex (fine tessellation of one sheet, a cut film).
// Rounding guard: a triangle lower than this (smallest height) has no direction, so it
// is degenerate.
const DEGENERATE_HEIGHT_MM = ROUNDING_MM;
// Rounding guard: triangles that share no vertex must be farther apart than this to be
// certified disjoint.
const SEPARATION_MM = ROUNDING_MM;
// Rounding guard: a cross product or 2D determinant of mm edges (square mm) below this
// has no direction to normalize (parallel separating axis, vertical triangle).
export const MESH_DEGENERATE_MM2 = ROUNDING_MM**2;
// Rounding guard: a cut height this close to a vertex height gives contour points too
// close to tell apart, so the section is nudged off it.
const VERTEX_CUT_CLEARANCE_MM = ROUNDING_MM;
// Section nudges clear that guard. None moves a cut by more than one program step, so
// the written program cannot tell the nudged section from the requested one.
const SECTION_NUDGES_MM = [0,-2*ROUNDING_MM,2*ROUNDING_MM,-PROGRAM_STEP_MM,PROGRAM_STEP_MM];
// Rounding guard on barycentric coordinates (dimensionless): a vertical line grazing a
// triangle edge still counts as crossing it.
const BARYCENTRIC_SLACK = ROUNDING_RELATIVE;

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
// `reason` keeps the finding without the import advice for callers that made the mesh.
export function meshInputError(message){return Object.assign(new Error(`${message} Import through Studio or the normal import tool to attempt repair; malformed input needs a corrected source.`),{reason:message});}

function meshResult(vertices,triangles,name,derived){
  // Each record owns its copy of the cached normals.
  return {kind:'triangle-mesh',name,vertices,triangles,empty:triangles.length===0,
    bounds:{min:[...derived.bounds.min],max:[...derived.bounds.max]},faceNormals:derived.normals.slice(),contacts:{count:derived.contacts.count,pairs:derived.contacts.pairs.map(p=>[...p])},topology:{...derived.topology}};
}

// Unit normal of triangle abc, or null when the triangle is degenerate: its smallest
// height is below the rounding guard, where the normal is not determined. Scale-free:
// a long sliver and a micro triangle are judged by the same height.
export function triangleNormal(a,b,c){
  const n=cross(sub(b,a),sub(c,a)),length=Math.hypot(...n);
  return length>0&&length>=DEGENERATE_HEIGHT_MM*Math.sqrt(Math.max(dot(sub(b,a),sub(b,a)),dot(sub(c,b),sub(c,b)),dot(sub(a,c),sub(a,c))))?n.map(v=>v/length):null;
}

// Unit normal of triangle i as validated at ingestion (packed xyz per triangle).
export function meshFaceNormal(mesh,i){
  return Array.from(mesh.faceNormals.subarray(i*3,i*3+3));
}

function meshIdentity(vertices,triangles){
  const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(65536);let offset=0;
  const put=v=>{if(offset===buffer.length){hash.update(buffer);offset=0;}buffer.writeDoubleLE(v,offset);offset+=8;};
  put(vertices.length);put(triangles.length);for(const p of vertices)for(const v of p)put(v);for(const t of triangles)for(const v of t)put(v);hash.update(buffer.subarray(0,offset));return hash.digest('hex');
}
// Geometry built through this backend: indexed meshes, booleans, and assemblies holding either.
export const hasMesh=geometry=>!!geometry&&((Array.isArray(geometry.vertices)||geometry.shape==='boolean')||(geometry.shape==='assembly'&&geometry.parts.some(p=>hasMesh(p.geometry))));
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
  requireMeshInput(Array.isArray(vertices),'Mesh vertices must be an array.');
  requireMeshInput(vertices.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)),'Mesh vertices must be finite XYZ millimeters.');
  requireMeshInput(Array.isArray(triangles),'Mesh triangles must be an array.');
  requireMeshInput(vertices.length===0&&triangles.length===0||vertices.length>=4&&triangles.length>=4,'Mesh needs at least 4 vertices and 4 triangles, or no material.');
  checkMeshCapacity(vertices.length,triangles.length);
  for(const t of triangles)requireMeshInput(Array.isArray(t)&&t.length===3&&t.every(v=>Number.isInteger(v)&&v>=0&&v<vertices.length)&&t[0]!==t[1]&&t[1]!==t[2]&&t[0]!==t[2],'Invalid mesh triangle indices.');
  return {vertices,triangles};
}

function meshFaceGeometry({vertices,triangles}){
  const counts=[vertices.length,triangles.length];
  const normals=meshAllocation('Mesh face normals',...counts,()=>new Float64Array(triangles.length*3)),bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  for(const p of vertices)for(let k=0;k<3;k++){bounds.min[k]=Math.min(bounds.min[k],p[k]);bounds.max[k]=Math.max(bounds.max[k],p[k]);}
  if(!vertices.length){bounds.min=[0,0,0];bounds.max=[0,0,0];}
  // A sliver (below the height contract) that cleanup could not remove is counted, not
  // refused; it keeps its raw unit normal, or none when exactly flat.
  let slivers=0;
  for(let i=0;i<triangles.length;i++){const [a,b,c]=triangles[i].map(v=>vertices[v]),n=triangleNormal(a,b,c);
    if(n)normals.set(n,i*3);else{slivers++;const raw=cross(sub(b,a),sub(c,a)),length=Math.hypot(...raw);if(length>0)normals.set(raw.map(x=>x/length),i*3);}}
  return {normals,bounds,slivers};
}

function validateMeshGeometry({vertices,triangles},{normals,bounds,slivers}){
  const counts=[vertices.length,triangles.length];
  const topology=meshAllocation('Mesh edge topology',...counts,()=>checkMeshTopology(vertices,triangles,requireMeshInput));
  const contacts=meshAllocation('Mesh intersection index',...counts,()=>nonadjacentContacts(vertices,triangles,normals));
  return {normals,bounds,contacts,topology:{...topology,slivers}};
}

function retainValidatedMesh(identity,derived){
  // Keep at most 32 MiB of compact derived data, never a full JSON mesh key.
  const bytes=derived.normals.byteLength;
  if(bytes<=32*1048576){while(validatedMeshes.size&&[...validatedMeshes.values()].reduce((sum,v)=>sum+v.normals.byteLength,bytes)>32*1048576)validatedMeshes.delete(validatedMeshes.keys().next().value);validatedMeshes.set(identity,derived);if(validatedMeshes.size>4)validatedMeshes.delete(validatedMeshes.keys().next().value);}
  return derived;
}
// Nonadjacent triangles that cross or come within the rounding guard are reported,
// not refused (owner, 2026-10-09: "Our job is to show things in saam, not limit what
// we can do with saam"). Sections still close there; an overlap of two shells reads
// as one region. The count is exact; the first pairs are kept as evidence.
function nonadjacentContacts(vertices,triangles,normals){
  const boxes=triangleBoxes(vertices,triangles),contacts={count:0,pairs:[]};
  overlappingBoxPairs(triangleBoxes(vertices,triangles,ROUNDING_MM),(i,j)=>{
    const ta=triangles[i],tb=triangles[j];if(ta[0]===tb[0]||ta[0]===tb[1]||ta[0]===tb[2]||ta[1]===tb[0]||ta[1]===tb[1]||ta[1]===tb[2]||ta[2]===tb[0]||ta[2]===tb[1]||ta[2]===tb[2])return;
    for(let k=0;k<3;k++)if(boxes[6*j+3+k]<boxes[6*i+k]-ROUNDING_MM||boxes[6*j+k]>boxes[6*i+3+k]+ROUNDING_MM)return;
    const pa=ta.map(v=>vertices[v]),pb=tb.map(v=>vertices[v]);
    if(!separatedTriangles(pa,pb,normals.subarray(i*3,i*3+3),normals.subarray(j*3,j*3+3))){contacts.count++;if(contacts.pairs.length<20)contacts.pairs.push([i,j]);}
  });
  return contacts;
}

// Shared closed-triangle separation predicate: the projections onto one of the
// triangles' separating axes (normals, edge cross products, in-plane edge normals)
// are more than the rounding guard apart. Allocation-free; validation runs it
// for every nearby pair. In-plane edge normals come before edge cross products,
// which for coplanar triangles all repeat the normal.
const separation=new Float64Array(24);
function separatedAlong(x,y,z,pa,pb,minimumLength=ROUNDING_RELATIVE){
  const length=Math.hypot(x,y,z);if(length<minimumLength)return false;
  const ux=x/length,uy=y/length,uz=z/length;let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity;
  for(let k=0;k<3;k++){const a=pa[k][0]*ux+pa[k][1]*uy+pa[k][2]*uz,b=pb[k][0]*ux+pb[k][1]*uy+pb[k][2]*uz;amin=Math.min(amin,a);amax=Math.max(amax,a);bmin=Math.min(bmin,b);bmax=Math.max(bmax,b);}
  return amax<bmin-ROUNDING_MM||bmax<amin-ROUNDING_MM;
}
// Scratch layout: edges of A at 0..8, of B at 9..17, unit normals at 18 and 21.
function setNormal(o,given,edges){
  const e=separation;if(given){e[o]=given[0];e[o+1]=given[1];e[o+2]=given[2];return;}
  const x=e[edges+1]*e[edges+5]-e[edges+2]*e[edges+4],y=e[edges+2]*e[edges+3]-e[edges]*e[edges+5],z=e[edges]*e[edges+4]-e[edges+1]*e[edges+3],length=Math.hypot(x,y,z);
  e[o]=x/length;e[o+1]=y/length;e[o+2]=z/length;
}
function crossSeparates(p,q,pa,pb){const e=separation;return separatedAlong(e[p+1]*e[q+2]-e[p+2]*e[q+1],e[p+2]*e[q]-e[p]*e[q+2],e[p]*e[q+1]-e[p+1]*e[q],pa,pb,p>=18?ROUNDING_MM:MESH_DEGENERATE_MM2);}
export function separatedTriangles(pa,pb,normalA,normalB) {
  const e=separation;
  for(let k=0;k<3;k++)for(let c=0;c<3;c++){e[3*k+c]=pa[(k+1)%3][c]-pa[k][c];e[9+3*k+c]=pb[(k+1)%3][c]-pb[k][c];}
  setNormal(18,normalA,0);setNormal(21,normalB,9);
  if(separatedAlong(e[18],e[19],e[20],pa,pb)||separatedAlong(e[21],e[22],e[23],pa,pb))return true;
  for(let i=0;i<3;i++)if(crossSeparates(18,3*i,pa,pb)||crossSeparates(21,9+3*i,pa,pb))return true;
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)if(crossSeparates(3*i,9+3*j,pa,pb))return true;
  return false;
}

export function translateMesh(mesh,dx,dy,dz=0) {
  return {...mesh,vertices:mesh.vertices.map(p=>[p[0]+dx,p[1]+dy,p[2]+dz]),
    bounds:{min:mesh.bounds.min.map((v,i)=>v+[dx,dy,dz][i]),max:mesh.bounds.max.map((v,i)=>v+[dx,dy,dz][i])}};
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
  if(!index.heights)return index.vertices.some(p=>Math.abs(p[2]-cut)<VERTEX_CUT_CLEARANCE_MM);
  const heights=index.heights;let lo=0,hi=heights.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(heights[mid]<cut)lo=mid+1;else hi=mid;}
  return (lo<heights.length&&Math.abs(heights[lo]-cut)<VERTEX_CUT_CLEARANCE_MM)||(lo>0&&Math.abs(heights[lo-1]-cut)<VERTEX_CUT_CLEARANCE_MM);
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

// Contour pieces of a cut: crossed mesh edges chained through the triangles
// between them. A crossed edge two triangles share continues its piece; one on an
// open boundary, or shared by more, ends it. -> {loops, open}, each piece a list
// of crossed edges [p, q].
function meshContourEdges(vertices,cut,triangles){
  const edges=new Map(),segments=[],incident=new Map();
  for(const t of triangles){
    const hits=[];
    for(let k=0;k<3;k++){
      const a=t[k],b=t[(k+1)%3],p=vertices[a],q=vertices[b];
      if((p[2]>cut)===(q[2]>cut))continue;
      const key=edgeKey(a,b);
      // Keep the last triangle's edge orientation and interpolation order.
      edges.set(key,[p,q]);hits.push(key);
    }
    if(hits.length!==2)continue;
    segments.push(hits);
    for(const key of hits){const list=incident.get(key)??[];list.push(segments.length-1);incident.set(key,list);}
  }
  const used=new Uint8Array(segments.length),loops=[],open=[];
  // From start along segment first until the piece returns to start or ends.
  const walk=(start,first)=>{
    const keys=[start];
    for(let key=start,segment=first;segment!==undefined;){
      used[segment]=1;key=segments[segment][0]===key?segments[segment][1]:segments[segment][0];
      if(key===start){loops.push(keys.map(k=>edges.get(k)));return;}
      keys.push(key);
      const list=incident.get(key);
      segment=list.length===2?list.find(s=>!used[s]):undefined;
    }
    open.push(keys.map(k=>edges.get(k)));
  };
  for(const [key,list] of incident)if(list.length!==2)for(const s of list)if(!used[s])walk(key,s);
  for(const [key,list] of incident)for(const s of list)if(!used[s])walk(key,s);
  return {loops,open};
}

// The section at frame height h: loops in the frame's (x, y), outer loops
// counterclockwise and holes clockwise, and the nudge that moved the cut off
// a vertex. A contour an open or nonmanifold edge breaks closes over gaps up
// to gapMm, the print's line width; open lists those gaps and the pieces dropped
// (closeOpenChains).
export function sectionMeshIndex(index,h,{gapMm=0,side=null}={}) {
  requireThat(Number.isFinite(h),'Section height must be finite.');
  requireThat(side===null||side==='negative'||side==='positive','Section side is negative or positive.');
  const [min,max]=[index.bounds.min[2],index.bounds.max[2]];
  // Layer-grid arithmetic can land a few floating-point ulps beyond an exact
  // boundary (0.2 + 29 * 0.2 > 6). Keep that numerical error distinct from the
  // geometric nudge below; genuinely outside layers must still be empty.
  const roundoff=16*Number.EPSILON*Math.max(1,Math.abs(h),Math.abs(min),Math.abs(max));
  if(h<min-roundoff||h>max+roundoff)return {loops:[],nudgedByMm:0,open:[]};
  // The requested oriented limit outside an extremum is empty; never replace
  // it by an inward cut. Interior limits use the existing numerical clearance.
  if(side==='negative'&&h<=min+roundoff||side==='positive'&&h>=max-roundoff)return {loops:[],nudgedByMm:0,open:[]};
  // Move a cut off vertices/edges; prefer the interior side at the top bound.
  const nudges=side===null?SECTION_NUDGES_MM:SECTION_NUDGES_MM.filter(nudge=>side==='negative'?nudge<0:nudge>0);
  for(const nudge of nudges) {
    const cut=h+nudge;
    if(cut<=min||cut>=max||nearVertex(index,cut))continue;
    const contours=meshContourEdges(index.vertices,cut,trianglesAt(index,cut));
    const point=([p,q])=>{const f=(cut-p[2])/(q[2]-p[2]);return [p[0]+f*(q[0]-p[0]),p[1]+f*(q[1]-p[1])];};
    const loops=[];
    for(const edges of contours.loops){
      // Remove triangle seams collinear to rounding before offsetting regions. The section
      // stays the exact cut: a shape tolerance here would switch retained vertices as Z
      // moves, and callers simplify at their own tolerance (contour-sleeve, layer-strokes).
      // A loop collapsing within the rounding guard has no area to print.
      const clean=cleanPlanarLoop(edges.map(point),ROUNDING_MM);
      if(clean.length>=3)loops.push(clean);
    }
    const closed=closeOpenChains(contours.open.map(edges=>edges.map(point)),gapMm);
    for(const loop of closed.loops){const clean=cleanPlanarLoop(loop,ROUNDING_MM);if(clean.length>=3)loops.push(clean);}
    return {loops:orientLoops(loops),nudgedByMm:nudge,open:closed.open};
  }
  throw new Error('Mesh cut is ambiguous within section tolerance.');
}

// Immutable solid identity owns the search index; caching changes recomputation
// cost, never the vertical crossing predicates or their source-triangle order.
const columnIndexes=new WeakMap();
function meshColumnIndex(mesh){
  if(columnIndexes.has(mesh))return columnIndexes.get(mesh);
  const index=triangleBVH(mesh.vertices,mesh.triangles);columnIndexes.set(mesh,index);return index;
}
// Bounded physical distance to the original mesh boundary, sharing its index.
export function meshBoundaryDistance(mesh,point,limitMm){
  requireThat(point?.length===3&&point.every(Number.isFinite)&&Number.isFinite(limitMm)&&limitMm>0,'Mesh boundary distance needs finite XYZ and a positive physical limit.');
  const state={squared:Infinity};
  const measure=i=>{const t=mesh.triangles[i];state.squared=Math.min(state.squared,pointTriangleDistanceSquared(point,mesh.vertices[t[0]],mesh.vertices[t[1]],mesh.vertices[t[2]]));};
  meshColumnIndex(mesh).query(point.map(v=>v-limitMm),point.map(v=>v+limitMm),measure);
  return state.squared<=limitMm*limitMm?Math.sqrt(state.squared):Infinity;
}
// Every non-vertical triangle the vertical line through (x, y) crosses.
export function meshCrossingsAt(mesh,x,y) {
  const crossings=[],candidates=[];
  const collect=i=>candidates.push(i);
  meshColumnIndex(mesh).query([x,y,mesh.bounds.min[2]],[x,y,mesh.bounds.max[2]],collect);
  candidates.sort((a,b)=>a-b);
  for(const i of candidates) {
    const t=mesh.triangles[i];
    const [a,b,c]=t.map(k=>mesh.vertices[k]);
    const det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
    if(Math.abs(det)<MESH_DEGENERATE_MM2)continue;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/det;
    const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/det,w=1-u-v;
    if(Math.min(u,v,w)<-BARYCENTRIC_SLACK)continue;
    const n=meshFaceNormal(mesh,i),normal=n[2]<0?n.map(v=>-v):n;
    crossings.push({zMm:u*a[2]+v*b[2]+w*c[2],normal,slopeDeg:Math.acos(Math.min(1,normal[2]))*180/Math.PI,feature:`triangle:${i}`,patch:`triangle:${i}`});
  }
  return crossings;
}

export function meshTopAt(mesh,x,y) {
  const crossings=meshCrossingsAt(mesh,x,y);let highest=-Infinity,best=null;
  for(const crossing of crossings)highest=Math.max(highest,crossing.zMm);
  // All ties refer to the actual top, never a previously selected lower face.
  // Prefer the steeper face within print resolution, then the higher equal slope.
  for(const crossing of crossings)if(highest-crossing.zMm<=PRINT_RESOLUTION_MM&&
    (!best||crossing.slopeDeg>best.slopeDeg||crossing.slopeDeg===best.slopeDeg&&crossing.zMm>best.zMm))best=crossing;
  return best;
}

// STL parsing indexes exact coordinates; source admission separately normalizes
// vertices in physical millimetres. Repair output reimport remains exact.
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
