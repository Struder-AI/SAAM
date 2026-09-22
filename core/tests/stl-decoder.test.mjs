import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {appendFileSync} from 'node:fs';
import {STLDecoder} from '../geom/stl-decoder.mjs';
import {decodeSTL} from '../geom/mesh.mjs';
import {decodeSTLFile} from '../geom/stl-file.mjs';

const ascii=Buffer.from('  solid m\u00e9sh\r\nfacet normal 0 0 1\r\n outer loop\r\n vertex 0 0 0\r\n vertex 1 0 0\r\n vertex 0 1 0\r\n endloop\r\nendfacet\r\nendsolid m\u00e9sh\r\n');
function binary(){
  const bytes=Buffer.alloc(134);bytes.write('solid binary');bytes.writeUInt32LE(1,80);
  [[0,0,0],[1,0,0],[0,1,0]].forEach((point,v)=>point.forEach((value,k)=>bytes.writeFloatLE(value,96+v*12+k*4)));
  return bytes;
}
function chunked(bytes,size,options={units:'mm'}){
  const decoder=new STLDecoder({...options,totalBytes:bytes.length});
  for(let at=0;at<bytes.length;at+=size)decoder.write(bytes.subarray(at,at+size));
  return decoder.finish();
}

test('incremental ASCII and binary decoding is invariant across token, UTF-8, header and facet boundaries',()=>{
  for(const bytes of [ascii,binary()]){
    const expected=decodeSTL(bytes,{units:'inch',scale:2});
    for(const size of [1,2,7,49,83,84,127])assert.deepEqual(chunked(bytes,size,{units:'inch',scale:2}),expected,`chunk ${size}`);
    assert.deepEqual(expected.vertices,[[0,0,0],[50.8,0,0],[0,50.8,0]]);
    assert.deepEqual(expected.triangles,[[0,1,2]]);
  }
});

test('buffer and file entry points agree on malformed, truncated, extra and nonfinite STL data',async t=>{
  const root=await mkdtemp(join(tmpdir(),'saam-stl-decoder-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const malformed=[
    Buffer.from('solid x\nfacet wrong 0 0 0\nendsolid x\n'),
    Buffer.from('solid x\nendsolid\nunexpected trailing line\n'),
    binary().subarray(0,133),Buffer.concat([binary(),Buffer.from([0])]),
    Buffer.from('solid x\nfacet normal 0 0 1 outer loop vertex 1e309 0 0 vertex 0 0 0 vertex 0 1 0 endloop endfacet endsolid x\n')
  ];
  for(const [index,bytes] of malformed.entries()){
    const path=join(root,index+'.stl');await writeFile(path,bytes);
    let direct,file;try{decodeSTL(bytes,{units:'mm'});}catch(error){direct=error;}
    try{await decodeSTLFile(path,{units:'mm'});}catch(error){file=error;}
    assert.ok(direct&&file);assert.equal(file.message,direct.message);
    for(const size of [1,7,83])assert.throws(()=>chunked(bytes,size),undefined,`malformed ${index}, chunk ${size}`);
  }
  assert.throws(()=>decodeSTL(Buffer.from('solid x endsolid x'),{units:'mm'}),/Invalid or truncated(?: ASCII)? STL/,
    'ASCII facets and endsolid require a line after the solid header');
});

test('stream wrapper retains progress, hashing and cancellation while the parser owns capacity',async t=>{
  const root=await mkdtemp(join(tmpdir(),'saam-stl-stream-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const path=join(root,'part.stl');await writeFile(path,ascii);
  const progress=[];const decoded=await decodeSTLFile(path,{units:'mm',progress:value=>progress.push(value)});
  assert.equal(progress.at(-1).completed,ascii.length);assert.equal(progress.at(-1).percent,100);
  assert.match(decoded.sha256,/^[a-f0-9]{64}$/);assert.equal(decoded.bytes,ascii.length);
  const controller=new AbortController();controller.abort();
  await assert.rejects(decodeSTLFile(path,{units:'mm',signal:controller.signal}),error=>error.name==='AbortError');

  const changing=join(root,'changing.stl'),changingBytes=Buffer.from(`solid x\n${' '.repeat(70000)}endsolid x\n`);
  await writeFile(changing,changingBytes);let shortened=false;
  await assert.rejects(decodeSTLFile(changing,{units:'mm',progress:()=>{
    if(!shortened){shortened=true;appendFileSync(changing,' '.repeat(100000));}
  }}),/STL file changed while reading/);

  const header=Buffer.alloc(84);header.writeUInt32LE(0x30000000,80);
  const decoder=new STLDecoder({units:'mm',totalBytes:84+50*0x30000000});
  assert.throws(()=>decoder.write(header),/Mesh index capacity exceeded/);
});

test('header, token and insignificant-whitespace limits are chunk independent',()=>{
  const longHeader=Buffer.from(`solid ${'x'.repeat(5000)}\nendsolid\n`);
  const longToken=Buffer.from(`solid x\nfacet normal ${'1'.repeat(5000)} 0 1 outer loop vertex 0 0 0 vertex 1 0 0 vertex 0 1 0 endloop endfacet\nendsolid x\n`);
  const whitespace=Buffer.from(`solid x\n${' \r\n\t'.repeat(3000)}endsolid x\n`);
  for(const size of [17,97,4096,10000]){
    assert.throws(()=>chunked(longHeader,size),/Invalid STL header/);
    assert.throws(()=>chunked(longToken,size),/Invalid STL token or closing line/);
    assert.deepEqual(chunked(whitespace,size),{vertices:[],triangles:[]});
  }
});
