import {STANDARD_SUPPORT,footprintRoofs,treeSolids,supportSolid,supportSlice,skinSlice,withSupportOperand} from './support-geometry.mjs';
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
const SOURCES=['roof','triangleIndices','footprint','tree'];

// One support source becomes one closed solid: a selected or copied roof, or a
// flat footprint, lowered by the gap and closed to the bed; or a tree skeleton.
// A roof source also returns its roofs raised by skinMm for the part's skin.
function sourceSolid(request,original,{gapMm,chordMm,bedZMm,skinMm},closeMeshPatchToPlane){
  if(request.tree!==undefined)return {...treeSolids(request.tree,{gapMm,chordMm,bedZMm}),raised:[]};
  if(request.footprint!==undefined)requireThat(request.footprint&&Object.keys(request.footprint).sort().join()==='loops,zMm','A footprint is {loops, zMm}.');
  const {roof,triangleIndices}=request;
  if(roof!==undefined)requireThat(roof&&Object.keys(roof).sort().join()==='triangles,vertices'&&Array.isArray(roof.triangles),'Supply an explicit roof mesh with vertices and triangles.');
  else if(triangleIndices!==undefined)requireThat(Array.isArray(original?.vertices)&&Array.isArray(original?.triangles),'The current component is not an indexed manufacturing mesh; supply an explicit copied roof.');
  const footprint=request.footprint&&footprintRoofs(request.footprint.loops,request.footprint.zMm);
  const patches=footprint?footprint.roofs.map(patch=>[patch,patch.triangles.map((_,i)=>i)]):[[roof??original,triangleIndices??roof.triangles.map((_,i)=>i)]];
  const close=offsetMm=>patches.map(([patch,selection])=>closeMeshPatchToPlane(patch,{triangleIndices:selection,planeZMm:bedZMm,offsetMm}));
  const closed=close(-gapMm);
  return {solids:closed.map(c=>c.solid),raised:skinMm>0?close(skinMm).map(c=>c.solid):[],notes:[...(footprint?.notes??[]),...closed.flatMap(c=>c.notes)]};
}

// The support is a hidden union operand of its part and an ordinary Slice claim;
// saved geometry and Slice settings regenerate without this extension.
export function editStandardSupport(source,request,{closeMeshPatchToPlane}){
  requireThat(request&&typeof request==='object'&&!Array.isArray(request),'Standard support needs a request.');
  requireThat(Object.keys(request).every(key=>['id','part',...SOURCES,'gapMm','fillDensity','angleDeg','baseLayers','skinLayers','chordMm','description'].includes(key)),'Unknown standard-support request field.');
  const {id,part=null,gapMm,fillDensity,angleDeg,baseLayers,skinLayers,chordMm,description}={...STANDARD_SUPPORT,...request};
  requireThat(typeof id==='string'&&/^[a-z][a-z0-9-]*$/.test(id),'Standard support needs a lowercase hyphenated assignment id.');
  requireThat(typeof description==='string','Support description must be text.');
  const geometry=structuredClone(source.geometry),assignments=structuredClone(source.slices?.assignments??[]);
  requireThat(!assignments.some(a=>a.id===id||a.id===`${id}-skin`),'The assignment id or its -skin already exists; edit its ordinary geometry and Slice settings or use another id.');
  const component=geometry?.shape==='assembly'?geometry.parts.find(p=>p.id===part):null;
  requireThat(geometry?.shape==='assembly'?!!component:part===null,'Select the component for an assembly, or leave part null for a single part.');
  requireThat(SOURCES.filter(key=>request[key]!==undefined).length===1,'Supply one support source: roof, triangleIndices, footprint or tree.');
  requireThat(Number.isFinite(gapMm)&&gapMm>=0,'Support gapMm must be nonnegative.');
  requireThat(Number.isFinite(fillDensity)&&fillDensity>=0&&fillDensity<=1,'Support fillDensity must be between zero and one, inclusive.');
  requireThat(Number.isFinite(angleDeg),'Support angleDeg must be finite.');
  requireThat([baseLayers,skinLayers].every(n=>Number.isSafeInteger(n)&&n>=0),'Support baseLayers and skinLayers must be nonnegative whole numbers.');
  requireThat(Number.isFinite(chordMm)&&chordMm>0,'Support chordMm must be positive.');
  // Recipe Z is above the build plate; only an assembly component has a local
  // Z origin, and a raised part's support still reaches the real bed.
  const original=component?component.geometry:geometry,bedZMm=-(component?.zMm??0),layerMm=source.process?.layerMm;
  const skinMm=Number.isFinite(layerMm)&&layerMm>0?skinLayers*layerMm:0;
  const {solids,raised,notes}=sourceSolid(request,original,{gapMm,chordMm,bedZMm,skinMm},closeMeshPatchToPlane),solid=supportSolid(solids);
  const replacement=withSupportOperand(original,solid);
  if(component)component.geometry=replacement;
  return {geometry:component?geometry:replacement,
    assignmentRequests:[supportSlice({id,part,solid,fillDensity,angleDeg,baseLayers,description}),
      ...(raised.length?[skinSlice({id,part,raised,solid,angleDeg})]:[]),...assignments],
    report:{id,part,source:SOURCES.find(key=>request[key]!==undefined),solids:solids.length,skin:raised.length?`${id}-skin`:null,
      notes:[...notes,...(baseLayers?[]:['No dense base slices; review bed adhesion or add a brim.'])]}};
}
