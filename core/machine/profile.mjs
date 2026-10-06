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
