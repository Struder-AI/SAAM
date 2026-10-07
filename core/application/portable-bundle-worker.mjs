import {parentPort,workerData} from 'node:worker_threads';
import {shareBundle,importBundle} from '../print/portable.mjs';

const beforeCommit=()=>new Promise(resolve=>{
  parentPort.once('message',message=>{
    if(message.type!=='commit')throw Error('Invalid bundle publication acknowledgement.');
    resolve();
  });
  parentPort.postMessage({type:'before-commit'});
});
const progress=value=>parentPort.postMessage({type:'progress',value});
try{
  const {operation,directory,packageFile,options}=workerData;
  const settings={...options,beforeCommit,progress};
  const value=operation==='share'?await shareBundle(directory,packageFile,settings)
    :operation==='import'?await importBundle(packageFile,directory,settings)
    :(()=>{throw Error('Unknown portable bundle operation.');})();
  parentPort.postMessage({type:'result',value});
}catch(error){
  parentPort.postMessage({type:'error',error:{message:error.message,name:error.name,stack:error.stack,
    ...(error.code?{code:error.code}:{}),...(error.installedExtensions?{installedExtensions:error.installedExtensions}:{})}});
}finally{parentPort.close();}
