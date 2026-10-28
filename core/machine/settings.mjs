import {CONSTRUCTION_TOLERANCE_MM} from '../dimensions.mjs';
// Reusable machine/material/installation settings. Consumers keep selected
// snapshots; reading a bundle never consults this store. The owner supplies the
// store folder (`machineSetups`); without one, nothing is remembered or recalled.
import {loadMachine} from './profile.mjs';
import {requireThat} from '../private/settings/numeric.mjs';
import {readRememberedSetup} from './settings-memory.mjs';
export {saveSetup} from './settings-memory.mjs';
import {DEFAULT_MINIMUM_BRIDGE_RATIO} from '../path/process-controls.mjs';

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

// The selected tool may have its own bed; otherwise use the machine envelope.
export function machineBounds(machine,tool){
  return machine?.tools.find(t=>t.index===tool)?.bounds??machine?.bounds;
}
// The XY offset that puts the part on the selected tool's bed: the bed's centre,
// with the part's footprint centred there when its bounds are known. Without a
// machine the part stays at its own origin.
export function defaultPlacement(machine,tool,boundsMm){
  if(!machine)return {xMm:0,yMm:0};
  const plate=machineBounds(machine,tool),part=i=>boundsMm?(boundsMm.min[i]+boundsMm.max[i])/2:0;
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
      lineWidthMm:0.4,
      planarWallToleranceMm:machine?.planarWallToleranceMm??CONSTRUCTION_TOLERANCE_MM,
      planarSpeedMmS:20,skinSpeedMmS:10,firstLayerSpeedMmS:12,travelSpeedMmS:60,zSpeedMmS:5,
      retractMm:6.5,retractSpeedMmS:25,liftMm:1,maxCombMm:6,
      fanPercent:100,maxFlowMm3S:4,minimumLayerSeconds:6,minimumBridgeRatio:DEFAULT_MINIMUM_BRIDGE_RATIO,
      experimentalDeposition:false,primeLine:null,clearanceResponsibility:'operator',
      clearanceNote:'Nozzle clearance uses the saved geometry envelope; carriage, fixtures and physical qualification remain the operator’s responsibility.',
      ...structuredClone(machine?.defaultProcess??{}),firstLayerMm:0.2,layerMm:0.2
    },
    output:machine?.outputs[0].id??null
  };
}

// An unreadable remembered setup leaves the profile's defaults and a note; the
// file stays for the next successful export to replace.
export async function selectSettings(machineId,{machineSetups,appRoot,dataRoot}={}){
  const machine=loadMachine(machineId,{appRoot,dataRoot}),settings=settingsDefaults(machine),{saved,unreadable}=await readRememberedSetup(machine.id,{machineSetups});
  const notes=unreadable?[`Remembered setup for ${machine.name} couldn't be read; using defaults.`]:[];
  if(saved){
    const remembered=Object.fromEntries(Object.entries(neutralMaterials(saved.setup)??{}).filter(([key])=>Object.hasOwn(settings.setup,key)));
    settings.setup={...settings.setup,...remembered,materialGuid:remembered.materialGuid||settings.setup.materialGuid};
  }
  settings.placement=defaultPlacement(machine,settings.setup.tool);
  return {machine,settings,notes};
}

// Initial publication overlays authored values on one retained selection.
// Known host-derived defaults resolve after the part bounds are available.
export function resolveInitialSettings(plan,{machine,settings},{boundsMm,placementOrigins}={}){
  const base=structuredClone(settings),patch=Object.fromEntries(SETTINGS_FIELDS.filter(key=>Object.hasOwn(plan,key)).map(key=>[key,plan[key]]));
  const resolved={...base,...resolveSettingsPatch(base,patch)};
  const centered=defaultPlacement(machine,resolved.setup?.tool??machine.defaultSetup.tool,boundsMm);
  if(!Object.hasOwn(plan,'placement'))resolved.placement=centered;
  else if(settingsRecord(plan.placement))resolved.placement={...centered,...structuredClone(plan.placement)};
  for(const axis of ['xMm','yMm'])if(placementOrigins?.[axis]==='derived')resolved.placement={...resolved.placement,[axis]:centered[axis]};
  return resolved;
}

// Material is not machine: the print's material settings stay across a machine change.
const MATERIAL_FIELDS=['material','nozzleC','filament','filaments'];
// A machine change preserves authored process/material values; Bundle rechecks
// the schedule's nozzle dimensions. Remembered/default setup fills omissions.
// Only known-derived coordinates follow the new bed; authored/unknown stay.
export function resolveMachineSettings(previous,previousMachine,{machine,settings},{boundsMm,placementOrigins}={}){
  const material=Object.fromEntries(MATERIAL_FIELDS.filter(key=>previous.setup?.[key]!==undefined).map(key=>[key,structuredClone(previous.setup[key])]));
  if(previous.setup?.filamentColor!=null)material.filamentColor=structuredClone(previous.setup.filamentColor);
  const setup=previousMachine?{...settings.setup,...material}:{...settings.setup,...previous.setup};
  const centered=defaultPlacement(machine,setup.tool,boundsMm),placement={...previous.placement};
  for(const axis of ['xMm','yMm'])if(placementOrigins?.[axis]==='derived')placement[axis]=centered[axis];
  return {setup,output:!previousMachine&&machine.outputs.some(output=>output.id===previous.output)?previous.output:settings.output,
    process:{...settings.process,...previous.process},
    placement};
}
