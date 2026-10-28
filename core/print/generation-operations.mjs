import {generateBundle} from '../application/generation.mjs';
import {runBundleSolve} from '../application/bundle-execution.mjs';

// Existing CLI/Studio entry: admit one Bundle solve before touching its host.
// Runtime executes the captured whole-plan request and owns its worker.
export function createBundleGenerationOperations(){
  return {
    generate(directory,{development=false,trigger='agent',expectedEditRevision,onlyIfMissingOutput=false,paths}={},host){
      return runBundleSolve(directory,async()=>{
        const bundle=await import('./bundle.mjs');
        if(expectedEditRevision){
          const {state}=await bundle.loadBundleSnapshot(directory,{program:false});
          if(state.editRevision!==expectedEditRevision)throw Error('The print changed before generation. Review the updated print.');
        }
        if(onlyIfMissingOutput){
          const {state}=await bundle.loadBundleSnapshot(directory,{program:true});
          if(state.program&&!state.programError)return;
        }
        host.prepare();
        const {state}=await bundle.loadBundleSnapshot(directory,{program:false});
        if(state.inspection)throw Error('This inspection does not support print generation.');
        return host.run({directory,editRevision:state.editRevision,development,trigger},job=>
          generateBundle(directory,{development,signal:job.signal,onProgress:job.progress,beforeCommit:job.beforeCommit,paths}));
      });
    }
  };
}
