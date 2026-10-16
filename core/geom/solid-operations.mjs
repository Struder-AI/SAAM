// One construction pipeline retains ordinary geometry. Mesh output is an
// explicit derived result; only operations requiring a mesh allocate the kernel.
import {solidKernel,solidFromMesh,meshFromSolid,discardSolidKernel,KERNEL_TRIANGLE_CAPACITY} from './solid.mjs';
import {tessellateSolid} from './boolean-display.mjs';
import {buildShell,buildShells,translateShell} from './build.mjs';
import {booleanShell} from './boolean-solid.mjs';
import {revolvedProfile} from './revolved-profile.mjs';
import {boxGeometry,polygonProfile,loftProfiles,transformGeometry} from './solid-profiles.mjs';
import {rigid} from './frame.mjs';
import {requireThat,distance} from './tolerance.mjs';

async function prepareConstructions(requests){
  const cache=new Map();
  async function prepare(request){
    if(cache.has(request))return cache.get(request);
    const result=await construct(request);cache.set(request,result);return result;
  }
  async function construct(request){
    if(request.kind||!request.shape&&request.patches)return {solid:request,geometry:null,notes:request.notes??[]};
    if(request.shape){
      const physical=request.solid??request;
      const geometry=physical.shape!=='mesh'&&Array.isArray(physical.vertices)&&Array.isArray(physical.triangles)?{shape:'mesh',source:physical.source??null,vertices:physical.vertices,triangles:physical.triangles}:physical;
      return {geometry,solid:null,notes:[]};
    }
    if(['union','difference','intersection'].includes(request.operation)){
      const children=[];for(const operand of request.operands)children.push(await prepare(operand));
      if(!children.length){requireThat(request.operation==='union','Difference and intersection need operands.');return {geometry:{shape:'mesh',source:null,vertices:[],triangles:[]},solid:null,notes:[]};}
      const geometry=children.every(c=>c.geometry)?children.length===1?children[0].geometry:{shape:'boolean',operation:request.operation,operands:children.map(c=>c.geometry)}:null;
      const solid=geometry?null:children.length===1?numerical(children[0]):booleanShell(request.operation,children.map(numerical));
      return {solid,geometry,notes:[...new Set([...children.flatMap(c=>c.notes),...solid?.notes??[]])]};
    }
    if(request.operation==='translate'){
      const child=await prepare(request.geometry),geometry=child.geometry?transformGeometry(child.geometry,rigid(request.offset)):null;
      return {geometry,solid:geometry?null:translateShell(numerical(child),...request.offset),notes:child.notes};
    }
    if(request.operation==='box')return prepare(boxGeometry(request.size));
    if(request.operation==='cylinder')return prepare(revolvedProfile({positionMm:[0,0,0],axis:[0,0,1],profile:[[0,request.radiusMm],[request.heightMm,request.radiusMm]]}));
    if(request.operation==='loft')return prepare(loftProfiles({profiles:request.rings.map(polygonProfile),centers:request.centers}));
    if(request.operation==='mapped-extrusion'){
      const kernel=await solidKernel(),mapped=mappedExtrusion(kernel,request);
      try{const mesh=meshFromSolid(mapped.solid),geometry={shape:'mesh',source:null,vertices:mesh.vertices,triangles:mesh.triangles};return {geometry,solid:null,notes:mapped.notes};}
      finally{mapped.solid.delete();}
    }
    throw Error('Unknown solid construction operation: '+request.operation);
  }
  const numerical=result=>result.solid??=buildShell(null,result.geometry,{material:true,native:false});
  const results=[];for(const request of requests)results.push(await prepare(request));
  const sources=results.filter(result=>!result.solid),built=buildShells(null,sources.map(result=>result.geometry),{material:true,native:false});
  sources.forEach((result,i)=>{result.solid=built[i];result.notes=[...new Set([...result.notes,...built[i].notes??[]])];});return results;
}
// Retained results are ordinary serializable geometry; empty results remain empty.
export async function constructGeometry(requests,options={}){
  const prepared=await prepareConstructions(requests);
  requireThat(prepared.every(result=>result.geometry),'Retained construction needs authored geometry, not an opaque prepared solid.');
  const present=await materialPresence(prepared.map(result=>result.solid),options);
  return prepared.map((result,i)=>({geometry:present[i]?result.geometry:{shape:'mesh',source:null,vertices:[],triangles:[]},empty:!present[i],notes:result.notes}));
}
export async function constructSolids(requests,{toleranceMm=.02}={}){
  const prepared=await prepareConstructions(requests),kernel=await solidKernel(),meshes=[];
  for(const result of prepared){
    const mesh=await tessellateSolid(result.solid,{toleranceMm}),solid=solidFromMesh(kernel,mesh);
    try{requireThat(solid.status()==='NoError','Solid construction produced invalid geometry.');meshes.push(solid.isEmpty()?null:{...meshFromSolid(solid),notes:[...new Set([...result.notes,...mesh.notes??[]])]});}
    finally{solid.delete();}
  }
  return meshes;
}
export async function materialPresence(solids,options={}){
  const pending=solids.filter(solid=>solid.kind==='boolean'&&!solid.empty),meshes=pending.length?await constructSolids(pending,options):[];
  const answers=new Map(pending.map((solid,i)=>[solid,meshes[i]!==null]));return solids.map(solid=>answers.get(solid)??!solid.empty);
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

