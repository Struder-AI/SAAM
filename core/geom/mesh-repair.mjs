// Exact triangle cleanup, solid repair and output validation for explicit repair.
import {decodeSTL,makeMesh,parseSTL,triangleNormal} from './mesh.mjs';
import {reconstructSolid,cleanSurfaceSlivers,anyIntersection} from './mesh-autorefine.mjs';
import {checkMeshTopology} from './mesh-topology.mjs';
import {adjacentContacts} from './mesh-spatial.mjs';
import {subtract as sub,cross,dot,requireThat} from './tolerance.mjs';
import {checkMeshCapacity} from './mesh-capacity.mjs';
import {mergeCloseVertices} from './mesh-vertices.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM,ROUNDING_RELATIVE} from '../dimensions.mjs';

// Source vertices closer than print resolution merge first; faces that collapse
// or fail triangleNormal go. A vertex within print resolution of an opposite
// boundary edge is stitched into it.
export function cleanTriangleSoup(input,{mergeToleranceMm=0}={}) {
  requireThat(Array.isArray(input.vertices)&&Array.isArray(input.triangles),'Repair needs vertices and triangles.');
  requireThat(Number.isFinite(mergeToleranceMm)&&mergeToleranceMm>=0,'mergeToleranceMm must be a finite nonnegative distance in millimetres.');
  checkMeshCapacity(input.vertices.length,input.triangles.length);
  for(const p of input.vertices)requireThat(Array.isArray(p)&&p.length===3&&p.every(Number.isFinite),'Repair coordinates must be finite XYZ.');
  for(const face of input.triangles)requireThat(Array.isArray(face)&&face.length===3&&face.every(i=>Number.isInteger(i)&&i>=0&&i<input.vertices.length),'Invalid repair triangle indices.');
  // A requested coarser weld replaces the physical-resolution pass; every
  // displacement is measured directly from the original source coordinates.
  const effectiveToleranceMm=Math.max(PRINT_RESOLUTION_MM,mergeToleranceMm);
  const resolution=mergeCloseVertices(input.vertices,input.triangles,effectiveToleranceMm),vertices=resolution.vertices;
  // Coincident triangles keep one copy facing their net orientation; an
  // opposed pair is a zero-thickness wall and cancels, so the surface stays closed.
  const kept=[],groups=new Map();let degenerate=0;
  for(const face of resolution.triangles){
    const t=face;
    if(new Set(t).size!==3||!triangleNormal(...t.map(i=>vertices[i]))){degenerate++;continue;}
    const s=[...t].sort((a,b)=>a-b),key=s.join(','),sign=(s.indexOf(t[1])-s.indexOf(t[0])+3)%3===1?1:-1;
    const group=groups.get(key);if(group)group.net+=sign;else{groups.set(key,{triangle:t,sign,net:sign});kept.push(key);}
  }
  const triangles=[];
  for(const key of kept){const {triangle:t,sign,net}=groups.get(key);if(net)triangles.push(Math.sign(net)===sign?t:[t[0],t[2],t[1]]);}
  const duplicates=resolution.triangles.length-degenerate-triangles.length;
  requireThat(triangles.length===0||triangles.length>=4,'Repair has no usable solid surface.');
  // A removed or merged face can leave a vertex on the opposite edge (a T-junction);
  // stitching closes it wherever the boundary allows, and finds nothing on a closed mesh.
  const stitching=stitchCollapsedEdges(vertices,triangles);
  const compact=compactMesh(vertices,stitching.triangles);
  const merge={...resolution.merge,requestedToleranceMm:mergeToleranceMm,effectiveToleranceMm};
  return {...compact,empty:compact.triangles.length===0,resolutionMerge:merge,...(mergeToleranceMm>0?{merge}:{}),removed:{degenerate:degenerate+resolution.merge.collapsedTriangles,duplicates,unusedOrDuplicateVertices:input.vertices.length-compact.vertices.length},
    stitching:{edges:stitching.stitchedEdges,addedTriangles:stitching.addedTriangles,toleranceMm:PRINT_RESOLUTION_MM}};
}

