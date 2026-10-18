// Support geometry: closed solids under authored contacts, sliced as ordinary
// Slice volumes. Pure: no kernel or host calls. The current editor supplies
// roof closing through the shared Geometry operations.
// copies core/dimensions.mjs PRINT_RESOLUTION_MM; this runtime has no release-relative imports
const PRINT_RESOLUTION_MM=1e-3;
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
const finitePoint=(p,n)=>Array.isArray(p)&&p.length===n&&p.every(Number.isFinite);

// gapMm: owner, 2026-10-05, "let's make that a 0.15mm gap moving forward".
// chordMm is process scale: a branch circle's chord error, a twentieth of a 0.4 mm line.
export const STANDARD_SUPPORT=Object.freeze({gapMm:.15,fillDensity:.2,angleDeg:0,baseLayers:2,chordMm:.02,description:'Authored underside support.'});

// The owner's method as ordinary Slice settings: no loops, one fill direction,
// dense bottom slices as the bed base, no hop or retract.
export function supportSlice({id,part=null,solid,fillDensity,angleDeg,baseLayers,description}){
  return {id,part,loops:0,fillDensity,fillPattern:'rectilinear',fillAnglesDeg:[angleDeg],rotateFill:false,connectNearby:false,
    solidTop:0,solidBottom:baseLayers,process:{liftMm:0,retractMm:0},geometry:solid,description};
}

export const supportSolid=meshes=>meshes.length===1?meshes[0]:{shape:'boolean',operation:'union',operands:meshes};

const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const signedArea=loop=>loop.reduce((sum,p,i)=>sum+cross([0,0],p,loop[(i+1)%loop.length]),0)/2;
function inside(loop,[x,y]){
  let hit=false;
  for(let i=0,j=loop.length-1;i<loop.length;j=i++){const [ax,ay]=loop[i],[bx,by]=loop[j];if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)hit=!hit;}
  return hit;
}
function segmentsCross(a,b,c,d){
  const d1=cross(c,d,a),d2=cross(c,d,b),d3=cross(a,b,c),d4=cross(a,b,d);
  return (d1>0)!==(d2>0)&&(d3>0)!==(d4>0)&&d1&&d2&&d3&&d4;
}
// Ear clipping over point indices; a hole joins its outer loop by a bridge to the
// nearest outer vertex it can see, so bridge vertices repeat by index.
function triangulate(points,outer,holes){
  const ring=[...outer];
  for(const hole of [...holes].sort((a,b)=>Math.max(...b.map(i=>points[i][0]))-Math.max(...a.map(i=>points[i][0])))){
    const m=hole.reduce((best,i)=>points[i][0]>points[best][0]?i:best,hole[0]),others=holes.filter(h=>h!==hole);
    const edges=[ring,...others].flatMap(loop=>loop.map((i,k)=>[points[i],points[loop[(k+1)%loop.length]]]));
    const visible=ring.map((v,k)=>[v,k]).filter(([v])=>!edges.some(([a,b])=>segmentsCross(points[m],points[v],a,b)))
      .sort(([a],[b])=>Math.hypot(points[a][0]-points[m][0],points[a][1]-points[m][1])-Math.hypot(points[b][0]-points[m][0],points[b][1]-points[m][1]));
    requireThat(visible.length,'A footprint hole cannot be joined to its outer loop; separate crossing loops.');
    const [v,k]=visible[0],start=hole.indexOf(m),turned=[...hole.slice(start),...hole.slice(0,start)];
    ring.splice(k+1,0,...turned,m,v);
  }
  const triangles=[];
  for(let guard=ring.length**2;ring.length>3&&guard>0;guard--){
    const n=ring.length,ear=ring.findIndex((v,k)=>{
      const a=points[ring[(k+n-1)%n]],b=points[v],c=points[ring[(k+1)%n]],ids=[ring[(k+n-1)%n],v,ring[(k+1)%n]];
      return cross(a,b,c)>0&&!ring.some(i=>!ids.includes(i)&&cross(a,b,points[i])>=0&&cross(b,c,points[i])>=0&&cross(c,a,points[i])>=0);
    });
    // A vertex on a straight run adds no area and is dropped without a triangle.
    const flat=ring.findIndex((v,k)=>Math.abs(cross(points[ring[(k+n-1)%n]],points[v],points[ring[(k+1)%n]]))<PRINT_RESOLUTION_MM**2);
    const k=ear>=0?ear:flat;
    requireThat(k>=0,'A footprint loop crosses itself; supply simple loops.');
    if(ear>=0)triangles.push([ring[(k+n-1)%n],ring[k],ring[(k+1)%n]]);
    ring.splice(k,1);
  }
  if(ring.length===3&&cross(...ring.map(i=>points[i]))>0)triangles.push(ring);
  return triangles;
}

