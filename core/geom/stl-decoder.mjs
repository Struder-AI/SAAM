import {StringDecoder} from 'node:string_decoder';
import {checkMeshCapacity} from './mesh-capacity.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';

const invalid=(message)=>Error(message);

// Vertices closer than print resolution are one vertex: a print cannot tell them
// apart, so a mesh that keeps them apart is almost always in error. Every pair
// closer than the tolerance joins one cluster (so clusters may chain); each
// cluster keeps the member nearest its centroid, input order breaking ties, so
// accepted coordinates are always source coordinates and the result does not
// depend on visiting order. A triangle with two or more corners in one cluster
// collapses and is removed; unused vertices go. Spatial cells only find
// candidates; the Euclidean distance decides. Every mesh import passes this in
// the STL decoder; repair runs it again on its own output.
export const VERTEX_MERGE_METHOD='print-resolution-cluster/1';
export function mergeCloseVertices(vertices,triangles,toleranceMm=PRINT_RESOLUTION_MM){
  const n=vertices.length,report={method:VERTEX_MERGE_METHOD,toleranceMm,mergedVertices:0,collapsedTriangles:0,unusedVertices:0,maxDisplacementMm:0};
  const magnitude=[0,0,0];for(const p of vertices)for(let k=0;k<3;k++)magnitude[k]=Math.max(magnitude[k],Math.abs(p[k]));
  // Power-of-two cells at least the tolerance wide, widened only where coordinates
  // are so large that neighbouring cell numbers would stop being exact integers.
  const width=magnitude.map(m=>2**Math.max(Math.ceil(Math.log2(toleranceMm)),Math.ceil(Math.log2(m||Number.MIN_VALUE))-48));
  const parent=new Int32Array(n).map((_,i)=>i),root=x=>{while(parent[x]!==x)x=parent[x]=parent[parent[x]];return x;};
  const cells=new Map(),key=(x,y,z)=>(Math.imul(x|0,73856093)^Math.imul(y|0,19349663)^Math.imul(z|0,83492791));
  let joined=false;
  for(let i=0;i<n;i++){
    const p=vertices[i],c=[0,1,2].map(k=>Math.floor(p[k]/width[k]));
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const j of cells.get(key(c[0]+x,c[1]+y,c[2]+z))??[]){
      const q=vertices[j];if(Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2])>=toleranceMm)continue;
      const a=root(i),b=root(j);if(a!==b){parent[Math.max(a,b)]=Math.min(a,b);joined=true;}
    }
    const name=key(...c),bucket=cells.get(name);if(bucket)bucket.push(i);else cells.set(name,[i]);
  }
  let representative=null;
  if(joined){
    const sum=new Float64Array(3*n),count=new Int32Array(n),best=new Int32Array(n).fill(-1),distance=new Float64Array(n).fill(Infinity);
    for(let i=0;i<n;i++){const r=root(i);count[r]++;for(let k=0;k<3;k++)sum[3*r+k]+=vertices[i][k];}
    for(let i=0;i<n;i++){
      const r=root(i);if(count[r]===1){best[r]=i;continue;}
      const p=vertices[i],d=Math.hypot(p[0]-sum[3*r]/count[r],p[1]-sum[3*r+1]/count[r],p[2]-sum[3*r+2]/count[r]);
      if(d<distance[r]){distance[r]=d;best[r]=i;}
    }
    representative=new Int32Array(n);
    for(let i=0;i<n;i++){
      const r=best[root(i)],p=vertices[i],q=vertices[r];representative[i]=r;
      if(r!==i){report.mergedVertices++;report.maxDisplacementMm=Math.max(report.maxDisplacementMm,Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]));}
    }
  }
  const mapped=representative?triangles.map(t=>t.map(v=>representative[v])):triangles;
  const kept=mapped.filter(t=>t[0]!==t[1]&&t[1]!==t[2]&&t[0]!==t[2]);report.collapsedTriangles=mapped.length-kept.length;
  if(!representative&&!report.collapsedTriangles)return {vertices,triangles,merge:report};
  const used=new Map(),points=[];
  const output=kept.map(t=>t.map(v=>{let index=used.get(v);if(index===undefined){index=points.length;used.set(v,index);points.push(vertices[v]);}return index;}));
  report.unusedVertices=n-report.mergedVertices-points.length;
  return {vertices:points,triangles:output,merge:report};
}

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
    return mergeCloseVertices(this.vertices,this.triangles);
  }
}

export function decodeSTLBuffer(bytes,options){
  const buffer=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  const decoder=new STLDecoder({...options,totalBytes:buffer.length});decoder.write(buffer);return decoder.finish();
}
