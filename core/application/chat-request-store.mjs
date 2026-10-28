import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {replaceFile} from '../private/studio/file-write.mjs';

// One runtime owns this folder. Keep its own read handles clear of atomic
// replacement on Windows; unrelated records and external writers stay independent.
export function createRequestStore(folder){
  const root=resolve(folder),pending=new Map(),lifetime={closing:null};
  function recordPath(id){
    if(!/^[a-f0-9-]{32,64}$/.test(id))throw Error('Invalid agent request id.');
    return resolve(root,id+'.json');
  }
  function enqueue(id,action){
    const file=recordPath(id);
    if(lifetime.closing)return Promise.reject(Error('Request store closed.'));
    const result=(pending.get(id)??Promise.resolve()).then(()=>action(file));
    const tail=result.then(release,release);
    function release(){if(pending.get(id)===tail)pending.delete(id);}
    pending.set(id,tail);return result;
  }
  return {
    get:id=>enqueue(id,async file=>JSON.parse(await readFile(file,'utf8'))),
    snapshot:(id,knownKey)=>enqueue(id,async file=>{
      const info=await stat(file,{bigint:true}),key=[info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
      return key===knownKey?{key}:{key,bytes:await readFile(file,'utf8')};
    }),
    replace(record){
      // Ownership transfers now, before waiting for another file handle to close.
      const bytes=JSON.stringify(record)+'\n',saved=JSON.parse(bytes);
      return enqueue(saved.id,async file=>{await replaceFile(file,bytes);return saved;});
    },
    close(){return lifetime.closing??=Promise.all([...pending.values()]).then(()=>{});}
  };
}
