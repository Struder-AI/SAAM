import {access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createSTLBundle} from '../../../core/print/import-stl.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';

export async function importThingi10KBundle(client, directory, fileId, options = {}) {
  loadMachine(options.machineId);
  if (!['auto', 'mm', 'inch'].includes(options.units ?? 'auto')) throw Error('Use auto, mm or inch units.');
  try { await access(resolve(directory, 'plan.json')); throw Error('Print already exists. Choose another directory.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const downloaded = await client.download(fileId, options);
  try {
    await createSTLBundle(directory, downloaded.sourcePath, {...options, attribution: downloaded.attribution});
  } catch (error) {
    if(options.signal?.aborted)throw error;
    return {...downloaded, imported: false, error: error.message,
      nextStep: 'The downloaded original and attribution are retained at sourcePath and sourcePath + .json. Automatic repair could not accept this input; explain the reported failure and choose a corrected source or ask a builder to diagnose it.'};
  }
  return {...downloaded, imported: true, directory: resolve(directory), nextStep: 'Show the imported geometry in Studio with its dimensions. Nothing is approved.'};
}
