// Part geometry records: an extension's geometry kept on a part as {shape:'extension',
// extension, parameters, base, solid, materialParts, label, rows}. SAAM reads only the
// solid, material parts, base and display text; the parameters belong to the extension.
// Records stack: each one's base may be another record. Editing one rebuilds every record
// above it from that record's own parameters, so no extension reads another's format.
import {loadExtensionInvocation,readExtensionIdentity,verifyExtensionInvocation} from './library.mjs';
import {geometryOperations} from '../geom/operations.mjs';

const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
export const isPartGeometry=geometry=>geometry?.shape==='extension';

// The edited geometry in a geometry tree held as {value}: a named assembly part, else the root solid.
export function partTarget(tree,part){
  const spatial=tree.value?.shape==='spatial',root=spatial?tree.value.solid:tree.value;
  if(part!==undefined&&part!==null){
    const owner=root?.parts?.find(p=>p.id===part);requireThat(owner,'Unknown target part: '+part+'.');
    return {get:()=>owner.geometry,set:value=>{owner.geometry=value;}};
  }
  return spatial?{get:()=>tree.value.solid,set:value=>{tree.value.solid=value;}}:{get:()=>tree.value,set:value=>{tree.value=value;}};
}

// The records above an inner geometry, outermost first.
export function peel(geometry){
  const above=[];let inner=geometry;
  while(isPartGeometry(inner)){above.push(inner);inner=inner.base;}
  return {inner,above};
}

// An extension's part-geometry entry with the services it is granted: Geometry, and the
// builds of the part-geometry extensions it declares as dependencies.
async function invocation(extension,options,loaded){
  if(loaded.has(extension))return loaded.get(extension);
  const selected=await readExtensionIdentity(extension,options);
  requireThat(selected,'Required extension '+extension+' is missing. Import it before editing.');
  requireThat(selected.manifest.entries['part-geometry'],'Extension '+extension+' has no part-geometry entry.');
  const editor=await loadExtensionInvocation(extension,'part-geometry',options),Geometry=await geometryOperations(options);
  const Extensions=await partGeometryBuilds(editor.selection.packages.at(-1).dependencies,options,loaded);
  const value={feature:editor.entry(),selection:editor.selection,services:{...Geometry,Geometry,Extensions}};
  loaded.set(extension,value);return value;
}

// The builds of the named dependencies that have a part-geometry entry: what an extension
// may call on another, never its saved form.
export async function partGeometryBuilds(ids,options={},loaded=new Map()){
  const Extensions={};
  for(const id of ids){
    if(!(await readExtensionIdentity(id,options))?.manifest.entries['part-geometry'])continue;
    const dependency=await invocation(id,options,loaded);
    Extensions[id]=Object.freeze({build:input=>dependency.feature.build(structuredClone(input),dependency.services)});
  }
  return Object.freeze(Extensions);
}

async function built(extension,base,parameters,options,loaded){
  const {feature,services}=await invocation(extension,options,loaded);
  const result=await feature.build({base:structuredClone(base),parameters:structuredClone(parameters)},services);
  return {geometry:{shape:'extension',extension,parameters:structuredClone(parameters),base:structuredClone(base),solid:result.solid,
    materialParts:result.materialParts??[],label:result.label??'',rows:result.rows??[]},notes:result.notes??[]};
}

// Rebuild the records above an inner geometry, innermost first, each from its own parameters.
export async function restack(inner,above,options={},loaded=new Map()){
  let geometry=inner;const notes=[];
  for(const saved of [...above].reverse()){
    const next=await built(saved.extension,geometry,saved.parameters,options,loaded);
    geometry=next.geometry;notes.push(...next.notes);
  }
  return {geometry,notes,loaded};
}

export async function verifiedSelections(loaded,options){
  const selections=[...loaded.values()].map(({selection})=>selection);
  for(const selection of selections)await verifyExtensionInvocation(selection,options);
  return selections;
}

// What an extension may know about the recipe around its part: the part, its ordinary Slice
// owners, the extension's own Trace operations there and the part's assignment IDs.
const onPart=(assignment,part)=>(assignment.part??null)===(part??null);
const ownOperation=(extension,part)=>assignment=>assignment.construction==='curves'&&assignment.source?.extension===extension&&onPart(assignment,part);
function operationContext(extension,part,assignments){
  return {part:part??null,
    slices:assignments.filter(a=>!a.construction&&!a.join&&!a.preset&&!a.geometry&&(onPart(a,part)||(a.part??null)===null)).map(a=>a.id),
    operations:assignments.filter(ownOperation(extension,part)).map(({id,source:{assignment,parameters}})=>structuredClone({id,source:{assignment,parameters}})),
    assignments:assignments.filter(a=>onPart(a,part)).map(a=>a.id)};
}
// The extension's returned operations replace its own on the part; every other assignment stays, in order.
function withOperations(extension,part,assignments,operations,context){
  requireThat(Array.isArray(operations),'Extension '+extension+' returned no operation list.');
  const kept=assignments.filter(a=>!ownOperation(extension,part)(a)),taken=new Set(kept.map(a=>a.id));
  for(const op of operations){
    requireThat(typeof op?.id==='string'&&op.id&&!taken.has(op.id),'Extension '+extension+' returned a missing or duplicate operation id: '+op?.id+'.');taken.add(op.id);
    requireThat(context.slices.includes(op.source?.assignment),'Extension '+extension+' operation '+op.id+' must follow an ordinary Slice owner of its part.');
  }
  return [...kept,...operations.map(op=>({id:op.id,construction:'curves',part:part??null,source:{extension,assignment:op.source.assignment,parameters:structuredClone(op.source.parameters??{})}}))];
}

// Edit one extension's record on the target: its own record if the stack holds one, else a
// new record on top. The extension sees only its base, its parameters and the request. A new
// print starts with no geometry: the record is the part, placed where the extension proposes.
export async function editPartGeometry(geometry,extension,request,{part,create=false,assignments=[],...options}={}){
  const tree={value:create?null:structuredClone(geometry??null)},loaded=new Map(),target=partTarget(tree,create?undefined:part);
  const {above:stack}=peel(target.get()),index=stack.findIndex(saved=>saved.extension===extension);
  const above=index<0?[]:stack.slice(0,index),own=index<0?null:stack[index],base=own?own.base:target.get();
  const {feature,services}=await invocation(extension,options,loaded);
  const context=operationContext(extension,create?null:part,assignments);
  const result=await feature.edit({base:structuredClone(base??null),parameters:own?structuredClone(own.parameters):null,request:structuredClone(request),context:structuredClone(context)},services);
  requireThat(result?.remove===true||result?.parameters&&typeof result.parameters==='object','Extension '+extension+' returned no parameters.');
  requireThat(!result.remove||own,'Extension '+extension+' has no geometry on this part to remove.');
  const edited=result.remove?{geometry:base,notes:[]}:await built(extension,base??null,result.parameters,options,loaded);
  const rebuilt=await restack(edited.geometry,above,options,loaded);
  target.set(rebuilt.geometry);
  return {geometry:tree.value,notes:[...edited.notes,...rebuilt.notes],selections:await verifiedSelections(loaded,options),
    ...(create&&result.placement?{placement:structuredClone(result.placement)}:{}),
    ...(result.operations===undefined?{}:{assignments:withOperations(extension,create?null:part,assignments,result.operations,context)})};
}
