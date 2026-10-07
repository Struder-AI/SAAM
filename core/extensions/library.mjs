import {homePaths} from '../application/home.mjs';
// Extension exchange and resolution. Release defaults are replaceable; the
// user's copies live beside prints and survive installation updates.
import {createHash,randomUUID} from 'node:crypto';
import {access,lstat,mkdir,cp,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {createTemporaryWorkspace} from '../application/temporary-workspace.mjs';
import {canonicalJson,canonicalHash} from '../canonical-json.mjs';
import {dirname,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const applicationRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const ID=/^[a-z][a-z0-9-]*$/;
const DIGEST=/^[a-f0-9]{64}$/;
const PACKAGE_SCHEMA='saam-extension-package/1';
const MANIFEST_SCHEMA='saam-extension/1';
const loadedDigests=new Map();
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export function extensionRoots({appRoot=applicationRoot,dataRoot}={}){
  return {bundled:resolve(appRoot,'skills'),machines:resolve(appRoot,'machines'),local:homePaths(dataRoot).extensions};
}

export function relativeExtensionFile(name){
  if(typeof name!=='string'||!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(part=>!part||part==='.'||part==='..')
    ||/[\x00-\x1f:*?"<>|]/.test(name))throw Error(`Invalid extension file path: ${name}.`);
  return name;
}

const relativeFile=relativeExtensionFile;

function manifestValue(raw,id){
  if(!raw||raw.schema!==MANIFEST_SCHEMA||raw.id!==id||!ID.test(id))throw Error(`Invalid extension manifest for ${id}.`);
  const dependencies=raw.dependencies??[];
  if(!Array.isArray(dependencies))throw Error(`Extension ${id} dependencies must be a list.`);
  const seen=new Set();
  for(const item of dependencies){
    if(!item||Object.keys(item).join()!=='id'||!ID.test(item.id??'')||item.id===id||seen.has(item.id))
      throw Error(`Invalid or duplicate dependency in ${id}.`);
    seen.add(item.id);
  }
  const entries=raw.entries??{};
  if(!entries||typeof entries!=='object'||Array.isArray(entries))throw Error(`Invalid entries in ${id}.`);
  for(const [name,entry] of Object.entries(entries)){
    if(!ID.test(name)||!entry||typeof entry.export!=='string'||!/^[$A-Z_a-z][$\w]*$/.test(entry.export))
      throw Error(`Invalid entry ${name} in ${id}.`);
    relativeFile(entry.file);
    if(!entry.file.endsWith('.mjs'))throw Error(`Entry ${name} in ${id} must name an .mjs file.`);
  }
  const kind=raw.kind??'skill';
  if(!['skill','workspace','machine'].includes(kind))throw Error(`Invalid extension kind: ${kind}.`);
  // A machine extension ships profiles, each named <profile id>.json, and the adapter writing their outputs.
  if(kind==='machine'){
    if(!entries['machine-adapter']||!Array.isArray(raw.machines)||!raw.machines.length
      ||raw.machines.some(name=>!/^[a-z][a-z0-9-]*\.json$/.test(relativeFile(name).split('/').at(-1))))
      throw Error(`Machine extension ${id} needs a machine-adapter entry and its profile files.`);
  }else if(raw.machines||entries['machine-adapter'])throw Error(`Extension ${id} must declare kind machine.`);
  if(kind==='workspace'){
    if(!entries['workspace-runtime'])throw Error(`Workspace ${id} needs a workspace-runtime entry.`);
    if(!raw.workspace||Object.keys(raw.workspace).join()!=='ui')throw Error(`Workspace ${id} needs a UI directory.`);
    relativeFile(raw.workspace.ui);
  }else if(raw.workspace||entries['workspace-runtime'])throw Error(`Extension ${id} must declare kind workspace.`);
  if(raw.license!==undefined&&raw.license!==null&&typeof raw.license!=='string')throw Error(`Invalid license in ${id}.`);
  if(raw.provenance!==undefined&&raw.provenance!==null&&typeof raw.provenance!=='string')throw Error(`Invalid provenance in ${id}.`);
  return {...raw,dependencies,entries};
}

async function filesIn(directory,at=directory){
  const names=[];
  for(const item of await readdir(at,{withFileTypes:true})){
    const file=resolve(at,item.name),name=relative(directory,file).split(sep).join('/');
    relativeFile(name);
    const stat=await lstat(file);
    if(stat.isSymbolicLink())throw Error(`Extension contains a link: ${name}.`);
    if(stat.isDirectory())names.push(...await filesIn(directory,file));
    else if(stat.isFile())names.push(name);
    else throw Error(`Extension contains an unsupported file: ${name}.`);
  }
  return names.sort((a,b)=>a<b?-1:a>b?1:0);
}

async function extensionAt(directory,id){
  const manifest=manifestValue(JSON.parse(await readFile(resolve(directory,'extension.json'),'utf8')),id);
  const names=await filesIn(directory);
  if(!names.includes('SKILL.md'))throw Error(`Extension ${id} has no SKILL.md guidance.`);
  for(const entry of Object.values(manifest.entries))if(!names.includes(entry.file))
    throw Error(`Extension ${id} entry ${entry.file} is absent.`);
  if(manifest.kind==='workspace'&&!names.includes(manifest.workspace.ui+'/index.html'))throw Error(`Workspace ${id} has no UI index.html.`);
  for(const name of manifest.machines??[])if(!names.includes(name))throw Error(`Machine extension ${id} profile ${name} is absent.`);
  const files=await Promise.all(names.map(async path=>({path,bytes:await readFile(resolve(directory,path))})));
  const digest=canonicalHash(files.map(({path,bytes})=>({path,sha256:sha256(bytes)})));
  return {id,directory,manifest,digest,files};
}

async function exists(path){try{await access(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}

// Release defaults live in skills/<id> or machines/<id>.
const bundledDirectory=(roots,id)=>[roots.bundled,roots.machines].map(root=>resolve(root,id))
  .find(directory=>existsSync(resolve(directory,'extension.json')));

export async function readExtension(id,options={}){
  if(!ID.test(id))throw Error(`Invalid extension id: ${id}.`);
  const roots=extensionRoots(options),local=resolve(roots.local,id),bundled=bundledDirectory(roots,id);
  if(await exists(local))return {...await extensionAt(local,id),origin:'local'};
  if(bundled)return {...await extensionAt(bundled,id),origin:'bundled'};
  return null;
}

// Profile id -> the machine extension shipping it. Profiles are chosen by
// synchronous callers, so this reads manifests only; a local copy wins.
export function machineCatalog(options={}){
  const roots=extensionRoots(options),profiles=new Map(),seen=new Set();
  for(const folder of [roots.local,roots.machines]){
    if(!existsSync(folder))continue;
    for(const item of readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
      const file=resolve(folder,item.name,'extension.json');
      if(!item.isDirectory()||!ID.test(item.name)||seen.has(item.name)||!existsSync(file))continue;
      seen.add(item.name);
      const manifest=manifestValue(JSON.parse(readFileSync(file,'utf8')),item.name);
      for(const name of manifest.kind==='machine'?manifest.machines:[]){
        const id=name.split('/').at(-1).slice(0,-'.json'.length);
        if(profiles.has(id))throw Error(`Machine profile ${id} is declared by ${profiles.get(id).extension} and ${item.name}.`);
        profiles.set(id,{extension:item.name,file:resolve(folder,item.name,name)});
      }
    }
  }
  return profiles;
}

export async function listExtensions(options={}){
  const roots=extensionRoots(options),ids=new Set();
  for(const folder of Object.values(roots)){
    if(!await exists(folder))continue;
    for(const item of await readdir(folder,{withFileTypes:true}))
      if(item.isDirectory()&&ID.test(item.name)&&await exists(resolve(folder,item.name,'extension.json')))ids.add(item.name);
  }
  return Promise.all([...ids].sort().map(id=>readExtension(id,options).then(({files,...entry})=>entry)));
}

// Exactly one selected copy exists per id: local wins over release defaults.
// Dependencies are visited in name order. The result is stable across
// filesystem enumeration order.
export async function resolveExtensions(ids,options={}){
  const resolved=[],done=new Set(),visiting=[];
  async function visit(id){
    if(visiting.includes(id))throw Error(`Extension dependency cycle: ${[...visiting,id].join(' -> ')}.`);
    const entry=await readExtension(id,options);
    if(!entry)throw Object.assign(Error(`Required extension ${id} is missing. Import it before regeneration.`),{code:'EXTENSION_MISSING'});
    if(done.has(id))return;
    visiting.push(id);
    for(const dependency of [...entry.manifest.dependencies].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0))
      await visit(dependency.id);
    visiting.pop();done.add(id);
    const {files,...summary}=entry;resolved.push(summary);
  }
  for(const id of [...new Set(ids)].sort())await visit(id);
  return resolved;
}

export async function loadExtensionEntry(id,name,options={}){
  const resolved=await resolveExtensions([id],options),selected=resolved.at(-1),entry=selected.manifest.entries[name];
  if(!entry)throw Error(`Extension ${id} has no ${name} entry.`);
  for(const item of resolved){
    const loaded=loadedDigests.get(item.directory);
    if(loaded&&loaded!==item.digest)throw Error(`Extension ${item.id} changed while SAAM is running. Restart SAAM to use its new scripts.`);
  }
  const module=await import(pathToFileURL(resolve(selected.directory,entry.file)).href);
  if(typeof module[entry.export]!=='function')throw Error(`Extension ${id} entry ${entry.file} does not export ${entry.export}.`);
  loadedDigests.set(selected.directory,selected.digest);
  return module[entry.export];
}

export async function exportExtension(id,packageFile,options={}){
  const entry=await readExtension(id,options);
  if(!entry)throw Error(`Extension ${id} is missing.`);
  const document={schema:PACKAGE_SCHEMA,manifest:entry.manifest,digest:entry.digest,
    files:entry.files.map(({path,bytes})=>({path,sha256:sha256(bytes),base64:bytes.toString('base64')}))};
  await writeFile(packageFile,canonicalJson(document)+'\n',{flag:'wx'});
  return {id,digest:entry.digest,file:resolve(packageFile),files:document.files.length};
}

async function installFiles(id,files,options){
  const destination=resolve(extensionRoots(options).local,id);
  if(await exists(destination)){
    const installed=await extensionAt(destination,id);
    const digest=canonicalHash(files.map(({path,bytes})=>({path,sha256:sha256(bytes)})));
    if(installed.digest===digest)return {...installed,origin:'local',unchanged:true};
    throw Error(`Local extension ${id} has changes. Keep it, or move it aside before importing another copy.`);
  }
  await mkdir(dirname(destination),{recursive:true});
  const workspace=await createTemporaryWorkspace('extension'),prepared=resolve(workspace.directory,'entry');
  const staging=resolve(dirname(destination),`.${id}-${randomUUID()}.installing`);
  try{
    await mkdir(prepared);
    for(const {path,bytes} of files){
      const target=resolve(prepared,...path.split('/'));
      await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});
    }
    // Publication stays on the destination volume; preparation lives in tmp.
    await cp(prepared,staging,{recursive:true,force:false,errorOnExist:true});
    await rename(staging,destination);
  }finally{try{await rm(staging,{recursive:true,force:true});}finally{await workspace.release();}}
  return {...await extensionAt(destination,id),origin:'local',unchanged:false};
}

// Import checks all bytes before writing anything and never evaluates scripts.
export async function importExtension(packageFile,options={}){
  const document=JSON.parse(await readFile(packageFile,'utf8'));
  if(document?.schema!==PACKAGE_SCHEMA)throw Error('Unsupported extension package.');
  const id=document.manifest?.id,manifest=manifestValue(document.manifest,id);
  if(!Array.isArray(document.files)||!DIGEST.test(document.digest??''))throw Error('Invalid extension package files or digest.');
  const names=new Set(),files=[];
  for(const record of document.files){
    const path=relativeFile(record?.path);
    if(names.has(path)||!DIGEST.test(record.sha256??'')||typeof record.base64!=='string'||!/^([A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.base64))
      throw Error(`Invalid or duplicate package file: ${path}.`);
    names.add(path);
    const bytes=Buffer.from(record.base64,'base64');
    if(sha256(bytes)!==record.sha256)throw Error(`Package file changed: ${path}.`);
    files.push({path,bytes});
  }
  files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  if(!names.has('SKILL.md')||!names.has('extension.json')
    ||canonicalJson(manifestValue(JSON.parse(files.find(file=>file.path==='extension.json').bytes.toString('utf8')),id))!==canonicalJson(manifest))
    throw Error(`Extension ${id} package manifest or guidance is missing.`);
  for(const entry of Object.values(manifest.entries))if(!names.has(entry.file))throw Error(`Extension ${id} entry ${entry.file} is absent.`);
  if(manifest.kind==='workspace'&&!names.has(manifest.workspace.ui+'/index.html'))throw Error(`Workspace ${id} has no UI index.html.`);
  for(const name of manifest.machines??[])if(!names.has(name))throw Error(`Machine extension ${id} profile ${name} is absent.`);
  const digest=canonicalHash(files.map(({path,bytes})=>({path,sha256:sha256(bytes)})));
  if(digest!==document.digest)throw Error(`Extension ${id} package digest changed.`);
  const installed=await installFiles(id,files,options);
  return {id,digest,origin:installed.origin,unchanged:installed.unchanged};
}

// Builders edit this user-owned copy. Subsequent release updates replace only
// the bundled directory, so local changes remain selected.
export async function checkoutExtension(id,options={}){
  const roots=extensionRoots(options),bundled=bundledDirectory(roots,id);
  const local=resolve(roots.local,id);
  if(await exists(local)){
    const selected=await extensionAt(local,id);
    return {id,digest:selected.digest,directory:selected.directory,alreadyLocal:true};
  }
  if(!bundled)throw Error(`Bundled extension ${id} is missing.`);
  const entry=await extensionAt(bundled,id);
  const installed=await installFiles(id,entry.files,options);
  return {id,digest:installed.digest,directory:installed.directory,alreadyLocal:false};
}
