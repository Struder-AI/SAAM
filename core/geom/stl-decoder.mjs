import {StringDecoder} from 'node:string_decoder';
import {checkMeshCapacity} from './mesh-capacity.mjs';

const invalid=(message)=>Error(message);

// One incremental STL parser for complete buffers and streamed files. It retains
// indexed geometry plus only a format prefix and the current binary/text token.
export class STLDecoder {
  constructor({units,scale=1,totalBytes}={}){
    if(!['mm','inch'].includes(units)||!Number.isFinite(scale)||scale<=0)
      throw invalid('STL import needs explicit mm/inch units and positive scale.');
    this.factor=scale*(units==='inch'?25.4:1);this.totalBytes=totalBytes;
    this.vertices=[];this.triangles=[];this.lookup=new Map();
    this.prefix=Buffer.alloc(0);this.format=null;this.binaryPending=Buffer.alloc(0);
    this.binaryCount=0;this.binaryRead=0;this.text='';this.started=false;this.ended=false;this.closingLineEnded=false;this.tokens=[];
    this.strings=new StringDecoder('utf8');
  }
  #facet(points){
    const triangle=points.map(point=>{
      point=point.map(value=>value*this.factor);
      if(!point.every(Number.isFinite))throw invalid('Nonfinite STL coordinate.');
      const key=point.join(',');
      if(!this.lookup.has(key)){this.lookup.set(key,this.vertices.length);this.vertices.push(point);}
      return this.lookup.get(key);
    });
    this.triangles.push(triangle);
  }
  #selectFormat(final=false){
    if(this.format||this.prefix.length<84&&!final)return;
    const count=this.prefix.length>=84?this.prefix.readUInt32LE(80):0;
    const binary=count>0&&Number.isSafeInteger(this.totalBytes)&&84+50*count===this.totalBytes;
    this.format=binary?'binary':'ascii';
    if(binary){
      checkMeshCapacity(count*3,count);this.binaryCount=count;
      const body=this.prefix.subarray(84);this.prefix=Buffer.alloc(0);if(body.length)this.#binary(body);
    }else{
      const bytes=this.prefix;this.prefix=Buffer.alloc(0);if(bytes.length)this.#ascii(this.strings.write(bytes));
    }
  }
  #binary(data){
    const pending=this.binaryPending.length?Buffer.concat([this.binaryPending,data]):data;
    let at=0;
    while(at+50<=pending.length){
      if(this.binaryRead>=this.binaryCount)throw invalid('Invalid binary STL length.');
      this.#facet([0,1,2].map(vertex=>[0,1,2].map(axis=>pending.readFloatLE(at+12+vertex*12+axis*4))));
      this.binaryRead++;at+=50;
    }
    this.binaryPending=Buffer.from(pending.subarray(at));
  }
  #token(value){
    if(this.tokens.length===0&&value.toLowerCase()==='endsolid'){this.ended=true;return;}
    const words={0:'facet',1:'normal',5:'outer',6:'loop',7:'vertex',11:'vertex',15:'vertex',19:'endloop',20:'endfacet'};
    const index=this.tokens.length;
    if(words[index]){if(value.toLowerCase()!==words[index])throw invalid('Malformed ASCII STL.');}
    else if(!Number.isFinite(Number(value)))throw invalid('Nonfinite STL coordinate.');
    this.tokens.push(value);
    if(this.tokens.length===21){this.#facet([8,12,16].map(i=>this.tokens.slice(i,i+3).map(Number)));this.tokens=[];}
  }
  #ascii(decoded){
    this.text+=decoded;
    if(!this.started){
      const newline=this.text.indexOf('\n');
      if(newline<0){if(this.text.length>4096)throw invalid('Invalid STL header.');return;}
      if(newline>4096)throw invalid('Invalid STL header.');
      if(!/^\s*solid(?:\s|$)/i.test(this.text.slice(0,newline)))throw invalid('Invalid or truncated STL.');
      this.text=this.text.slice(newline+1);this.started=true;
    }
    if(!this.ended){
      if(/^\s+$/.test(this.text)){this.text='';return;}
      let at=0;const scanner=/\S+\s+/g;let match;
      while((match=scanner.exec(this.text))){
        at=scanner.lastIndex;const value=match[0].trim();
        if(value.length>4096)throw invalid('Invalid STL token or closing line.');
        this.#token(value);
        if(this.ended){this.closingLineEnded=/[\r\n]/.test(match[0].slice(value.length));break;}
      }
      this.text=this.text.slice(at);
    }
    if(this.text.length>4096)throw invalid('Invalid STL token or closing line.');
  }
  write(chunk){
    const data=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    let remainder=data;
    if(!this.format){
      const take=Math.min(84-this.prefix.length,remainder.length);
      if(take){const part=remainder.subarray(0,take);this.prefix=this.prefix.length?Buffer.concat([this.prefix,part]):Buffer.from(part);remainder=remainder.subarray(take);}
      this.#selectFormat();if(!this.format)return;
    }
    if(!remainder.length)return;
    if(this.format==='binary')this.#binary(remainder);else this.#ascii(this.strings.write(remainder));
  }
  finish(){
    this.#selectFormat(true);
    if(this.format==='binary'){
      if(this.binaryPending.length||this.binaryRead!==this.binaryCount)throw invalid('Truncated binary STL.');
    }else{
      this.#ascii(this.strings.end()+' ');
      const validClosing=this.closingLineEnded?/^\s*$/.test(this.text):/^[^\r\n]*(?:\r?\n\s*)?$/.test(this.text);
      if(!this.started||!this.ended||this.tokens.length||!validClosing)
        throw invalid('Invalid or truncated ASCII STL.');
    }
    checkMeshCapacity(this.vertices.length,this.triangles.length);
    return {vertices:this.vertices,triangles:this.triangles};
  }
}

export function decodeSTLBuffer(bytes,options){
  const buffer=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  const decoder=new STLDecoder({...options,totalBytes:buffer.length});decoder.write(buffer);return decoder.finish();
}
