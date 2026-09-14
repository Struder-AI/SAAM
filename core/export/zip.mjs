// Bounded ZIP container for output artifacts. No filesystem extraction, ZIP64,
// encryption, symlinks, duplicate names or path aliases. Dates are fixed so the
// exact same locked program produces the exact same archive bytes.
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {requireThat} from '../geom/tolerance.mjs';
// ZIP32 has 32-bit member sizes and offsets. This is the container's actual
// representational boundary, not a manufacturing/file-size policy. ZIP64 is
// outside the currently declared machine artifact contract.
const MAX=0xffffffff, MAX_ENTRIES=0xfffe;
const table=Uint32Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++)i=(i>>>1)^((i&1)?0xedb88320:0);return i>>>0;});
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
const validName=name=>requireThat(typeof name==='string'&&name.length<256&&/^[A-Za-z0-9_\[\]./-]+$/.test(name)&&!name.startsWith('/')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Invalid ZIP member name.');
export function packZip(entries){
  requireThat(entries instanceof Map&&entries.size>0&&entries.size<=MAX_ENTRIES,'ZIP32 requires 1–65534 entries; ZIP64 is not supported.');
  const local=[],central=[];let offset=0;
  for(const [name,value] of [...entries].sort(([a],[b])=>a<b?-1:a>b?1:0)){
    // Level 1 preserves every source byte; level 9 spent seconds saving only
    // about 12% on the measured print body. Container hashes remain exact.
    validName(name);const bytes=Buffer.from(value),filename=Buffer.from(name),compressed=deflateRawSync(bytes,{level:1}),crc=crc32(bytes);
    requireThat(bytes.length<MAX&&compressed.length<MAX,'ZIP member requires ZIP64; this exporter supports ZIP32.');
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt16LE(33,12);
    h.writeUInt32LE(crc,14);h.writeUInt32LE(compressed.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(filename.length,26);
    local.push(h,filename,compressed);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);h.copy(c,6,4,30);c.writeUInt32LE(offset,42);
    central.push(c,filename);offset+=h.length+filename.length+compressed.length;
    requireThat(offset<MAX,'ZIP offsets require ZIP64; this exporter supports ZIP32.');
  }
  const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.size,8);end.writeUInt16LE(entries.size,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
  const bytes=Buffer.concat([...local,cd,end]);return bytes;
}
export function unpackZip(input){
  const b=Buffer.isBuffer(input)?input:Buffer.from(input);requireThat(b.length>=22,'Invalid ZIP size.');
  // No comments or trailing bytes in the supported artifact format.
  const end=b.length-22;requireThat(b.readUInt32LE(end)===0x06054b50&&b.readUInt16LE(end+20)===0,'Invalid ZIP end record.');
  const count=b.readUInt16LE(end+10),size=b.readUInt32LE(end+12),start=b.readUInt32LE(end+16);
  requireThat(count>0&&count<=MAX_ENTRIES&&b.readUInt16LE(end+8)===count&&b.readUInt32LE(end+4)===0&&start+size===end,'Unsupported ZIP layout.');
  const result=new Map(),ranges=[];let p=start;
  for(let i=0;i<count;i++){
    requireThat(p+46<=end&&b.readUInt32LE(p)===0x02014b50,'Invalid ZIP directory.');
    const flags=b.readUInt16LE(p+8),method=b.readUInt16LE(p+10),crc=b.readUInt32LE(p+16),compressed=b.readUInt32LE(p+20),length=b.readUInt32LE(p+24);
    const nl=b.readUInt16LE(p+28),el=b.readUInt16LE(p+30),cl=b.readUInt16LE(p+32),off=b.readUInt32LE(p+42);
    requireThat((flags&~0x808)===0&&[0,8].includes(method)&&p+46+nl+el+cl<=end&&b.readUInt16LE(p+34)===0&&(b.readUInt32LE(p+38)>>>16&0xf000)!==0xa000,'Unsupported ZIP member.');
    const name=b.subarray(p+46,p+46+nl).toString('utf8');validName(name);requireThat(!result.has(name),'Duplicate ZIP member.');
    requireThat(off+30<=start&&b.readUInt32LE(off)===0x04034b50&&b.readUInt16LE(off+6)===flags&&b.readUInt16LE(off+8)===method,'Invalid ZIP local header.');
    const lnl=b.readUInt16LE(off+26),lel=b.readUInt16LE(off+28),data=off+30+lnl+lel;
    requireThat(data+compressed<=start&&b.subarray(off+30,off+30+lnl).toString('utf8')===name,'ZIP member name/data mismatch.');
    let memberEnd=data+compressed;
    if(flags&8){
      const sig=memberEnd+4<=start&&b.readUInt32LE(memberEnd)===0x08074b50?4:0;
      requireThat(memberEnd+sig+12<=start&&b.readUInt32LE(memberEnd+sig)===crc&&b.readUInt32LE(memberEnd+sig+4)===compressed&&b.readUInt32LE(memberEnd+sig+8)===length,'Invalid ZIP data descriptor.');memberEnd+=sig+12;
    }else requireThat(b.readUInt32LE(off+14)===crc&&b.readUInt32LE(off+18)===compressed&&b.readUInt32LE(off+22)===length,'ZIP local size/checksum mismatch.');
    requireThat(length<MAX&&compressed<MAX&&off<MAX,'ZIP64 members are not supported by this ZIP32 reader.');
    const raw=b.subarray(data,data+compressed),bytes=method===0?Buffer.from(raw):inflateRawSync(raw,{maxOutputLength:Math.max(1,length)});
    requireThat(bytes.length===length&&crc32(bytes)===crc,'ZIP member checksum mismatch.');
    ranges.push([off,memberEnd]);result.set(name,bytes);p+=46+nl+el+cl;
  }
  requireThat(p===end,'Unexpected ZIP directory data.');ranges.sort((a,b)=>a[0]-b[0]);let next=0;
  for(const [from,to] of ranges){requireThat(from===next,'ZIP has overlapping or unreferenced data.');next=to;}
  requireThat(next===start,'ZIP has unreferenced data.');return result;
}
