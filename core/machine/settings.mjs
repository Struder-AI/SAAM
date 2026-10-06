// Reusable machine/material/installation settings. Consumers keep selected
// snapshots; reading a bundle never consults this store. The owner supplies the
// store folder (`machineSetups`); without one, nothing is remembered or recalled.
import {readFile,mkdir,open,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {loadMachine} from './profile.mjs';
import {requireThat} from '../private/settings/numeric.mjs';
import {replaceFile} from '../private/settings/file-write.mjs';

const setupFor=(machineSetups,machine)=>resolve(machineSetups,machine.id+'.json');
export const SETTINGS_FIELDS=Object.freeze(['setup','process','output','placement']);

const settingsRecord=value=>value&&typeof value==='object'&&!Array.isArray(value);

// Setup records, including any adapter block, merge field by field at every
// depth; arrays and scalars replace.
function mergeSetup(previous,changes){
  if(!settingsRecord(changes))return structuredClone(changes);
  return Object.fromEntries([...Object.entries(settingsRecord(previous)?previous:{}),
    ...Object.entries(changes).map(([key,value])=>[key,mergeSetup(previous?.[key],value)])]);
}

export function resolveSettingsPatch(previous,patch){
  requireThat(patch&&typeof patch==='object'&&!Array.isArray(patch)&&Object.keys(patch).every(k=>SETTINGS_FIELDS.includes(k)),'Settings edits accept setup, process, output and placement only.');
  const settings={};
  if(Object.hasOwn(patch,'setup'))settings.setup=mergeSetup(previous.setup,patch.setup);
  // Process values are scalars or an atomic prime-line record; placement is XY.
  if(Object.hasOwn(patch,'process'))settings.process=settingsRecord(patch.process)
    ?{...previous.process,...structuredClone(patch.process)}:structuredClone(patch.process);
  if(Object.hasOwn(patch,'output'))settings.output=structuredClone(patch.output);
  if(Object.hasOwn(patch,'placement'))settings.placement=settingsRecord(patch.placement)
    ?{...previous.placement,...structuredClone(patch.placement)}:structuredClone(patch.placement);
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
      planarWallToleranceMm:machine.planarWallToleranceMm??0.01,
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

export async function selectSettings(machineId,{machineSetups}={}){
  const machine=loadMachine(machineId),settings=settingsDefaults(machine);
  let saved;
  if(machineSetups)try{saved=JSON.parse(await readFile(setupFor(machineSetups,machine),'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(saved){
    requireThat(saved.schema==='saam-machine-setup/1'&&saved.machineId===machine.id,'Saved machine setup is incompatible.');
    const remembered=Object.fromEntries(Object.entries(saved.setup??{}).filter(([key])=>Object.hasOwn(settings.setup,key)));
    settings.setup={...settings.setup,...remembered,materialGuid:remembered.materialGuid||settings.setup.materialGuid};
  }
  return {machine,settings};
}

export async function saveSetup(machine,setup,{machineSetups,source='Last successful export',exportReceipt}={}){
  requireThat(machine&&setup&&machineSetups,'Choose a machine, setup and setup store before remembering settings.');
  const file=setupFor(machineSetups,machine);
  await replaceFile(file,JSON.stringify({schema:'saam-machine-setup/1',machineId:machine.id,
    setup:structuredClone(setup),source,...(exportReceipt?{exportReceipt}:{}),updatedAt:new Date().toISOString()},null,2)+'\n');
  return file;
}

// Hold the machine's store lock before copying an export, through remembering
// its exact setup. Serializing only the final store write would invert exports.
export async function withMachineSetupExport(machineSetups,machine,action){
  const lock=setupFor(machineSetups,machine)+'.export.lock',writer={handle:null,unreadable:0};
  await mkdir(dirname(lock),{recursive:true});
  for(;;){
    try{writer.handle=await open(lock,'wx');break;}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const busy=Error('Machine setup has an interrupted export writer. Inspect '+lock+' before recovery.');
      const holder=await readFile(lock,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT'||error instanceof SyntaxError)return null;throw error;});
      if(!(Number.isInteger(holder?.pid)&&holder.pid>0)&&++writer.unreadable>40)throw busy;
      if(Number.isInteger(holder?.pid)&&holder.pid>0){
        try{process.kill(holder.pid,0);}catch(error){if(error.code==='ESRCH')throw busy;throw error;}
      }
      await new Promise(function waitForExport(done){setTimeout(done,25);});
    }
  }
  try{await writer.handle.writeFile(JSON.stringify({pid:process.pid,time:new Date().toISOString()}));return await action();}
  finally{await writer.handle.close();await rm(lock);}
}

export function resolveMachineSettings(previous,previousMachine,{machine,settings},{boundsMm}={}){
  const selectedTool=!previousMachine?previous.setup?.tool??settings.setup.tool:settings.setup.tool;
  const tool=machine.tools.find(t=>t.index===selectedTool),plate=tool?.bounds??machine.bounds;
  const placement=boundsMm&&machine.kinematics?.startsWith('cartesian')
    ?{xMm:(plate.min[0]+plate.max[0]-boundsMm.min[0]-boundsMm.max[0])/2,
      yMm:(plate.min[1]+plate.max[1]-boundsMm.min[1]-boundsMm.max[1])/2}
    :settings.placement;
  if(!previousMachine)return {...settings,setup:{...settings.setup,...previous.setup},
    process:{...settings.process,...previous.process},output:previous.output??settings.output,
    placement:previous.placement??placement};
  const process={...previous.process};
  for(const key of new Set([...Object.keys(previousMachine.defaultProcess??{}),...Object.keys(machine.defaultProcess??{})]))
    process[key]=settings.process[key];
  return {setup:settings.setup,output:settings.output,process};
}
