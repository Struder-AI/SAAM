import {STANDARD_SUPPORT,footprintRoofs,treeSolids,supportSolid,supportSlice} from './support-geometry.mjs';
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
const SOURCES=['roof','triangleIndices','footprint','tree'];

// One support source becomes one closed solid: a selected or copied roof, or a
// flat footprint, lowered by the gap and closed to the bed; or a tree skeleton.
function sourceSolid(request,original,{gapMm,chordMm,bedZMm},closeMeshPatchToPlane){
  if(request.tree!==undefined){
    const built=treeSolids(request.tree,{gapMm,chordMm,bedZMm});
    const contacts=request.tree.filter(node=>!request.tree.some(child=>child.parent===node.id)).flatMap(node=>{
      const count=Math.max(12,Math.ceil(Math.PI/Math.acos(1-Math.min(chordMm/node.radiusMm,1))));
      const ring=Array.from({length:count},(_,i)=>[node.point[0]+node.radiusMm*Math.cos(i*2*Math.PI/count),node.point[1]+node.radiusMm*Math.sin(i*2*Math.PI/count),node.point[2]]);
      return ring.map((point,i)=>[node.point,point,ring[(i+1)%count]]);
    });
    return {...built,contacts};
  }
  if(request.footprint!==undefined)requireThat(request.footprint&&Object.keys(request.footprint).sort().join()==='loops,zMm','A footprint is {loops, zMm}.');
  const {roof,triangleIndices}=request;
  if(roof!==undefined)requireThat(roof&&Object.keys(roof).sort().join()==='triangles,vertices'&&Array.isArray(roof.triangles),'Supply an explicit roof mesh with vertices and triangles.');
  else if(triangleIndices!==undefined)requireThat(Array.isArray(original?.vertices)&&Array.isArray(original?.triangles),'The current component is not an indexed manufacturing mesh; supply an explicit copied roof.');
  const footprint=request.footprint&&footprintRoofs(request.footprint.loops,request.footprint.zMm);
  const patches=footprint?footprint.roofs.map(patch=>[patch,patch.triangles.map((_,i)=>i)]):[[roof??original,triangleIndices??roof.triangles.map((_,i)=>i)]];
  const close=offsetMm=>patches.map(([patch,selection])=>closeMeshPatchToPlane(patch,{triangleIndices:selection,planeZMm:bedZMm,offsetMm}));
  const closed=close(-gapMm);
  return {solids:closed.map(c=>c.solid),contacts:patches.flatMap(([patch,indices])=>indices.map(index=>patch.triangles[index].map(vertex=>patch.vertices[vertex]))),notes:[...(footprint?.notes??[]),...closed.flatMap(c=>c.notes)]};
}

// The support is an independent solid supplied to an ordinary Slice assignment;
// saved geometry and Slice settings regenerate without this extension.
export function editStandardSupport(source,request,{closeMeshPatchToPlane}){
  requireThat(request&&typeof request==='object'&&!Array.isArray(request),'Standard support needs a request.');
  requireThat(Object.keys(request).every(key=>['id','part',...SOURCES,'gapMm','fillDensity','angleDeg','baseLayers','chordMm','description'].includes(key)),'Unknown standard-support request field.');
  const {id,part=null,gapMm,fillDensity,angleDeg,baseLayers,chordMm,description}={...STANDARD_SUPPORT,...request};
  requireThat(typeof id==='string'&&/^[a-z][a-z0-9-]*$/.test(id),'Standard support needs a lowercase hyphenated assignment id.');
  requireThat(typeof description==='string','Support description must be text.');
  const geometry=structuredClone(source.geometry),assignments=structuredClone(source.slices?.assignments??[]);
  requireThat(!assignments.some(a=>a.id===id),'The assignment id already exists; edit its ordinary geometry and Slice settings or use another id.');
  const native=geometry?.shape==='spatial'?geometry.solid:geometry;
  const component=native?.shape==='assembly'?native.parts.find(p=>p.id===part):null;
  requireThat(native?.shape==='assembly'?!!component:part===null,'Select the component for an assembly, or leave part null for a single part.');
  requireThat(SOURCES.filter(key=>request[key]!==undefined).length===1,'Supply one support source: roof, triangleIndices, footprint or tree.');
  requireThat(Number.isFinite(gapMm)&&gapMm>=0,'Support gapMm must be nonnegative.');
  requireThat(Number.isFinite(fillDensity)&&fillDensity>=0&&fillDensity<=1,'Support fillDensity must be between zero and one, inclusive.');
  requireThat(Number.isFinite(angleDeg),'Support angleDeg must be finite.');
  requireThat(Number.isSafeInteger(baseLayers)&&baseLayers>=0,'Support baseLayers must be a nonnegative whole number.');
  requireThat(Number.isFinite(chordMm)&&chordMm>0,'Support chordMm must be positive.');
  // Recipe Z is above the build plate; only an assembly component has a local
  // Z origin, and a raised part's support still reaches the real bed.
  const original=component?component.geometry:native,bedZMm=-(component?.zMm??0);
  const {solids,contacts,notes}=sourceSolid(request,original,{gapMm,chordMm,bedZMm},closeMeshPatchToPlane),solid=supportSolid(solids);
  const supported=assignments.map(assignment=>!assignment.construction&&!assignment.geometry&&!assignment.join&&
    (assignment.part===part||assignment.part===null&&native?.shape==='assembly')?{...assignment,contact:{...(assignment.contact??{source:null}),
      surfaces:[...(assignment.contact?.surfaces??[]),{source:{assignment:id,part},part,triangles:contacts,offsetMm:[0,0,-gapMm]}]}}:assignment);
  return {geometry,
    assignmentRequests:[supportSlice({id,part,solid,fillDensity,angleDeg,baseLayers,description}),...supported],
    report:{id,part,source:SOURCES.find(key=>request[key]!==undefined),solids:solids.length,
      notes:[...notes,...(baseLayers?[]:['No dense base slices; review bed adhesion or add a brim.'])]}};
}
