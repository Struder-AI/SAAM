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

// Logical materials are neutral settings (setup.filaments, setup.filament);
// setups saved before SAAM 0.3.6 kept them in the Bambu block.
export function neutralMaterials(setup){
  if(!settingsRecord(setup?.bambu)||!['filaments','filament'].some(key=>Object.hasOwn(setup.bambu,key)))return setup;
  const {filaments,filament,...bambu}=setup.bambu;
  return {...setup,...filaments!==undefined&&{filaments},...filament!==undefined&&{filament},bambu};
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

// The XY offset that puts the part on the selected tool's bed: the bed's centre,
// with the part's footprint centred there when its bounds are known. Without a
// machine the part stays at its own origin.
export function defaultPlacement(machine,tool,boundsMm){
  if(!machine)return {xMm:0,yMm:0};
  const plate=machine.tools.find(t=>t.index===tool)?.bounds??machine.bounds,part=i=>boundsMm?(boundsMm.min[i]+boundsMm.max[i])/2:0;
  return {xMm:(plate.min[0]+plate.max[0])/2-part(0),yMm:(plate.min[1]+plate.max[1])/2-part(1)};
}

// Without a machine: generic process values and a PLA material intent at the
// nozzle temperature the bundled printer profiles share; no output.
const GENERIC_SETUP=Object.freeze({material:'PLA',nozzleC:215});
export function settingsDefaults(machine){
  return {
    placement:defaultPlacement(machine,machine?.defaultSetup.tool),
    setup:structuredClone(machine?.defaultSetup??GENERIC_SETUP),
    process:{
      firstLayerMm:0.2,layerMm:0.2,lineWidthMm:0.4,
      planarWallToleranceMm:machine?.planarWallToleranceMm??0.01,
      planarSpeedMmS:20,skinSpeedMmS:10,firstLayerSpeedMmS:12,travelSpeedMmS:60,zSpeedMmS:5,
      retractMm:6.5,retractSpeedMmS:25,liftMm:1,maxCombMm:6,
      fanPercent:100,maxFlowMm3S:4,minimumLayerSeconds:6,
      experimentalDeposition:false,primeLine:null,clearanceResponsibility:'operator',
      clearanceNote:'No collision model is implemented; the operator owns physical clearance.',
      ...structuredClone(machine?.defaultProcess??{})
    },
    output:machine?.outputs[0].id??null
  };
}

// The machine's remembered setup record, or null; unreadable when the file is
// not JSON or is recorded for another machine or format.
async function rememberedSetup(machineSetups,machine){
  const text=machineSetups?await readFile(setupFor(machineSetups,machine),'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;}):null;
  if(text===null)return {saved:null,unreadable:false};
  try{
    const saved=JSON.parse(text);
    if(saved?.schema==='saam-machine-setup/1'&&saved.machineId===machine.id)return {saved,unreadable:false};
  }catch(error){if(!(error instanceof SyntaxError))throw error;}
  return {saved:null,unreadable:true};
}

// An unreadable remembered setup leaves the profile's defaults and a note; the
// file stays for the next successful export to replace.
export async function selectSettings(machineId,{machineSetups}={}){
  const machine=loadMachine(machineId),settings=settingsDefaults(machine),{saved,unreadable}=await rememberedSetup(machineSetups,machine);
  const notes=unreadable?[`Remembered setup for ${machine.name} couldn't be read; using defaults.`]:[];
  if(saved){
    const remembered=Object.fromEntries(Object.entries(neutralMaterials(saved.setup)??{}).filter(([key])=>Object.hasOwn(settings.setup,key)));
    settings.setup={...settings.setup,...remembered,materialGuid:remembered.materialGuid||settings.setup.materialGuid};
  }
  return {machine,settings,notes};
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

// Material is not machine: the print's material settings stay across a machine change.
const MATERIAL_FIELDS=['material','nozzleC','filament','filaments'];
// A machine change selects setup and output; authored process and material
// values stay, so the SAAMpath stays current. A remembered setup or the new
// machine's defaults fill only what the print lacks. A placement left at the
// previous default moves to the new bed's centre; a chosen one keeps its position.
export function resolveMachineSettings(previous,previousMachine,{machine,settings},{boundsMm}={}){
  const material=Object.fromEntries(MATERIAL_FIELDS.filter(key=>previous.setup?.[key]!==undefined).map(key=>[key,structuredClone(previous.setup[key])]));
  const setup=previousMachine?{...settings.setup,...material}:{...settings.setup,...previous.setup};
  const same=(a,b)=>a?.xMm===b.xMm&&a?.yMm===b.yMm,tool=previous.setup?.tool??previousMachine?.defaultSetup.tool;
  const defaulted=!previous.placement||same(previous.placement,defaultPlacement(previousMachine,tool,boundsMm))
    ||same(previous.placement,defaultPlacement(previousMachine,tool));
  return {setup,output:previousMachine?settings.output:previous.output??settings.output,
    process:{...settings.process,...previous.process},
    placement:defaulted?defaultPlacement(machine,setup.tool,boundsMm):previous.placement};
}
