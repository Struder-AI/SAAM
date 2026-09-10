// Indexed triangle backend. No CAD kernel or display proxy participates in slicing.
import { requireThat } from './tolerance.mjs';
import { orientLoops } from './shell.mjs';
import { cleanPlanarLoop } from './polyline.mjs';

const sub = (a,b) => a.map((v,i)=>v-b[i]);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const edgeKey = (a,b) => a<b ? `${a}:${b}` : `${b}:${a}`;

export function makeMesh(vertices, triangles, {name='mesh'}={}) {
  requireThat(Array.isArray(vertices)&&vertices.length>=4&&vertices.length<=300000,'Mesh needs 4–300000 vertices.');
  requireThat(vertices.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)),'Mesh vertices must be finite XYZ millimeters.');
  requireThat(Array.isArray(triangles)&&triangles.length>=4&&triangles.length<=100000,'Mesh needs 4–100000 triangles.');
  const edges=new Map(),seen=new Set(),normals=[],incident=vertices.map(()=>[]);
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  vertices.forEach(p=>p.forEach((v,k)=>{bounds.min[k]=Math.min(bounds.min[k],v);bounds.max[k]=Math.max(bounds.max[k],v);}));
  for(const [i,t] of triangles.entries()) {
    requireThat(Array.isArray(t)&&t.length===3&&t.every(v=>Number.isInteger(v)&&v>=0&&v<vertices.length)&&new Set(t).size===3,'Invalid mesh triangle indices.');
    const key=[...t].sort((a,b)=>a-b).join(':');
    requireThat(!seen.has(key),'Duplicate mesh triangle.');seen.add(key);
    const n=cross(sub(vertices[t[1]],vertices[t[0]]),sub(vertices[t[2]],vertices[t[0]])),length=Math.hypot(...n);
    requireThat(length>1e-10,'Degenerate mesh triangle.');normals.push(n.map(v=>v/length));
    for(let k=0;k<3;k++){
      incident[t[k]].push(i);
      const a=t[k],b=t[(k+1)%3],key=edgeKey(a,b),list=edges.get(key)??[];
      list.push({triangle:i,direction:a<b?1:-1});edges.set(key,list);
    }
  }
  for(const list of edges.values()) requireThat(list.length===2&&list[0].direction!==list[1].direction,'Mesh must be closed, manifold and consistently wound; repair the source before importing.');
  requireThat(incident.every(list=>list.length>=3),'Unused or nonmanifold mesh vertex.');
  // Two otherwise closed shells touching at a vertex are not a manifold solid.
  for(const [v,list] of incident.entries()) {
    const reached=new Set([list[0]]),pending=[list[0]];
    while(pending.length) for(const other of triangles[pending.pop()].filter(k=>k!==v))
      for(const e of edges.get(edgeKey(v,other))) if(!reached.has(e.triangle)){reached.add(e.triangle);pending.push(e.triangle);}
    requireThat(reached.size===list.length,'Nonmanifold mesh vertex.');
  }
  rejectIntersections(vertices,triangles,normals);
  return {kind:'triangle-mesh',name,vertices,triangles,normals,edges,bounds};
}

function rejectIntersections(vertices,triangles,normals) {
  const boxes=triangles.map((t,i)=>({i,min:[0,1,2].map(k=>Math.min(...t.map(v=>vertices[v][k]))),max:[0,1,2].map(k=>Math.max(...t.map(v=>vertices[v][k])))})).sort((a,b)=>a.min[0]-b.min[0]);
  let checks=0;
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length&&boxes[j].min[0]<=boxes[i].max[0]+1e-9;j++){
    const a=boxes[i],b=boxes[j];
    if([1,2].some(k=>a.max[k]<b.min[k]-1e-9||b.max[k]<a.min[k]-1e-9))continue;
    const ta=triangles[a.i],tb=triangles[b.i];
    if(ta.some(v=>tb.includes(v)))continue;
    requireThat(++checks<=2000000,'Mesh intersection check limit exceeded; simplify the mesh explicitly.');
    const pa=ta.map(v=>vertices[v]),pb=tb.map(v=>vertices[v]);
    const ea=pa.map((p,k)=>sub(pa[(k+1)%3],p)),eb=pb.map((p,k)=>sub(pb[(k+1)%3],p));
    const axes=[normals[a.i],normals[b.i],...ea.flatMap(e=>eb.map(f=>cross(e,f))),...ea.map(e=>cross(normals[a.i],e)),...eb.map(e=>cross(normals[b.i],e))];
    const separated=axes.some(axis=>{
      const length=Math.hypot(...axis);if(length<1e-12)return false;
      const unit=axis.map(v=>v/length),aa=pa.map(p=>dot(p,unit)),bb=pb.map(p=>dot(p,unit));
      return Math.max(...aa)<Math.min(...bb)-1e-9||Math.max(...bb)<Math.min(...aa)-1e-9;
    });
    requireThat(separated,'Intersecting or touching nonadjacent mesh triangles; repair the source before importing.');
  }
}

