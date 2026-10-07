// A stored map set drawn for the owner: a design set's stored design or an influence set's stored
// model, rendered by generated-view.py. It reads the store, then places untouched influence maps;
// it never analyses source or solves nesting.
import {readFile,readdir,mkdir,rm,stat,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {repoRoot,setFile,mapSet} from './map-set.mjs';

// Every stored page, the source behind it, and which pages the source has moved out from under.
async function viewModel({repo}) {
  if(mapSet?.mode==='design')return (await import('./design.mjs')).designModel({repo});
  if(mapSet?.mode==='influence')return (await import('../influence/solved-set.mjs')).solvedModel();
  throw Error('Choose a map set: --set 030-influence, 030-architecture or 030-deployment.');
}
const bytesUnder=async dir=>{
  let total=0,files=0;
  for(const entry of await readdir(dir,{withFileTypes:true})) {
    const at=resolve(dir,entry.name);
    if(entry.isDirectory()){const sub=await bytesUnder(at);total+=sub.bytes;files+=sub.files;}
    else {total+=(await stat(at)).size;files++;}
  }
  return {bytes:total,files};
};

// The viewer is one stable place a person keeps open. It is drawn beside itself and then laid
// over the old one file by file, the shell last, so an open viewer never finds the folder gone
// and only sees the new stamp once every drawing behind it is in place.
export async function buildGeneratedView({repo=repoRoot,out=resolve(repo,setFile('view'))}={}) {
  const model={...await viewModel({repo}),built:new Date().toISOString()};
  const next=`${out}.next`;
  await rm(next,{recursive:true,force:true});
  await mkdir(next,{recursive:true});
  const started=Date.now();
  const child=spawn(process.env.PYTHON??'python',[fileURLToPath(new URL('./generated-view.py',import.meta.url)),next],
    {stdio:['pipe',2,'inherit'],env:{...process.env,SAAM_NODE:process.execPath,PYTHONIOENCODING:'utf-8',PYTHONPATH:fileURLToPath(new URL('./',import.meta.url))}});
  child.stdin.end(JSON.stringify(model));
  await new Promise((done,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?done():reject(Error(`Generated-map renderer exited ${code}`)));});
  await mkdir(resolve(out,'svg'),{recursive:true});
  const drawn=new Set(await readdir(resolve(next,'svg')));
  for(const name of drawn)await copyFile(resolve(next,'svg',name),resolve(out,'svg',name));
  for(const name of await readdir(resolve(out,'svg')))if(!drawn.has(name))await rm(resolve(out,'svg',name),{force:true});
  for(const name of ['sources.js','index.html','stamp.js'])await copyFile(resolve(next,name),resolve(out,name));
  await rm(next,{recursive:true,force:true});
  const {bytes,files}=await bytesUnder(out);
  return {out,index:resolve(out,'index.html'),pages:model.pages.length,stale:Object.keys(model.stale).length,
    changed:model.changed,changedInputs:model.changedInputs,ms:Date.now()-started,bytes,files,
    ...(model.placement?{placement:model.placement}:{})};
}

