// Geometry converts acquired STL bytes and provenance into an authored geometry record.
import {canonicalHash} from '../canonical-json.mjs';
import {parseSTL,makeMesh} from './mesh.mjs';
import {decodeSTLFile} from './stl-file.mjs';
import {createGeometry} from '../print/geometry.mjs';
import {repairSTLFiles} from '../print/repair-stl.mjs';
import {runRepairJob} from '../print/mesh-repair-job.mjs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createTemporaryWorkspace} from '../application/temporary-workspace.mjs';

const importScratch=new Map();
const repairable=error=>error.meshDiagnostic?.kind==='triangle-intersection'
  ||/^(?:Degenerate mesh triangle\.|Duplicate mesh triangle\.|Invalid mesh triangle indices\.|Mesh must be closed, manifold and consistently wound;|Unused or nonmanifold mesh vertex\.|Nonmanifold mesh vertex\.)/.test(error.message);

// Import owns scratch, decoding, explicit repair and completed native geometry.
// No bundle directory or persistence callback crosses this boundary.
export async function prepareSTLImport(source,options={}){
  options.signal?.throwIfAborted();
  const workspace=await createTemporaryWorkspace('stl-import'),scratch=workspace.directory;importScratch.set(scratch,workspace);
  try{return {...await runRepairJob('import',scratch,source,options),scratch};}
  catch(error){await releaseSTLImport({scratch});throw error;}
}
export async function releaseSTLImport({scratch}){
  if(!importScratch.has(scratch))return;
  await importScratch.get(scratch).release();importScratch.delete(scratch);
}
export async function prepareSTLImportInWorker(scratch,source,{units='auto',bounds,center=true,progress,signal,attribution,repairReport,repair=true,...options}={}){
  if(!['auto','mm','inch'].includes(units))throw Error('Use auto, mm or inch STL units.');
  let sourcePath=typeof source==='string'?source:join(scratch,'source.stl');
  if(typeof source!=='string')await writeFile(sourcePath,source);
  const importDiagnostic={sourceSha256:null,repairedSha256:null,stage:'import',repairAttempted:false,repaired:false,
    ...(attribution?{dataset:{provider:attribution.provider,fileId:attribution.fileId,revision:attribution.revision}}:{})};
  const decode=async()=>{
    try{
      const decoded=await decodeSTLFile(sourcePath,{units:'mm',signal,progress});
      if(!importDiagnostic.repaired){importDiagnostic.sourceSha256=decoded.sha256;importDiagnostic.sourceBytes=decoded.bytes;
        importDiagnostic.inputVertices=decoded.vertices.length;importDiagnostic.inputTriangles=decoded.triangles.length;}
      return decoded;
    }catch(error){
      if(!importDiagnostic.repaired&&error.stlSource){importDiagnostic.sourceSha256=error.stlSource.sha256;
        importDiagnostic.sourceBytes=error.stlSource.bytes;importDiagnostic.sourceComplete=error.stlSource.complete;}
      throw error;
    }
  };
  const prepare=async()=>{
    const decodedSource=await decode();
    const result=await prepareImportedGeometry(undefined,{units,bounds,decodedSource,attribution,repairReport});
    return {...result,artifact:await createGeometry(result.geometry)};
  };
  progress?.({stage:'import'});
  let result,repaired=false,attachments=[];
  try{
    try{result=await prepare();}
    catch(error){
      importDiagnostic.rejection={name:error.name,code:error.code??null,message:error.message,meshDiagnostic:error.meshDiagnostic??null};
      if(!repair||!repairable(error))throw error;
      importDiagnostic.repairAttempted=true;importDiagnostic.stage='repair';
      if(units==='auto')units=inferSTLUnits(await decode(),bounds);
      const directory=join(scratch,'repair');progress?.({stage:'repair'});
      repairReport=await repairSTLFiles(directory,sourcePath,{...options,units,maxHoleEdges:0,maxHoleDiameterMm:0,signal,
        progress:event=>{importDiagnostic.repairStage=event.stage;progress?.({...event,stage:'repair',step:event.stage});}});
      importDiagnostic.repairedSha256=repairReport.repairedSha256;importDiagnostic.repaired=true;
      importDiagnostic.repair={method:repairReport.method,inputTriangles:repairReport.inputTriangles,outputTriangles:repairReport.outputTriangles,
        removed:repairReport.removed,shells:repairReport.shells,stitching:repairReport.stitching,reconstruction:repairReport.reconstruction??null,changedSourceFaces:repairReport.changedSourceFaces,newOutputFaces:repairReport.newOutputFaces,
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
    if(error.nativeDiagnostic)importDiagnostic.native=error.nativeDiagnostic;
    throw Object.assign(error,{importDiagnostic});
  }
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
  const translationMm=[0,1,2].map(k=>-mesh.vertices.reduce((minimum,p)=>Math.min(minimum,p[k]*factor),Infinity));
  return {shape:'mesh',vertices:mesh.vertices.map(p=>p.map((v,k)=>v*factor+translationMm[k])),triangles:mesh.triangles,source:{format:'stl',sha256:sourceHash,units,scale:1,unitsInferred:inferred,translationMm}};
}

export async function prepareImportedGeometry(sourceBytes,{units='auto',bounds,decodedSource,attribution,repairReport}={}){
  let geometry;
  const file=Boolean(decodedSource),mesh=decodedSource??parseSTL(sourceBytes,{units:'mm'}),inferred=units==='auto';
  if(file)makeMesh(mesh.vertices,mesh.triangles);
  if(inferred)units=inferSTLUnits(mesh,bounds);
  geometry=geometryFromSTL(file?mesh.sha256:canonicalHash(sourceBytes),units,mesh,inferred);
  if(attribution){
    if(attribution.sha256!==(repairReport?.sourceSha256??geometry.source.sha256)||repairReport&&repairReport.repairedSha256!==geometry.source.sha256)throw Error('Mesh attribution does not match the downloaded source hash or verified repair.');
    geometry.source.attribution=structuredClone(attribution);
    if(repairReport)geometry.source.repair={sourceSha256:repairReport.sourceSha256,repairedSha256:repairReport.repairedSha256};
  }
  // Centre the imported mesh on the plate. Its vertices were translated to put
  // the minimum XY at the origin, so the footprint size is the vertex span.
  const footprint=[0,1].map(k=>{let mn=Infinity,mx=-Infinity;for(const p of geometry.vertices){mn=Math.min(mn,p[k]);mx=Math.max(mx,p[k]);}return mx-mn;});
  return {geometry,footprint};
}
