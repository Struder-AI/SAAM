import {decodeSource,fetchSources} from './source-player.mjs';
import {moveBuffers} from './move-store.mjs';
self.onmessage=async({data:state})=>{
  try{
    const sources=await fetchSources(state),program=decodeSource(sources,state.plan,state.machine);
    const moves=program.moves.snapshot();
    // Transfer ownership inside the browser; never stringify motion records.
    self.postMessage({program:{...program,moves}},moveBuffers(moves));
  }catch(error){self.postMessage({error:error.message});}
};
