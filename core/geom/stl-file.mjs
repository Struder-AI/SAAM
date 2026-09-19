// File ingestion retains indexed geometry, not a second full source/text buffer.
import {open,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {checkMeshCapacity,meshAllocationError} from './mesh-capacity.mjs';
import {meshInputError} from './mesh.mjs';
export async function hashFile(path,{signal}={}){const sha=createHash('sha256');for await(const chunk of createReadStream(path,{signal}))sha.update(chunk);return sha.digest('hex');}
export async function decodeSTLFile(path,options={}){
  try{return await decodeFile(path,options);}catch(error){if(!error.code&&error.name==='Error'&&!error.message.startsWith('STL import needs'))throw meshInputError(error.message);throw error;}
}
async function decodeFile(path,{units,scale=1,signal,progress=()=>{}}={}){
  if(!['mm','inch'].includes(units)||!Number.isFinite(scale)||scale<=0)throw Error('STL import needs explicit mm/inch units and positive scale.');
  const size=(await stat(path)).size,handle=await open(path,'r'),header=Buffer.alloc(84);let read;
  try{read=(await handle.read(header,0,84,0)).bytesRead;}finally{await handle.close();}
  const count=read===84?header.readUInt32LE(80):0,binary=count>0&&84+50*count===size;
  if(binary)checkMeshCapacity(count*3,count);
  const factor=scale*(units==='inch'?25.4:1),vertices=[],triangles=[],lookup=new Map(),sha=createHash('sha256');let bytesRead=0;
  function facet(points){const t=points.map(p=>{p=p.map(v=>v*factor);if(!p.every(Number.isFinite))throw Error('Nonfinite STL coordinate.');const key=p.join(',');if(!lookup.has(key)){lookup.set(key,vertices.length);vertices.push(p);}return lookup.get(key);});triangles.push(t);}
  let pending=Buffer.alloc(0),skip=84,text='',started=false,ended=false,tokens=[];
  const words={0:'facet',1:'normal',5:'outer',6:'loop',7:'vertex',11:'vertex',15:'vertex',19:'endloop',20:'endfacet'};
  function token(word){if(tokens.length===0&&word.toLowerCase()==='endsolid'){ended=true;return;}const i=tokens.length;if(words[i]){if(word.toLowerCase()!==words[i])throw Error('Malformed ASCII STL.');}else if(!Number.isFinite(Number(word)))throw Error('Nonfinite STL coordinate.');tokens.push(word);if(tokens.length===21){facet([8,12,16].map(i=>tokens.slice(i,i+3).map(Number)));tokens=[];}}
  try{for await(const data of createReadStream(path,{highWaterMark:65536,signal})){
    signal?.throwIfAborted();sha.update(data);bytesRead+=data.length;
    if(binary){let part=data;if(skip){const n=Math.min(skip,part.length);part=part.subarray(n);skip-=n;}pending=pending.length?Buffer.concat([pending,part]):part;let at=0;while(at+50<=pending.length){facet([0,1,2].map(v=>[0,1,2].map(k=>pending.readFloatLE(at+12+v*12+k*4))));at+=50;}pending=Buffer.from(pending.subarray(at));}
    else{
      text+=data.toString('utf8');
      if(!started){const newline=text.indexOf('\n');if(newline<0){if(text.length>4096)throw Error('Invalid STL header.');continue;}if(!/^\s*solid(?:\s|$)/i.test(text.slice(0,newline)))throw Error('Invalid or truncated STL.');text=text.slice(newline+1);started=true;}
      if(!ended){let at=0;const scanner=/\S+\s+/g;let match;while((match=scanner.exec(text))){at=scanner.lastIndex;token(match[0].trim());if(ended)break;}text=text.slice(at);}
      if(text.length>4096)throw Error('Invalid STL token or closing line.');
    }
    progress({stage:'read-source',completed:bytesRead,total:size,percent:100*bytesRead/size,triangles:triangles.length});
  }}catch(error){throw meshAllocationError(error,'STL decoding',vertices.length,triangles.length);}
  if(binary){if(skip||pending.length||triangles.length!==count)throw Error('Truncated binary STL.');}
  else{if(!ended&&text.trim()){token(text.trim());text='';}if(!started||!ended||tokens.length||!/^[^\r\n]*(?:\r?\n\s*)?$/.test(text))throw Error('Invalid or truncated ASCII STL.');}
  checkMeshCapacity(vertices.length,triangles.length);return {vertices,triangles,sha256:sha.digest('hex'),bytes:size};
}
