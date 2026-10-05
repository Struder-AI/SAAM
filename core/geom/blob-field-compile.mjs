// Explicit blob field -> manufacturing mesh conversion; slicing and Studio use the mesh.
import {solidKernel,solidFromMesh,preciseSolidMesh} from './solid.mjs';
import {makeMesh} from './mesh.mjs';
import {prepareBlobField,evaluateBlobField,blobFieldBounds} from './blob-field.mjs';
import {BLOB_FIELD_COMPILER,validateBlobFieldExtraction,blobFieldDigest} from './blob-field-record.mjs';
import {requireThat,cross} from './tolerance.mjs';

// The extraction lattice follows edgeMm and the points' extent; there is no
// work budget, so a fine edgeMm over a large field is slow rather than refused.
export async function compileBlobField(field,{edgeMm}={}){
  field=structuredClone(field);
  const prepared=prepareBlobField(field);blobFieldBounds(field);
  const extraction={compiler:BLOB_FIELD_COMPILER,edgeMm};validateBlobFieldExtraction(extraction);
  const surface=extractBlobSurface(prepared,field,edgeMm);
  requireThat(surface.triangles.length>0,'Blob field extraction is empty; raise strengths or reaches, or lower edgeMm.');
  // The bed plane Z = 0 cuts the closed surface into an exact flat base.
  const kernel=await solidKernel();let whole,solid;
  try{
    whole=solidFromMesh(kernel,surface);solid=whole.trimByPlane([0,0,1],0);
    requireThat(solid.status()==='NoError'&&!solid.isEmpty(),'Blob field extraction is empty above the bed plane Z = 0; raise strengths or reaches, or move points up.');
    const {vertices,triangles}=preciseSolidMesh(solid);
    try{makeMesh(vertices,triangles);}
    catch(error){throw Object.assign(new Error(`Blob field extraction made an invalid mesh (${error.reason??error.message}). This is a SAAM defect, not a fault in the field or an STL to import or repair; report it with the request. A different edgeMm may avoid it.`),{meshDiagnostic:error.meshDiagnostic});}
    const record={shape:'blob-field',field,extraction,vertices,triangles};
    return {...record,compiledHash:blobFieldDigest(record)};
  }finally{solid?.delete();whole?.delete();}
}

// Marching tetrahedra on a cubic lattice of spacing edgeMm, each cube split
// into the six tetrahedra around its main diagonal, so neighbouring cubes agree
// on every face diagonal. A surface vertex lies on a lattice edge whose ends
// differ in sign, CROSSING_MARGIN of the edge away from either end, so no two
// vertices coincide and every triangle has area bounded away from zero: the
// surface is closed, embedded and manifold by construction. The lattice
// extends past every positive reach (where the field is zero) and places
// Z = 0 midway between layers.
const CROSSING_MARGIN=0.01;
const CUBE_TETRAHEDRA=[[0,1,3,7],[0,1,5,7],[0,2,3,7],[0,2,6,7],[0,4,5,7],[0,4,6,7]];
function extractBlobSurface(prepared,field,edgeMm){
  const h=edgeMm,positive=field.points.filter(p=>p.strength>0);
  const low=[0,1,2].map(a=>Math.min(...positive.map(p=>p.positionMm[a]-p.reachMm))-h);
  const high=[0,1,2].map(a=>Math.max(...positive.map(p=>p.positionMm[a]+p.reachMm))+h);
  const first=[Math.floor(low[0]/h),Math.floor(low[1]/h),Math.floor(low[2]/h-0.5)+0.5];
  const [nx,ny,nz]=[0,1,2].map(a=>Math.ceil(high[a]/h-first[a])+1);
  requireThat(Number.isSafeInteger(nx*ny*nz*8),'Blob field lattice exceeds exact integer indexing; raise edgeMm.');
  const coordinate=(a,index)=>(first[a]+index)*h;
  const sampleLayer=k=>{
    const z=coordinate(2,k),values=new Float64Array(nx*ny);
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)values[j*nx+i]=evaluateBlobField(prepared,[coordinate(0,i),coordinate(1,j),z]).value-field.threshold;
    return values;
  };
  const vertices=[],triangles=[],edgeVertex=new Map(),value=new Float64Array(8),inside=new Array(8);
  const layers={below:sampleLayer(0)};
  for(let k=0;k+1<nz;k++){
    const below=layers.below,above=sampleLayer(k+1);
    for(let j=0;j+1<ny;j++)for(let i=0;i+1<nx;i++){
      let insideCount=0;
      for(let c=0;c<8;c++){value[c]=(c&4?above:below)[(j+(c>>1&1))*nx+i+(c&1)];inside[c]=value[c]>0;if(inside[c])insideCount++;}
      if(insideCount===0||insideCount===8)continue;
      // Corner c of this cube is offset by its bits x = 1, y = 2, z = 4.
      const corner=c=>[coordinate(0,i+(c&1)),coordinate(1,j+(c>>1&1)),coordinate(2,k+(c>>2))];
      // Tetrahedra join only corners a ⊂ b, so an edge is owned by its lower
      // corner's lattice node and named by the offset bits b ^ a.
      const crossing=(a,b)=>{
        const [lo,hi]=a<b?[a,b]:[b,a],key=(((k+(lo>>2))*ny+j+(lo>>1&1))*nx+i+(lo&1))*8+(hi^lo),known=edgeVertex.get(key);
        if(known!==undefined)return known;
        const t=Math.min(1-CROSSING_MARGIN,Math.max(CROSSING_MARGIN,value[lo]/(value[lo]-value[hi]))),p=corner(lo),q=corner(hi);
        edgeVertex.set(key,vertices.length);vertices.push(p.map((v,axis)=>v+t*(q[axis]-v)));return vertices.length-1;
      };
      // Wind each piece so its normal points away from the inside corner `from`.
      const emit=(from,polygon)=>{
        const p=polygon.map(v=>vertices[v]),n=cross(p[1].map((v,a)=>v-p[0][a]),p[2].map((v,a)=>v-p[0][a])),o=corner(from);
        const w=n.reduce((sum,v,a)=>sum+v*(o[a]-p[0][a]),0)>0?[polygon[0],...polygon.slice(1).reverse()]:polygon;
        triangles.push([w[0],w[1],w[2]]);if(w.length===4)triangles.push([w[0],w[2],w[3]]);
      };
      for(const tetrahedron of CUBE_TETRAHEDRA){
        const ins=tetrahedron.filter(c=>inside[c]),outs=tetrahedron.filter(c=>!inside[c]);
        if(ins.length===1)emit(ins[0],outs.map(c=>crossing(ins[0],c)));
        else if(ins.length===3)emit(ins[0],ins.map(c=>crossing(c,outs[0])));
        else if(ins.length===2){const [a,b]=ins,[c,d]=outs;emit(a,[crossing(a,c),crossing(a,d),crossing(b,d),crossing(b,c)]);}
      }
    }
    layers.below=above;
  }
  return {vertices,triangles};
}
