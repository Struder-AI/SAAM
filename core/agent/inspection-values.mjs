// CLI composes its named Runtime observation query for Studio. No filesystem
// resolver or Runtime resolver crosses this selected-values port.
import {resolve} from 'node:path';
import {prepareSurfaceReference} from '../geom/surface-record.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {joinSaamPath} from '../path/saampath.mjs';
import {isSliceReceiver,sliceReceiverType,readSliceReceiverContexts,buildSliceReceiverView} from './inspection-slice-values.mjs';
import {decodeNumericalRecord,numericalViewTransport} from '../contracts/numerical-json.mjs';

const identity=r=>({observationId:r.id,valueId:r.valueId??null,wireId:r.wireId??null,typeId:r.typeId??null,implementationSchema:r.implementationSchema??null,
  bundleId:r.bundleId??null,inputRevision:r.inputRevision??null,flowId:r.flowId??null,invocationId:r.invocationId??null,
  occurrenceId:r.occurrenceId??null,phase:r.phase??null,stageId:r.stageId??null,artifactId:r.artifact?.id??null,
  requestIdentity:r.requestIdentity??null,valueEncoding:r.artifact?.encoding??'json'});
const unique=rows=>[...new Map(rows.map(r=>[r.valueId,r])).values()];
export function createInspectionValues({queryRuntime,openNativeRuntime,openRepresentationRuntime,libraryRoot}){
  const query=async args=>{
    const record=await queryRuntime('read_contract_observations',args);
    return Array.isArray(record)||record.status!=='complete'?record:decodeNumericalRecord(record);
  };
  async function records(id,contextBindings){
    const selected=await query({id}),related=[];let work=null,schedule=null,request=null,problem=null,slice=null;
    if(selected.status!=='complete')return {selected,related,work,schedule,request};
    try{if(isSliceReceiver(selected.value)){
      if(selected.typeId!==sliceReceiverType(selected.value)||selected.implementationSchema!==selected.value.schema)throw Error('Slice receiver type/schema mismatch.');
      slice=await readSliceReceiverContexts(selected,query,contextBindings);related.push(...slice.records.map(identity));
      const mapping=selected.value.receiver.mappingInputIdentity;
      if(mapping){
        const input=await query({id:mapping.observationId});
        if(input.status!=='complete'||input.valueId!==mapping.valueId||input.typeId!=='slice-layout'||input.flowId!==selected.flowId||input.bundleId!==selected.bundleId||input.value?.identity?.consumerPurpose!=='deposition'||input.value.context?.surface?.valueId!==selected.value.context?.surface?.valueId)throw Error('The exact Slice mapping input is unavailable or mismatched.');
        related.push(identity(input));
      }
    }else if(['work','schedule','schedule-request'].includes(selected.typeId)){
      if(selected.typeId==='work')work=selected;
      if(selected.typeId==='schedule')schedule=selected;
      const rows=await query({flowId:selected.flowId});
      const sourceId=selected.typeId==='work'?selected.artifact?.id:selected.value?.sourcePathId;
      const requests=[];
      for(const meta of rows.filter(r=>r.typeId==='schedule-request'&&r.status==='complete')){
        const r=await query({id:meta.id});
        if(r.status==='complete'&&r.value.sourcePathId===sourceId&&(!work||r.value.work?.valueId===work.valueId))requests.push(r);
      }
      request=selected.typeId==='schedule-request'?selected:unique(requests).length===1?unique(requests)[0]:null;
      if(request){
        const r=await query({id:request.value.work.observationId});
        if(r.status!=='complete'||r.typeId!=='work'||r.flowId!==selected.flowId||r.valueId!==request.value.work.valueId||
          r.artifact?.id!==sourceId||request.value.work.artifactId!==sourceId)throw Error('The exact retained Paath source is unavailable or mismatched.');
        work=r;related.push(identity(request),identity(work));
        if(!schedule){const matches=unique(rows.filter(r=>r.typeId==='schedule'&&r.status==='complete'&&r.artifact?.id===sourceId));if(matches.length===1)schedule=await query({id:matches[0].id});}
        if(schedule){
          if(schedule.status!=='complete'||schedule.flowId!==selected.flowId||schedule.value?.sourcePathId!==sourceId||schedule.artifact?.id!==sourceId)throw Error('The exact retained schedule is unavailable or mismatched.');
          joinSaamPath({sourcePathId:sourceId,deposition:work.value,schedule:schedule.value});related.push(identity(schedule));
        }
      }
      if(!request&&(selected.typeId==='schedule'||rows.some(r=>r.typeId==='schedule'&&r.artifact?.id===sourceId)))
        problem='No unambiguous complete scheduling input binds this value to an exact retained source and schedule.';
      // Source alone is useful and unordered; it never needs a schedule request.
    }else if(selected.requestIdentity){
      request=await query({id:selected.requestIdentity.id});
      if(request.status!=='complete'||request.valueId!==selected.requestIdentity.valueId||request.flowId!==selected.flowId||
        request.flowId!==selected.requestIdentity.flowId||request.wireId!==selected.wireId||request.occurrenceId!==selected.occurrenceId)
        throw Error('The exact retained request is unavailable or mismatched.');
      related.push(identity(request));
    }}catch(error){
      // A failed relation cannot invalidate or replace an independently valid
      // selected value. Only its dependent graphic/join becomes unavailable.
      problem=error.message;related.length=0;work=selected.typeId==='work'?selected:null;schedule=null;request=null;slice=null;
    }
    if(selected.implementationSchema==='saam-allocated-chart-region/1'&&!request)
      problem??='No exact retained chart request is available for this region.';
    return {selected,related,work,schedule,request,problem,slice};
  }
  async function select({bundleId,directory,observationId}){
    if(!/^[a-f0-9-]{36}$/.test(observationId))throw Error('Select an observation identity.');
    const r=await records(observationId),s=r.selected;
    if(s.bundleId&&resolve(libraryRoot,s.bundleId)!==resolve(directory))throw Error('The retained observation belongs to another part.');
    if(s.status==='complete'&&!s.bundleId)throw Error('The retained observation has no confirmed part identity.');
    const kind=s.status!=='complete'?'unavailable':r.slice?'slice-receiver':r.work?'paath':s.typeId==='geometry-answer'&&s.value?.descriptor?'geometry':s.implementationSchema==='saam-allocated-chart-region/1'&&r.request?'region':'unsupported';
    return {schema:'saam-studio-inspection/1',...identity(s),bundleId,kind,status:s.status,reason:s.reason??r.problem??null,origin:'retained exchange',
      representations:s.status==='complete'?['complete',...(s.value?.descriptor?['descriptor']:[]),...(s.representation==='binary-sidecar'?['native']:[])]:['complete'],
      ...(r.slice?{contextBindings:r.slice.bindings}:{}),related:[...new Map(r.related.filter(row=>row.observationId!==s.id).map(row=>[row.observationId,row])).values()]};
  }
  async function read(selection,{representation='complete',observationId=selection.observationId}={}){
    const admitted=[selection,...selection.related],expected=admitted.find(r=>r.observationId===observationId);
    if(!expected)throw Error('That observation is not part of the selected inspection.');
    if(['complete','native','descriptor'].includes(representation)){
      const r=await queryRuntime('read_contract_observations',{id:observationId,representation});
      if(r.status==='complete'&&r.valueId!==expected.valueId)throw Error('Retained value identity changed.');
      return r;
    }
    if(representation!=='view')throw Error('Unknown inspection representation.');
    const r=await records(selection.observationId,selection.contextBindings),s=r.selected;
    if(s.status!=='complete')return {kind:'unavailable',status:s.status,reason:s.reason};
    const related=[...new Map(r.related.filter(row=>row.observationId!==s.id).map(row=>[row.observationId,row])).values()];
    if(s.valueId!==selection.valueId||JSON.stringify(related)!==JSON.stringify(selection.related))throw Error('Retained inspection relationships changed. Select the occurrence again.');
    if(selection.kind==='slice-receiver')return r.slice?numericalViewTransport(buildSliceReceiverView(s.value,{lookup:hash=>r.slice.entries.get(hash)}),[selection,...selection.related]):{kind:'unavailable',reason:r.problem??'The exact Slice contexts are unavailable.'};
    if(selection.kind==='geometry')return {kind:'geometry',geometry:s.value.descriptor,coverage:{complete:true,meaning:s.representation==='binary-sidecar'?'Descriptor tessellation; native bytes remain authoritative.':'Retained indexed geometry; shading is derived.'}};
    if(selection.kind==='paath')return {kind:'paath',source:r.work.value,sourceIdentity:identity(r.work),schedule:r.schedule?.value??null,
      path:r.schedule?joinSaamPath({sourcePathId:r.work.artifact.id,deposition:r.work.value,schedule:r.schedule.value}):null,relatedFinding:r.problem,
      coverage:{ordering:r.schedule?'exact related schedule':'none',meaning:'Finite source pages; complete source and local queries remain available.'}};
    if(selection.kind==='region'){
      const surface=prepareSurfaceReference(r.request.value.chart),segments=[];let totalEdges=0;
      for(const loop of s.value)for(let i=0;i<loop.length;i++){
        totalEdges++;if(segments.length>=1000)continue;
        const a=loop[i],b=loop[(i+1)%loop.length],points=Array.from({length:5},(_,j)=>evaluateSurface(surface,a.map((v,k)=>v+(b[k]-v)*j/4)).point);
        segments.push(points);
      }
      return {kind:'region',segments,coverage:{complete:segments.length===totalEdges,shownEdges:segments.length,totalEdges,samplesPerEdge:5,meaning:'Derived chart-edge samples, not a surface accuracy or contact proof.'}};
    }
    return {kind:'unsupported',reason:r.problem??'No shared graphic is admitted for this retained type. Complete data remains available.'};
  }
  async function openNative(selection,{observationId=selection.observationId,signal}={}){
    const expected=[selection,...selection.related].find(r=>r.observationId===observationId);
    if(!expected)throw Error('That observation is not part of the selected inspection.');
    if(!openNativeRuntime)throw Error('Retained native bytes are unavailable.');
    const lease=await openNativeRuntime('read_contract_observations',{id:observationId,representation:'native',signal});
    if(lease.manifest.valueId!==expected.valueId){await lease.close();throw Error('Retained value identity changed.');}
    return lease;
  }
  async function openRepresentation(selection,{observationId=selection.observationId,representation='complete',signal}={}){
    const expected=[selection,...selection.related].find(r=>r.observationId===observationId);
    if(!expected)throw Error('That observation is not part of the selected inspection.');
    if(!['complete','descriptor','native'].includes(representation))throw Error('Unknown retained representation.');
    if(!openRepresentationRuntime){if(representation==='native')return openNative(selection,{observationId,signal});throw Error('Retained raw JSON bytes are unavailable.');}
    const lease=await openRepresentationRuntime('read_contract_observations',{id:observationId,representation,signal});
    if(lease.manifest.valueId!==expected.valueId){await lease.close();throw Error('Retained value identity changed.');}return lease;
  }
  return {select,read,openNative,openRepresentation};
}
