// Optional checkout-owned extensions. An ordinary checkout has no extension.
// Never search user data or publish local manuals through the shared reader.
import {lstat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export async function loadLocalExtension(root=resolve(dirname(fileURLToPath(import.meta.url)),'..')){
  const file=resolve(root,'.local/extension.mjs');
  try{const entry=await lstat(file);if(!entry.isFile()||entry.isSymbolicLink())throw new Error('Local extension must be a regular file.');}
  catch(error){if(error.code==='ENOENT')return {};throw error;}
  return import(pathToFileURL(file).href);
}
