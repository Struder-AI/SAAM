// Geometry converts acquired STL bytes and provenance into an authored geometry record.
import {canonicalHash} from '../canonical-json.mjs';
import {decodeSTL} from './mesh.mjs';
import {decodeSTLFile} from './stl-file.mjs';
import {createGeometry,transferGeometry,receiveGeometry} from '../print/geometry.mjs';
import {repairSTLFiles} from '../print/repair-stl.mjs';
import {executeGeometry} from './execution.mjs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createTemporaryWorkspace} from '../application/temporary-workspace.mjs';

const importScratch=new Map();
// Import repair closes small openings and refuses larger ones. A hole fills only
// when it is at most this wide (bounding-box diagonal of its boundary) and has at
// most IMPORT_HOLE_EDGES edges. Owner, 2026-10-06: "I'd like our mesh repair to
// have BOTH an edge limit and a size limit (2mm? unless the size check is too
// costly, then let me know)", and on filling ordinary imports automatically
// within those limits: "Yeah I think A."
export const IMPORT_HOLE_DIAMETER_MM=2;
// Owner approved 500 edges and 2 mm on 2026-10-07. Filling time grows as the cube
// of a hole's edge count (about 0.4 s at 500 edges, 3.5 s at 1,000, 28 s at 2,000);
// 500 edges around a 2 mm opening are already about 13 um long.
export const IMPORT_HOLE_EDGES=500;
const repairable=error=>/^(?:Duplicate mesh triangle.|Invalid mesh triangle indices.)/.test(error.message);

// Import owns scratch, decoding, explicit repair and completed native geometry.
// No bundle directory or persistence callback crosses this boundary.
export async function prepareSTLImport(source,options={}){
  options.signal?.throwIfAborted();
  const workspace=await createTemporaryWorkspace('stl-import'),scratch=workspace.directory;importScratch.set(scratch,workspace);
  try{return {...await prepareSTLImportAt(scratch,source,options),scratch};}
  catch(error){await releaseSTLImport({scratch});throw error;}
}
export async function releaseSTLImport({scratch}){
  if(!importScratch.has(scratch))return;
  await importScratch.get(scratch).release();importScratch.delete(scratch);
}
async function prepareSTLImportAt(scratch,source,{units='auto',bounds,center=true,progress,signal,attribution,repairReport,repair=true,...options}={}){
  if(!['auto','mm','inch'].includes(units))throw Error('Use auto, mm or inch STL units.');
  let sourcePath=typeof source==='string'?source:join(scratch,'source.stl');
  if(typeof source!=='string')await writeFile(sourcePath,source);
  const importDiagnostic={sourceSha256:null,repairedSha256:null,stage:'import',repairAttempted:false,repaired:false,
    ...(attribution?{dataset:{provider:attribution.provider,fileId:attribution.fileId,revision:attribution.revision}}:{})};
  const sourceState={info:null,error:null};
  const remember=info=>{
    if(!info||importDiagnostic.repaired)return;
    importDiagnostic.sourceSha256=info.sha256;importDiagnostic.sourceBytes=info.bytes;
    importDiagnostic.inputVertices=info.inputVertices;importDiagnostic.inputTriangles=info.inputTriangles;
    importDiagnostic.merge=info.merge??null;
    if(info.complete!==undefined)importDiagnostic.sourceComplete=info.complete;
  };
  const prepare=async()=>{
    try{
      const response=await executeGeometry('stl-source',{source:sourcePath,options:{units,bounds,attribution,repairReport}},
        {signal,progress,timeoutMs:options.timeoutMs,subject:'STL import',detail:' reading '+sourcePath,memoryCode:'MESH_MEMORY_EXHAUSTED'});
      sourceState.info=response.sourceInfo;remember(response.sourceInfo);
      const {sourceInfo,...result}=response;
      result.geometry=await receiveGeometry(result.geometry);
      if(!importDiagnostic.repaired)importDiagnostic.merge=result.merge??null;
      if(result.merge)importDiagnostic.meshNormalization=result.merge;
      return result;
    }catch(error){
      sourceState.error=error;sourceState.info=error.sourceInfo??null;remember(error.sourceInfo??error.stlSource);
      throw error;
    }
  };
  progress?.({stage:'import'});
  let result,repaired=false,attachments=[];
  try{
    try{result=await prepare();}
    catch(error){
      importDiagnostic.rejection={name:error.name,code:error.code??null,message:error.message,meshDiagnostic:error.meshDiagnostic??null};
      if(!repair||!repairable(error))throw error;
      importDiagnostic.repairAttempted=true;importDiagnostic.stage='repair';
      if(units==='auto'){if(!sourceState.info)throw sourceState.error;units=sourceState.info.inferredUnits;}
      const directory=join(scratch,'repair');progress?.({stage:'repair'});
      repairReport=await repairSTLFiles(directory,sourcePath,{...options,units,maxHoleEdges:IMPORT_HOLE_EDGES,maxHoleDiameterMm:IMPORT_HOLE_DIAMETER_MM,signal,
        progress:event=>{importDiagnostic.repairStage=event.stage;progress?.({...event,stage:'repair',step:event.stage});}});
      importDiagnostic.repairedSha256=repairReport.repairedSha256;importDiagnostic.repaired=true;
      importDiagnostic.repair={method:repairReport.method,inputTriangles:repairReport.inputTriangles,outputTriangles:repairReport.outputTriangles,
        resolutionMerge:repairReport.resolutionMerge??null,removed:repairReport.removed,shells:repairReport.shells,stitching:repairReport.stitching,holesFilled:repairReport.holesFilled??0,holeTrianglesAdded:repairReport.holeTrianglesAdded??0,reconstruction:repairReport.reconstruction??null,changedSourceFaces:repairReport.changedSourceFaces,newOutputFaces:repairReport.newOutputFaces,
        sampledDistanceMm:repairReport.sampledDistanceMm};
      sourcePath=join(directory,'repaired.stl');units='mm';repaired=true;
      attachments=['original.stl','repaired.stl','repair.json'].map(name=>({file:'repair/'+name,sourcePath:join(directory,name)}));
      importDiagnostic.stage='import-repaired';progress?.({stage:'import-repaired'});result=await prepare();
    }
    signal?.throwIfAborted();
    const placement=!bounds?undefined:center?{xMm:(bounds.max[0]+bounds.min[0]-result.footprint[0])/2,yMm:(bounds.max[1]+bounds.min[1]-result.footprint[1])/2}:{xMm:bounds.min[0]+5,yMm:bounds.min[1]+5};
    importDiagnostic.stage='complete';
    return {...result,placement,sourcePath,attachments,repaired,importDiagnostic};
  }catch(error){
    importDiagnostic.failure={name:error.name,code:error.code??null,message:error.message,meshDiagnostic:error.meshDiagnostic??null};
    throw Object.assign(error,{importDiagnostic});
  }
}

