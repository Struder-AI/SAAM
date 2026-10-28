// Host transport captures one requested source. Interpretation belongs to Bundle.
import {createReadStream,createWriteStream} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createTemporaryWorkspace} from './temporary-workspace.mjs';
import {retainFailedImport} from './diagnostics.mjs';

export async function assetIdentity(path,{signal}={}){
  const hash=createHash('sha256');let byteLength=0;
  for await(const chunk of createReadStream(path,{signal})){hash.update(chunk);byteLength+=chunk.length;}
  return {sha256:hash.digest('hex'),byteLength};
}

export function createAssetTransport({meshLibrary,paths,workspace=createTemporaryWorkspace}){
  const retained=new Map();
  return {
    async acquire(source,{signal}={}){
      const owned=await workspace('acquired-asset',{paths}),path=resolve(owned.directory,'source');
      let downloaded;
      try{
        if(source.kind==='local')await pipeline(createReadStream(source.path),createWriteStream(path,{flags:'wx'}),{signal});
        else{
          const {bytes,...metadata}=await meshLibrary.download(source.fileId,{signal});downloaded=metadata;
          await writeFile(path,bytes,{flag:'wx',signal});
        }
        signal?.throwIfAborted();
        const asset=Object.freeze({id:randomUUID(),path,...await assetIdentity(path,{signal}),source:structuredClone(source),...(downloaded?{downloaded:structuredClone(downloaded)}:{})});
        retained.set(asset.id,owned);return asset;
      }catch(error){
        if(downloaded)error.acquiredSource=downloaded;
        try{await owned.release();}catch(cleanup){error.cleanupError=cleanup.message;}
        throw error;
      }
    },
    async release(asset){
      const owned=retained.get(asset.id);if(!owned)return;
      await owned.release();retained.delete(asset.id);
    },
    async retainFailed(asset){
      const {readFile}=await import('node:fs/promises');
      const bytes=await readFile(asset.path);
      if(bytes.length!==asset.byteLength||createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error('Acquired source changed; diagnostic evidence was not retained.');
      return retainFailedImport(paths,bytes);
    }
  };
}
