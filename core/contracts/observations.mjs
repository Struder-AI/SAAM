// Debug observations retain the value at the crossing, never a later Bundle read.
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,open,opendir,rename,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createReadStream,renameSync} from 'node:fs';
import {jsonProblem,jsonChunks,textChunks,writeChunksSync,copyArtifactSync,observationChunkBytes} from './observation-json.mjs';
import {createObservationSession,publishObservation,closeObservationSessions} from './observation-spool.mjs';
import {trackObservationLease,closeObservationLeases,openVerifiedObservationBytes} from './observation-lease.mjs';
import {numericalEncoding,isNumericalObservation,numericalJsonProblem,numericalJsonChunks,numericalTextValue} from './numerical-json.mjs';

const flows=new AsyncLocalStorage();
export function withObservationFlow(context,action){
  const session=context.capture?null:createObservationSession(context.directory,retainSpoolObservation,{ownerId:context.retentionOwner});
  const flow={...context,capture:context.capture??session?.producer,inputRevision:capturedInputRevision(context),flowId:context.flowId??randomUUID(),invocationId:context.invocationId??randomUUID(),startedAt:context.startedAt??new Date().toISOString()};
  try{const result=flows.run(flow,action);if(result&&typeof result.then==='function')return result.finally(()=>{void session?.seal();});void session?.seal();return result;}
  catch(error){void session?.seal();throw error;}
}
export const observationSession=(directory,options)=>createObservationSession(directory,retainSpoolObservation,options);
export async function closeObservationRetention(directory,options){await closeObservationSessions(directory,options);await closeObservationLeases(directory,options);}
export function getObservationFlow(){return flows.getStore()??null;}
// This is supplied producer input provenance, never the candidate's publication
// revision or a revision recovered later from the current Bundle.
function capturedInputRevision(context){return typeof context.inputRevision==='string'&&context.inputRevision?context.inputRevision:null;}
// Runtime receives worker observations before that worker's result message.
// Persistence is deliberately independent of result, commit and cancellation.
export async function retainObservation(directory,record){
  try{
    if(!directory)return {status:'unavailable',reason:'No observation retention directory'};
    // Compatibility for older captures carrying frozen JSON text.
    // Parse only the small envelope, never materialize the captured graph again.
    const captured=record.schema==='saam-contract-observation-transport/1'?record:null;
    if(captured)record=JSON.parse(captured.metadata);
    validId(record.id);await mkdir(directory,{recursive:true});
    const text=captured?.metadata??JSON.stringify(record),file=await open(resolve(directory,record.id+'.json'),'wx');
    try{
      if(captured?.value!==undefined){
        await file.writeFile(text.slice(0,-1)+',"value":');
        await file.writeFile(captured.value);
        await file.writeFile('}');
      }else await file.writeFile(text);
    }finally{await file.close();}
    // Derived discovery data is expendable. Failure here cannot undo retention.
    const {value,...metadata}=record;
    await writeFile(resolve(directory,record.id+'.meta.json'),JSON.stringify(metadata),{flag:'wx'}).catch(()=>{});
    return {status:record.status,id:record.id};
  }catch(error){return {status:'unavailable',reason:error.message};}
}
async function retainSpoolObservation(producer,record){
  validId(record.id);const target=producer.directory,moved=[];
  const move=async(file,suffix)=>{
    const source=resolve(producer.folder,record.id+suffix);if(file!==source)throw Error('Observation spool identity mismatch.');
    const final=resolve(target,record.id+suffix);await rename(source,final);moved.push(final);return final;
  };
  const partial=resolve(target,record.id+'.meta.partial');let committed=false;
  try{
  if(['json',numericalEncoding].includes(record.artifact?.encoding)){
    record.artifact.file=await move(record.artifact.file,'.value.json');
    if(record.artifact.descriptor)record.artifact.descriptor.file=await move(record.artifact.descriptor.file,'.geometry.json');
  }
  else if(record.artifact?.encoding==='geometry-artifact/1'){
    record.artifact.descriptor.file=await move(record.artifact.descriptor.file,'.geometry.json');
    record.artifact.native.file=await move(record.artifact.native.file,'.3dm');
  }
  const text=JSON.stringify(record);
  await writeFile(partial,text,{flag:'wx'});await rename(partial,resolve(target,record.id+'.json'));
  committed=true;
  await writeFile(resolve(target,record.id+'.meta.json'),text,{flag:'wx'}).catch(()=>{});
  }finally{if(!committed){await unlink(partial).catch(()=>{});for(const file of moved)await unlink(file).catch(()=>{});}}
}
function enqueueObservation(flow,record){
  if(!flow.capture)throw Error('No observation staging owner.');
  publishObservation(flow.capture,record);
}
function snapshotValue(flow,id,value,suffix='.value.json',encoding='json'){
  if(!flow.capture)throw Error('No observation staging owner.');
  const partial=resolve(flow.capture.folder,id+suffix+'.partial'),file=resolve(flow.capture.folder,id+suffix);
  const identity=writeChunksSync(partial,encoding===numericalEncoding?numericalJsonChunks(value):jsonChunks(value),{control:flow.capture.control});renameSync(partial,file);return {file,...identity};
}
async function retainedFileIdentity(file,{signal}={}){
  const hash=createHash('sha256'),size={bytes:0};
  for await(const chunk of createReadStream(file,{signal})){hash.update(chunk);size.bytes+=chunk.length;}
  return {valueId:hash.digest('hex'),byteLength:size.bytes};
}
// The Geometry owner lends its returned bytes read-only until this asynchronous
// snapshot settles. No native byte array enters JSON or a worker message.
export async function observeGeometryArtifact({value,...selection}){
  if(value?.bytes===null)return observeContractValue({...selection,typeId:'geometry-answer',value});
  const flow=flows.getStore();if(!flow?.directory)return {status:'unavailable',reason:'No observation flow'};
  const inputRevision=capturedInputRevision(flow);
  try{
    const descriptor=value?.descriptor,bytes=value?.bytes,patchHash=descriptor?.patchHash??descriptor?.solidArtifact?.patchHash;
    if(!(bytes instanceof Uint8Array)||!bytes.byteLength||descriptor?.schema!=='saam-shell-geometry/1'||
      !/^[a-f0-9]{64}$/.test(patchHash??'')||jsonProblem(descriptor))
      return observeContractValue({...selection,typeId:'geometry-answer',value});
    const id=randomUUID(),encodedDescriptor=snapshotValue(flow,id,descriptor,'.geometry.json'),descriptorFile=encodedDescriptor.file,nativeFile=resolve(flow.capture.folder,id+'.3dm');
    // Bundle already awaits this read-only borrow; finite writes retain no copy
    // of the entire descriptor or native byte array in a worker message.
    const handle=await open(nativeFile,'wx'),nativeHash=createHash('sha256');let nativeLength=0;
    try{for(let offset=0;offset<bytes.length;offset+=observationChunkBytes){if(Atomics.load(flow.capture.control,1))throw Error('Observation capture stopped.');const chunk=bytes.subarray(offset,offset+observationChunkBytes);await handle.writeFile(chunk);nativeHash.update(chunk);nativeLength+=chunk.length;}}
    finally{await handle.close();}
    const native={valueId:nativeHash.digest('hex'),byteLength:nativeLength};
    const valueId=createHash('sha256').update('geometry-artifact/1:'+encodedDescriptor.valueId+':'+native.valueId).digest('hex');
    const record={schema:'saam-contract-observation/1',id,flowId:flow.flowId,invocationId:flow.invocationId,operation:flow.operation??null,
      caller:flow.caller??null,bundleId:flow.bundleId??null,inputRevision,startedAt:flow.startedAt,capturedAt:new Date().toISOString(),
      wireId:selection.wireId,occurrenceId:selection.occurrenceId??flow.invocationId+':'+selection.wireId,phase:selection.phase??'value',
      typeId:'geometry-answer',implementationSchema:descriptor.schema,typeAdmission:'owner-admitted',stageId:selection.stageId??null,
      consumerId:selection.consumerId?flow.invocationId+':'+selection.consumerId:null,jobId:flow.jobId??null,status:'complete',reason:null,
      valueId,byteLength:native.byteLength+encodedDescriptor.byteLength,artifact:{encoding:'geometry-artifact/1',
        descriptor:{file:descriptorFile,...encodedDescriptor},native:{file:nativeFile,...native,format:'3dm'}}};
    enqueueObservation(flow,record);return {status:'queued',id,valueId,flowId:flow.flowId};
  }catch(error){return {status:'unavailable',reason:error.message};}
}
function artifactContractProblem(typeId,schema){
  if(typeId==='work'&&schema==='saampath/3')return null;
  if(typeId==='schedule'&&schema==='saam-schedule/1')return null;
  return 'No owner-admitted artifact capture for '+typeId+' with schema '+String(schema??'unavailable');
}
function inlineContractProblem(typeId,value,implementationSchema){
  if(isNumericalObservation(typeId,implementationSchema))return value?.schema===implementationSchema&&
    (typeId==='flow-value'?typeof value.kind==='string'&&Object.hasOwn(value,'value'):value.identity&&value.receiver&&value.context)
    ?null:'Numerical Slice value needs its declared receiver/context schema';
  if(typeId==='chart-allocation-request'&&implementationSchema==='saam-chart-allocation-request/1')
    return Array.isArray(value?.region)&&Array.isArray(value.claims)&&value.owner?.id&&value.chart&&Number.isInteger(value.layer?.index)?null:'Chart allocation needs region, claims, owner, chart and layer identity';
  if(typeId==='allocated-chart-region'&&implementationSchema==='saam-allocated-chart-region/1')
    return Array.isArray(value)&&value.every(loop=>Array.isArray(loop)&&loop.every(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)))?null:'Allocated chart reply must retain the complete finite UV loop array';
  if(typeId==='geometry-request'&&implementationSchema==='saam-uv-image-request/1')
    return value?.patch&&value.definition&&Number.isFinite(value.toleranceMm)&&value.toleranceMm>0?null:'UV image request needs numerical patch, curve and positive tolerance';
  if(typeId==='geometry-answer'&&implementationSchema==='saam-uv-images/1')
    return Array.isArray(value)&&value.every(piece=>piece.nurbs&&piece.uvNurbs&&Number.isFinite(piece.positionErrorMm)&&piece.positionErrorMm>=0)?null:'UV image reply must retain each paired curve and error bound';
  if(typeId==='geometry-answer'){
    const descriptor=value?.descriptor,parameters=descriptor?.parameters;
    if(value?.bytes!==null||descriptor?.schema!=='saam-shell-geometry/1'||parameters?.shape!=='mesh'||
      !Array.isArray(parameters.vertices)||!Array.isArray(parameters.triangles)||
      !Array.isArray(descriptor.vertices)||!Array.isArray(descriptor.faces)||!Array.isArray(descriptor.labels))
      return 'Only the actual finite indexed-mesh Geometry artifact with null encoded bytes has lossless retention; native/binary forms are unsupported.';
    return null;
  }
  if(typeId!=='schedule-request')return 'No inline capture serializer registered for '+typeId;
  if(!value||typeof value.sourcePathId!=='string'||!value.sourcePathId||!value.nozzleTypes||Array.isArray(value.nozzleTypes)||typeof value.nozzleTypes!=='object')return 'Scheduling descriptor needs sourcePathId and explicit nozzleTypes';
  if(value.work?.artifactId!==value.sourcePathId||!/^[a-f0-9]{64}$/.test(value.work?.valueId??'')||!/^[a-f0-9-]{36}$/.test(value.work?.observationId??''))return 'Scheduling descriptor needs the exact retained source identity';
  return null;
}
export function observeContractArtifact({wireId,phase='value',typeId,file,occurrenceId,artifactId,retainedIdentity,serialized,stageId,consumerId,implementationSchema}){
  const flow=flows.getStore();if(!flow?.directory)return {status:'unavailable',reason:'No observation flow'};
  try{
    if(serialized===undefined&&!(retainedIdentity?.file===resolve(file)&&retainedIdentity.valueId))return {status:'unavailable',reason:'Artifact owner did not supply its exact serialized bytes or retained identity'};
    const problem=artifactContractProblem(typeId,implementationSchema),id=randomUUID();
    if(!flow.capture)throw Error('No observation staging owner.');
    const capturedFile=resolve(flow.capture.folder,id+'.value.json'),partial=capturedFile+'.partial';
    // The saving owner lends either its immutable text or its open file interval.
    // A borrowed file is copied and checked before this synchronous call returns.
    const identity=serialized!==undefined?writeChunksSync(partial,textChunks(serialized),{control:flow.capture.control}):copyArtifactSync(resolve(file),partial,{control:flow.capture.control,expected:retainedIdentity});
    renameSync(partial,capturedFile);
    const record={schema:'saam-contract-observation/1',id,flowId:flow.flowId,invocationId:flow.invocationId,operation:flow.operation??null,caller:flow.caller??null,bundleId:flow.bundleId??null,startedAt:flow.startedAt,capturedAt:new Date().toISOString(),wireId,occurrenceId:occurrenceId??flow.invocationId+':'+wireId,phase,typeId,implementationSchema:implementationSchema??null,typeAdmission:problem?'unsupported':'owner-admitted',stageId:stageId??null,consumerId:consumerId?flow.invocationId+':'+consumerId:null,jobId:flow.jobId??null,status:problem?'unsupported':'complete',reason:problem,...identity,artifact:{file:capturedFile,id:artifactId??null,encoding:'json'}};
    record.inputRevision=capturedInputRevision(flow);
    enqueueObservation(flow,record);
    return {status:'queued',id,...identity,file:resolve(file),flowId:flow.flowId};
  }catch(error){return {status:'unavailable',reason:error.message};}
}
export function observeContractValue({wireId,phase='value',typeId,value,occurrenceId,stageId,consumerId,implementationSchema,requestIdentity}){
  const flow=flows.getStore();if(!flow?.directory)return {status:'unavailable',reason:'No observation flow'};
  // Serialization happens synchronously before yielding so the retained bytes are
  // exactly this occurrence. Unsupported objects are named, never replaced by {}.
  try{
    const encoding=isNumericalObservation(typeId,implementationSchema)?numericalEncoding:'json';
    const problem=(encoding===numericalEncoding?numericalJsonProblem(value):jsonProblem(value))??inlineContractProblem(typeId,value,implementationSchema),id=randomUUID(),artifact=problem?null:snapshotValue(flow,id,value,'.value.json',encoding),valueId=artifact?.valueId??null;
    const descriptor=artifact&&typeId==='geometry-answer'&&value?.descriptor?snapshotValue(flow,id,value.descriptor,'.geometry.json'):null;
    const record={schema:'saam-contract-observation/1',id,flowId:flow.flowId,invocationId:flow.invocationId,operation:flow.operation??null,caller:flow.caller??null,bundleId:flow.bundleId??null,startedAt:flow.startedAt,capturedAt:new Date().toISOString(),wireId,occurrenceId:occurrenceId??flow.invocationId+':'+wireId,phase,typeId,...(requestIdentity?{requestIdentity}:{}),implementationSchema:implementationSchema??(typeId==='schedule-request'?'saam-schedule-request-observation/1':typeId==='geometry-answer'?value?.descriptor?.schema??null:null),typeAdmission:problem?'unsupported':'validated-inline',stageId:stageId??null,consumerId:consumerId?flow.invocationId+':'+consumerId:null,jobId:flow.jobId??null,status:problem?'unsupported':'complete',reason:problem,valueId,byteLength:artifact?.byteLength??0,...(artifact?{artifact:{file:artifact.file,encoding,...(descriptor?{descriptor}:{})}}:{})};
    record.inputRevision=capturedInputRevision(flow);
    enqueueObservation(flow,record);
    return {status:'queued',valueStatus:record.status,id,valueId,flowId:flow.flowId};
  }catch(error){return {status:'unavailable',reason:error.message};}
}
function validId(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid observation identity.');return id;}
export async function readObservation(directory,id){
  const record=JSON.parse(await readFile(resolve(directory,validId(id)+'.json'),'utf8'));
  return {...record,inputRevision:capturedInputRevision(record)};
}
export async function readObservationValue(directory,id){
  validId(id);
  const record=await readObservation(directory,id).catch(error=>({schema:'saam-contract-observation/1',id,inputRevision:null,status:'unavailable',reason:'Observation not retained or not yet available: '+error.message}));
  if(record.status!=='complete')return record;
  if(!record.artifact){
    try{
      const problem=jsonProblem(record.value);if(problem)throw Error(problem);
      const bytes=JSON.stringify(record.value);
      if(createHash('sha256').update(bytes).digest('hex')!==record.valueId||Buffer.byteLength(bytes)!==record.byteLength)
        throw Error('Inline retained value changed; historical value is unavailable');
      return record;
    }catch(error){return {...record,status:'unavailable',reason:'Retained value unavailable: '+error.message};}
  }
  try{
    if(record.artifact.encoding==='geometry-artifact/1'){
      const {native,descriptor}=record.artifact;
      if(native.file!==resolve(directory,id+'.3dm')||descriptor.file!==resolve(directory,id+'.geometry.json'))throw Error('Geometry sidecar identity mismatch');
      const identities=await Promise.all([retainedFileIdentity(native.file),retainedFileIdentity(descriptor.file)]);
      if(identities[0].valueId!==native.valueId||identities[0].byteLength!==native.byteLength||
        identities[1].valueId!==descriptor.valueId||identities[1].byteLength!==descriptor.byteLength||
        record.byteLength!==native.byteLength+descriptor.byteLength||
        record.valueId!==createHash('sha256').update('geometry-artifact/1:'+descriptor.valueId+':'+native.valueId).digest('hex'))
        throw Error('Geometry sidecar changed; historical value is unavailable');
      return {...record,representation:'binary-sidecar',value:{descriptor:JSON.parse(await readFile(descriptor.file,'utf8')),
        bytes:{encoding:'binary-sidecar',format:native.format,valueId:native.valueId,byteLength:native.byteLength}}};
    }
    if(![undefined,'json',numericalEncoding].includes(record.artifact.encoding))throw Error('Unknown retained artifact encoding.');
    if(record.artifact.encoding===numericalEncoding&&!isNumericalObservation(record.typeId,record.implementationSchema))throw Error('Unsupported numerical schema/profile.');
    const bytes=await readFile(record.artifact.file),actual=createHash('sha256').update(bytes).digest('hex');
    if(actual!==record.valueId||bytes.length!==record.byteLength)return {...record,status:'unavailable',reason:'The retained artifact changed; historical value is unavailable.'};
    return {...record,value:record.artifact.encoding===numericalEncoding?numericalTextValue(bytes.toString('utf8'),record):JSON.parse(bytes.toString('utf8'))};
  }catch(error){return {...record,status:'unavailable',reason:'Retained artifact unavailable: '+error.message};}
}
// Named admitted representations only. The caller supplies an observation ID,
// never a file; verify the bytes actually returned after opening the sidecar.
export async function readObservationRepresentation(directory,id,representation='complete',options){
  if(representation==='native'){
    let lease;
    try{lease=await openObservationNative(directory,id,options);return lease.manifest;}
    catch(error){const record=await readObservation(directory,id).catch(()=>({id,inputRevision:null}));return {...record,status:'unavailable',reason:'Retained native bytes unavailable: '+error.message};}
    finally{await lease?.close();}
  }
  const record=await readObservationValue(directory,id);
  if(representation==='complete'||record.status!=='complete')return record;
  if(representation==='descriptor')return record.value?.descriptor
    ?{...record,value:record.value.descriptor,representation:'descriptor'}
    :{...record,status:'unavailable',reason:'This observation has no admitted descriptor.'};
  throw Error('Unknown retained representation.');
}
function publicObservation(record){
  const {value,...metadata}=record,artifact=record.artifact;
  if(!artifact)return metadata;
  const identity=part=>part?{valueId:part.valueId,byteLength:part.byteLength,...(part.format?{format:part.format}:{})}:undefined;
  return {...metadata,artifact:{encoding:artifact.encoding,...(artifact.id?{id:artifact.id}:{}),...(artifact.descriptor?{descriptor:identity(artifact.descriptor)}:{}),...(artifact.native?{native:identity(artifact.native)}:{})}};
}
// Raw access is a private named-byte port. Public parsed replies keep their
// existing shape and resident-value cost; Studio downloads need not parse them.
export async function openObservationRepresentation(directory,id,{representation='complete',signal,ownerId='standalone'}={}){
  if(representation==='native')return openObservationNative(directory,id,{signal,ownerId});
  if(!['complete','descriptor'].includes(representation))throw Error('Unknown retained representation.');
  signal?.throwIfAborted();const record=await readObservation(directory,id),artifact=record.artifact;
  if(record.status!=='complete')throw Error(record.reason??'Retained value is unavailable.');
  if(![undefined,'json','geometry-artifact/1',numericalEncoding].includes(artifact?.encoding))throw Error('Unknown retained artifact encoding.');
  if(artifact?.encoding===numericalEncoding&&!isNumericalObservation(record.typeId,record.implementationSchema))throw Error('Unsupported numerical schema/profile.');
  const metadata=publicObservation(record);let part,prefix,suffix='}',verifyRelated;
  const envelope=extra=>JSON.stringify({...metadata,...extra}).slice(0,-1)+',"value":';
  if(artifact?.encoding==='geometry-artifact/1'){
    const {native,descriptor}=artifact;
    if(native.file!==resolve(directory,id+'.3dm')||descriptor.file!==resolve(directory,id+'.geometry.json'))throw Error('Geometry sidecar identity mismatch.');
    part=descriptor;
    verifyRelated=async()=>{const actual=await retainedFileIdentity(native.file,{signal});if(actual.valueId!==native.valueId||actual.byteLength!==native.byteLength||record.byteLength!==native.byteLength+descriptor.byteLength||record.valueId!==createHash('sha256').update('geometry-artifact/1:'+descriptor.valueId+':'+native.valueId).digest('hex'))throw Error('Geometry sidecar changed; historical value is unavailable.');};
    prefix=envelope({representation:representation==='descriptor'?'descriptor':'binary-sidecar'});
    if(representation==='complete'){
      prefix+='{"descriptor":';suffix=',"bytes":'+JSON.stringify({encoding:'binary-sidecar',format:native.format,valueId:native.valueId,byteLength:native.byteLength})+'}}';
    }
  }else if(['json',numericalEncoding].includes(artifact?.encoding)&&artifact.file===resolve(directory,id+'.value.json')){
    if(representation==='descriptor'){
      part=artifact.descriptor;if(!part||part.file!==resolve(directory,id+'.geometry.json'))throw Error('This observation has no admitted descriptor.');
      verifyRelated=async()=>{const base=await retainedFileIdentity(artifact.file,{signal});if(base.valueId!==record.valueId||base.byteLength!==record.byteLength)throw Error('Retained value changed; historical value is unavailable.');};
    }else part={file:artifact.file,valueId:record.valueId,byteLength:record.byteLength};
    prefix=envelope(representation==='descriptor'?{representation:'descriptor'}:{});
  }else{
    // Legacy /1 embedded values and old Bundle-file artifacts remain readable.
    // This fallback still parses one whole value; no migration claim is made.
    const result=await readObservationRepresentation(directory,id,representation,{ownerId});
    if(result.status!=='complete')throw Error(result.reason??'Retained value is unavailable.');
    const value={...publicObservation(result),value:result.value};let byteLength=0;
    for(const chunk of jsonChunks(value))byteLength+=Buffer.byteLength(chunk);
    let closed=false;const close=async()=>{closed=true;};
    async function* bytes(){try{for(const chunk of jsonChunks(value)){signal?.throwIfAborted();if(closed)throw Error('Observation byte lease is closed.');yield Buffer.from(chunk);}}finally{await close();}}
    return trackObservationLease(directory,ownerId,{manifest:publicObservation(result),byteLength,contentType:'application/json',bytes,close});
  }
  return openVerifiedObservationBytes({directory,ownerId,...part,manifest:metadata,prefix,suffix,signal,verifyRelated});
}
// The Runtime observation owner lends named bytes, never a file path or resolver.
// Verification and transmission use the same read-only handle. One final chunk
// is withheld until the transmitted-byte hash agrees, so mutation cannot finish
// an apparently successful response. Cancellation closes the owned handle.
export async function openObservationNative(directory,id,{signal,ownerId='standalone'}={}){
  signal?.throwIfAborted();
  const record=await readObservation(directory,id),{artifact}=record;
  if(record.status!=='complete'||artifact?.encoding!=='geometry-artifact/1')throw Error('This observation has no admitted native bytes.');
  const {native,descriptor}=artifact;
  if(native.file!==resolve(directory,id+'.3dm')||descriptor.file!==resolve(directory,id+'.geometry.json'))throw Error('Geometry sidecar identity mismatch.');
  const handle=await open(native.file,'r');let closed=false,consumed=false,closing=null;
  const onAbort=()=>{void close().catch(()=>{});};
  const close=()=>{if(!closing){closed=true;signal?.removeEventListener('abort',onAbort);closing=handle.close();}return closing;};
  signal?.addEventListener('abort',onAbort,{once:true});
  let stream;
  const tracked=trackObservationLease(directory,ownerId,{bytes:()=>stream(),close});
  try{
    if((await handle.stat()).size!==native.byteLength)throw Error('Native byte length changed.');
    const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(64*1024);let position=0;
    for(;;){signal?.throwIfAborted();const {bytesRead}=await handle.read(buffer,0,buffer.length,position);if(!bytesRead)break;hash.update(buffer.subarray(0,bytesRead));position+=bytesRead;}
    const pair=await retainedFileIdentity(descriptor.file,{signal});
    if(position!==native.byteLength||hash.digest('hex')!==native.valueId||pair.valueId!==descriptor.valueId||pair.byteLength!==descriptor.byteLength||
      record.byteLength!==native.byteLength+descriptor.byteLength||record.valueId!==createHash('sha256').update('geometry-artifact/1:'+descriptor.valueId+':'+native.valueId).digest('hex'))throw Error('Geometry sidecar changed; historical value is unavailable.');
    const manifest={...record,artifact:{encoding:'geometry-artifact/1',
      descriptor:{valueId:descriptor.valueId,byteLength:descriptor.byteLength},native:{format:native.format,valueId:native.valueId,byteLength:native.byteLength}},
      representation:'native',value:{encoding:'binary-sidecar',format:native.format,valueId:native.valueId,byteLength:native.byteLength,
      descriptor:{valueId:descriptor.valueId,byteLength:descriptor.byteLength}}};
    async function* bytes(){
      if(consumed||closed)throw Error('Native byte lease is closed or consumed.');consumed=true;
      const hash=createHash('sha256');let position=0,pending=null;
      try{
        for(;;){signal?.throwIfAborted();const buffer=Buffer.allocUnsafe(64*1024),{bytesRead}=await handle.read(buffer,0,buffer.length,position);if(!bytesRead)break;
          const chunk=buffer.subarray(0,bytesRead);hash.update(chunk);position+=bytesRead;if(pending)yield pending;pending=chunk;}
        if(position!==native.byteLength||hash.digest('hex')!==native.valueId)throw Error('Native bytes changed during transfer.');
        if(pending)yield pending;
      }finally{await close();}
    }
    stream=bytes;return {...tracked,manifest,byteLength:native.byteLength,contentType:'application/octet-stream'};
  }catch(error){await tracked.close();throw error;}
}
export async function listObservations(directory,{wireIds=[],flowId}={}){
  const entries=await opendir(directory).catch(error=>{if(error.code==='ENOENT')return null;throw error;}),records=[];
  if(!entries)return records;
  for await(const entry of entries){
    if(!/^[a-f0-9-]{36}\.json$/.test(entry.name))continue;
    try{
      const id=entry.name.slice(0,-5),metadataFile=resolve(directory,id+'.meta.json');
      const record=await readFile(metadataFile,'utf8').then(JSON.parse).catch(async()=>{
        // Trivial lazy migration of old /1 records, one full value at a time.
        // This is only a rebuildable private index; retained values stay intact.
        const {value,...metadata}=await readObservation(directory,id);
        await writeFile(metadataFile,JSON.stringify(metadata)).catch(()=>{});
        return metadata;
      });
      if(wireIds.length&&!wireIds.includes(record.wireId)||flowId&&record.flowId!==flowId)continue;
      records.push({...record,inputRevision:capturedInputRevision(record)});
    }catch{/* A concurrent incomplete observation is unavailable until its next read. */}
  }
  return records.sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt));
}
