// The whole stored map, drawn for the owner. This reads the store and nothing else: every page
// it draws is what `generate` wrote, and a page whose source has moved since the store was
// written is marked on its own drawing rather than quietly redrawn.
import {readFile,readdir,mkdir,rm,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {repoRoot,storeDir,readIndex} from './store.mjs';

const sha=t=>createHash('sha256').update(t).digest('hex');
const order=(a,b)=>a<b?-1:a>b?1:0;
export const regenerate='node scripts/agent-toolkit.mjs regenerate';
export const noStore=dir=>`No stored map at ${dir}. Run: ${regenerate}`;

// Every stored page, the source behind it, and which pages the source has moved out from under.
export async function viewModel({repo=repoRoot,readSource=file=>readFile(resolve(repo,file),'utf8')}={}) {
  const dir=storeDir(repo),held=await readIndex(dir);
  if(!held)throw Error(noStore(dir));
  const sources={},changed=[];
  for(const [file,stored] of Object.entries(held.files)) {
    const text=await Promise.resolve(readSource(file)).catch(()=>null);
    if(text===null||sha(text)!==stored.sha256)changed.push(file);
    if(text!==null)sources[file]=text;
  }
  const pages=[held.root,...Object.values(held.regionPages),...Object.values(held.filePages)];
  for(const record of Object.values(held.records))
    pages.push(...Object.values(JSON.parse(await readFile(resolve(dir,'files',record),'utf8')).pages));
  // The files behind a page are the ones a read hashes for it: the whole map behind 0, the
  // region's files behind a region, the file behind a file page, and behind a node page its own
  // file plus every file a component of it is declared in.
  const behind=p=>p.index==='0'?Object.keys(held.files):p.kind==='region'?p.files:p.kind==='file'?[p.file]
    :[...new Set([p.file,...p.components.map(c=>c.file)])];
  const moved=new Set(changed),stale={};
  for(const p of pages) {
    const files=behind(p).filter(f=>moved.has(f));
    if(!files.length)continue;
    const regions=[...new Set(files.map(f=>held.files[f]?.region).filter(Boolean))];
    stale[p.index]={files:files.sort(order),regenerate:regions.length===1?regions[0]:'0'};
  }
  return {generated:held.generated,pages,sources,stale,changed:changed.sort(order)};
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

export async function buildGeneratedView({repo=repoRoot,out=resolve(repo,'dev-map/generated-view'),readSource}={}) {
  const model=await viewModel({repo,...(readSource?{readSource}:{})});
  await rm(out,{recursive:true,force:true});
  await mkdir(out,{recursive:true});
  const started=Date.now();
  const child=spawn(process.env.PYTHON??'python',[fileURLToPath(new URL('./generated-view.py',import.meta.url)),out],
    {stdio:['pipe','inherit','inherit'],env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONPATH:fileURLToPath(new URL('./',import.meta.url))}});
  child.stdin.end(JSON.stringify(model));
  await new Promise((done,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?done():reject(Error(`Generated-map renderer exited ${code}`)));});
  const {bytes,files}=await bytesUnder(out);
  return {out,index:resolve(out,'index.html'),pages:model.pages.length,stale:Object.keys(model.stale).length,
    changed:model.changed,ms:Date.now()-started,bytes,files};
}
