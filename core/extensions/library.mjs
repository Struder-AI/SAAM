import {homePaths} from '../application/home.mjs';
import {relativePackageFile} from '../package-path.mjs';
// Extension exchange and resolution. Release defaults are replaceable; the
// user's copies live beside prints and survive installation updates.
import {createHash,randomUUID} from 'node:crypto';
import {access,lstat,mkdir,cp,open,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
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
const IDENTITY_BUFFER_BYTES=64*1024;

function validBase64(value){
  if(typeof value!=='string'||value.length%4!==0)return false;
  let end=value.length;
  if(value.charCodeAt(end-1)===61)end--;
  if(value.charCodeAt(end-1)===61)end--;
  for(let i=0;i<end;i++){
    const c=value.charCodeAt(i);
    if(!(c>=65&&c<=90||c>=97&&c<=122||c>=48&&c<=57||c===43||c===47))return false;
  }
  return true;
}

export function extensionRoots({appRoot=applicationRoot,dataRoot}={}){
  return {bundled:resolve(appRoot,'skills'),machines:resolve(appRoot,'machines'),local:homePaths(dataRoot).extensions};
}

export function relativeExtensionFile(name){
  return relativePackageFile(name,'extension');
}

const relativeFile=relativeExtensionFile;

function validateAttribution(raw,id){
  const credits=raw.credits??[];
  if(!Array.isArray(credits)||credits.some(credit=>!credit||typeof credit!=='object'
    ||Object.keys(credit).some(key=>!['name','role'].includes(key))
    ||typeof credit.name!=='string'||!credit.name.trim()||typeof credit.role!=='string'||!credit.role.trim()))
    throw Error(`Extension ${id} credits need named contributors and roles.`);
  const support=raw.support??null;
  if(support!==null&&(!support||typeof support!=='object'||Array.isArray(support)
    ||Object.keys(support).some(key=>!['status','maintainer','scope'].includes(key))
    ||!['community','supported','unsupported','unspecified'].includes(support.status)
    ||support.maintainer!==null&&typeof support.maintainer!=='string'
    ||typeof support.scope!=='string'))throw Error(`Extension ${id} support needs status, maintainer and scope.`);
}

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
  }else if(raw.machines||entries['machine-adapter']||entries['machine-kinematics'])throw Error(`Extension ${id} must declare kind machine.`);
  if(kind==='workspace'){
    if(!entries['workspace-runtime'])throw Error(`Workspace ${id} needs a workspace-runtime entry.`);
    if(!raw.workspace||Object.keys(raw.workspace).join()!=='ui')throw Error(`Workspace ${id} needs a UI directory.`);
    relativeFile(raw.workspace.ui);
  }else if(raw.workspace||entries['workspace-runtime'])throw Error(`Extension ${id} must declare kind workspace.`);
  if(raw.license!==undefined&&raw.license!==null&&typeof raw.license!=='string')throw Error(`Invalid license in ${id}.`);
  if(raw.provenance!==undefined&&raw.provenance!==null&&typeof raw.provenance!=='string')throw Error(`Invalid provenance in ${id}.`);
  validateAttribution(raw,id);
  return {...raw,dependencies,entries};
}

