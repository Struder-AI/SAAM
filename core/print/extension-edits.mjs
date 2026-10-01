// The lifecycle applies returned extension values through the same revisioned
// edit as any other author. Extensions never receive a bundle directory.
import {loadBundle,updatePlan,proposedPlan,initBundle} from './bundle.mjs';
import {rhino} from './geometry.mjs';
import {buildShell} from '../geom/build.mjs';
import {requireThat} from '../geom/tolerance.mjs';
import {RECIPE_EDITORS,RECIPE_CREATORS} from '../../skills/edits.mjs';

export async function applyExtensionEdit(directory,extension,request,{expectedRevision,...options}={}){
  const edit=RECIPE_EDITORS[extension];
  requireThat(typeof edit==='function',`No recipe editor for extension ${extension}.`);
  const state=await loadBundle(directory,{program:false});
  requireThat(expectedRevision===undefined||expectedRevision===state.revision,'This review is stale. Reload before changing the print.');
  const r=await rhino();
  const plan=await edit(state.plan,request,{...options,buildGeometry:geometry=>buildShell(r,geometry)});
  return updatePlan(directory,plan,state.revision);
}

export async function createExtensionBundle(directory,extension,request,options={}){
  const create=RECIPE_CREATORS[extension];
  requireThat(typeof create==='function',`No recipe creator for extension ${extension}.`);
  const plan=await create(await proposedPlan(options.machineId,options),request);
  await initBundle(directory,plan,options);
  return loadBundle(directory,{program:false});
}
