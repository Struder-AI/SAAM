// Workspace factories receive construction operations, never Bundle/Studio/export authority.
import {listExtensions,resolveExtensions,loadExtensionEntry} from './library.mjs';
import {loftPolygons} from '../geom/loft.mjs';
import {clipLineToRegion} from '../geom/curve-region.mjs';
import {recipeDefaults} from '../print/plan.mjs';
import {curveAssignment} from '../print/curves.mjs';

export const workspaceIdentity=resolved=>{
  const selected=resolved.at(-1);
  return {id:selected.id,digest:selected.digest,origin:selected.origin,
    dependencies:resolved.slice(0,-1).map(({id,digest})=>({id,digest}))};
};
export async function listWorkspaces(options={}){
  return (await listExtensions(options)).filter(item=>item.manifest.kind==='workspace')
    .map(({id,digest,origin,manifest})=>({id,digest,origin,kind:'workspace',workspace:manifest.workspace,dependencies:manifest.dependencies,manual:`extensions/${id}/SKILL.md`}));
}
export async function loadWorkspaceRuntime(extensionId,options={}){
  const resolved=await resolveExtensions([extensionId],options),selected=resolved.at(-1);
  if(selected.manifest.kind!=='workspace')throw Error(`Extension ${extensionId} is not a workspace.`);
  const create=await loadExtensionEntry(extensionId,'workspace-runtime',options);
  const definition=await create(Object.freeze({
    Geometry:Object.freeze({loftPolygons,clipLineToRegion}),
    Toolpath:Object.freeze({recipeDefaults,curveAssignment})
  }));
  for(const name of ['normalize','preview','pieces','construct'])
    if(typeof definition?.[name]!=='function')throw Error(`Workspace ${extensionId} needs ${name}.`);
  if(!definition.defaults||typeof definition.defaults!=='object')throw Error(`Workspace ${extensionId} needs default design values.`);
  if(definition.resources!==undefined&&typeof definition.resources!=='function')throw Error(`Workspace ${extensionId} resources must be a function.`);
  return {definition,selected,extension:workspaceIdentity(resolved)};
}
export async function requireWorkspaceCurrent(extension,options={}){
  const current=workspaceIdentity(await resolveExtensions([extension.id],options));
  if(JSON.stringify(current)!==JSON.stringify(extension))throw Error(`Workspace ${extension.id} changed while open. Restart SAAM to use the selected extension.`);
}
export function workspacePieces(value){
  if(!Array.isArray(value)||!value.length)throw Error('A workspace must supply at least one printable piece.');
  const ids=new Set();
  for(const piece of value){
    if(!piece||typeof piece.id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(piece.id)
      ||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(piece.id)||ids.has(piece.id))throw Error('Workspace pieces need distinct portable folder IDs.');
    ids.add(piece.id);
  }
  return value;
}
