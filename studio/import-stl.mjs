import {mkdir,realpath,rm,readFile} from 'node:fs/promises';
import {resolve,basename,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {importOrRepairSTLBundle} from '../core/print/import-stl.mjs';

export async function loadStudioImportRepair(directory){
  let report;
  try{report=JSON.parse(await readFile(resolve(directory,'repair/repair.json'),'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  const removed=report.removed.degenerate+report.removed.duplicates;
  const distance=Math.max(report.sampledDistanceMm.sourceToResult,report.sampledDistanceMm.resultToSource);
  const changes=[removed?`${removed} duplicate or degenerate faces removed`:null,
    report.changedSourceFaces?`${report.changedSourceFaces} source faces changed`:null,
    report.newOutputFaces?`${report.newOutputFaces} output faces added`:null].filter(Boolean);
  return `Mesh repaired${changes.length?': '+changes.join(','):'. Face orientation or connections corrected'}. `+
    `Maximum sampled surface change: ${Number(distance.toPrecision(4))} mm. `+
    `Source units interpreted as ${report.sourceUnits}.`;
}

// Browser progress labels for the core import job's stages and repair steps.
const importStages={import:'Checking your STL',repair:'Repairing your STL','import-repaired':'Opening repaired geometry'};
const repairSteps={'read-source':'Reading your STL',cleanup:'Cleaning mesh faces','measure-changes':'Measuring repaired geometry',validate:'Checking repaired geometry',complete:'Mesh repair complete'};

export async function importStudioSTL(library,bytes,{name,units,machineId,onProgress}={}){
  if(units!==undefined&&!['auto','mm','inch'].includes(units))throw Error('Use auto, mm or inch STL units.');
  if(typeof name!=='string'||name.length>240||!name.toLowerCase().endsWith('.stl'))throw Error('Choose an STL file.');
  if(!bytes.length||bytes.length>64*1024*1024)throw Error('Choose an STL file up to 64 MiB.');
  const root=await realpath(library),parent=root;
  const actual=await realpath(parent);if(actual!==root&&!actual.startsWith(root+sep))throw Error('Import must stay in the print library.');
  let stem=basename(name.replaceAll('\\','/')).slice(0,-4).replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/,'');
  if(!stem||/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(stem)||stem.startsWith('.'))stem='Imported model';
  let directory,index=1;
  for(;;){directory=resolve(actual,stem+(index===1?'':' '+index));try{await mkdir(directory);break;}catch(e){if(e.code!=='EEXIST')throw e;index++;}}
  const defaultRoot=resolve(fileURLToPath(new URL('../Prints/',import.meta.url)));
  const setupFile=root.toLowerCase()===defaultRoot.toLowerCase()?undefined:resolve(root,'.machine-setups',machineId+'.json');
  let shown;
  const progress=event=>{
    const stage=event.stage==='repair'&&repairSteps[event.step]||importStages[event.stage];
    if(stage&&stage!==shown){shown=stage;onProgress?.({stage});}
  };
  try{
    const {repaired}=await importOrRepairSTLBundle(directory,bytes,{units,machineId,setupFile,progress});
    return {directory,repaired,repairSummary:repaired?await loadStudioImportRepair(directory):null};
  }
  catch(error){
    // Only remove the directory this invocation reserved; the core job settles
    // after its worker stops. Do not follow a replaced directory or a path
    // outside the library.
    try{
      const target=await realpath(directory);
      if(target===directory&&target.startsWith(actual+sep))await rm(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});
    }catch(cleanup){if(cleanup.code!=='ENOENT')error.cleanupError=cleanup.message;}
    throw error;
  }
}