// A flat footprint at zMm becomes roof patches: each outer loop with the holes
// directly inside it, by even-odd nesting. Close each with closeMeshPatchToPlane.
export function footprintRoofs(loops,zMm){
  requireThat(Array.isArray(loops)&&loops.length&&loops.every(loop=>Array.isArray(loop)&&loop.every(p=>finitePoint(p,2))),'A footprint is a list of [x,y] loops.');
  requireThat(Number.isFinite(zMm),'A footprint needs a finite contact height.');
  const notes=[],kept=[];
  for(const [n,loop] of loops.entries()){
    const open=loop.filter((p,i)=>Math.hypot(p[0]-loop[(i+1)%loop.length][0],p[1]-loop[(i+1)%loop.length][1])>=PRINT_RESOLUTION_MM);
    if(open.length>=3&&Math.abs(signedArea(open))>=PRINT_RESOLUTION_MM**2)kept.push(open);
    else notes.push(`Footprint loop ${n} encloses no area and was skipped.`);
  }
  const depth=kept.map((loop,i)=>kept.filter((other,j)=>j!==i&&inside(other,loop[0])).length);
  const roofs=kept.flatMap((outer,i)=>{
    if(depth[i]%2)return [];
    const holes=kept.filter((hole,j)=>depth[j]===depth[i]+1&&inside(outer,hole[0]));
    const points=[],index=loop=>loop.map(p=>points.push(p)-1);
    const ccw=signedArea(outer)>0?outer:[...outer].reverse(),outerIds=index(ccw);
    const holeIds=holes.map(hole=>index(signedArea(hole)<0?hole:[...hole].reverse()));
    return [{vertices:points.map(([x,y])=>[x,y,zMm]),triangles:triangulate(points,outerIds,holeIds)}];
  });
  requireThat(roofs.length,'The footprint encloses no area.');
  return {roofs,notes};
}

// A lofted branch with horizontal circular sections, the same sections the
// retired tree slicer interpolated: closed rings at both ends, capped.
function branchMesh([x0,y0,z0],r0,[x1,y1,z1],r1,chordMm){
  const count=Math.max(12,Math.ceil(Math.PI/Math.acos(1-Math.min(chordMm/Math.max(r0,r1),1))));
  const ring=(x,y,z,r)=>Array.from({length:count},(_,i)=>[x+r*Math.cos(2*Math.PI*i/count),y+r*Math.sin(2*Math.PI*i/count),z]);
  const vertices=[...ring(x0,y0,z0,r0),...ring(x1,y1,z1,r1),[x0,y0,z0],[x1,y1,z1]],triangles=[];
  for(let i=0;i<count;i++){
    const j=(i+1)%count;
    triangles.push([2*count,j,i],[2*count+1,count+i,count+j],[i,j,count+j],[i,count+j,count+i]);
  }
  return {shape:'mesh',vertices,triangles,source:null};
}

// A tree skeleton: nodes {id,parent,point,radiusMm}, parent null at a root. Tips
// (nodes without children) sit at their contact and are lowered by gapMm.
export function treeSolids(nodes,{gapMm,chordMm,bedZMm=0}){
  requireThat(Array.isArray(nodes)&&nodes.length>=2,'A tree needs a list of at least two nodes.');
  const byId=new Map(),notes=[];
  for(const n of nodes){
    requireThat(n&&typeof n==='object'&&Object.keys(n).sort().join()==='id,parent,point,radiusMm','Tree nodes have exactly id, parent, point and radiusMm.');
    requireThat(typeof n.id==='string'&&n.id.length&&!byId.has(n.id),'Tree node ids are distinct nonempty strings.');
    requireThat(finitePoint(n.point,3),`Tree node ${n.id} needs a finite [x,y,z] point.`);
    requireThat(Number.isFinite(n.radiusMm)&&n.radiusMm>0,`Tree node ${n.id} needs a positive radius.`);
    byId.set(n.id,n);
  }
  const rooted=(n,seen)=>{
    requireThat(n.parent===null||byId.has(n.parent),`Tree node ${n.id} names a missing parent.`);
    requireThat(!seen.has(n.id),`Tree node ${n.id} lies on a parent cycle.`);
    return n.parent===null||rooted(byId.get(n.parent),new Set([...seen,n.id]));
  };
  for(const n of nodes)rooted(n,new Set());
  const tips=new Set(nodes.filter(n=>!nodes.some(c=>c.parent===n.id)).map(n=>n.id));
  const point=n=>tips.has(n.id)?[n.point[0],n.point[1],n.point[2]-gapMm]:n.point;
  for(const n of nodes)if(n.parent===null&&Math.abs(n.point[2]-bedZMm)>=PRINT_RESOLUTION_MM)notes.push(`Root ${n.id} starts ${(n.point[2]-bedZMm).toFixed(3)} mm from the bed.`);
  const solids=nodes.filter(n=>n.parent!==null).flatMap(n=>{
    const parent=byId.get(n.parent),[low,high]=[[point(parent),parent.radiusMm],[point(n),n.radiusMm]].sort((a,b)=>a[0][2]-b[0][2]);
    if(high[0][2]-low[0][2]>=PRINT_RESOLUTION_MM)return [branchMesh(low[0],low[1],high[0],high[1],chordMm)];
    notes.push(`Branch ${n.parent} to ${n.id} is horizontal and adds no sliced volume; it was skipped.`);return [];
  });
  requireThat(solids.length,'The tree has no branch with height.');
  return {solids,notes};
}

