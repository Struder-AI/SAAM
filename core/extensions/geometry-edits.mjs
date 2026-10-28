// The extension host selects author code and assembles its contribution. CAD
// operations know neither the selected extension nor the enclosing recipe.
import {readExtensionIdentity,loadExtensionInvocation,verifyExtensionInvocation} from './library.mjs';
import {geometryOperations} from '../geom/operations.mjs';
import {recipeTools} from '../print/recipe-tools.mjs';
import {resolveSpatialPlan} from '../print/spatial-inputs.mjs';
import {replaceSolid} from '../geom/spatial.mjs';
import {editPartGeometry,partTarget,peel,restack,verifiedSelections} from './part-geometry.mjs';

export async function prepareExtensionGeometry(source,extension,request,options={}){
  const selected=await readExtensionIdentity(extension,options);
  if(!selected)throw Error('Required extension '+extension+' is missing. Import it before editing.');
  // Editors consume resolved solid/curve values; recipe selectors retain the
  // full authored spatial store and its stable geometry identities.
  const resolved=resolveSpatialPlan(source),part=options.part??request?.part;
  const contribution=(geometry,report,selections,more={})=>({...more,report,
    plan:{...source,...(geometry===undefined?{}:{geometry:replaceSolid(source.geometry,geometry)}),...(more.placement===undefined?{}:{placement:more.placement})},
    editProvenance:{operation:options.create?'extension-create':'extension-edit',selections,scope:{
      ...(geometry===undefined?{}:{geometry:'solid replacement'}),
      ...(more.placement===undefined?{}:{placement:'replacement'}),
      ...(more.assignments===undefined&&more.assignmentRequests===undefined?{}:{assignments:{replacement:true,ids:(more.assignments??more.assignmentRequests).map(item=>item.id)}})}}});
  if(selected.manifest.entries['part-geometry']){
    const {part:_part,...rest}=options;
    const assignments=structuredClone(options.assignments??resolved.slices?.assignments??[]);
    const edited=await editPartGeometry(resolved.geometry,extension,request,{...rest,part,assignments});
    return contribution(edited.geometry,edited.notes.length?{notes:edited.notes}:undefined,edited.selections,{
      ...(edited.placement===undefined?{}:{placement:edited.placement}),
      ...(edited.assignments!==undefined?{assignmentRequests:edited.assignments}:options.assignments===undefined?{}:{assignments}),});
  }
  const entry=options.create?'geometry-create':'geometry-edit';
  if(!selected.manifest.entries[entry])return null;
  const editor=await loadExtensionInvocation(extension,entry,options);
  // Part geometry records above the edited part are not this editor's: it edits the
  // geometry beneath them, and they are rebuilt from their own parameters on its result.
  const input=structuredClone({geometry:resolved.geometry,slices:resolved.slices,
    process:source.process,composition:source.composition,skills:source.skills});
  const tree={value:input.geometry},target=input.geometry?partTarget(tree,part):null,{inner,above}=target?peel(target.get()):{inner:null,above:[]};
  if(above.length){target.set(inner);input.geometry=tree.value;}
  const Geometry=geometryOperations(options);
  // Existing geometry editors take named operations directly. These are the
  // same functions supplied under Geometry to runtime and workspace factories.
  let {geometry,placement,assignments,assignmentRequests,report}=await editor.entry(input,request,
    {...options,...Geometry,Geometry,Recipe:recipeTools(source)});
  await verifyExtensionInvocation(editor.selection,options);
  const loaded=new Map();
  if(above.length&&geometry!==undefined){
    const result={value:geometry},edited=partTarget(result,part),rebuilt=await restack(edited.get(),above,options,loaded);
    edited.set(rebuilt.geometry);geometry=result.value;
    if(rebuilt.notes.length)report={...report,notes:[...report?.notes??[],...rebuilt.notes]};
  }
  return contribution(geometry,report,[editor.selection,...await verifiedSelections(loaded,options)],{placement,assignments,assignmentRequests});
}
