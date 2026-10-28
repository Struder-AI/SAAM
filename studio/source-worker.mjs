import {loadPathPreview} from './path-preview.mjs';
import {moveStore,moveBuffers} from './move-store.mjs';
import {createMachinePresentation} from '../core/machine/presentation.mjs';
import {Kinematics} from '../core/machine/kinematics.mjs';
import {validateSnapshot} from './machine-view.mjs';
import {buildSourcePathView,sourcePathFrame,sampleSourcePath,sourcePathEntity,sourcePathOperations,sourcePathCourses} from './source-preview.mjs';

// One path read feeds the renderer and provider. Retain compact moves only when
// a model needs random access; transferring those buffers would detach its input.
const worker={program:null,source:null,provider:null,pending:Promise.resolve()};
async function bind(state){
  worker.provider?.dispose();worker.provider=null;
  if(!state.machine||!worker.program)return {descriptor:null};
  try{
    // The machine extension's kinematics plug, as the Studio server serves it.
    const plug=(await import('/machine-kinematics/'+encodeURIComponent(state.machine.id)+'.mjs')).default;
    worker.provider=await createMachinePresentation({program:worker.program,machine:state.machine,setup:state.plan.setup,kinematics:plug?plug(Kinematics):null,
      sourceIdentity:{printId:state.printId,revision:String(state.revision),outputId:state.outputId}});
    return {descriptor:worker.provider?.descriptor??null};
  }catch(error){worker.provider?.dispose();worker.provider=null;return {descriptor:null,machineError:error.message};}
}
async function handleMessage(data){
  const {id,type}=data;
  try{
    if(type==='load'){
      const state=data.state;
      worker.source=null;let relatedFinding=null;
      worker.program=await loadPathPreview(state,{id:state.outputId,moves:moveStore(),onSource:(path,metadata)=>{
        relatedFinding=metadata.relatedFinding;
        if(path.deposition?.schema==='saampath/3')worker.source=buildSourcePathView(path.deposition,{plan:state.plan,sourceIdentity:metadata.sourceIdentity});
      }});
      const machine=await bind(state),{program}=worker,moves=program?.moves.snapshot();
      self.postMessage({id,program:program?{...program,moves}:null,sourceIdentity:worker.source?.sourceIdentity??null,
        frame:!program&&worker.source?sourcePathFrame(worker.source):null,relatedFinding,...machine},worker.provider||!moves?[]:moveBuffers(moves));
      if(!worker.provider)worker.program=null;
    }else if(type==='source-operations'||type==='source-courses'){
      if(!worker.source)throw Error('No source Paath selected.');
      self.postMessage({id,page:type==='source-operations'?sourcePathOperations(worker.source,data.options):sourcePathCourses(worker.source,data.options)});
    }else if(type==='source-frame'){
      if(!worker.source)throw Error('No source Paath selected.');
      self.postMessage({id,frame:sourcePathFrame(worker.source,data.options)});
    }else if(type==='source-complete'){
      if(!worker.source)throw Error('No source Paath selected.');
      self.postMessage({id,sourceIdentity:worker.source.sourceIdentity,source:worker.source.source});
    }else if(type==='source-sample'||type==='source-entity'){
      if(!worker.source)throw Error('No source Paath selected.');
      self.postMessage({id,...(type==='source-sample'?{sample:sampleSourcePath(worker.source,data.selection)}:
        {sourceIdentity:worker.source.sourceIdentity,entity:sourcePathEntity(worker.source,data.selection)})});
    }else if(type==='bind')self.postMessage({id,...await bind(data.state)});
    else if(type==='sample'){
      const request={requestId:id,seconds:data.seconds,...(data.manual?{manual:data.manual}:{}),...(data.jog?{jog:data.jog}:{})},owner=worker.provider;
      const snapshot=owner?validateSnapshot(await owner.sample(request),owner.descriptor,request):null;
      if(owner===worker.provider)self.postMessage({id,snapshot});else self.postMessage({id,error:'Machine model changed'});
    }
  }catch(error){self.postMessage({id,error:error.message});}
}
// Program, provider and move buffers have one owner until the reply is sent.
self.onmessage=({data})=>{
  const handle=()=>handleMessage(data);
  worker.pending=worker.pending.then(handle,handle);
};