// Read/admit one source without publication. The shared executor owns isolation.
export async function prepareSTLSourceValue(sourcePath,{units='auto',bounds,attribution,repairReport,signal,progress}={}){
  const decodedSource=await decodeSTLFile(sourcePath,{units:'mm',signal,progress});
  const sourceInfo={sha256:decodedSource.sha256,bytes:decodedSource.bytes,inputVertices:decodedSource.vertices.length,
    inputTriangles:decodedSource.triangles.length,merge:decodedSource.merge??null,inferredUnits:inferSTLUnits(decodedSource,bounds)};
  try{
    const result=await prepareImportedGeometry(undefined,{units,bounds,decodedSource,attribution,repairReport});
    signal?.throwIfAborted();
    return {...result,geometry:await transferGeometry(result.geometry),sourceInfo};
  }catch(error){throw Object.assign(error,{sourceInfo});}
}

export function inferSTLUnits(mesh,bounds){
  if(!bounds)return 'mm';
  const size=[0,1,2].map(k=>{let min=Infinity,max=-Infinity;for(const p of mesh.vertices){min=Math.min(min,p[k]);max=Math.max(max,p[k]);}return max-min;});
  const longest=Math.max(...size),fitsInches=size.every((v,k)=>v*25.4<=bounds.max[k]-bounds.min[k]-(k<2?5:0));
  // Provisional D-030: prefer mm; only reinterpret a very small model when
  // inches give a plausible size that still fits this printer.
  return longest<10&&longest*25.4>=10&&fitsInches?'inch':'mm';
}
function geometryFromSTL(sourceHash,units,mesh,inferred=false){
  const factor=units==='inch'?25.4:1;
  const translationMm=mesh.vertices.length?[0,1,2].map(k=>-mesh.vertices.reduce((minimum,p)=>Math.min(minimum,p[k]*factor),Infinity)):[0,0,0];
  return {shape:'mesh',vertices:mesh.vertices.map(p=>p.map((v,k)=>v*factor+translationMm[k])),triangles:mesh.triangles,source:{format:'stl',sha256:sourceHash,units,scale:1,unitsInferred:inferred,translationMm}};
}

export async function prepareImportedGeometry(sourceBytes,{units='auto',bounds,decodedSource,attribution,repairReport}={}){
  let geometry;
  const file=Boolean(decodedSource),mesh=decodedSource??decodeSTL(sourceBytes,{units:'mm'}),inferred=units==='auto';
  if(inferred)units=inferSTLUnits(mesh,bounds);
  geometry=geometryFromSTL(file?mesh.sha256:canonicalHash(sourceBytes),units,mesh,inferred);
  if(attribution){
    if(attribution.sha256!==(repairReport?.sourceSha256??geometry.source.sha256)||repairReport&&repairReport.repairedSha256!==geometry.source.sha256)throw Error('Mesh attribution does not match the downloaded source hash or verified repair.');
    geometry.source.attribution=structuredClone(attribution);
    if(repairReport)geometry.source.repair={sourceSha256:repairReport.sourceSha256,repairedSha256:repairReport.repairedSha256};
  }
  // Geometry owns admission and preparation, in physical millimetres; Bundle reuses it.
  const artifact=await createGeometry(geometry);
  geometry=artifact.descriptor.parameters;
  // Centre the imported mesh on the plate. Its vertices were translated to put
  // the minimum XY at the origin, so the footprint size is the vertex span.
  const footprint=[0,1].map(k=>artifact.descriptor.boundsMm.max[k]-artifact.descriptor.boundsMm.min[k]);
  return {geometry,footprint,...(artifact.descriptor.meshNormalization?.length?{merge:artifact.descriptor.meshNormalization[0]}:{})};
}
