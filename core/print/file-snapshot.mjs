import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Change detection only. Review, approval and delivery still read current bytes
// through their owning validators. Retain a bounded number of file snapshots.
export function createFileSnapshot(limit=32){
  const files=new Map();
  return async function snapshot(file,{parse=false}={}){
    try{
      const info=await stat(file,{bigint:true});
      const key=[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
      let entry=files.get(file);
      if(entry?.key!==key){
        const bytes=await readFile(file);
        entry={key,digest:createHash('sha256').update(bytes).digest('hex'),bytes};
        if(files.size>=limit)files.clear();
        files.set(file,entry);
      }
      if(parse&&!entry.value)entry.value=JSON.parse(entry.bytes.toString('utf8'));
      return parse?entry.value:entry.digest;
    }catch(error){if(error.code==='ENOENT'){files.delete(file);return null;}throw error;}
  };
}