// All newly admitted and explicitly repaired sources use one preparation owner.
// Useful coordinate/face reduction precedes the intersection probe. The solid
// repair operation reconstructs only when that probe finds an intersection.
export function prepareMesh(input,options={}){
  const clean=cleanTriangleSoup(input,options);
  if(clean.empty)return {clean,result:{vertices:[],triangles:[],report:{method:'vertex-merge-cleanup/1',empty:true}}};
  const result=repairSolid(clean,options),r=result.report;
  // Contacts and topology defects that remain are reported with the result, never a
  // reason to refuse it.
  if(result.triangles.length){const mesh=makeMesh(result.vertices,result.triangles),folds=adjacentContacts(result);
    r.remaining={contacts:{nonadjacent:mesh.contacts.count,adjacentFolds:folds.count,pairs:{nonadjacent:mesh.contacts.pairs,adjacentFolds:folds.pairs}},topology:mesh.topology};}
  else{requireThat(result.vertices.length===0,'Empty repaired geometry must have no unused vertices.');r.empty=true;}
  if(!r.selfIntersectionsRepaired&&!r.orientation.flippedFaces&&!r.orientation.reversedOrientation&&!r.holesFilled)
    r.method=clean.merge?.movedVertices||clean.resolutionMerge.mergedVertices?'vertex-merge-cleanup/1':clean.stitching.edges?'edge-stitch-cleanup/1':'exact-cleanup/1';
  return {clean,result};
}

