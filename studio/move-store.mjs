// Local drawing/timeline storage. Packaged tours serialize snapshots only through
// the versioned display cache; manufacturing output never uses that cache.
// Doubles retain the interpreter's precision. Fixed-size chunks avoid repeated
// whole-job reallocations; strings are interned once per column.
const CHUNK=16384;
export function moveStore(data={length:0,fields:null,chunks:[],lineOffset:0}) {
  let fieldsByName;
  const at=index=>{
    if(index<0)index+=data.length;
    if(index<0||index>=data.length)return undefined;
    const row={},chunk=data.chunks[Math.floor(index/CHUNK)],offset=index%CHUNK;
    for(const field of data.fields){
      const column=chunk[field.name];
      row[field.name]=field.width>1?Array.from(column.subarray(offset*field.width,(offset+1)*field.width)):
        field.values?field.values[column[offset]]:column[offset];
    }
    row.line+=data.lineOffset;return row;
  };
  const methods={
    get length(){return data.length;},
    at,
    // A local scratch row for batch display work. Copy only requested columns,
    // reusing its small vectors; never expose or mutate the backing buffers.
    reader(names){
      const fields=names.map(name=>data.fields?.find(field=>field.name===name)).filter(Boolean);
      const hasLine=fields.some(field=>field.name==='line');
      const row=Object.fromEntries(names.map(name=>[name,undefined]));
      for(const field of fields)if(field.width>1)row[field.name]=Array(field.width).fill(0);
      return index=>{
        if(index<0||index>=data.length)return undefined;
        const chunk=data.chunks[Math.floor(index/CHUNK)],offset=index%CHUNK;
        for(const field of fields){
          const column=chunk[field.name];
          if(field.width>1)for(let k=0;k<field.width;k++)row[field.name][k]=column[offset*field.width+k];
          else row[field.name]=field.values?field.values[column[offset]]:column[offset];
        }
        if(hasLine)row.line+=data.lineOffset;
        return row;
      };
    },
    value(index,name){
      fieldsByName??=Object.fromEntries(data.fields.map(f=>[f.name,f]));
      const field=fieldsByName[name],column=data.chunks[Math.floor(index/CHUNK)][name],offset=index%CHUNK;
      return field.values?field.values[column[offset]]:column[offset];
    },
    range(first,end){
      // A bounded temporary layer, so reduction reads each compact row once.
      const rows=Object.create(null);for(let i=first;i<end;i++)rows[i]=at(i);return rows;
    },
    push(row){
      data.fields??=Object.entries(row).map(([name,value])=>({name,width:Array.isArray(value)?value.length:1,
        ...(typeof value==='number'||Array.isArray(value)?{}:{values:[]})}));
      const offset=data.length%CHUNK;
      // Indexed values are stored as dictionary ids; numbers keep full precision.
      if(offset===0)data.chunks.push(Object.fromEntries(data.fields.map(f=>[f.name,f.values?new Uint32Array(CHUNK*f.width):new Float64Array(CHUNK*f.width)])));
      const chunk=data.chunks.at(-1);
      for(const field of data.fields){
        const value=row[field.name],column=chunk[field.name];
        if(field.width>1)column.set(value,offset*field.width);
        else if(field.values){let id=field.values.indexOf(value);if(id<0){id=field.values.length;field.values.push(value);}column[offset]=id;}
        else column[offset]=value;
      }
      return ++data.length;
    },
    *[Symbol.iterator](){for(let i=0;i<data.length;i++)yield at(i);},
    some(fn){for(let i=0;i<data.length;i++)if(fn(at(i),i))return true;return false;},
    findLast(fn){for(let i=data.length-1;i>=0;i--){const row=at(i);if(fn(row,i))return row;}},
    every(fn){for(let i=0;i<data.length;i++)if(!fn(at(i),i))return false;return true;},
    filter(fn){const result=[];for(let i=0;i<data.length;i++){const row=at(i);if(fn(row,i))result.push(row);}return result;},
    map(fn){return Array.from({length:data.length},(_,i)=>fn(at(i),i));},
    offsetLines(n){data.lineOffset+=n;},
    snapshot(){return data;}
  };
  return new Proxy(methods,{get(target,key){return typeof key==='string'&&/^\d+$/.test(key)?at(Number(key)):Reflect.get(target,key);}});
}
export const moveBuffers=data=>data.chunks.flatMap(chunk=>Object.values(chunk).map(column=>column.buffer));
