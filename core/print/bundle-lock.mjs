import {open,rm,mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// The short lock serializes manifest commits and Studio reservation transitions.
// An interrupted writer needs explicit recovery after its PID has exited.
export async function withBundleWriteLock(directory,action,{wait=false}={}){
  await mkdir(directory,{recursive:true});
  const path=resolve(directory,'.bundle-write.lock');
  let handle,unreadable=0;
  for(;;){
    try{handle=await open(path,'wx');break;}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const busy=Error('Bundle has an active or interrupted writer. Retry after it finishes; an abandoned .bundle-write.lock requires explicit recovery.');
      if(!wait)throw busy;
      let record;
      try{record=JSON.parse(await readFile(path,'utf8'));}catch(readError){if(readError.code!=='ENOENT'&&!(readError instanceof SyntaxError))throw readError;}
      if(!Number.isInteger(record?.pid)&&++unreadable>40)throw busy;
      if(Number.isInteger(record?.pid)&&record.pid>0){
        try{process.kill(record.pid,0);}catch(liveness){if(liveness.code==='ESRCH')throw busy;throw liveness;}
      }
      await new Promise(resolve=>setTimeout(resolve,25));
    }
  }
  try{
    await handle.writeFile(JSON.stringify({pid:process.pid,time:new Date().toISOString()}));
    return await action();
  }finally{await handle.close();await rm(path,{force:true});}
}
