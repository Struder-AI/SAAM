import {mkdir,realpath} from 'node:fs/promises';
import {resolve,basename,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {importSTLBundle} from '../core/print/import-stl.mjs';

export async function importStudioSTL(library,bytes,{name,units,machineId,tour=false}={}){
  if(units!==undefined&&!['auto','mm','inch'].includes(units))throw Error('Use auto, mm or inch STL units.');
  if(typeof name!=='string'||name.length>240||!name.toLowerCase().endsWith('.stl'))throw Error('Choose an STL file.');
  if(!bytes.length||bytes.length>64*1024*1024)throw Error('Choose an STL file up to 64 MiB.');
  const root=await realpath(library),parent=resolve(root,tour?'tour':'');await mkdir(parent,{recursive:true});
  const actual=await realpath(parent);if(actual!==root&&!actual.startsWith(root+sep))throw Error('Import must stay in the print library.');
  let stem=basename(name.replaceAll('\\','/')).slice(0,-4).replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/,'');
  if(!stem||/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(stem)||stem.startsWith('.'))stem='Imported model';
  let directory,index=1;
  for(;;){directory=resolve(actual,stem+(index===1?'':' '+index));try{await mkdir(directory);break;}catch(e){if(e.code!=='EEXIST')throw e;index++;}}
  const defaultRoot=resolve(fileURLToPath(new URL('../Prints/',import.meta.url)));
  const setupFile=root.toLowerCase()===defaultRoot.toLowerCase()?undefined:resolve(root,'.machine-setups',machineId+'.json');
  await importSTLBundle(directory,bytes,{units,machineId,setupFile});
  return directory;
}
