// Explicit, resolution-dependent solid reconstruction. Never called by import.
import {decodeSTL,makeMesh,parseSTL} from './mesh.mjs';
import {triangleIndex,checkAdjacentContacts} from './mesh-spatial.mjs';
import {subtract as sub,cross,dot,requireThat} from './tolerance.mjs';

export function cleanTriangleSoup(input) {
  requireThat(Array.isArray(input.vertices)&&Array.isArray(input.triangles),'Repair needs vertices and triangles.');
  requireThat(input.vertices.length<=300000&&input.triangles.length<=100000,'Repair input exceeds 300000 vertices or 100000 triangles.');
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
  const compact=compactMesh(vertices,triangles);
  return {...compact,removed:{degenerate,duplicates,unusedOrDuplicateVertices:input.vertices.length-compact.vertices.length}};
}

export function compactMesh(vertices,triangles) {
  const used=new Map(),points=[];
  return {vertices:points,triangles:triangles.map(t=>t.map(i=>{if(!used.has(i)){used.set(i,points.length);points.push(vertices[i]);}return used.get(i);}))};
}

function checkClosedWinding({triangles}) {
  const edges=new Map();
  for(const t of triangles)for(let k=0;k<3;k++){const a=t[k],b=t[(k+1)%3],key=a<b?`${a}:${b}`:`${b}:${a}`,e=edges.get(key)??{count:0,sum:0};e.count++;e.sum+=a<b?1:-1;edges.set(key,e);}
  requireThat([...edges.values()].every(e=>e.count===2&&e.sum===0),'Winding reconstruction requires a closed, consistently oriented triangle surface after cleanup; open edges, nonmanifold edges and inconsistent winding need an explicit source correction.');
}

// A conforming six-tetrahedra subdivision uses the same diagonal on shared faces.
const TETS=[[0,1,3,7],[0,3,2,7],[0,2,6,7],[0,6,4,7],[0,4,5,7],[0,5,1,7]];
const CORNERS=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];

