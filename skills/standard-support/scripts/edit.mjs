const requireThat=(condition,message)=>{if(!condition)throw Error(message);};

// Source stays an ordinary Boolean operand; support claims are ordinary Slice
// volumes. Each authored contribution has no private reconstruction lifecycle.
export async function editStandardSupport(source,request,{buildGeometry,constructSolids,closeMeshPatchToPlane}){
  requireThat(request&&typeof request==='object'&&!Array.isArray(request),'Standard support needs a request.');
  requireThat(Object.keys(request).every(key=>['id','part','roof','triangleIndices','gapMm','fillDensity','angleDeg','baseLayers','reason'].includes(key)),'Unknown standard-support request field.');
  const {id,part=null,roof,triangleIndices,gapMm=.15,fillDensity=.2,angleDeg=0,baseLayers=2,reason='Authored underside support.'}=request;
  requireThat(typeof id==='string'&&/^[a-z][a-z0-9-]*$/.test(id),'Standard support needs a stable assignment id.');
  requireThat(typeof reason==='string'&&reason.trim().length>0,'Record why these underside patches need support.');
  const geometry=structuredClone(source.geometry),assignments=structuredClone(source.slices?.assignments??[]);
  requireThat(!assignments.some(a=>a.id===id),'The assignment id already exists; edit its ordinary geometry and Slice settings or use another id.');
  const component=geometry?.shape==='assembly'?geometry.parts.find(p=>p.id===part):null;
  requireThat(geometry?.shape==='assembly'?!!component:part===null,'Select the mesh component for an assembly, or leave part null for a single part.');
  const original=component?component.geometry:geometry;
  requireThat((roof===undefined)!==(triangleIndices===undefined),'Supply either explicit roof geometry or triangleIndices from the current manufacturing mesh.');
  if(roof!==undefined)requireThat(roof&&Object.keys(roof).sort().join()==='triangles,vertices'&&Array.isArray(roof.triangles),'Supply an explicit selected roof mesh with vertices and triangles.');
  else requireThat(Array.isArray(original?.vertices)&&Array.isArray(original?.triangles),'The current component is not an indexed manufacturing mesh; supply an explicit copied roof.');
  const patch=roof??original,selection=triangleIndices??roof.triangles.map((_,i)=>i);
  requireThat(Number.isFinite(gapMm)&&gapMm>=0,'Support gapMm must be nonnegative.');
  requireThat(Number.isFinite(fillDensity)&&fillDensity>=0&&fillDensity<=1,'Support fillDensity must be between zero and one, inclusive.');
  requireThat(Number.isFinite(angleDeg),'Support angleDeg must be finite.');
  requireThat(Number.isSafeInteger(baseLayers)&&baseLayers>=0,'Support baseLayers must be a nonnegative whole number; zero explicitly omits the adhesion base.');
  // Recipe Z is already above the build plate; only an assembly component has
  // a local Z origin. Raised parts still need supports reaching the real bed.
  const bedZMm=-(component?.zMm??0);
  const support=closeMeshPatchToPlane(patch,{triangleIndices:selection,planeZMm:bedZMm,offsetMm:-gapMm});
  const supportShell=buildGeometry(support);
  const placedSupport=component?{operation:'translate',geometry:supportShell,offset:[component.xMm,component.yMm,component.zMm]}:supportShell;
  const sourceSolids=geometry.shape==='assembly'?geometry.parts.map(p=>({operation:'translate',geometry:buildGeometry(p.geometry),offset:[p.xMm,p.yMm,p.zMm]})):[buildGeometry(original)];
  const obstacles=sourceSolids.length===1?sourceSolids[0]:{operation:'union',operands:sourceSolids};
  const [occlusion]=await constructSolids([{operation:'intersection',operands:[placedSupport,obstacles]}]);
  requireThat(!occlusion,'The vertical support volume crosses part material below the selected underside. Select accessible patches or explicitly author a cutout; no supports were saved.');
  // assignmentRequests accepts ordinary Slice settings at the existing engine
  // boundary, so no extension-specific deposition configuration is introduced.
  const supportRequest={id,part,loops:0,fillDensity,fillPattern:'rectilinear',fillAnglesDeg:[angleDeg],rotateFill:false,connectNearby:false,
    solidTop:0,solidBottom:baseLayers,process:{liftMm:0,retractMm:0},within:[{kind:'geometry',geometry:support}],description:reason};
  const assignmentRequests=[supportRequest,...assignments];
  const replacement={shape:'boolean',operation:'union',operands:[original,support],displayOperand:0};
  if(component)component.geometry=replacement;
  return {geometry:component?geometry:replacement,assignmentRequests,report:{id,part,roofTriangles:selection.length,gapMm,fillDensity,angleDeg,baseLayers,
    adhesion:baseLayers?'Dense bottom courses provide the support base.':'No adhesion base requested; review bed adhesion.',
    separation:'Geometric roof gap; actual Slice gap also depends on layer sampling.',physicalValidation:'provisional'}};
}
