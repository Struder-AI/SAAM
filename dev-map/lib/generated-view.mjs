// The whole stored map, drawn for the owner. This reads the store and nothing else: every page
// it draws is what `generate` wrote, and a page whose source has moved since the store was
// written is marked on its own drawing rather than quietly redrawn.
import {readFile,readdir,mkdir,rm,stat,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {repoRoot,storeDir,readIndex,storedFreshness,matchingSource} from './store.mjs';
import {presentationPage} from './presentation.mjs';
import {snapshotIdentity} from './freshness.mjs';
import {writeScorePage,scoreMaps} from './score.mjs';

export const regenerate='node scripts/agent-toolkit.mjs regenerate';
export const noStore=dir=>`No stored map at ${dir}. Run: ${regenerate}`;

// Every stored page, the source behind it, and which pages the source has moved out from under.
export async function viewModel({repo=repoRoot,readSource=file=>readFile(resolve(repo,file),'utf8'),files}={}) {
  const dir=storeDir(repo),held=await readIndex(dir);
  if(!held)throw Error(noStore(dir));
  const freshness=await storedFreshness(held,{repo,readSource,files});
  const sources={},sourceInfo={};
  const pages=[held.root,...Object.values(held.regionPages),...Object.values(held.groupPages??{})];
  for(const [file,name] of Object.entries(held.records)) {
    const record=JSON.parse(await readFile(resolve(dir,'files',name),'utf8'));
    pages.push(...Object.values(record.pages));
    const {text,...provenance}=await matchingSource(file,{repo,held,record,readSource});
    if(text!==null)sources[file]=text;
    sourceInfo[file]=provenance;
  }
  const stale=Object.fromEntries(freshness?pages.map(p=>[p.index,freshness]):[]);
  // Each map's score and its parts, drawn in the viewer's bar while the owner checks the scorer.
  const scores=Object.fromEntries((await scoreMaps({repo})).scores.map(s=>[s.index,s]));
  return {generated:held.generated,scores,snapshotId:snapshotIdentity(held),pages:pages.map(presentationPage),sources,sourceInfo,stale,changed:freshness?.files??[],changedInputs:freshness?.inputs??[]};
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
export async function buildGeneratedView({repo=repoRoot,out=resolve(repo,'dev-map/view'),readSource}={}) {
  const model={...await viewModel({repo,...(readSource?{readSource}:{})}),built:new Date().toISOString()};
  const next=`${out}.next`;
  await rm(next,{recursive:true,force:true});
  await mkdir(next,{recursive:true});
  const started=Date.now();
  const child=spawn(process.env.PYTHON??'python',[fileURLToPath(new URL('./generated-view.py',import.meta.url)),next],
    {stdio:['pipe','inherit','inherit'],env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONPATH:fileURLToPath(new URL('./',import.meta.url))}});
  child.stdin.end(JSON.stringify(model));
  await new Promise((done,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?done():reject(Error(`Generated-map renderer exited ${code}`)));});
  await mkdir(resolve(out,'svg'),{recursive:true});
  const drawn=new Set(await readdir(resolve(next,'svg')));
  for(const name of drawn)await copyFile(resolve(next,'svg',name),resolve(out,'svg',name));
  for(const name of await readdir(resolve(out,'svg')))if(!drawn.has(name))await rm(resolve(out,'svg',name),{force:true});
  for(const name of ['sources.js','index.html','stamp.js'])await copyFile(resolve(next,name),resolve(out,name));
  await rm(next,{recursive:true,force:true});
  await writeScorePage({repo,out});
  const {bytes,files}=await bytesUnder(out);
  return {out,index:resolve(out,'index.html'),pages:model.pages.length,stale:Object.keys(model.stale).length,
    changed:model.changed,changedInputs:model.changedInputs,ms:Date.now()-started,bytes,files};
}

// After a regenerate the viewer follows. A machine without Python still regenerates.
export async function drawView(options={}) {
  try {const {index,pages,stale,ms}=await buildGeneratedView(options);return {index,pages,stale,ms};}
  catch(error){return {error:error.message};}
}