function manifestText(text,id){
  try{return manifestValue(JSON.parse(text),id);}
  catch(error){throw error instanceof SyntaxError?Error(`Extension ${id} extension.json is not valid JSON: ${error.message}`):error;}
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

async function fileHash(file,buffer){
  const handle=await open(file,'r'),hash=createHash('sha256');
  try{
    for(;;){
      const {bytesRead}=await handle.read(buffer,0,buffer.length,null);
      if(!bytesRead)return hash.digest('hex');
      hash.update(buffer.subarray(0,bytesRead));
    }
  }finally{await handle.close();}
}

async function extensionAt(directory,id,{includeFiles=true,buffer}={}){
  const manifest=manifestText(await readFile(resolve(directory,'extension.json'),'utf8'),id);
  const names=await filesIn(directory);
  if(!names.includes('SKILL.md'))throw Error(`Extension ${id} has no SKILL.md guidance.`);
  for(const entry of Object.values(manifest.entries))if(!names.includes(entry.file))
    throw Error(`Extension ${id} entry ${entry.file} is absent.`);
  if(manifest.kind==='workspace'&&!names.includes(manifest.workspace.ui+'/index.html'))throw Error(`Workspace ${id} has no UI index.html.`);
  for(const name of manifest.machines??[])if(!names.includes(name))throw Error(`Machine extension ${id} profile ${name} is absent.`);
  if(includeFiles){
    const files=await Promise.all(names.map(async path=>({path,bytes:await readFile(resolve(directory,path))})));
    const digest=canonicalHash(files.map(({path,bytes})=>({path,sha256:sha256(bytes)})));
    return {id,directory,manifest,digest,files};
  }
  // Identity queries retain paths/digests, not package contents. One buffer is
  // reused sequentially across every file and, for catalog/closure reads, package.
  buffer??=Buffer.allocUnsafe(IDENTITY_BUFFER_BYTES);
  const records=[];
  for(const path of names)records.push({path,sha256:await fileHash(resolve(directory,path),buffer)});
  return {id,directory,manifest,digest:canonicalHash(records)};
}

async function exists(path){try{await access(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}

// Release defaults live in skills/<id> or machines/<id>.
const bundledDirectory=(roots,id)=>[roots.bundled,roots.machines].map(root=>resolve(root,id))
  .find(directory=>existsSync(resolve(directory,'extension.json')));

async function selectedExtension(id,options,contents){
  if(!ID.test(id))throw Error(`Invalid extension id: ${id}.`);
  const roots=extensionRoots(options),local=resolve(roots.local,id),bundled=bundledDirectory(roots,id);
  const localEntry=await lstat(local).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(localEntry?.isDirectory())return {...await extensionAt(local,id,contents),origin:'local'};
  if(bundled)return {...await extensionAt(bundled,id,contents),origin:'bundled'};
  return null;
}

export async function readExtension(id,options={}){
  return selectedExtension(id,options,{includeFiles:true});
}
export async function readExtensionIdentity(id,options={}){
  return selectedExtension(id,options,{includeFiles:false});
}

// The selected copy of each extension in the given folders, first folder first,
// then name order. A copy that cannot be read is skipped with its reason and the
// others load; using the skipped one still fails with that reason.
const skippedCopy=(extension,origin,error)=>({extension,origin,reason:error.message});
function selectedManifests(folders){
  const selected=[],skipped=[],seen=new Set();
  for(const [origin,folder] of folders){
    if(!existsSync(folder))continue;
    for(const item of readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
      const directory=resolve(folder,item.name),file=resolve(directory,'extension.json');
      if(!item.isDirectory()||!ID.test(item.name)||seen.has(item.name))continue;
      // A local package directory owns its ID even before a usable manifest
      // exists. Bundled skill folders without manifests are not extensions.
      if(origin!=='local'&&!existsSync(file))continue;
      seen.add(item.name);
      try{selected.push({id:item.name,origin,directory,manifest:manifestText(readFileSync(file,'utf8'),item.name)});}
      catch(error){skipped.push(skippedCopy(item.name,origin,error));}
    }
  }
  return {selected,skipped};
}

// Profile id -> the machine extension shipping it. Profiles are chosen by
// synchronous callers, so this reads manifests only; a local copy wins, and a
// profile id declared again is skipped in favour of the first.
export function machineProfileDeclarations(options={}){
  const roots=extensionRoots(options),profiles=new Map();
  const {selected,skipped}=selectedManifests([['local',roots.local],['bundled',roots.machines]]);
  for(const {id:extension,origin,directory,manifest} of selected)for(const name of manifest.machines??[]){
    const id=name.split('/').at(-1).slice(0,-'.json'.length);
    if(profiles.has(id))skipped.push({...skippedCopy(extension,origin,Error(`Machine profile ${id} is already declared by ${profiles.get(id).extension}.`)),profile:id});
    else profiles.set(id,{profileId:id,extension,origin,declaration:name,file:resolve(directory,name),provenance:manifest.provenance??null});
  }
  return {profiles,skipped};
}
// Existing executable-provider callers retain their old catalog shape. This is
// compatibility data selection, not authority to load or execute an entry.
export function machineProfiles(options={}){
  const {profiles,skipped}=machineProfileDeclarations(options);
  return {profiles:new Map([...profiles].map(([id,{extension,file}])=>[id,{extension,file}])),skipped};
}
export const machineCatalog=(options={})=>machineProfiles(options).profiles;

// A machine profile's extension entry as module source, or null when that
// extension has none: Studio serves the machine-kinematics entry to its viewer.
export async function machineEntrySource(machineId,name,options={}){
  const id=machineCatalog(options).get(machineId)?.extension,selected=id?await readExtension(id,options):null,entry=selected?.manifest.entries[name];
  return entry?{exportName:entry.export,bytes:selected.files.find(file=>file.path===entry.file).bytes}:null;
}

// Every selected extension whose contents can be read, without retaining them.
export async function listExtensions(options={}){
  const roots=extensionRoots(options),extensions=[];
  const {selected,skipped}=selectedManifests([['local',roots.local],['bundled',roots.bundled],['bundled',roots.machines]]);
  const buffer=Buffer.allocUnsafe(IDENTITY_BUFFER_BYTES);
  for(const {id,origin,directory} of selected){
    try{extensions.push({...await extensionAt(directory,id,{includeFiles:false,buffer}),origin});}
    catch(error){skipped.push(skippedCopy(id,origin,error));}
  }
  const order=key=>(a,b)=>a[key]<b[key]?-1:a[key]>b[key]?1:0;
  return {extensions:extensions.sort(order('id')),skipped:skipped.sort(order('extension'))};
}

// Exactly one selected copy exists per id: local wins over release defaults.
// Dependencies are visited in name order. The result is stable across
// filesystem enumeration order.
export async function resolveExtensions(ids,options={}){
  const resolved=[],done=new Set(),visiting=[],buffer=Buffer.allocUnsafe(IDENTITY_BUFFER_BYTES);
  async function visit(id){
    if(visiting.includes(id))throw Error(`Extension dependency cycle: ${[...visiting,id].join(' -> ')}.`);
    const entry=await selectedExtension(id,options,{includeFiles:false,buffer});
    if(!entry)throw Object.assign(Error(`Required extension ${id} is missing. Import it before regeneration.`),{code:'EXTENSION_MISSING'});
    if(done.has(id))return;
    visiting.push(id);
    for(const dependency of [...entry.manifest.dependencies].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0))
      await visit(dependency.id);
    visiting.pop();done.add(id);
    resolved.push(entry);
  }
  for(const id of [...new Set(ids)].sort())await visit(id);
  return resolved;
}

// The running module graph and its declared source must agree. A restart
// clears this owned state and makes the changed extension available.
export function extensionRuntimeSourceError(resolved){
  for(const item of resolved){
    const loaded=loadedDigests.get(item.directory);
    if(loaded&&loaded!==item.digest)return {code:'EXTENSION_RELOAD_REQUIRED',message:`Extension ${item.id} changed while SAAM is running; its new scripts load after \`saam reload-runtime\`.`};
  }
  return null;
}

function immutableSelection(value){
  if(value&&typeof value==='object'){
    for(const item of Object.values(value))immutableSelection(item);
    Object.freeze(value);
  }
  return value;
}

// The binding and identity come from the same resolution before module loading.
// The host retains this envelope; extension results cannot replace its identity.
export async function loadExtensionInvocation(id,name,options={}){
  const resolved=await resolveExtensions([id],options),selected=resolved.at(-1),entry=selected.manifest.entries[name];
  if(!entry)throw Error(`Extension ${id} has no ${name} entry.`);
  const unavailable=extensionRuntimeSourceError(resolved);
  if(unavailable)throw Object.assign(Error(unavailable.message),{code:unavailable.code});
  const module=await import(pathToFileURL(resolve(selected.directory,entry.file)).href);
  if(typeof module[entry.export]!=='function')throw Error(`Extension ${id} entry ${entry.file} does not export ${entry.export}.`);
  loadedDigests.set(selected.directory,selected.digest);
  const selection=immutableSelection({schema:'saam-extension-selection/1',extension:id,
    entry:{name,file:entry.file,export:entry.export},
    packages:resolved.map(({id,digest,origin,manifest})=>({id,digest,origin,
      dependencies:manifest.dependencies.map(({id})=>id),
      ...(manifest.license==null?{}:{license:manifest.license}),
      ...(manifest.provenance==null?{}:{provenance:manifest.provenance}),
      ...(manifest.credits?{credits:structuredClone(manifest.credits)}:{})}))});
  return Object.freeze({entry:module[entry.export],selection});
}

export async function loadExtensionEntry(id,name,options={}){
  return (await loadExtensionInvocation(id,name,options)).entry;
}

// Re-reading mutable source can reject a drifted invocation; it must never
// replace the identity captured before execution with today's package identity.
export async function verifyExtensionInvocation(selection,options={}){
  const current=await resolveExtensions([selection.extension],options),entry=current.at(-1).manifest.entries[selection.entry.name];
  if(current.length===selection.packages.length&&current.every((item,i)=>{
    const captured=selection.packages[i];
    return item.id===captured.id&&item.digest===captured.digest&&item.origin===captured.origin;
  })&&entry?.file===selection.entry.file&&entry?.export===selection.entry.export)return;
  throw Object.assign(Error(`Extension ${selection.extension} changed during invocation. Reload the runtime before editing again.`),{code:'EXTENSION_RELOAD_REQUIRED'});
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
    const installed=await extensionAt(destination,id,{includeFiles:false});
    const digest=canonicalHash(files.map(({path,bytes})=>({path,sha256:sha256(bytes)})));
    if(installed.digest===digest)return {...installed,origin:'local',unchanged:true};
    throw Error(`Local extension ${id} has changes. Keep it, or move it aside before importing another copy.`);
  }
  await mkdir(dirname(destination),{recursive:true});
  const workspace=await createTemporaryWorkspace('extension',{paths:homePaths(options.dataRoot)}),prepared=resolve(workspace.directory,'entry');
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
  return {...await extensionAt(destination,id,{includeFiles:false}),origin:'local',unchanged:false};
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
    if(names.has(path)||!DIGEST.test(record.sha256??'')||!validBase64(record.base64))
      throw Error(`Invalid or duplicate package file: ${path}.`);
    names.add(path);
    const bytes=Buffer.from(record.base64,'base64');
    if(sha256(bytes)!==record.sha256)throw Error(`Package file changed: ${path}.`);
    files.push({path,bytes});
  }
  files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  if(!names.has('SKILL.md')||!names.has('extension.json')
    ||canonicalJson(manifestText(files.find(file=>file.path==='extension.json').bytes.toString('utf8'),id))!==canonicalJson(manifest))
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
    const selected=await extensionAt(local,id,{includeFiles:false});
    return {id,digest:selected.digest,directory:selected.directory,alreadyLocal:true};
  }
  if(!bundled)throw Error(`Bundled extension ${id} is missing.`);
  const entry=await extensionAt(bundled,id);
  const installed=await installFiles(id,entry.files,options);
  return {id,digest:installed.digest,directory:installed.directory,alreadyLocal:false};
}