export function translateMesh(mesh,dx,dy,dz=0) {
  return {...mesh,vertices:mesh.vertices.map(p=>[p[0]+dx,p[1]+dy,p[2]+dz]),
    bounds:{min:mesh.bounds.min.map((v,i)=>v+[dx,dy,dz][i]),max:mesh.bounds.max.map((v,i)=>v+[dx,dy,dz][i])}};
}

// Repeated cuts share only search data. The caller keeps geometry fixed for the
// lifetime of this query; a newly built/translated mesh gets a fresh query.
// A Z-bound hierarchy stores each triangle once, including tall triangles that
// would occupy many bins in a uniform layer index.
export function createMeshSectionQuery(mesh) {
  const heights=mesh.vertices.map(p=>p[2]).sort((a,b)=>a-b);
  const ranges=mesh.triangles.map((t,i)=>({i,
    min:Math.min(...t.map(v=>mesh.vertices[v][2])),
    max:Math.max(...t.map(v=>mesh.vertices[v][2]))}));
  function build(items) {
    let min=Infinity,max=-Infinity;
    for(const item of items){min=Math.min(min,item.min);max=Math.max(max,item.max);}
    if(items.length<=16)return {min,max,items};
    items.sort((a,b)=>(a.min/2+a.max/2)-(b.min/2+b.max/2)||a.i-b.i);
    const middle=Math.floor(items.length/2);
    return {min,max,left:build(items.slice(0,middle)),right:build(items.slice(middle))};
  }
  const tree=build(ranges);
  const nearVertex=cut=>{
    let lo=0,hi=heights.length;
    while(lo<hi){const mid=Math.floor((lo+hi)/2);if(heights[mid]<cut)lo=mid+1;else hi=mid;}
    return (lo<heights.length&&Math.abs(heights[lo]-cut)<1e-10)
      ||(lo>0&&Math.abs(heights[lo-1]-cut)<1e-10);
  };
  const trianglesAt=cut=>{
    const found=[];
    function visit(node) {
      if(cut<=node.min||cut>=node.max)return;
      if(node.items){for(const item of node.items)if(cut>item.min&&cut<item.max)found.push(item.i);}
      else {visit(node.left);visit(node.right);}
    }
    visit(tree);
    // Preserve the original edge overwrite and contour traversal order exactly.
    return found.sort((a,b)=>a-b).map(i=>mesh.triangles[i]);
  };
  return z=>cutMesh(mesh,z,nearVertex,trianglesAt);
}

export function sectionMesh(mesh,z) {
  return cutMesh(mesh,z,cut=>mesh.vertices.some(p=>Math.abs(p[2]-cut)<1e-10),()=>mesh.triangles);
}

