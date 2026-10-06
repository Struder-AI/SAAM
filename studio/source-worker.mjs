import {loadPathPreview} from './path-preview.mjs';
import {moveStore,moveBuffers} from './move-store.mjs';
import {createMachinePresentation} from '../core/machine/presentation.mjs';
import {validateSnapshot} from './machine-view.mjs';

// One path read feeds the renderer and provider. Retain compact moves only when
// a model needs random access; transferring those buffers would detach its input.
const worker={program:null,provider:null,pending:Promise.resolve()};
async function bind(state){
  worker.provider?.dispose();worker.provider=null;
  try{
    worker.provider=await createMachinePresentation({program:worker.program,machine:state.machine,setup:state.plan.setup,
      sourceIdentity:{printId:state.printId,revision:String(state.revision),outputId:state.outputId}});
    return {descriptor:worker.provider?.descriptor??null};
  }catch(error){worker.provider?.dispose();worker.provider=null;return {descriptor:null,machineError:error.message};}
}
async function handleMessage(data){
  const {id,type}=data;
  try{
    if(type==='load'){
      const state=data.state;
      const sliceIdentity=row=>{const info=state.inspection?.operations?.[row.operation],layer=info?.layers?.[row.layer];return {...row,
        sliceFamily:info?.family??null,sliceIndex:layer?.index??null,modulated:!!info?.modifiers?.length};};
      worker.program=await loadPathPreview(state,{id:state.outputId,moves:moveStore(undefined,{annotate:sliceIdentity})});
      const machine=await bind(state),{program}=worker,moves=program.moves.snapshot();
      self.postMessage({id,program:{...program,moves},...machine},worker.provider?[]:moveBuffers(moves));
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
