import { readFileSync } from 'node:fs';
import { requireThat,distance } from '../geom/tolerance.mjs';

export const MACHINE_IDS=['ultimaker-s5','ultimaker-2-extended','ultimaker-3','bambu-h2d','bambu-x1-carbon','dobot-mg400','denso-vs068a4-rc8'];
export function loadMachine(id='ultimaker-s5') {
  requireThat(MACHINE_IDS.includes(id),'Unknown machine profile.');
  return JSON.parse(readFileSync(new URL(`../../machines/${id}.json`,import.meta.url),'utf8'));
}
export * from './rules.mjs';