// Removing a collinear face can expose A--C opposite C--B--A. Split the
// surviving A--C face at B, preserving its orientation and existing coordinates.
// B is on A--C when it lies within print resolution of it.
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
    if(length<=PRINT_RESOLUTION_MM)continue;
    const direction=ab.map(v=>v/length),chain=[edge.b];let at=edge.b,previous=length;
    const visited=new Set(chain);
    while(at!==edge.a){
      const next=(outgoing.get(at)??[]).filter(e=>{
        if(e===edge||visited.has(e.b))return false;
        const offset=sub(vertices[e.b],a),position=dot(offset,direction);
        return position>=-PRINT_RESOLUTION_MM&&position<previous&&Math.hypot(...cross(offset,direction))<=PRINT_RESOLUTION_MM;
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
// Open edges are refused unless every hole they bound is within both maxHoleEdges
// and maxHoleDiameterMm; then each hole is filled first (holeLoops, triangulateHole).
export function repairSolid(mesh,{maxHoleEdges=0,maxHoleDiameterMm=0,progress=()=>{}}={}){
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
  // An open edge has one face; every other edge must balance.
  const open=[],isOpen=new Uint8Array(3*n);let unbalanced=0;
  for(let i=0;i<3*n;){let j=i,balance=0;while(j<3*n&&lo[edges[j]]===lo[edges[i]]&&hi[edges[j]]===hi[edges[i]]){const e=edges[j++];balance+=(tri[e]<tri[next(e)]?1:-1)*(flip[(e/3)|0]?-1:1);}
    if(j-i===1){open.push(edges[i]);isOpen[edges[i]]=1;}else if(balance)unbalanced++;i=j;}
  // What repair cannot close stays open and is reported, never a reason to refuse: an
  // edge whose faces cannot be oriented alike (a twisted seam), and holes beyond the
  // fill bounds or without a fill that repeats no edge.
  orientation.unorientedEdges=unbalanced;
  const holes={holesFilled:0,holeTrianglesAdded:0,holeSlivers:0,holesLeftOpen:0,unpairedOpenEdges:0},patch=[];
  if(open.length){
    progress({stage:'fill-holes',edges:open.length});
    const orientedEdges={tri,flip,twin,isOpen,next};
    const {loops,unpaired}=holeLoops(open,orientedEdges);
    holes.unpairedOpenEdges=unpaired;
    // A chord may not repeat an edge of the mesh or of an earlier patch.
    const added=new Set(),edgeKey=(a,b)=>Math.min(a,b)*(xyz.length/3)+Math.max(a,b);
    const meshHasEdge=(a,b)=>{const l=Math.min(a,b),h=Math.max(a,b);let x=0,y=3*n;while(x<y){const m=(x+y)>>1,e=edges[m];if(lo[e]<l||lo[e]===l&&hi[e]<h)x=m+1;else y=m;}return x<3*n&&lo[edges[x]]===l&&hi[edges[x]]===h||added.has(edgeKey(a,b));};
    for(const loop of loops){
      if(!maxHoleEdges||loop.length>maxHoleEdges||holeDiameter(xyz,loop,orientedEdges)>maxHoleDiameterMm){holes.holesLeftOpen++;continue;}
      const hole=holeGeometry(xyz,loop,orientedEdges),fill=triangulateHole(hole.points,hole.sideNormals,(i,k)=>meshHasEdge(hole.ids[i],hole.ids[k]));
      if(!fill){holes.holesLeftOpen++;continue;}
      for(let t=0;t<fill.length;t+=3){const a=hole.ids[fill[t]],b=hole.ids[fill[t+1]],c=hole.ids[fill[t+2]];patch.push(a,b,c);if(!triangleNormal(...[a,b,c].map(v=>Array.from(xyz.subarray(3*v,3*v+3)))))holes.holeSlivers++;added.add(edgeKey(a,b));added.add(edgeKey(b,c));added.add(edgeKey(c,a));}
      holes.holesFilled++;holes.holeTrianglesAdded+=fill.length/3;
    }
  }
  for(let f=0;f<n;f++)if(flip[f]){const b=tri[3*f+1];tri[3*f+1]=tri[3*f+2];tri[3*f+2]=b;orientation.flippedFaces++;}
  const closed=patch.length?Int32Array.from([...tri,...patch]):tri,faces=closed.length/3;
  let volume=0;for(let f=0;f<faces;f++){const [a,b,c]=[0,1,2].map(k=>3*closed[3*f+k]);volume+=xyz[a]*(xyz[b+1]*xyz[c+2]-xyz[b+2]*xyz[c+1])+xyz[a+1]*(xyz[b+2]*xyz[c]-xyz[b]*xyz[c+2])+xyz[a+2]*(xyz[b]*xyz[c+1]-xyz[b+1]*xyz[c]);}
  if(volume<0){orientation.reversedOrientation=true;for(let f=0;f<faces;f++){const b=closed[3*f+1];closed[3*f+1]=closed[3*f+2];closed[3*f+2]=b;}}
  // A fill that could only use slivers is cleaned before reconstruction.
  let surface={xyz,tri:closed};
  if(holes.holeSlivers){const cleaned=cleanSurfaceSlivers(surface,{progress});surface={xyz:cleaned.xyz,tri:cleaned.tri};holes.holeSliverCleanup=cleaned.sliverCorrection;}
  // Reconstruction classifies material by winding, which needs a closed, oriented surface.
  const closedSurface=!unbalanced&&!holes.holesLeftOpen&&!holes.unpairedOpenEdges;
  const solid=closedSurface?reconstructSolid(surface,{progress}):null,out=solid??surface,vertices=[],triangles=[];
  if(!closedSurface)holes.selfIntersectionsUnrepaired=anyIntersection(surface);
  for(let i=0;i<out.xyz.length;i+=3)vertices.push([out.xyz[i],out.xyz[i+1],out.xyz[i+2]]);
  for(let i=0;i<out.tri.length;i+=3)triangles.push([out.tri[i],out.tri[i+1],out.tri[i+2]]);
  const topology=checkMeshTopology(vertices,triangles,ok=>requireThat(ok,'Repair produced a repeated triangle.'));
  const summary=pass=>{const {refine,snapGridMm,maxSnapMm,roundingMergedPoints,roundingDroppedTriangles,roundingCancelledPairs,remaining,...counts}=pass;return counts;};
  const reconstruction=solid&&{...summary(solid.passes[0]),snapGridMm:solid.passes[0].snapGridMm,maxSnapMm:Math.max(...solid.passes.map(p=>p.maxSnapMm)),
    ...(solid.passes.length>1?{roundingPasses:solid.passes.slice(1).map(summary)}:{}),sliverCorrection:solid.sliverCorrection,merge:solid.merge,unresolvedCrossings:solid.unresolvedCrossings};
  return {vertices,triangles,report:{method:'saam-solid-repair/2',orientation,...holes,topology,selfIntersectionsRepaired:!!solid,reconstruction}};
}

// Hole boundaries as loops of open face edges e (face (e/3)|0, oriented by flip).
// The hole runs against its faces: edge e, oriented u->v, is the hole step v->u.
// The step after it leaves u across the fan of faces around u, as a halfedge
// mesh links border halfedges. A walk that meets a vertex again splits off the
// closed part, so every loop is simple: holes touching at a vertex fill apart.
// Edges whose fan crosses a nonmanifold or inconsistent edge stay unpaired.
function holeLoops(open,{tri,flip,twin,isOpen,next}){
  const from=e=>flip[(e/3)|0]?tri[next(e)]:tri[e],to=e=>flip[(e/3)|0]?tri[e]:tri[next(e)];
  const into=(f,u)=>{for(let k=0;k<3;k++)if(to(3*f+k)===u)return 3*f+k;return -1;};
  const step=new Map();
  for(const e of open){
    const u=from(e);let c=into((e/3)|0,u),following=-1;
    for(let turns=0;turns<=tri.length/3&&c>=0;turns++){
      if(isOpen[c]){following=c;break;}
      const t=twin[c];if(t<0||from(t)!==u)break;c=into((t/3)|0,u);
    }
    step.set(e,following);
  }
  const loops=[],seen=new Set();let unpaired=0;
  for(const start of open){
    if(seen.has(start))continue;
    const path=[],at=new Map();let e=start;
    // A step from a vertex already on the path closes the steps since it; a
    // walk that returns to a seen step closes through its first vertex or stays open.
    for(;;){
      const v=e<0?-1:to(e),repeat=at.get(v);
      if(repeat!==undefined){const piece=path.splice(repeat);for(const p of piece)at.delete(to(p));piece.length>=3?loops.push(piece):unpaired+=piece.length;}
      if(e<0||seen.has(e)){unpaired+=path.length;break;}
      seen.add(e);at.set(v,path.length);path.push(e);e=step.get(e);
    }
  }
  return {loops,unpaired};
}

// Loop vertices p_i (the hole step i runs p_i -> p_i+1), their coordinates, and the
// unit normal of the face across each step.
function holeGeometry(xyz,loop,{tri,flip,next}){
  const n=loop.length,ids=new Int32Array(n),points=new Float64Array(3*n),sideNormals=new Float64Array(3*n);
  loop.forEach((e,i)=>{
    const f=(e/3)|0,u=flip[f]?tri[next(e)]:tri[e],v=flip[f]?tri[e]:tri[next(e)],w=tri[3*f]+tri[3*f+1]+tri[3*f+2]-u-v;
    ids[i]=v;for(let k=0;k<3;k++)points[3*i+k]=xyz[3*v+k];
    const a=[0,1,2].map(k=>xyz[3*v+k]-xyz[3*u+k]),b=[0,1,2].map(k=>xyz[3*w+k]-xyz[3*u+k]),c=cross(a,b),l=Math.hypot(...c);
    for(let k=0;k<3;k++)sideNormals[3*i+k]=c[k]/l;
  });
  return {ids,points,sideNormals};
}

// The size limit: the diagonal of the loop's axis-aligned bounding box, in mm.
function holeDiameter(xyz,loop,{tri,flip,next}){
  const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
  for(const e of loop){const v=flip[(e/3)|0]?tri[e]:tri[next(e)];for(let k=0;k<3;k++){low[k]=Math.min(low[k],xyz[3*v+k]);high[k]=Math.max(high[k],xyz[3*v+k]);}}
  return Math.hypot(high[0]-low[0],high[1]-low[1],high[2]-low[2]);
}

// Liepa's minimum-weight triangulation of a hole (P. Liepa, "Filling Holes in
// Meshes", SGP 2003), the weight CGAL's triangulate_hole uses: the largest
// dihedral angle between adjacent faces (patch faces and the faces across the
// loop), then total area. Dihedral angles compare as |n1 - n2|^2 of unit normals,
// which grows with the angle and stays exact near zero. No vertices are added and
// a chord (i,k) that repeats an existing edge is not used. A sliver (below the
// mesh height contract) weighs more than any dihedral angle, so a fill uses slivers
// only when none avoids them, then the shortest; sliver cleanup removes them.
// Returns loop-index triples (each oriented with the loop) or null when no
// triangulation exists.
// Time grows as n^3 and memory as n^2 in the loop's edge count n.
const SLIVER_WEIGHT=5;
export function triangulateHole(points,sideNormals,hasEdge){
  const n=points.length/3,cells=n*(n-1)/2,row=new Int32Array(n);
  for(let i=1;i<n;i++)row[i]=row[i-1]+n-i;
  // Cell (i,k), i<k, at row[i]+k-i-1: [largest angle, area, unit normal of the
  // triangle on chord i-k] in stride 5, and that triangle's apex m in best. The
  // copy by column (at k(k-1)/2+i, NaN angle until solved) keeps the inner loop's
  // reads contiguous.
  const cell=new Float64Array(5*cells).fill(NaN),column=new Float64Array(5*cells).fill(NaN),best=new Int32Array(cells).fill(-1),P=points;
  const store=(i,k,angle,area,x,y,z)=>{const c=5*(row[i]+k-i-1),d=5*(k*(k-1)/2+i);cell[c]=column[d]=angle;cell[c+1]=column[d+1]=area;cell[c+2]=column[d+2]=x;cell[c+3]=column[d+3]=y;cell[c+4]=column[d+4]=z;};
  for(let i=0;i+1<n;i++){best[row[i]]=i;store(i,i+1,0,0,sideNormals[3*i],sideNormals[3*i+1],sideNormals[3*i+2]);}
  for(let span=2;span<n;span++)for(let i=0;i+span<n;i++){
    const k=i+span,c=row[i]+span-1,top=span===n-1;if(!top&&hasEdge(i,k))continue;
    let bestAngle=Infinity,bestArea=Infinity,bestM=-1,bx=0,by=0,bz=0;
    const ix=P[3*i],iy=P[3*i+1],iz=P[3*i+2],kx=P[3*k]-ix,ky=P[3*k+1]-iy,kz=P[3*k+2]-iz,ik=kx*kx+ky*ky+kz*kz;
    const first=row[i]-i-1,last=k*(k-1)/2;
    for(let m=i+1;m<k;m++){
      const p=5*(first+m),q=5*(last+m);if(!(cell[p]>=0&&column[q]>=0))continue;
      const mx=P[3*m]-ix,my=P[3*m+1]-iy,mz=P[3*m+2]-iz,ex=kx-mx,ey=ky-my,ez=kz-mz;
      const nx=my*kz-mz*ky,ny=mz*kx-mx*kz,nz=mx*ky-my*kx,squared=nx*nx+ny*ny+nz*nz;
      const longest=Math.max(mx*mx+my*my+mz*mz,ex*ex+ey*ey+ez*ez,ik),limit=ROUNDING_MM*ROUNDING_MM*longest;
      // The height contract in triangleNormal's own arithmetic when it is close.
      const sliver=squared<=limit*(1+ROUNDING_RELATIVE)&&!triangleNormal([ix,iy,iz],P.slice(3*m,3*m+3),P.slice(3*k,3*k+3));
      const length=Math.sqrt(squared),ux=sliver?0:nx/length,uy=sliver?0:ny/length,uz=sliver?0:nz/length;
      const ax=ux-cell[p+2],ay=uy-cell[p+3],az=uz-cell[p+4],bx2=ux-column[q+2],by2=uy-column[q+3],bz2=uz-column[q+4];
      let a=Math.max(cell[p],column[q],sliver?SLIVER_WEIGHT:Math.max(ax*ax+ay*ay+az*az,bx2*bx2+by2*by2+bz2*bz2));
      if(top&&!sliver){const tx=ux-sideNormals[3*k],ty=uy-sideNormals[3*k+1],tz=uz-sideNormals[3*k+2];a=Math.max(a,tx*tx+ty*ty+tz*tz);}
      const s=cell[p+1]+column[q+1]+(sliver?Math.sqrt(longest):length/2);
      if(a<bestAngle||a===bestAngle&&s<bestArea){bestAngle=a;bestArea=s;bestM=m;bx=ux;by=uy;bz=uz;}
    }
    if(bestM<0)continue;
    best[c]=bestM;store(i,k,bestAngle,bestArea,bx,by,bz);
  }
  if(n<3||best[n-2]<0)return null;
  const faces=[],pending=[[0,n-1]];
  while(pending.length){const [i,k]=pending.pop(),m=best[row[i]+k-i-1];faces.push(i,m,k);if(m-i>1)pending.push([i,m]);if(k-m>1)pending.push([m,k]);}
  return faces;
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
  for(const t of mesh.triangles){const n=triangleNormal(...t.map(i=>mesh.vertices[i]))??[0,0,0];chunk+=`facet normal ${n.join(' ')}\nouter loop\n`+t.map(i=>`vertex ${mesh.vertices[i].join(' ')}\n`).join('')+'endloop\nendfacet\n';if(chunk.length>=65536){yield chunk;chunk='';}}
  yield chunk+'endsolid saam_repaired\n';
}

export function validateRepair(mesh) {
  if(mesh.triangles.length)makeMesh(mesh.vertices,mesh.triangles);
  else requireThat(mesh.vertices.length===0,'Empty repaired geometry must have no unused vertices.');
  const bytes=encodeRepairSTL(mesh);
  if(mesh.triangles.length)parseSTL(bytes,{units:'mm'});
  else{const exact=decodeSTL(bytes,{units:'mm'});requireThat(exact.vertices.length===0&&exact.triangles.length===0,'Empty repaired STL changed on exact reimport.');}
  return bytes;
}

export {decodeSTL};
