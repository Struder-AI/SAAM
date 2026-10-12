import {requireThat} from '../private/settings/numeric.mjs';
import { readFileSync } from 'node:fs';
import {machineCatalog} from '../extensions/library.mjs';

// Profiles ship in machine extensions (bundled machines/<extension>/ or the home's extensions folder).
export const machineIds=()=>[...machineCatalog().keys()];
export function loadMachine(id='ultimaker-s5') {
  const entry=machineCatalog().get(id);
  requireThat(entry,'Unknown machine profile.');
  const machine=JSON.parse(readFileSync(entry.file,'utf8'));
  requireThat(machine.id===id,`Machine profile ${id} names another id.`);
  return machine;
}

// A locked machine snapshot as current adapters read it: setup blocks its
// profile gained after it was saved (an adapter's installation block) come from
// the installed profile; every value it has stays. filled names the added keys.
export function currentMachineSnapshot(machine){
  const profile=machine?machineCatalog().get(machine.id):null;
  if(!profile)return {machine,filled:[]};
  const defaults=JSON.parse(readFileSync(profile.file,'utf8')).defaultSetup??{};
  const filled=Object.keys(defaults).filter(key=>!Object.hasOwn(machine.defaultSetup??{},key));
  if(!filled.length)return {machine,filled};
  return {machine:{...machine,defaultSetup:{...machine.defaultSetup,...Object.fromEntries(filled.map(key=>[key,defaults[key]]))}},filled};
}
