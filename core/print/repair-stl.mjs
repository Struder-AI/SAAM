// Explicit mesh preparation. Accepted output returns to normal import and review.
import {mkdir,writeFile,access,mkdtemp,rm,copyFile,rename} from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {join,dirname,basename,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {decodeSTL,cleanTriangleSoup,encodeRepairSTLChunks,validateRepair} from '../geom/mesh-repair.mjs';
import {makeMesh} from '../geom/mesh.mjs';
import {decodeSTLFile} from '../geom/stl-file.mjs';
import {repairMeshNative} from '../geom/mesh-native.mjs';
import {triangleIndex,checkAdjacentContacts} from '../geom/mesh-spatial.mjs';
import {hash} from './plan.mjs';
import {isMainThread} from 'node:worker_threads';
import {runRepairJob} from './mesh-repair-job.mjs';

const retired=['resolutionMm','maxGridPoints','maxOutputTriangles','fillRule','targetTriangles','maxPlaneErrorMm','maxBatchTriangles'];
function checkOptions(options){for(const key of retired)if(options[key]!==undefined)throw Error(`Unsupported repair option: ${key}. Mesh repair now preserves source facets; remove obsolete options.`);}
function shapeChanges(source,result,progress,signal){
  const sourcePoints=new Map(source.vertices.map((p,i)=>[p.join(','),i]));
  const key=t=>[...t].sort((a,b)=>a-b).join(','),original=new Set(source.triangles.map(key));let unchanged=0;
  for(const t of result.triangles){const mapped=t.map(v=>sourcePoints.get(result.vertices[v].join(',')));if(mapped.every(v=>v!==undefined)&&original.has(key(mapped)))unchanged++;}
  if(unchanged===source.triangles.length&&unchanged===result.triangles.length){const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};for(const p of source.vertices)for(let k=0;k<3;k++){bounds.min[k]=Math.min(bounds.min[k],p[k]);bounds.max[k]=Math.max(bounds.max[k],p[k]);}return {inputBoundsMm:bounds,outputBoundsMm:structuredClone(bounds),unchangedSourceFaces:unchanged,changedSourceFaces:0,newOutputFaces:0,sampledDistanceMm:{sourceToResult:0,resultToSource:0,sourceSamples:0,resultSamples:0,coverage:'Exact equality of all cleaned input/output face geometry; no distance sampling needed.'}};}
  const sourceIndex=triangleIndex(source.vertices,source.triangles),resultIndex=triangleIndex(result.vertices,result.triangles);
  const centroid=(mesh,t)=>[0,1,2].map(k=>(mesh.vertices[t[0]][k]+mesh.vertices[t[1]][k]+mesh.vertices[t[2]][k])/3);
  function sample(mesh,index){let distance=0,samples=0;const total=mesh.vertices.length+mesh.triangles.length,step=Math.max(1,Math.ceil(total/10000));for(let i=0;i<total;i+=step){signal?.throwIfAborted();const p=i<mesh.vertices.length?mesh.vertices[i]:centroid(mesh,mesh.triangles[i-mesh.vertices.length]);distance=Math.max(distance,index.nearest(p).distance);samples++;}return {maxMm:distance,samples};}
  progress({stage:'measure-changes'});const forward=sample(source,resultIndex),reverse=sample(result,sourceIndex);
  return {inputBoundsMm:sourceIndex.bounds,outputBoundsMm:resultIndex.bounds,unchangedSourceFaces:unchanged,changedSourceFaces:source.triangles.length-unchanged,newOutputFaces:result.triangles.length-unchanged,
    sampledDistanceMm:{sourceToResult:forward.maxMm,resultToSource:reverse.maxMm,sourceSamples:forward.samples,resultSamples:reverse.samples,coverage:'Deterministic vertex and face-centroid samples (at most 10,000 per direction); not a certified surface bound.'}};
}
async function prepare(source,options){
  checkOptions(options);const {units,signal,progress=()=>{}}=options;signal?.throwIfAborted();const start=performance.now();
  if(options.maxSampledDistanceMm!==undefined&&(!Number.isFinite(options.maxSampledDistanceMm)||options.maxSampledDistanceMm<0))throw Error('maxSampledDistanceMm must be nonnegative.');
  progress({stage:'read-source'});const input=typeof source==='string'?await decodeSTLFile(source,{units,signal,progress}):decodeSTL(source,{units});
  const sourceHash=input.sha256??hash(source),clean=cleanTriangleSoup(input);let result,sourceError;
  progress({stage:'cleanup'});
  try{makeMesh(clean.vertices,clean.triangles);checkAdjacentContacts(clean);result={...clean,report:{method:clean.stitching.edges?'edge-stitch-cleanup/1':'exact-cleanup/1'}};}catch(error){if(error.code==='MESH_MEMORY_BUDGET')throw error;sourceError=error.message;}
  if(!result)result=await repairMeshNative(clean,options);
  signal?.throwIfAborted();progress({stage:'validate',triangles:result.triangles.length});makeMesh(result.vertices,result.triangles);checkAdjacentContacts(result);
  const changes=shapeChanges(clean,result,progress,signal);
  if(options.maxSampledDistanceMm!==undefined&&Math.max(changes.sampledDistanceMm.sourceToResult,changes.sampledDistanceMm.resultToSource)>options.maxSampledDistanceMm)throw Object.assign(Error('Repair exceeds maxSampledDistanceMm; no result accepted.'),{code:'MESH_SHAPE_CHANGE',changes});
  const report={schema:'saam-mesh-repair/2',sourceSha256:sourceHash,sourceUnits:units,outputUnits:'mm',sourceValidationError:sourceError??null,...result.report,removed:clean.removed,stitching:clean.stitching,inputTriangles:input.triangles.length,outputTriangles:result.triangles.length,...changes,
    validation:'Shared mesh topology/intersection checks, adjacent-contact checks and exact-output STL reimport. Numerical contact tolerance is 1e-9 mm; sampled distances do not certify shape fidelity.',geometryApproved:false};
  return {result,report,start};
}
async function emitGeometry(result,{onGeometry,progress=()=>{},signal}){
  if(!onGeometry)return;const total=result.triangles.length;
  for(let first=0;first<total;first+=4096){signal?.throwIfAborted();const end=Math.min(total,first+4096),vertices=[],faces=[],mapping=new Map();
    for(let i=first;i<end;i++)faces.push(result.triangles[i].map(v=>{if(!mapping.has(v)){mapping.set(v,vertices.length);vertices.push([...result.vertices[v]]);}return mapping.get(v);}));
    const event={stage:'geometry',firstTriangle:first,completed:end,total,percent:100*end/total,vertices,faces};await onGeometry(event);progress({stage:event.stage,completed:end,total,percent:event.percent});
  }
}
export async function repairSTL(sourceBytes,options={}){
  if(isMainThread)return runRepairJob('bytes',null,sourceBytes,options);
  const {result,report,start}=await prepare(sourceBytes,options),repairedBytes=validateRepair(result);report.repairedSha256=hash(repairedBytes);
  await emitGeometry(result,options);report.elapsedSeconds=(performance.now()-start)/1000;options.progress?.({stage:'complete',percent:100});return {repairedBytes,report};
}
export async function repairSTLFiles(directory,source,options={}){
  if(isMainThread)return runRepairJob('files',directory,source,options);
  directory=resolve(directory);try{await access(directory);throw Object.assign(Error('EEXIST: repair destination already exists.'),{code:'EEXIST'});}catch(error){if(error.code!=='ENOENT')throw error;}
  const {result,report,start}=await prepare(source,options),parent=dirname(directory),temporary=await mkdtemp(join(parent,'.'+basename(directory)+'-repair-'));let owned=false;
  try{
    const output=join(temporary,'repaired.stl'),digest=createHash('sha256');
    async function* chunks(){for(const chunk of encodeRepairSTLChunks(result)){options.signal?.throwIfAborted();digest.update(chunk);yield chunk;}}
    await pipeline(chunks(),createWriteStream(output),{signal:options.signal});report.repairedSha256=digest.digest('hex');
    const reimport=await decodeSTLFile(output,{units:'mm',signal:options.signal});makeMesh(reimport.vertices,reimport.triangles);checkAdjacentContacts(reimport);
    if(typeof source==='string'){await copyFile(source,join(temporary,'original.stl'));const copiedHash=createHash('sha256');for await(const chunk of createReadStream(join(temporary,'original.stl'),{signal:options.signal}))copiedHash.update(chunk);if(copiedHash.digest('hex')!==report.sourceSha256)throw Error('Source changed during repair; no result accepted.');}
    else await writeFile(join(temporary,'original.stl'),source,{flag:'wx'});
    await emitGeometry(result,options);report.elapsedSeconds=(performance.now()-start)/1000;await writeFile(join(temporary,'repair.json'),JSON.stringify(report,null,2)+'\n');
    await mkdir(directory);owned=true;for(const name of ['original.stl','repaired.stl','repair.json'])await rename(join(temporary,name),join(directory,name));owned=false;options.progress?.({stage:'complete',percent:100});return report;
  }finally{
    if(dirname(temporary)!==parent)throw Error('Unexpected repair staging path');
    await rm(temporary,{recursive:true,force:true,maxRetries:4,retryDelay:100});
    if(owned)await rm(directory,{recursive:true,force:true,maxRetries:4,retryDelay:100});
  }
}
