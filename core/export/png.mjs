import {deflateSync} from 'node:zlib';
import {crc32} from './zip.mjs';

// An 8-bit PNG of `width` × `height` pixels from row-major bytes: RGBA (4 per
// pixel) or RGB (3). Rows are unfiltered; `level` is the deflate effort.
export function encodePng(pixels,width,height,{channels=4,level=9}={}){
  const row=width*channels,raw=Buffer.alloc(height*(1+row));
  for(let y=0;y<height;y++)Buffer.from(pixels.buffer,pixels.byteOffset+y*row,row).copy(raw,y*(1+row)+1);
  const chunk=(name,data)=>{const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([length,type,data,crc]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=channels===4?6:2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw,{level})),chunk('IEND',Buffer.alloc(0))]);
}
