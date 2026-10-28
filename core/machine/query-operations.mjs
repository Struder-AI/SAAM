import {lstat,readdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {machineProfileDeclarations} from '../extensions/library.mjs';
import {loadMachine} from './profile.mjs';
import {selectSettings,settingsDefaults} from './settings.mjs';

async function rejectSetupLinks(path){
  const info=await lstat(path);
  if(info.isSymbolicLink())throw new Error('Symbolic links and junctions are not supported in SAAM print bundles.');
  if(info.isFile()&&info.nlink>1)throw new Error('Hard-linked files are not supported in SAAM print bundles.');
  if(info.isDirectory())for(const entry of await readdir(path))await rejectSetupLinks(resolve(path,entry));
}
export async function admitMachineSetupStore(folder){
  try{
    if((await lstat(dirname(folder))).isSymbolicLink())throw new Error('The machine setup parent cannot be a symbolic link or junction.');
    await rejectSetupLinks(folder);
  }catch(error){if(error.code!=='ENOENT')throw error;}
  return folder;
}

// Settings consumes an explicitly captured neutral recipe value, not a Bundle
// lookup callback. Profile declaration discovery uses the data-only owner plug.
export function createSettingsQueries({machineSetupsPath,appRoot,dataRoot}){
  const roots={appRoot,dataRoot};
  return {
    async listMachines(){
      const {profiles,skipped}=machineProfileDeclarations(roots),machines=[];
      for(const [id,{extension}] of profiles){
        try{
          const machine=loadMachine(id,roots);
          machines.push({id,name:machine.name,extension,capabilities:machine.capabilities,tools:machine.tools,materials:machine.materials,
            outputs:machine.outputs.map(({id,extension,flavor,implemented,experimental,constraints,reason})=>({id,extension,flavor,implemented:implemented!==false,experimental,constraints,reason})),defaultSetup:machine.defaultSetup});
        }catch(error){skipped.push({extension,profile:id,reason:error.message});}
      }
      return {machines,...(skipped.length?{skipped}:{})};
    },
    async getRecipeDefaults({kind,machineId},recipeBase){
      const machineSetups=await admitMachineSetupStore(machineSetupsPath);
      const {settings,notes}=machineId?await selectSettings(machineId,{...roots,machineSetups}):{settings:settingsDefaults(null),notes:[]};
      return {kind,machineId,plan:{...recipeBase,...settings},...(notes.length?{limitations:notes}:{})};
    }
  };
}