function cutMesh(mesh,z,nearVertex,trianglesAt) {
  requireThat(Number.isFinite(z),'Section height must be finite.');
  // Layer-grid arithmetic can land a few floating-point ulps beyond an exact
  // boundary (0.2 + 29 * 0.2 > 6). Keep that numerical error distinct from the
  // geometric nudge below; genuinely outside layers must still be empty.
  const roundoff=16*Number.EPSILON*Math.max(1,Math.abs(z),Math.abs(mesh.bounds.min[2]),Math.abs(mesh.bounds.max[2]));
  if(z<mesh.bounds.min[2]-roundoff||z>mesh.bounds.max[2]+roundoff)return {loops:[],requestedZ:z,nudgedByMm:0};
  // Move a cut off vertices/edges; prefer the interior side at the top bound.
  for(const nudge of [0,-1e-6,1e-6,-1e-5,1e-5]) {
    const cut=z+nudge;
    if(cut<=mesh.bounds.min[2]||cut>=mesh.bounds.max[2]||nearVertex(cut))continue;
    const points=new Map(),graph=new Map();
    for(const t of trianglesAt(cut)){
      const hits=[];
      for(let k=0;k<3;k++){
        const a=t[k],b=t[(k+1)%3],p=mesh.vertices[a],q=mesh.vertices[b];
        if((p[2]>cut)===(q[2]>cut))continue;
        const key=edgeKey(a,b),f=(cut-p[2])/(q[2]-p[2]);
        points.set(key,[p[0]+f*(q[0]-p[0]),p[1]+f*(q[1]-p[1])]);hits.push(key);
      }
      if(hits.length===2)for(let k=0;k<2;k++){const list=graph.get(hits[k])??[];list.push(hits[1-k]);graph.set(hits[k],list);}
    }
    requireThat([...graph.values()].every(n=>n.length===2),'Mesh section is not a closed set of contours.');
    const remaining=new Set(graph.keys()),loops=[];
    while(remaining.size){
      const start=remaining.values().next().value,loop=[];let previous=null,current=start;
      do {
        requireThat(remaining.delete(current),'Ambiguous mesh contour.');loop.push(points.get(current));
        const next=graph.get(current).find(k=>k!==previous);previous=current;current=next;
      } while(current!==start);
      // Remove collinear triangle seams before offsetting regions.
      const clean=cleanPlanarLoop(loop);
      requireThat(clean.length>=3,'Mesh section collapsed below tolerance.');loops.push(clean);
    }
    return {loops:orientLoops(loops),requestedZ:z,nudgedByMm:nudge};
  }
  throw new Error('Mesh cut is ambiguous within section tolerance.');
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
export function parseSTL(bytes,{units,scale=1}={}) {
  requireThat(['mm','inch'].includes(units)&&Number.isFinite(scale)&&scale>0,'STL import needs explicit mm/inch units and positive scale.');
  const buffer=Buffer.from(bytes),factor=scale*(units==='inch'?25.4:1),facets=[];
  const count=buffer.length>=84?buffer.readUInt32LE(80):0;
  if(count>0&&84+50*count===buffer.length){
    requireThat(count<=100000,'STL exceeds 100000 triangles.');
    for(let i=0;i<count;i++)facets.push(Array.from({length:3},(_,v)=>Array.from({length:3},(_,k)=>buffer.readFloatLE(84+i*50+12+v*12+k*4)*factor)));
  } else {
    const text=buffer.toString('utf8').trim();
    requireThat(/^solid(?:\s|$)/i.test(text)&&/endsolid[^\r\n]*$/i.test(text),'Invalid or truncated STL.');
    const body=text.replace(/^solid[^\r\n]*(?:\r?\n|$)/i,'').replace(/endsolid[^\r\n]*$/i,'').trim();
    const tokens=body.split(/\s+/);let at=0;
    const word=w=>requireThat(tokens[at++]?.toLowerCase()===w,'Malformed ASCII STL.');
    const number=()=>{const v=Number(tokens[at++]);requireThat(Number.isFinite(v),'Nonfinite STL coordinate.');return v;};
    while(at<tokens.length&&tokens[at]){
      word('facet');word('normal');number();number();number();word('outer');word('loop');
      facets.push(Array.from({length:3},()=>{word('vertex');return [number()*factor,number()*factor,number()*factor];}));
      word('endloop');word('endfacet');requireThat(facets.length<=100000,'STL exceeds 100000 triangles.');
    }
  }
  const vertices=[],triangles=[],lookup=new Map();
  for(const facet of facets)triangles.push(facet.map(p=>{const key=p.join(',');if(!lookup.has(key)){lookup.set(key,vertices.length);vertices.push(p);}return lookup.get(key);}));
  makeMesh(vertices,triangles);
  return {vertices,triangles};
}
