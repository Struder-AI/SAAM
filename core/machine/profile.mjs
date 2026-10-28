import {requireThat} from '../private/settings/numeric.mjs';
import { readFileSync } from 'node:fs';
import {machineProfileDeclarations} from '../extensions/library.mjs';

// Profiles ship in machine extensions (bundled machines/<extension>/ or the home's extensions folder).
export const machineIds=()=>[...machineProfileDeclarations().profiles.keys()];
// Captured profile data includes the templates needed by its selected output.
// Generated machine programs and executable adapters are not snapshot data.
export function storedMachineSnapshot(machine){
  return machine?structuredClone(machine):null;
}
// Settings' resolution of a machine label: the installed profile, or null when
// no label is set or that machine is not installed here.
export function installedMachine(id,options={}){
  if(!id)return null;
  return machineProfileDeclarations(options).profiles.has(id)?loadMachine(id,options):null;
}
export function loadMachine(id='ultimaker-s5',options={}) {
  const entry=machineProfileDeclarations(options).profiles.get(id);
  requireThat(entry,'Unknown machine profile.');
  const machine=JSON.parse(readFileSync(entry.file,'utf8'));
  requireThat(machine.id===id,`Machine profile ${id} names another id.`);
  return machine;
}