export function reconstructMesh(input,{resolutionMm,maxGridPoints=16000000,maxOutputTriangles=2000000,fillRule='nonzero',progress=()=>{}}={}) {
  requireThat(Number.isFinite(resolutionMm)&&resolutionMm>0,'Specify a positive repair resolutionMm in millimeters.');
  requireThat(['nonzero','evenodd'].includes(fillRule),'Repair fillRule must be nonzero or evenodd.');
  requireThat(Number.isSafeInteger(maxGridPoints)&&maxGridPoints>=64&&maxGridPoints<=64000000,'Repair maxGridPoints must be 64–64000000.');
  requireThat(Number.isSafeInteger(maxOutputTriangles)&&maxOutputTriangles>=4&&maxOutputTriangles<=2000000,'Repair maxOutputTriangles must be 4–2000000.');
  const mesh=cleanTriangleSoup(input);checkClosedWinding(mesh);
  const index=triangleIndex(mesh.vertices,mesh.triangles),h=resolutionMm;
  // Non-dyadic phase reduces coincidences with source facets; half-open ray tests
  // still own projected shared edges exactly. Padding closes the extracted solid.
  const origin=index.bounds.min.map(v=>v-h*1.314159265359);
  const dims=index.bounds.max.map((v,k)=>Math.ceil((v-origin[k])/h)+3),[nx,ny,nz]=dims,count=nx*ny*nz;
  requireThat(Number.isSafeInteger(count)&&count<=maxGridPoints,`Repair needs ${count} grid points; allowance is ${maxGridPoints}. Increase maxGridPoints or explicitly choose a coarser resolutionMm.`);
  const inside=new Uint8Array(count),id=(x,y,z)=>x+nx*(y+ny*z),position=i=>{const x=i%nx,y=Math.floor(i/nx)%ny,z=Math.floor(i/(nx*ny));return [origin[0]+x*h,origin[1]+y*h,origin[2]+z*h];};
  progress({stage:'classify',gridPoints:count,dimensions:dims});
  let occupied=0;
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++){
    const hits=index.crossings(origin[1]+y*h,origin[2]+z*h);let at=0,winding=0;
    for(let x=0;x<nx;x++){
      const px=origin[0]+x*h;while(at<hits.length&&hits[at].x<px)winding+=hits[at++].sign;
      if(fillRule==='nonzero'?winding!==0:Math.abs(winding)%2===1){inside[id(x,y,z)]=1;occupied++;}
    }
    while(at<hits.length)winding+=hits[at++].sign;
    requireThat(winding===0,'Projected winding did not close; cannot reconstruct this source at the selected grid phase.');
  }
  requireThat(occupied>0,'No material resolved; use a finer resolution or correct the source orientation.');
  const values=new Map(),edgeVertices=new Map(),vertices=[],triangles=[];
  function value(i){if(!values.has(i)){const distance=index.nearest(position(i)).distance;values.set(i,(inside[i]?-1:1)*Math.max(distance,h*1e-3));}return values.get(i);}
  function vertex(a,b){
    const key=a<b?a*count+b:b*count+a;
    if(!edgeVertices.has(key)){const p=position(a),q=position(b),va=value(a),vb=value(b),t=va/(va-vb);edgeVertices.set(key,vertices.length);vertices.push(p.map((v,k)=>v+(q[k]-v)*t));}
    return edgeVertices.get(key);
  }
  function emit(t,outward){
    const [a,b,c]=t.map(i=>vertices[i]);if(dot(cross(sub(b,a),sub(c,a)),outward)<0)[t[1],t[2]]=[t[2],t[1]];
    triangles.push(t);requireThat(triangles.length<=maxOutputTriangles,`Repair exceeded ${maxOutputTriangles} output triangles; increase maxOutputTriangles or explicitly coarsen resolutionMm.`);
  }
  progress({stage:'surface',occupiedGridPoints:occupied});
  for(let z=0;z<nz-1;z++)for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++){
    const ids=CORNERS.map(([dx,dy,dz])=>id(x+dx,y+dy,z+dz)),sum=ids.reduce((s,i)=>s+inside[i],0);if(sum===0||sum===8)continue;
    for(const tet of TETS){
      const a=tet.map(i=>ids[i]),neg=a.filter(i=>inside[i]),pos=a.filter(i=>!inside[i]);if(!neg.length||!pos.length)continue;
      const mean=ids=>ids.map(position).reduce((s,p)=>s.map((v,k)=>v+p[k]/ids.length),[0,0,0]),outward=sub(mean(pos),mean(neg));
      if(neg.length===1)emit(pos.map(i=>vertex(neg[0],i)),outward);
      else if(pos.length===1)emit(neg.map(i=>vertex(pos[0],i)),outward);
      else {const [a,b]=neg,[c,d]=pos,ac=vertex(a,c),ad=vertex(a,d),bc=vertex(b,c),bd=vertex(b,d);emit([ac,ad,bd],outward);emit([ac,bd,bc],outward);}
    }
  }
  const report={method:'winding-grid-marching-tetrahedra/1',resolutionMm,fillRule,removed:mesh.removed,gridPoints:count,gridDimensions:dims,occupiedGridPoints:occupied,inputTriangles:input.triangles.length,reconstructedTriangles:triangles.length,
    limitations:['Resolution-dependent reconstruction; features and gaps smaller than the grid spacing can disappear or join.','Nonzero winding defines material; overlapping oppositely oriented surfaces can cancel.','No certified surface-distance or topology-preservation bound. Geometry review is required.']};
  progress({stage:'reconstructed',triangles:triangles.length});return {vertices,triangles,report};
}

// Decimal STL preserves JS coordinates through the shared decoder. Float32 STL
// can create new contacts when newly reconstructed vertices are rounded.
export function encodeRepairSTL(mesh) {
  const lines=['solid saam_repaired'];
  for(const t of mesh.triangles){const [a,b,c]=t.map(i=>mesh.vertices[i]),n=cross(sub(b,a),sub(c,a)),length=Math.hypot(...n);requireThat(length>1e-10,'Repair produced a degenerate triangle.');lines.push(`facet normal ${n.map(v=>v/length).join(' ')}`,'outer loop',...t.map(i=>`vertex ${mesh.vertices[i].join(' ')}`),'endloop','endfacet');}
  lines.push('endsolid saam_repaired');return Buffer.from(lines.join('\n')+'\n');
}

export function validateRepair(mesh) {
  makeMesh(mesh.vertices,mesh.triangles);
  checkAdjacentContacts(mesh);
  const bytes=encodeRepairSTL(mesh);parseSTL(bytes,{units:'mm'});return bytes;
}

export {decodeSTL};
