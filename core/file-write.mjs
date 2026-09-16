import {mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

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
