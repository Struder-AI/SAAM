import {decodePreview} from './preview-cache.mjs';
import {decodeSource,fetchSources} from './source-player.mjs';
import {moveBuffers,moveStore} from './move-store.mjs';
import {createMachinePresentation} from '../core/machine/presentation.mjs';
import {validateSnapshot} from './machine-view.mjs';

// One decode feeds the renderer and provider. Retain compact moves only when
// a model needs random access; transferring those buffers would detach its input.
let program,provider;
async function bind(state){
  provider?.dispose();provider=null;
  try{
    provider=await createMachinePresentation({program,machine:state.machine,setup:state.plan.setup,
      sourceIdentity:{printId:state.printId,revision:String(state.revision),exportHash:state.exportHash}});
    return {descriptor:provider?.descriptor??null};
  }catch(error){provider?.dispose();provider=null;return {descriptor:null,machineError:error.message};}
}
self.onmessage=async({data})=>{
  const {id,type}=data;
  try{
    if(type==='load'){
      const state=data.state;
      if(state.referencePreview){
        const query=new URLSearchParams({printId:state.printId,revision:state.revision,exportHash:state.exportHash}),response=await fetch('/api/example-display?'+query);
        if(!response.ok)throw Error((await response.json()).error);const cache=decodePreview(await response.arrayBuffer());
        program={...cache.program,moves:moveStore(cache.moves),previewMaterial:cache.material};
      }else{const sources=await fetchSources(state);program=decodeSource(sources,state.plan,state.machine);}
      const machine=await bind(state),moves=program.moves.snapshot();
      self.postMessage({id,program:{...program,moves},...machine},provider?[]:moveBuffers(moves));
    }else if(type==='bind')self.postMessage({id,...await bind(data.state)});
    else if(type==='sample'){
      const request={requestId:id,seconds:data.seconds,...(data.manual?{manual:data.manual}:{}),...(data.jog?{jog:data.jog}:{})},owner=provider;
      const snapshot=owner?validateSnapshot(await owner.sample(request),owner.descriptor,request):null;
      if(owner===provider)self.postMessage({id,snapshot});else self.postMessage({id,error:'Machine model changed'});
    }
  }catch(error){self.postMessage({id,error:error.message});}
};
