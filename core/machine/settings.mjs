// Reusable machine/material/installation settings. Consumers keep selected
// snapshots; reading a bundle never consults this store.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {loadMachine} from './profile.mjs';
import {requireThat} from '../private/settings/numeric.mjs';
import {replaceFile} from '../private/settings/file-write.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const setupFor=machine=>resolve(root,`.local/machine-setups/${machine.id}.json`);
export const SETTINGS_FIELDS=Object.freeze(['setup','process','output','placement']);

function mergeSettings(previous,changes){
  const result={...previous};
  for(const [key,value] of Object.entries(changes)){
    result[key]=value&&typeof value==='object'&&!Array.isArray(value)&&key!=='primeLine'
      ?mergeSettings(result[key],value):structuredClone(value);
  }
  return result;
}

export function resolveSettingsPatch(previous,patch){
  requireThat(patch&&typeof patch==='object'&&!Array.isArray(patch)&&Object.keys(patch).every(k=>SETTINGS_FIELDS.includes(k)),'Settings edits accept setup, process, output and placement only.');
  const selected=Object.fromEntries(Object.keys(patch).map(key=>[key,previous[key]]));
  const settings=mergeSettings(selected,patch);
  if(patch.setup?.firmwareVersion!==undefined&&patch.setup.firmwareVersion!==previous.setup?.firmwareVersion&&patch.setup.startupVerified===undefined)
    settings.setup={...settings.setup,startupVerified:false};
  return settings;
}

export function settingsDefaults(machine){
  const tool=machine.tools.find(t=>t.index===machine.defaultSetup.tool);
  const bounds=tool?.bounds??machine.bounds;
  return {
    placement:machine.kinematics?.startsWith('cartesian')
      ?{xMm:(bounds.min[0]+bounds.max[0])/2,yMm:(bounds.min[1]+bounds.max[1])/2}
      :{xMm:140,yMm:100},
    setup:structuredClone(machine.defaultSetup),
    process:{
      firstLayerMm:0.2,layerMm:0.2,lineWidthMm:0.4,
      planarSpeedMmS:20,skinSpeedMmS:10,firstLayerSpeedMmS:12,travelSpeedMmS:60,zSpeedMmS:5,
      retractMm:6.5,retractSpeedMmS:25,liftMm:1,maxCombMm:6,
      fanPercent:100,maxFlowMm3S:4,minimumLayerSeconds:6,
      experimentalDeposition:false,primeLine:null,clearanceResponsibility:'operator',
      clearanceNote:'No collision model is implemented; the operator owns physical clearance.',
      ...structuredClone(machine.defaultProcess??{})
    },
    output:machine.outputs[0].id
  };
}

export async function selectSettings(machineId,{setupFile}={}){
  const machine=loadMachine(machineId),settings=settingsDefaults(machine);
  let saved;
  try{saved=JSON.parse(await readFile(setupFile??setupFor(machine),'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(saved){
    requireThat(saved.schema==='saam-machine-setup/1'&&saved.machineId===machine.id,'Saved machine setup is incompatible.');
    const remembered=Object.fromEntries(Object.entries(saved.setup??{}).filter(([key])=>Object.hasOwn(settings.setup,key)));
    settings.setup={...settings.setup,...remembered,materialGuid:remembered.materialGuid||settings.setup.materialGuid};
  }
  return {machine,settings};
}

export async function saveSetup(machine,setup,{setupFile,source='User setup supplied through chat'}={}){
  requireThat(machine&&setup,'Choose a machine and setup before remembering settings.');
  const file=setupFile??setupFor(machine);
  await replaceFile(file,JSON.stringify({schema:'saam-machine-setup/1',machineId:machine.id,
    setup:structuredClone(setup),source,updatedAt:new Date().toISOString()},null,2)+'\n');
  return file;
}

export function resolveMachineSettings(previous,previousMachine,{machine,settings}){
  if(!previousMachine)return {...settings,setup:{...settings.setup,...previous.setup},
    process:{...settings.process,...previous.process},output:previous.output??settings.output,
    placement:previous.placement??settings.placement};
  const process={...previous.process};
  for(const key of new Set([...Object.keys(previousMachine.defaultProcess??{}),...Object.keys(machine.defaultProcess??{})]))
    process[key]=settings.process[key];
  return {setup:settings.setup,output:settings.output,process};
}
