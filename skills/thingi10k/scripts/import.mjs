import {access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {importSTLBundle} from '../../../core/print/import-stl.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';

export async function importThingi10KBundle(client, directory, fileId, options = {}) {
  loadMachine(options.machineId);
  if (!['auto', 'mm', 'inch'].includes(options.units ?? 'auto')) throw Error('Use auto, mm or inch units.');
  try { await access(resolve(directory, 'plan.json')); throw Error('Print already exists. Choose another directory.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const downloaded = await client.download(fileId, options);
  try {
    await importSTLBundle(directory, downloaded.sourcePath, {...options, attribution: downloaded.attribution});
  } catch (error) {
    return {...downloaded, imported: false, error: error.message,
      nextStep: 'The downloaded original and attribution are retained at sourcePath and sourcePath + .json. For a geometry defect use the mesh-tools manual, preserving attribution and recording repair changes; otherwise resolve the reported import error.'};
  }
  return {...downloaded, imported: true, directory: resolve(directory), nextStep: 'Show the imported geometry in Studio with its dimensions. Nothing is approved.'};
}
