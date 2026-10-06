import {realpath,readFile} from 'node:fs/promises';
import {resolve,basename,dirname,relative,isAbsolute,sep} from 'node:path';

import {prepareSTLImport,releaseSTLImport} from '../core/geom/import-stl.mjs';


export async function loadStudioImportRepair(directory){
  let report;
  try{report=JSON.parse(await readFile(resolve(directory,'repair/repair.json'),'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  const removed=report.removed.degenerate+report.removed.duplicates;
  const distance=Math.max(report.sampledDistanceMm.sourceToResult,report.sampledDistanceMm.resultToSource);
  const changes=[removed?`${removed} duplicate or degenerate faces removed`:null,
    report.changedSourceFaces?`${report.changedSourceFaces} source faces changed`:null,
    report.newOutputFaces?`${report.newOutputFaces} output faces added`:null,
    report.reconstruction?.interiorTriangles?`${report.reconstruction.interiorTriangles} interior faces removed`:null].filter(Boolean);
  return `Mesh repaired${changes.length?': '+changes.join(','):'. Face orientation or connections corrected'}. `+
    `Maximum sampled surface change: ${Number(distance.toPrecision(4))} mm. `+
    `Source units interpreted as ${report.sourceUnits}.`;
}

// Browser progress labels for the core import job's stages and repair steps.
const importStages={import:'Checking your STL',repair:'Repairing your STL','import-repaired':'Opening repaired geometry'};
const repairSteps={'read-source':'Reading your STL',cleanup:'Cleaning mesh faces',orient:'Orienting mesh faces',boundaries:'Checking mesh boundaries',intersections:'Finding mesh intersections',close:'Closing sheets below print resolution',refine:'Splitting intersecting faces',classify:'Finding the solid boundary',round:'Rounding repaired geometry','native-validation':'Checking repaired topology','read-result':'Reading repaired geometry','measure-changes':'Measuring repaired geometry',validate:'Checking repaired geometry',complete:'Mesh repair complete'};

export async function importStudioSTL(library,bytes,{name,units,directory:destination,onProgress,signal}={}){
  signal?.throwIfAborted();
  if(units!==undefined&&!['auto','mm','inch'].includes(units))throw Error('Use auto, mm or inch STL units.');
  if(typeof name!=='string'||!name.toLowerCase().endsWith('.stl'))throw Error('Choose an STL file.');
  if(typeof bytes!=='string'&&(!bytes.length||bytes.length>64*1024*1024))throw Error('Choose an STL file up to 64 MiB.');
  const root=await realpath(library),parent=root;
  const actual=await realpath(parent);if(actual!==root&&!actual.startsWith(root+sep))throw Error('Import must stay in the print library.');
  if(destination){
    destination=resolve(destination);
    const inside=path=>{const rel=relative(root,path);return rel&&!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel);};
    if(!inside(destination))throw Error('Import must stay in the print library.');
    let ancestor=dirname(destination);
    for(;;){try{const resolved=await realpath(ancestor);if(resolved!==root&&!inside(resolved))throw Error('Import must stay in the print library.');break;}catch(error){if(error.code!=='ENOENT')throw error;ancestor=dirname(ancestor);}}
  }
  let stem=basename(name.replaceAll('\\','/')).slice(0,-4).replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/,'');
  if(!stem||/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(stem)||stem.startsWith('.'))stem='Imported model';
  const progress=event=>{
    const stage=event.stage==='repair'&&repairSteps[event.step]||importStages[event.stage];
    onProgress?.({...event,phase:event.stage,stage:stage??event.step??event.stage});
  };
  const candidate=await prepareSTLImport(bytes,{units,progress,signal});
  try{for(let index=1;;index++){
    const directory=destination??resolve(actual,stem+(index===1?'':' '+index));
    try{
      const {commitSTLImport}=await import('../core/print/import-stl.mjs');
      const {repaired}=await commitSTLImport(directory,candidate,{signal});
      return {directory,repaired,importDiagnostic:candidate.importDiagnostic,repairSummary:repaired?await loadStudioImportRepair(directory):null};
    }catch(error){if(destination||!error.importDestinationExists)throw error;}
  }}finally{await releaseSTLImport(candidate);}
}
