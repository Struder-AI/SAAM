// Construction requests are ordinary geometry and operation records. This is
// the only owner of native temporaries for feature construction; shared input
// identity preserves lazy boolean reuse until all requested meshes are read.
import {solidKernel,solidFromMesh,meshFromSolid,discardSolidKernel,KERNEL_TRIANGLE_CAPACITY} from './solid.mjs';
import {tessellateSolid} from './boolean-display.mjs';
import {requireThat,distance} from './tolerance.mjs';
import {nativeSurfaceSolid,surfaceBoolean} from './surface-boolean.mjs';

// -> per request, a mesh with the notes of its construction (an approximation
// kept short of its tolerance), or null for no material.
export async function constructSolids(requests,{toleranceMm=.02}={}){
  const kernel=await solidKernel(),owned=[],cache=new Map(),notes=new Map(),boundaries=new Map();
  const keep=solid=>{owned.push(solid);return solid;};
  const operandsOf=async request=>{const solids=[];for(const operand of request.operands)solids.push(await evaluate(operand));return solids;};
  const evaluate=async request=>{
    if(cache.has(request))return cache.get(request);
    const own=[],state={solid:null};
    const boundary=nativeConstruction(request,boundaries);
    if(boundary){
      const mesh=await tessellateSolid(boundary,{toleranceMm});own.push(...mesh.notes??[]);state.solid=keep(solidFromMesh(kernel,mesh));
    }else switch(request.kind?null:request.operation){
      case 'union': state.solid=keep(kernel.Manifold.union(await operandsOf(request)));break;
      case 'intersection': state.solid=keep(kernel.Manifold.intersection(await operandsOf(request)));break;
      case 'difference': {const [first,...rest]=await operandsOf(request);state.solid=first;for(const operand of rest)state.solid=keep(state.solid.subtract(operand));break;}
      case 'translate': state.solid=keep((await evaluate(request.geometry)).translate(request.offset));break;
      case 'box': state.solid=keep(kernel.Manifold.cube(request.size));break;
      case 'cylinder': state.solid=keep(kernel.Manifold.cylinder(request.heightMm,request.radiusMm,request.radiusMm,request.segments));break;
      case 'loft': state.solid=keep(solidFromMesh(kernel,loftMesh(request.rings,request.centers)));break;
      case 'mapped-extrusion': {const extrusion=mappedExtrusion(kernel,request);state.solid=keep(extrusion.solid);own.push(...extrusion.notes);break;}
      default: {const mesh=await tessellateSolid(request,{toleranceMm});own.push(...mesh.notes??[]);state.solid=keep(solidFromMesh(kernel,mesh));}
    }
    requireThat(state.solid.status()==='NoError','Solid construction produced invalid geometry.');
    const inputs=request.kind?[]:request.operation==='translate'?[request.geometry]:request.operands??[];
    notes.set(request,[...new Set([...own,...inputs.flatMap(input=>notes.get(input)??[])])]);
    cache.set(request,state.solid);return state.solid;
  };
  try{
    const meshes=[];
    for(const request of requests){const solid=await evaluate(request);meshes.push(solid.isEmpty()?null:{...meshFromSolid(solid),notes:notes.get(request)});}
    return meshes;
  }finally{for(const solid of owned.reverse())try{solid.delete();}catch{}}
}

// The same native Boolean implementation serves value construction and explicit
// mesh-output requests. Only the completed boundary is converted for the latter.
function nativeConstruction(request,cache){
  if(cache.has(request))return cache.get(request);
  if(nativeSurfaceSolid(request)){cache.set(request,request);return request;}
  if((request.kind&&request.kind!=='boolean')||!['union','difference','intersection'].includes(request.operation))return null;
  const operands=request.operands.map(operand=>nativeConstruction(operand,cache));
  const native=operands.length&&operands.every(Boolean)?operands.length===1?operands[0]:surfaceBoolean(request.operation,operands):null;
  cache.set(request,native);return native;
}

