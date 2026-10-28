// The extension host combines geometry and deposition contributions into one proposed
// recipe. It has no bundle directory, persistence or revision ownership.
import {loadExtensionInvocation,readExtensionIdentity,verifyExtensionInvocation} from './library.mjs';
import {prepareExtensionGeometry} from './geometry-edits.mjs';
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
import {curveAssignment} from '../print/curves.mjs';
import {defaultSlices} from "../print/slice-records.mjs";
import {depositionAssignment} from '../print/assignment-records.mjs';
import {geometryOperations} from '../geom/operations.mjs';
import {resolveSpatialPlan} from '../print/spatial-inputs.mjs';
import {replaceSolid} from '../geom/spatial.mjs';
import {recipeTools} from '../print/recipe-tools.mjs';
import {paathAssignment} from '../print/paath.mjs';

const Toolpath=Object.freeze({defaultSlices,curveAssignment,paathAssignment,depositionAssignment});

export async function prepareExtensionRecipe(source,extension,request,{geometryContribution,...options}={}){
  if(geometryContribution){
    const {plan,placement,assignments,assignmentRequests,report,editProvenance}=geometryContribution;
    requireThat(!(assignments&&assignmentRequests),'An extension must return either assignments or assignmentRequests.');
    return {plan:{...plan,slices:{...source.slices,assignments:assignmentRequests
      ?assignmentRequests.map(depositionAssignment):assignments}},placement,report,editProvenance};
  }
  const resolved=resolveSpatialPlan(source);
  const input=structuredClone({geometry:resolved.geometry,slices:resolved.slices,
    process:source.process,composition:source.composition,skills:source.skills});
  requireThat(!options.create,`No deposition creator for extension ${extension}.`);
  const editor=await loadExtensionInvocation(extension,'deposition-edit',options);
  const Geometry=geometryOperations(options);
  const contribution=await editor.entry(input,request,{...options,Geometry,Toolpath,Recipe:recipeTools(source)});
  await verifyExtensionInvocation(editor.selection,options);
  const {geometry,assignments,placement,report}=contribution;
  // Only the declared engine outputs can alter the proposal. Setup, output,
  // versions and other bundle fields never come back from extension code.
  const plan={...source,...(geometry===undefined?{}:{geometry:replaceSolid(source.geometry,geometry)}),
    ...(assignments===undefined?{}:{slices:{...source.slices,assignments}}),
    ...(placement===undefined?{}:{placement})};
  return {plan,placement,report,editProvenance:{operation:'extension-edit',selections:[editor.selection],scope:{
    ...(geometry===undefined?{}:{geometry:'solid replacement'}),
    ...(assignments===undefined?{}:{assignments:{replacement:true,ids:assignments.map(item=>item.id)}}),
    ...(placement===undefined?{}:{placement:'replacement'})}}};
}

// An operation-edit extension sees its request, its part and SAAM's services, never the recipe. It
// reads only the assignments and the part it names, and returns the operations it adds, which
// follow the existing assignments under unused IDs, the fields it sets on assignments it names and
// the assignments it removes.
async function prepareAddedOperations(source,extension,request,options){
  const editor=await loadExtensionInvocation(extension,'operation-edit',options);
  const Geometry=geometryOperations(options);
  const prior=source.slices?.assignments??[],named=id=>prior.find(a=>a.id===id);
  const part=options.part??null,Recipe={...recipeTools(source),assignment:id=>{const found=named(id);return found?structuredClone(found):null;},
    preparedPart:async selection=>(await Geometry.prepareGeometrySelections(source.geometry,[{selection:selection??null}]))[0]};
  const {add=[],change=[],remove=[],report}=await editor.entry(structuredClone(request),{Geometry,Recipe,Toolpath,part});
  await verifyExtensionInvocation(editor.selection,options);
  requireThat([add,change,remove].every(Array.isArray)&&add.length+change.length+remove.length,'Extension '+extension+' returned no operation edits.');
  const removed=new Set(remove);
  requireThat(remove.every(id=>named(id))&&removed.size===remove.length,'Extension '+extension+' removed a missing or repeated assignment.');
  const taken=new Set(prior.filter(a=>!removed.has(a.id)).map(a=>a.id));
  for(const operation of add){requireThat(typeof operation?.id==='string'&&!taken.has(operation.id),'Operation id '+operation?.id+' is already in use.');taken.add(operation.id);}
  const changes=new Map();
  for(const {id,set} of change){
    requireThat(named(id)&&!changes.has(id)&&!removed.has(id),'Extension '+extension+' changed a missing or repeated assignment: '+id+'.');
    requireThat(set&&typeof set==='object'&&!Array.isArray(set)&&!Object.hasOwn(set,'id'),'Extension '+extension+' sets fields, never an assignment id.');
    changes.set(id,structuredClone(set));
  }
  const assignments=[...prior.filter(a=>!removed.has(a.id)).map(a=>changes.has(a.id)?{...a,...changes.get(a.id)}:a),...add.map(depositionAssignment)];
  return {plan:{...source,slices:{...source.slices,assignments}},report,
    editProvenance:{operation:'extension-edit',selections:[editor.selection],scope:{assignments:{added:add.map(operation=>operation.id),changed:[...changes.keys()],removed:[...removed]}}}};
}

export async function prepareExtensionEdit(source,extension,request,{beforeCommit,...options}={}){
  if((await readExtensionIdentity(extension,options))?.manifest.entries['operation-edit'])return prepareAddedOperations(source,extension,request,options);
  const geometryContribution=await prepareExtensionGeometry(source,extension,request,options);
  if(geometryContribution&&geometryContribution.assignments===undefined&&geometryContribution.assignmentRequests===undefined)return geometryContribution;
  return prepareExtensionRecipe(source,extension,request,{...options,geometryContribution});
}
