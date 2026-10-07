import {lstat,mkdir,open,writeFile,rename,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

// Create without overwriting. Failure cleanup checks the identity of the file
// opened by wx before removal. This does not promise crash atomicity.
export async function writeNewFile(file,bytes){
  const handle=await open(file,'wx');
  let failure;
  try{await handle.writeFile(bytes);}
  catch(error){
    failure=error;
    try{
      const owned=await handle.stat({bigint:true}),current=await lstat(file,{bigint:true});
      if(current.isSymbolicLink()||owned.dev!==current.dev||owned.ino!==current.ino)
        throw Error('New file changed; cleanup refused.');
      await rm(file);
    }catch(cleanup){
      if(cleanup.code!=='ENOENT'){failure.cleanupError=cleanup.message;failure.message+=' Cleanup: '+cleanup.message;}
    }
  }
  try{await handle.close();}catch(error){if(!failure)failure=error;else failure.closeError=error.message;}
  if(failure)throw failure;
}

// Replace one file, retaining its previous complete contents on write failure.
// Windows readers can briefly prevent replacement; retry that sharing conflict
// without truncating/removing the destination. This is not a multi-file lock.
export async function replaceFile(file,bytes){
  await mkdir(dirname(file),{recursive:true});
  const temporary=file+'.'+randomUUID()+'.tmp';
  try{
    await writeFile(temporary,bytes);
    for(let attempt=0;;attempt++){
      try{await rename(temporary,file);return;}
      catch(error){
        if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=6)throw error;
        await new Promise(done=>setTimeout(done,5*2**attempt));
      }
    }
  }finally{await rm(temporary,{force:true}).catch(()=>{});}
}
