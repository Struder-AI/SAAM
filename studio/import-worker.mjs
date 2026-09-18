// Parsing, topology validation and bundle construction must leave Studio's
// request and connection listeners responsive, including on rejected meshes.
import {parentPort,workerData} from 'node:worker_threads';
import {join} from 'node:path';
import {loadStudioImportRepair} from './import-stl.mjs';
import {importSTLBundle,inferSTLUnits} from '../core/print/import-stl.mjs';
import {proposedPlan} from '../core/print/bundle.mjs';
import {loadMachine,toolBounds} from '../core/machine/profile.mjs';
import {decodeSTL} from '../core/geom/mesh.mjs';
import {repairSTLFiles} from '../core/print/repair-stl.mjs';

// Malformed input, resource limits and setup failures need their original
// diagnostic. Only recognized geometric defects are candidates for repair.
const repairable=error=>error.meshDiagnostic?.kind==='triangle-intersection'
  ||/^(?:Degenerate mesh triangle\.|Duplicate mesh triangle\.|Invalid mesh triangle indices\.|Mesh must be closed, manifold and consistently wound;|Unused or nonmanifold mesh vertex\.|Nonmanifold mesh vertex\.)/.test(error.message);
let lastStage;
const progress=stage=>{if(stage!==lastStage){lastStage=stage;parentPort.postMessage({type:'progress',progress:{stage}});}};

async function importOrRepair(){
  const {directory,options}=workerData,bytes=Buffer.from(workerData.bytes);
  try{
    progress('Checking your STL');
    await importSTLBundle(directory,bytes,options);
    return {repaired:false,repairSummary:null};
  }catch(error){if(!repairable(error))throw error;}

  const sourceUnitsInferred=options.units===undefined||options.units==='auto';
  let units=options.units;
  if(sourceUnitsInferred){
    const machine=loadMachine(options.machineId),plan=await proposedPlan(machine.id,{setupFile:options.setupFile});
    units=inferSTLUnits(decodeSTL(bytes,{units:'mm'}),toolBounds(machine,plan.setup.tool));
  }
  // Preserve both versions and the complete change report inside the print.
  // This directory is new; importStudioSTL removes it if any later stage fails.
  const repairDirectory=join(directory,'repair');
  progress('Repairing your STL');
  const stages={'read-source':'Reading your STL',cleanup:'Cleaning mesh faces','measure-changes':'Measuring repaired geometry',validate:'Checking repaired geometry',complete:'Mesh repair complete'};
  await repairSTLFiles(repairDirectory,bytes,{units,maxHoleEdges:0,maxHoleDiameterMm:0,
    progress:event=>progress(stages[event.stage]??'Repairing your STL')});
  progress('Opening repaired geometry');
  await importSTLBundle(directory,join(repairDirectory,'repaired.stl'),{...options,units:'mm'});
  return {repaired:true,repairSummary:await loadStudioImportRepair(directory)};
}

try{
  parentPort.postMessage({ok:true,result:await importOrRepair()});
}catch(error){
  parentPort.postMessage({error:{message:error.message,code:error.code,meshDiagnostic:error.meshDiagnostic}});
}
