import {requireThat} from '../private/settings/numeric.mjs';
import { readFileSync } from 'node:fs';
import {machineCatalog} from '../extensions/library.mjs';

// Profiles ship in machine extensions (bundled machines/<extension>/ or the home's extensions folder).
export const machineIds=()=>[...machineCatalog().keys()];
// Bundles keep machine facts and settings. Program templates stay in extensions.
export function storedMachineSnapshot(machine){
  return machine?{...machine,outputs:machine.outputs.map(({program,...output})=>output)}:null;
}
export function loadMachine(id='ultimaker-s5') {
  const entry=machineCatalog().get(id);
  requireThat(entry,'Unknown machine profile.');
  const machine=JSON.parse(readFileSync(entry.file,'utf8'));
  requireThat(machine.id===id,`Machine profile ${id} names another id.`);
  return machine;
}

// A locked machine snapshot as current adapters read it: setup blocks its
// profile gained after it was saved (an adapter's installation block) come from
// the installed profile; every authored value stays. Missing output templates
// use the installed profile. filled names the added setup keys.
export function currentMachineSnapshot(machine){
  const entry=machine?machineCatalog().get(machine.id):null;
  if(!entry)return {machine,filled:[],notes:[]};
  const profile=JSON.parse(readFileSync(entry.file,'utf8')),defaults=profile.defaultSetup??{};
  const filled=Object.keys(defaults).filter(key=>!Object.hasOwn(machine.defaultSetup??{},key));
  const supplied=machine.outputs.map(output=>({output,program:output.program??profile.outputs.find(candidate=>candidate.id===output.id)?.program}));
  const outputs=supplied.map(({output,program})=>program&&!output.program?{...output,program}:output);
  const tools=machine.tools.map(tool=>({...tool,...(!tool.nozzleGeometry&&profile.tools?.find(candidate=>candidate.index===tool.index)?.nozzleGeometry?
    {nozzleGeometry:profile.tools.find(candidate=>candidate.index===tool.index).nozzleGeometry}:{})}));
  return {machine:{...machine,tools,...(!machine.nozzleGeometry&&profile.nozzleGeometry?{nozzleGeometry:profile.nozzleGeometry}:{}),outputs,
    defaultSetup:{...machine.defaultSetup,...Object.fromEntries(filled.map(key=>[key,defaults[key]]))}},filled,notes:[]};
}
