// The extension host selects author code and assembles its contribution. CAD
// operations know neither the selected extension nor the enclosing recipe.
import {readExtension,loadExtensionEntry} from './library.mjs';
import {geometryOperations} from '../geom/operations.mjs';
import {recipeTools} from '../print/recipe-tools.mjs';
import {resolveSpatialPlan} from '../print/spatial-inputs.mjs';
import {replaceSolid} from '../geom/spatial.mjs';

export async function prepareExtensionGeometry(source,extension,request,options={}){
  const entry=options.create?'geometry-create':'geometry-edit';
  const selected=await readExtension(extension);
  if(!selected)throw Error('Required extension '+extension+' is missing. Import it before editing.');
  if(!selected.manifest.entries[entry])return null;
  const editor=await loadExtensionEntry(extension,entry);
  const compileText=selected.manifest.dependencies.some(dependency=>dependency.id==='text')
    ?await loadExtensionEntry('text','geometry-compile'):undefined;
  // Editors consume resolved solid/curve values; recipe selectors retain the
  // full authored spatial store and its stable geometry identities.
  const resolved=resolveSpatialPlan(source);
  const input=structuredClone({geometry:resolved.geometry,slices:resolved.slices,
    process:source.process,composition:source.composition,skills:source.skills});
  const Geometry=await geometryOperations();
  // Existing geometry editors take named operations directly. These are the
  // same functions supplied under Geometry to runtime and workspace factories.
  const {geometry,placement,assignments,assignmentRequests,report}=await editor(input,request,
    {...options,...Geometry,Geometry,Recipe:recipeTools(source),...(compileText?{compileText}:{})});
  return {plan:{...source,...(geometry===undefined?{}:{geometry:replaceSolid(source.geometry,geometry)}),
    ...(placement===undefined?{}:{placement})},assignments,assignmentRequests,report};
}
