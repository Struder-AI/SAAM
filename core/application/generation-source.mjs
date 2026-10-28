import {GENERATION_PARAMETERS} from '../dimensions.mjs';
import {PATH_CONTRACT,NEUTRAL_PATH_CONTRACT} from '../path/dependencies.mjs';
import {generationExtensionSources} from '../path/extension-dependencies.mjs';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export async function pathSource(plan){
  const release=await readFile(new URL('../../release.json',import.meta.url),'utf8').then(JSON.parse)
    .catch(error=>{if(error.code!=='ENOENT')throw error;return {version:PATH_CONTRACT};});
  if(!release||typeof release.version!=='string'||!release.version)throw Error('Installed release record has no version.');
  const version=release.version;
  // An unavailable executable extension affects only its assignments. Its
  // absence still belongs to the source snapshot, so installing or repairing
  // it invalidates an earlier partial path before the next generation.
  const selected=await generationExtensionSources(plan);
  const hash=createHash('sha256').update(JSON.stringify([version,PATH_CONTRACT,NEUTRAL_PATH_CONTRACT,selected,GENERATION_PARAMETERS])).digest('hex');
  return {release:version,hash};
}
