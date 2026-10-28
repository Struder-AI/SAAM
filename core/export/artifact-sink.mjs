import {mkdir,mkdtemp,open,rename,rm,readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {Readable,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createDeflateRaw} from 'node:zlib';
import {crc32,validZipName,ZIP32_MAX,ZIP32_MAX_ENTRIES} from './zip.mjs';

const BLOCK=64*1024;
export async function createExportDirectory(root){await mkdir(root,{recursive:true});return mkdtemp(join(resolve(root),'export-'));}
export async function removeExportDirectory(directory){await rm(directory,{recursive:true,force:true});}
async function* chunks(value){
  if(value?.parts){for(const part of value.parts)yield* chunks(part);return;}
  if(value?.file){yield* createReadStream(value.file,{highWaterMark:BLOCK});return;}
  if(typeof value==='string'){
    for(let at=0;at<value.length;){let end=Math.min(value.length,at+BLOCK/4);if(end<value.length&&value.charCodeAt(end-1)>=0xd800&&value.charCodeAt(end-1)<=0xdbff)end--;yield Buffer.from(value.slice(at,end));at=end;}
    return;
  }
  if(ArrayBuffer.isView(value)){const bytes=Buffer.from(value.buffer,value.byteOffset,value.byteLength);for(let at=0;at<bytes.length;at+=BLOCK)yield bytes.subarray(at,at+BLOCK);return;}
  if(value instanceof ArrayBuffer){yield* chunks(new Uint8Array(value));return;}
  throw Error('Machine writer returned unsupported file content.');
}
async function fileWriter(file,signal){
  const handle=await open(file,'wx');let position=0,closed=false,buffer=Buffer.allocUnsafe(BLOCK),used=0;
  async function flush(){if(used){await handle.writeFile(buffer.subarray(0,used));used=0;}}
  return {file,get byteLength(){return position;},
    async write(value){if(closed)throw Error('Export member is already closed.');for await(const bytes of chunks(value)){signal?.throwIfAborted();let at=0;while(at<bytes.length){const count=Math.min(BLOCK-used,bytes.length-at);bytes.copy(buffer,used,at,at+count);used+=count;at+=count;position+=count;if(used===BLOCK)await flush();}}},
    async line(value){await this.write(value+'\n');},
    async patch(at,bytes){signal?.throwIfAborted();await flush();let done=0;while(done<bytes.length){const result=await handle.write(bytes,done,bytes.length-done,at+done);done+=result.bytesWritten;}},
    async close(){if(!closed){closed=true;try{await flush();}finally{buffer=null;await handle.close();}}}
  };
}

// One preparation owns body/member spools and the final artifact. None of these
// files becomes a downloadable result until finish() selects the complete file.
export async function createArtifactSink(directory,{signal}={}){
  let next=0,output=null,finished=false,calculated=null;const members=new Set();
  async function member(){const value=await fileWriter(join(directory,'member-'+next++),signal);members.add(value);return value;}
  async function root(){if(output)throw Error('Machine writer already selected an output.');return output=await fileWriter(join(directory,'program.partial'),signal);}
  async function compose(values){const target=await root();for(const value of values)await target.write(value);await target.close();}
  async function archive(entries){
    if(!(entries instanceof Map&&entries.size>0&&entries.size<=ZIP32_MAX_ENTRIES))throw Error('ZIP32 requires 1–65534 entries; ZIP64 is not supported.');
    const target=await root(),central=await member();let count=0;
    for(const [name,value]of [...entries].sort(([a],[b])=>a<b?-1:a>b?1:0)){
      validZipName(name);signal?.throwIfAborted();const offset=target.byteLength,filename=Buffer.from(name),header=Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);header.writeUInt16LE(filename.length,26);
      await target.write(header);await target.write(filename);const start=target.byteLength;let crc=0,length=0;
      async function* input(){for await(const bytes of chunks(value)){signal?.throwIfAborted();crc=crc32(bytes,crc);length+=bytes.length;if(length>=ZIP32_MAX)throw Error('ZIP member requires ZIP64; this exporter supports ZIP32.');yield bytes;}}
      await pipeline(Readable.from(input()),createDeflateRaw({level:1}),new Writable({highWaterMark:BLOCK,write(bytes,_encoding,done){target.write(bytes).then(()=>done(),done);}}));
      const compressed=target.byteLength-start;if(compressed>=ZIP32_MAX)throw Error('ZIP member requires ZIP64; this exporter supports ZIP32.');
      header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed,18);header.writeUInt32LE(length,22);await target.patch(offset,header);
      const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);header.copy(record,6,4,30);record.writeUInt32LE(offset,42);await central.write(record);await central.write(filename);count++;
      if(target.byteLength>=ZIP32_MAX)throw Error('ZIP offsets require ZIP64; this exporter supports ZIP32.');
    }
    await central.close();const offset=target.byteLength;await target.write(central);const end=Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(central.byteLength,12);end.writeUInt32LE(offset,16);await target.write(end);await target.close();
  }
  async function candidate(){
    if(calculated)return calculated;
    if(!output)throw Error('Machine writer returned no output artifact.');for(const value of members)await value.close();await output.close();signal?.throwIfAborted();
    const hash=createHash('sha256');for await(const bytes of chunks(output)){signal?.throwIfAborted();hash.update(bytes);}
    return calculated={directory,file:join(directory,'program.ready'),byteLength:output.byteLength,sha256:hash.digest('hex')};
  }
  async function finish({committed=false}={}){const value=await candidate();for(const member of members)await rm(member.file,{force:true});if(!committed)signal?.throwIfAborted();await rename(output.file,value.file);finished=true;return value;}
  async function abort(){for(const member of members)await member.close().catch(()=>{});await output?.close().catch(()=>{});if(!finished)await removeExportDirectory(directory);}
  async function digest(value,algorithm){const hash=createHash(algorithm);for await(const bytes of chunks(value)){signal?.throwIfAborted();hash.update(bytes);}return hash.digest('hex');}
  return {writer:Object.freeze({member,compose,archive,digest}),candidate,finish,abort};
}

// Receiver ownership is strong. Each active read holds a separate lease; a
// capability's release never deletes the file beneath an already acquired read.
export function ownExportArtifact(descriptor){
  const {directory,file,byteLength,sha256}=descriptor;
  if(resolve(file)!==join(resolve(directory),'program.ready'))throw Error('Invalid prepared Export artifact.');
  let released=false,active=0,removal=null,completion=null,complete,fail;
  function clean(){
    if(released&&!active&&!removal){removal=removeExportDirectory(directory);removal.then(complete,fail);}
    return removal??Promise.resolve();
  }
  function release(){
    if(!released){released=true;completion=new Promise((resolve,reject)=>{complete=resolve;fail=reject;});}
    clean();return completion;
  }
  function openRead(){
    if(released)throw Error('Prepared Export file is no longer available.');active++;
    const stream=createReadStream(file,{highWaterMark:BLOCK});let ended=false;
    const settled=new Promise((resolve,reject)=>{stream.once('close',()=>{if(!ended){ended=true;active--;clean().then(resolve,reject);}});});
    settled.catch(()=>{});
    // The caller owns stream failure. This listener only keeps a failed open
    // from becoming an unhandled error before pipeline attaches its handlers.
    stream.on('error',()=>{});
    return {stream,byteLength,async close(){stream.destroy();await settled;}};
  }
  async function materialize(){const lease=openRead();try{return await readFile(file);}finally{await lease.close();}}
  return Object.freeze({directory,file,byteLength,sha256,openRead,release,materialize});
}