// Material existence is a geometric query. Native boundaries already know
// whether any faces survived; mixed Boolean trees need their mesh construction.
// Evaluate them together so shared input conversion and native lifetime stay here.
export async function materialPresence(solids){
  const pending=solids.filter(solid=>solid.kind==='boolean'&&!solid.empty);
  const meshes=pending.length?await constructSolids(pending):[];
  const answers=new Map(pending.map((solid,i)=>[solid,meshes[i]!==null]));
  return solids.map(solid=>answers.get(solid)??!solid.empty);
}
function loftMesh(rings,centers){
  const n=rings[0].length,vertices=rings.flat(),triangles=[];
  requireThat(rings.length>=2&&n>=3&&rings.every(r=>r.length===n),'Loft rings need matching vertex correspondence.');
  for(let layer=0;layer<rings.length-1;layer++)for(let j=0;j<n;j++){
    const a=layer*n+j,b=layer*n+(j+1)%n,c=b+n,d=a+n;triangles.push([a,b,c],[a,c,d]);
  }
  const bottom=vertices.length,top=bottom+1;vertices.push(...centers);
  for(let j=0;j<n;j++){triangles.push([bottom,(j+1)%n,j]);const offset=(rings.length-1)*n;triangles.push([top,offset+j,offset+(j+1)%n]);}
  return {vertices,triangles};
}

function mappedExtrusion(kernel,{loops,map,lower,upper,maxEdgeMm,toleranceMm,normalSide=1}){
  let solid=kernel.Manifold.extrude(loops,upper-lower);
  try{
    const shifted=solid.translate([0,0,lower]);solid.delete();solid=shifted;
    // maxEdgeMm and toleranceMm decide the triangle count. Only a mesh the
    // 32-bit kernel cannot address at all is refused in advance; an actual
    // kernel failure discards the aborted instance and names its cause.
    const input=solid.getMesh();let estimated=0;
    const point=id=>Array.from(input.vertProperties.slice(id*input.numProp,id*input.numProp+3));
    for(let i=0;i<input.triVerts.length;i+=3){
      const p=Array.from(input.triVerts.slice(i,i+3),point),n=Math.ceil(Math.max(...p.map((v,j)=>distance(v,p[(j+1)%3])))/maxEdgeMm);
      estimated+=n*n;
    }
    requireThat(estimated<=KERNEL_TRIANGLE_CAPACITY,`Solid subdivision at ${maxEdgeMm} mm needs about ${estimated} triangles, beyond the ${KERNEL_TRIANGLE_CAPACITY} the solid kernel can address; increase maxEdgeMm or simplify the geometry.`);
    const grow=(step,what)=>{
      try{const next=step();solid.delete();return next;}
      catch(error){discardSolidKernel();throw new Error(`The solid kernel failed while ${what}: ${error.message}. Increase maxEdgeMm or toleranceMm, or simplify the geometry.`);}
    };
    solid=grow(()=>solid.refineToLength(maxEdgeMm),`refining geometry to ${maxEdgeMm} mm edges`);
    // Each pass quarters the sampled deviation of a smooth reference. A pass
    // that fails to reduce it will not reach toleranceMm, so the finest mesh
    // is kept and its deviation noted, rather than counting passes.
    for(let previousError=Infinity;;){
      const mesh=solid.getMesh();
      let error=0;
      const at=id=>Array.from(mesh.vertProperties.slice(id*mesh.numProp,id*mesh.numProp+3));
      for(let i=0;i<mesh.triVerts.length;i+=3){
        const p=Array.from(mesh.triVerts.slice(i,i+3),at),q=p.map(map);
        for(const w of [[0.5,0.5,0],[0,0.5,0.5],[0.5,0,0.5],[1/3,1/3,1/3]]){
          const mid=p[0].map((_,k)=>p.reduce((sum,v,n)=>sum+v[k]*w[n],0));
          const chord=q[0].map((_,k)=>q.reduce((sum,v,n)=>sum+v[k]*w[n],0));
          error=Math.max(error,distance(map(mid),chord));
        }
      }
      if(error<=toleranceMm||error>=previousError*0.9){
        // Reversing the reference normal reverses the map's handedness.
        // Manifold's mirror updates winding before the orientation-preserving warp.
        const source=normalSide===-1?solid.mirror([0,0,1]):solid;
        let warped;
        try{warped=source.warp(p=>{const q=map([p[0],p[1],p[2]*normalSide]);p[0]=q[0];p[1]=q[1];p[2]=q[2];});}
        finally{if(source!==solid)source.delete();}
        try{meshFromSolid(warped);}catch(error){warped.delete();throw error;}
        return {solid:warped,notes:error<=toleranceMm?[]:[`Mapped extrusion tessellation stopped converging at ${error.toFixed(6)} mm against a ${toleranceMm} mm tolerance; the finest mesh is used.`]};
      }
      previousError=error;
      solid=grow(()=>solid.refine(2),'refining mapped extrusion against its reference');
    }
    // A discarded kernel cannot free its own solids; releasing this one must not
    // replace the failure that discarded it.
  }finally{try{solid.delete();}catch{}}
}

