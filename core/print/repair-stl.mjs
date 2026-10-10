import {canonicalHash} from '../canonical-json.mjs';
// Explicit mesh preparation. Accepted output returns to normal import and review.
import {mkdir,writeFile,access,mkdtemp,rm,copyFile,rename} from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {join,dirname,basename,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {decodeSTL,prepareMesh,compactMesh,encodeRepairSTLChunks,validateRepair} from '../geom/mesh-repair.mjs';
import {makeMesh,triangleNormal} from '../geom/mesh.mjs';
import {decodeSTLFile} from '../geom/stl-file.mjs';
import {triangleIndex,checkAdjacentContacts} from '../geom/mesh-spatial.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM} from '../dimensions.mjs';
import {cross,dot} from '../geom/tolerance.mjs';

import {isMainThread} from 'node:worker_threads';
import {runRepairJob} from './mesh-repair-job.mjs';

function shapeChanges(source,result,progress,signal){
  if(!result.triangles.length){
    const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};for(const p of source.vertices)for(let k=0;k<3;k++){bounds.min[k]=Math.min(bounds.min[k],p[k]);bounds.max[k]=Math.max(bounds.max[k],p[k]);}
    return {inputBoundsMm:source.vertices.length?bounds:null,outputBoundsMm:null,unchangedSourceFaces:0,changedSourceFaces:source.triangles.length,newOutputFaces:0,
      sampledDistanceMm:{sourceToResult:null,resultToSource:null,sourceSamples:0,resultSamples:0,coverage:'Empty material has no boundary for a surface-distance comparison; source weld displacement is reported separately.'}};
  }
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
// Closed shells by orientation: an inward shell is a cavity. Fewer cavities after
// repair means cavities were opened (or united); the report states both counts.
function shells({vertices,triangles}){
  const parent=vertices.map((_,i)=>i),root=x=>{while(parent[x]!==x)x=parent[x]=parent[parent[x]];return x;};
  for(const [a,b,c] of triangles){parent[root(a)]=root(b);parent[root(b)]=root(c);}
  const volume=new Map();
  for(const [a,b,c] of triangles){const r=root(a);volume.set(r,(volume.get(r)??0)+dot(vertices[a],cross(vertices[b],vertices[c]))/6);}
  const values=[...volume.values()];return {outward:values.filter(v=>v>0).length,inward:values.filter(v=>v<0).length};
}
async function prepare(source,options){
  const {units,signal,progress=()=>{}}=options;signal?.throwIfAborted();const start=performance.now();
  if(options.maxSampledDistanceMm!==undefined&&(!Number.isFinite(options.maxSampledDistanceMm)||options.maxSampledDistanceMm<0))throw Error('maxSampledDistanceMm must be nonnegative.');
  const {maxHoleEdges=0,maxHoleDiameterMm=0}=options;
  if(!Number.isSafeInteger(maxHoleEdges)||maxHoleEdges<0||!Number.isFinite(maxHoleDiameterMm)||maxHoleDiameterMm<0||((maxHoleEdges===0)!==(maxHoleDiameterMm===0)))throw Error('Hole filling requires both positive maxHoleEdges and maxHoleDiameterMm, or both zero.');
  progress({stage:'read-source'});const input=typeof source==='string'?await decodeSTLFile(source,{units,signal,progress}):decodeSTL(source,{units});
  progress({stage:'cleanup'});
  const sourceHash=input.sha256??canonicalHash(source),{clean,result}=prepareMesh(input,{mergeToleranceMm:options.mergeToleranceMm,maxHoleEdges,maxHoleDiameterMm,progress});
  // Compare with the source coordinates before any print-resolution or requested
  // merge. Faces without a direction are not a source surface; compaction removes
  // their otherwise unused points without moving the retained surface.
  const comparison=compactMesh(input.vertices,input.triangles.filter(t=>triangleNormal(...t.map(i=>input.vertices[i]))));
  signal?.throwIfAborted();progress({stage:'validate',triangles:result.triangles.length});
  const changes=shapeChanges(comparison,result,progress,signal);
  if(options.maxSampledDistanceMm!==undefined&&(comparison.triangles.length&&!result.triangles.length||Math.max(changes.sampledDistanceMm.sourceToResult,changes.sampledDistanceMm.resultToSource)>options.maxSampledDistanceMm))throw Object.assign(Error('Repair exceeds maxSampledDistanceMm; an empty result has no finite source-to-result surface distance.'),{code:'MESH_SHAPE_CHANGE',changes});
  const report={schema:'saam-mesh-repair/2',sourceSha256:sourceHash,sourceUnits:units,outputUnits:'mm',sourceValidationError:null,...result.report,resolutionMerge:input.merge??clean.resolutionMerge,...(clean.merge?{merge:clean.merge}:{}),removed:clean.removed,stitching:clean.stitching,inputTriangles:input.triangles.length+(input.merge?.collapsedTriangles??0),outputTriangles:result.triangles.length,shells:{input:shells(comparison),output:shells(result)},...changes,
    validation:result.report.empty?'Empty material is represented by an exact zero-facet STL; there is no remaining boundary for a surface-distance comparison. Source displacement and removed faces are reported.':
      `Shared mesh topology/intersection checks, adjacent-contact checks and exact-output STL reimport certify the result at the rounding guard (${ROUNDING_MM} mm). The source coordinate weld uses ${clean.resolutionMerge.effectiveToleranceMm} mm; reconstructed-surface cleanup uses print resolution (${PRINT_RESOLUTION_MM} mm). Sampled distances do not certify shape fidelity.`};
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
  const {result,report,start}=await prepare(sourceBytes,options),repairedBytes=validateRepair(result);report.repairedSha256=canonicalHash(repairedBytes);
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
    const reimport=await decodeSTLFile(output,{units:'mm',signal:options.signal});
    if(result.triangles.length){makeMesh(reimport.vertices,reimport.triangles);checkAdjacentContacts(reimport);}
    else if(reimport.vertices.length||reimport.triangles.length)throw Error('Empty repaired STL changed on exact reimport.');
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
