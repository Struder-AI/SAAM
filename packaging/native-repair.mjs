import {readFile,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function executablePlatform(bytes){
  if(bytes.length>=64&&bytes.toString('ascii',0,2)==='MZ'){
    const offset=bytes.readUInt32LE(60);
    if(offset+6<=bytes.length&&bytes.readUInt32LE(offset)===0x4550&&bytes.readUInt16LE(offset+4)===0x8664)return 'win-x64';
  }
  if(bytes.length>=8&&bytes.readUInt32LE(0)===0xfeedfacf){
    const cpu=bytes.readUInt32LE(4);return cpu===0x100000c?'darwin-arm64':cpu===0x1000007?'darwin-x64':null;
  }
  return null;
}

// A release may omit the optional backend, but never substitute a host binary
// for the target. Source identity and actual executable architecture travel
// with the helper, including when an explicit cross-platform artifact is used.
export async function packageNativeRepair({root,app,platform,artifact}){
  const folder=resolve(artifact??join(root,'build/mesh-repair'));
  let manifest;
  try{manifest=JSON.parse(await readFile(join(folder,'build.json'),'utf8'));}
  catch(error){if(!artifact&&error.code==='ENOENT')return {available:false,reason:'Native backend not built; exact mesh cleanup only.'};throw error;}
  const sourceSha256=sha(await readFile(join(root,'core/geom/native/mesh-repair.cpp')));
  if(manifest.cgal!=='6.2.1'||manifest.sourceSha256!==sourceSha256)throw Error('Native mesh repair artifact is stale; rebuild against the packaged wrapper.');
  const name='saam-mesh-repair'+(platform==='win-x64'?'.exe':''),file=join(folder,name);
  let bytes;
  try{bytes=await readFile(file);}catch(error){
    if(!artifact&&error.code==='ENOENT')return {available:false,reason:'No native helper for '+platform+'; exact mesh cleanup only.'};throw error;
  }
  const actualPlatform=executablePlatform(bytes);
  if(actualPlatform!==platform){
    if(!artifact)return {available:false,reason:'Native helper targets '+(actualPlatform??'an unsupported executable format')+', not '+platform+'; exact mesh cleanup only.'};
    throw Error('Native repair artifact does not match target '+platform+'.');
  }
  const binarySha256=sha(bytes);
  if(manifest.binarySha256&&manifest.binarySha256!==binarySha256)throw Error('Native mesh repair artifact hash changed.');
  const destination=join(app,'build/mesh-repair');await mkdir(destination,{recursive:true});await copyFile(file,join(destination,name));
  await writeFile(join(destination,'build.json'),JSON.stringify({...manifest,platform,binarySha256},null,2)+'\n');
  return {available:true,cgal:manifest.cgal,sourceSha256,binarySha256,platform};
}
