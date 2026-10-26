// Workspace factories receive construction operations, never Bundle/Studio/export authority.
import {listExtensions,resolveExtensions,loadExtensionEntry} from './library.mjs';
import {geometryOperations} from '../geom/operations.mjs';
import {recipeDefaults} from '../print/plan.mjs';
import {curveAssignment} from '../print/curves.mjs';
import {machineIds,loadMachine} from '../machine/profile.mjs';

export const workspaceIdentity=resolved=>{
  const selected=resolved.at(-1);
  return {id:selected.id,digest:selected.digest,origin:selected.origin,
    credits:structuredClone(selected.manifest.credits??[]),support:structuredClone(selected.manifest.support??null),
    dependencies:resolved.slice(0,-1).map(({id,digest})=>({id,digest}))};
};
export async function listWorkspaces(options={}){
  return (await listExtensions(options)).extensions.filter(item=>item.manifest.kind==='workspace')
    .map(({id,digest,origin,manifest})=>({id,digest,origin,kind:'workspace',workspace:manifest.workspace,dependencies:manifest.dependencies,manual:`extensions/${id}/SKILL.md`}));
}
// Flat-bed printers a workspace can lay parts out for: the printable area is
// where every tool reaches. Facts only; bundles still choose their machine in Studio.
export function workspacePrinter(id){
  const machine=loadMachine(id),bounds=machine.tools.map(tool=>tool.bounds??machine.bounds);
  if(!machine.kinematics?.startsWith('cartesian'))throw Error(`${machine.name} has no flat build plate for workspace layout.`);
  return {id:machine.id,name:machine.name,
    printableMm:{min:[0,1,2].map(i=>Math.max(...bounds.map(b=>b.min[i]))),max:[0,1,2].map(i=>Math.min(...bounds.map(b=>b.max[i])))},
    filamentChanges:machine.outputs.some(output=>output.id==='bambu-gcode')};
}
const workspacePrinters=()=>machineIds().filter(id=>loadMachine(id).kinematics?.startsWith('cartesian')).map(workspacePrinter);

export async function loadWorkspaceRuntime(extensionId,options={}){
  const resolved=await resolveExtensions([extensionId],options),selected=resolved.at(-1);
  if(selected.manifest.kind!=='workspace')throw Error(`Extension ${extensionId} is not a workspace.`);
  const create=await loadExtensionEntry(extensionId,'workspace-runtime',options);
  const Geometry=await geometryOperations();
  const declares=id=>selected.manifest.dependencies.some(dependency=>dependency.id===id);
  const compileText=declares('text')?await loadExtensionEntry('text','geometry-compile',options):null;
  // A declared gridfinity dependency builds its bins and baseplates with the
  // same Geometry operations its own create entry receives.
  const gridfinityPlan=declares('gridfinity')?await loadExtensionEntry('gridfinity','geometry-create',options):null;
  const gridfinity=gridfinityPlan?Object.freeze({create:parameters=>gridfinityPlan(null,parameters,Geometry)}):null;
  const definition=await create(Object.freeze({
    Geometry,
    Toolpath:Object.freeze({recipeDefaults,curveAssignment}),
    Extensions:Object.freeze({...(compileText?{text:Object.freeze({compileText})}:{}),...(gridfinity?{gridfinity}:{})}),
    Machine:Object.freeze({printers:workspacePrinters,printer:workspacePrinter})
  }));
  for(const name of ['normalize','preview','pieces','construct'])
    if(typeof definition?.[name]!=='function')throw Error(`Workspace ${extensionId} needs ${name}.`);
  if(!definition.defaults||typeof definition.defaults!=='object')throw Error(`Workspace ${extensionId} needs default design values.`);
  if(definition.resources!==undefined&&typeof definition.resources!=='function')throw Error(`Workspace ${extensionId} resources must be a function.`);
  return {definition,selected,extension:workspaceIdentity(resolved)};
}
export async function requireWorkspaceCurrent(extension,options={}){
  const current=workspaceIdentity(await resolveExtensions([extension.id],options));
  if(JSON.stringify(current)!==JSON.stringify(extension))throw Error(`Workspace ${extension.id} changed while open; its new scripts load after \`saam reload-runtime\`.`);
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
