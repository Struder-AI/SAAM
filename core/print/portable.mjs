// Bundle input exchange: saved geometry remains viewable; outputs are regenerated.
import {createHash} from 'node:crypto';
import {lstat,mkdir,cp,copyFile,link,readFile,realpath,rm,writeFile,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createTemporaryWorkspace} from '../application/temporary-workspace.mjs';
import {dirname,resolve} from 'node:path';
import {packZip,unpackZip} from '../export/zip.mjs';
import {writeNewFile} from '../file-write.mjs';
import {initBundle,loadBundle} from './bundle.mjs';
import {geometryTree} from '../../skills/records.mjs';
import {withBundleInstance,requireBundleInstance} from './studio-ownership.mjs';
import {recordBundleRuntime} from './bundle-runtime.mjs';
import {requiredExtensionIds} from '../path/extension-dependencies.mjs';
import {exportExtension,importExtension,readExtension,resolveExtensions,relativeExtensionFile} from '../extensions/library.mjs';

const SCHEMA='saam-print-package/1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value)+'\n');

function portableName(name){
  relativeExtensionFile(name);
  for(const part of name.split('/'))if(/[. ]$/.test(part)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))
    throw Error(`Nonportable package path: ${name}.`);
  return name;
}

function distinctName(names,name){
  portableName(name);
  const lower=name.toLowerCase();
  if(names.has(lower))throw Error(`Duplicate package path: ${name}.`);
  for(const previous of names)if(previous.startsWith(lower+'/')||lower.startsWith(previous+'/'))
    throw Error(`Conflicting package path: ${name}.`);
  names.add(lower);
}

function checkPathSpellings(paths){
  const spellings=new Map();
  for(const path of paths){
    const parts=path.split('/');
    for(const index of parts.keys()){
      const prefix=parts.slice(0,index+1).join('/'),key=prefix.toLowerCase();
      if(spellings.has(key)&&spellings.get(key)!==prefix)throw Error(`Package path casing conflicts: ${prefix}.`);
      spellings.set(key,prefix);
    }
  }
}


function sourceRecords(value,records=[]){
  if(!value||typeof value!=='object')return records;
  if(value.source?.format==='stl')records.push(value.source);
  for(const child of Object.values(value))if(child&&typeof child==='object')sourceRecords(child,records);
  return records;
}

function inputNames(document){
  const names=['plan.json'];
  if(sourceRecords(document.geometry).length)names.push('geometry/source.stl');
  return names;
}

async function readInput(directory,name){
  portableName(name);
  const target=resolve(directory,...name.split('/'));
  const stat=await lstat(target);
  if(!stat.isFile()||stat.isSymbolicLink())throw Error(`Bundle input is not an ordinary file: ${name}.`);
  // Every parent belongs to the bundle; a symlink may not smuggle outside inputs.
  const parts=name.split('/');
  for(const index of parts.slice(0,-1).keys())if((await lstat(resolve(directory,...parts.slice(0,index+1)))).isSymbolicLink())
    throw Error(`Bundle input uses a linked directory: ${name}.`);
  return readFile(target);
}

function checkSources(document,files){
  const sources=sourceRecords(document.geometry);
  if(new Set(sources.map(source=>source.sha256)).size>1)
    throw Error('This bundle records multiple distinct STL sources, but retains only geometry/source.stl. Supply a self-contained source recipe before sharing.');
}

export async function shareBundle(directory,packageFile,options={}){
  options.progress?.({stage:'Reading editable bundle inputs'});
  const state=await loadBundle(directory,{program:false}),before=state.revision;
  const document={...state.plan,bundle:{schema:'saam-print-bundle/2',machine:state.machine}};
  const files=new Map([['plan.json',json(document)]]);
  for(const name of inputNames(document).slice(1))files.set(name,await readInput(state.dir,name));
  checkSources(document,files);
  // Repair provenance keeps the original input and report, but a repaired copy
  // already stored as geometry/source.stl need not be shipped twice.
  for(const name of ['repair/original.stl','repair/repair.json']){
    try{files.set(name,await readInput(state.dir,name));}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  checkRepairProvenance(files);
  const extensions=await resolveExtensions(requiredExtensionIds(state.plan),options);
  const workspace=options.workspace?null:await createTemporaryWorkspace('portable'),scratch=options.workspace??workspace.directory;
  try{
    options.progress?.({stage:'Packaging selected extensions'});
    for(const extension of extensions){
      const name=`extensions/${extension.id}.json`,target=resolve(scratch,extension.id+'.json');
      await exportExtension(extension.id,target,options);
      const bytes=await readFile(target),record=JSON.parse(bytes);
      if(record.digest!==extension.digest)throw Error(`Selected extension ${extension.id} changed during sharing.`);
      validateExtensionPaths(record);
      files.set(name,bytes);
    }
    if((await loadBundle(directory,{program:false})).revision!==before)throw Error('The bundle changed during sharing. Retry with the current revision.');
    const inventory=[...files].map(([path,bytes])=>({path,sha256:hash(bytes),bytes:bytes.length}));
    const metadata={schema:SCHEMA,extensions:extensions.map(({id,digest,manifest})=>({id,digest,
      version:manifest.version??null,file:`extensions/${id}.json`})),files:inventory};
    files.set('package.json',json(metadata));
    options.progress?.({stage:'Building portable ZIP'});
    const bytes=packZip(files);
    await options.beforeCommit?.();
    await writeNewFile(resolve(packageFile),bytes);
    return {file:resolve(packageFile),bytes:bytes.length,files:inventory.map(item=>item.path),extensions:metadata.extensions,
      revision:state.revision,outputs:'Regenerate toolpaths and review before exporting.'};
  }finally{await workspace?.release();}
}

function readArchive(bytes){
  const files=unpackZip(bytes),names=new Set();
  for(const name of files.keys())distinctName(names,name);
  checkPathSpellings(files.keys());
  return files;
}

function validateExtensionPaths(document){
  if(!Array.isArray(document.files))throw Error('Invalid extension package inventory.');
  const names=new Set();
  for(const file of document.files)distinctName(names,file.path);
  checkPathSpellings(document.files.map(file=>file.path));
}

function checkRepairProvenance(files){
  const original=files.get('repair/original.stl'),report=files.get('repair/repair.json');
  if(Boolean(original)!==Boolean(report))throw Error('Repair provenance needs both original STL and repair report.');
  if(report){
    const record=JSON.parse(report);
    if(record.sourceSha256!==hash(original)||record.repairedSha256!==hash(files.get('geometry/source.stl')??Buffer.alloc(0)))
      throw Error('Repair provenance differs from the retained original/repaired source.');
  }
}

function validatePackage(files){
  const metadata=JSON.parse(files.get('package.json')??'null');
  if(metadata?.schema!==SCHEMA||!Array.isArray(metadata.files)||!Array.isArray(metadata.extensions))throw Error('Unsupported bundle package.');
  const names=new Set(['package.json']);
  for(const item of metadata.files){
    distinctName(names,item.path);
    const bytes=files.get(item.path);
    if(!bytes||bytes.length!==item.bytes||hash(bytes)!==item.sha256)throw Error(`Package input changed: ${item.path}.`);
  }
  if(names.size!==files.size)throw Error('Bundle package contains unlisted files.');
  const document=JSON.parse(files.get('plan.json')??'null');
  if(document?.bundle?.schema!=='saam-print-bundle/2'||!Object.hasOwn(document.bundle,'machine'))
    throw Error('Portable bundles contain inputs only, without review results.');
  if(Object.keys(document.bundle).sort().join()!=='machine,schema')throw Error('Portable bundle metadata contains generated or unrelated state.');
  const expected=new Set(inputNames(document));
  for(const name of ['repair/original.stl','repair/repair.json'])if(files.has(name))expected.add(name);
  const ids=new Set();
  for(const extension of metadata.extensions){
    if(!/^[a-z][a-z0-9-]*$/.test(extension.id??'')||ids.has(extension.id)||extension.file!==`extensions/${extension.id}.json`)
      throw Error('Invalid selected extension inventory.');
    ids.add(extension.id);expected.add(extension.file);
    const record=JSON.parse(files.get(extension.file)??'null');
    if(record?.manifest?.id!==extension.id||record.digest!==extension.digest)throw Error(`Extension ${extension.id} identity changed.`);
    validateExtensionPaths(record);
  }
  for(const id of requiredExtensionIds(document))if(!ids.has(id))throw Error(`Required extension ${id} is absent from the package.`);
  if(expected.size!==metadata.files.length||[...expected].some(name=>!files.has(name)))throw Error('Bundle package input inventory is incomplete or contains unrelated files.');
  checkSources(document,files);
  checkRepairProvenance(files);
  return {metadata,document};
}

export async function importBundle(packageFile,directory,options={}){
  options.progress?.({stage:'Validating portable ZIP inputs'});
  const files=readArchive(await readFile(resolve(packageFile))),{metadata,document}=validatePackage(files);
  const target=resolve(directory),parent=dirname(target);
  async function requireCreationDestination(){
    if(!options.instance?.token)throw Error('Import destination already exists. Choose a new bundle directory.');
    await withBundleInstance(target,options.instance,()=>requireBundleInstance(target));
    const names=await readdir(target);if(names.some(name=>name!=='.bundle-studio.json'))throw Error('Import destination already contains files. Choose a new bundle directory.');
  }
  try{await lstat(target);await requireCreationDestination();}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const workspace=options.workspace?null:await createTemporaryWorkspace('portable'),scratch=options.workspace??workspace.directory;
  await mkdir(parent,{recursive:true});
  const staging=resolve(scratch,'bundle');
  const destination={created:false,completed:false};
  const installedExtensions=[];
  try{
    options.progress?.({stage:'Validating selected extensions'});
    // Ordinary extension import verifies every file without evaluating scripts.
    for(const extension of metadata.extensions){
      const file=resolve(scratch,extension.id+'.json');await writeFile(file,files.get(extension.file),{flag:'wx'});
      await importExtension(file,{...options,dataRoot:resolve(scratch,'validation')});
    }
    const resolved=await resolveExtensions(requiredExtensionIds(document),{...options,dataRoot:resolve(scratch,'validation')});
    if(resolved.some(item=>!metadata.extensions.some(record=>record.id===item.id&&record.digest===item.digest)))
      throw Error('The package does not contain the selected extension dependency closure.');
    const selectedExtensions=metadata.extensions.filter(record=>resolved.some(item=>item.id===record.id));
    for(const extension of selectedExtensions){
      const existing=await readExtension(extension.id,options);
      if(existing?.origin==='local'&&existing.digest!==extension.digest)throw Error(`Local extension ${extension.id} has changes. Keep it, or move it aside before importing another copy.`);
    }
    await mkdir(staging);
    for(const name of inputNames(document).slice(1).concat(['repair/original.stl','repair/repair.json'].filter(name=>files.has(name)))){
      const file=resolve(staging,...name.split('/'));await mkdir(dirname(file),{recursive:true});await writeFile(file,files.get(name),{flag:'wx'});
    }
    // Geometry owns reconstruction from saved ordinary recipes, including inline
    // compiled extension meshes. This does not load selected extension scripts.
    options.progress?.({stage:'Reconstructing bundle geometry'});
    for(const geometry of geometryTree(document.geometry))delete geometry.compiledHash;
    await initBundle(staging,document,{sourceBytes:files.get('geometry/source.stl')});
    await loadBundle(staging,{program:false});
    await options.beforeCommit?.();
    // mkdir is the exclusive destination claim on every supported OS; rename
    // alone could replace a concurrently created empty directory on POSIX.
    if(options.instance)await requireCreationDestination();else await mkdir(target);destination.created=true;
    for(const extension of selectedExtensions)installedExtensions.push(await importExtension(resolve(scratch,extension.id+'.json'),options));
    for(const name of ['geometry','repair']){
      try{await cp(resolve(staging,name),resolve(target,name),{recursive:true,force:false,errorOnExist:true});}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    // The destination was exclusively claimed above. Copy complete bytes to
    // its volume, then publish without replacing any concurrently added file.
    await recordBundleRuntime(target);
    const publication=resolve(target,'plan.json.publishing');
    await copyFile(resolve(staging,'plan.json'),publication,constants.COPYFILE_EXCL);
    try{await link(publication,resolve(target,'plan.json'));}
    catch(error){
      if(!['ENOTSUP','EOPNOTSUPP','EPERM'].includes(error.code))throw error;
      await copyFile(publication,resolve(target,'plan.json'),constants.COPYFILE_EXCL);
    }
    await rm(publication);
    const state=await loadBundle(target,{program:false});
    destination.completed=true;
    return {directory:target,revision:state.revision,editRevision:state.editRevision,files:[...files.keys()].filter(name=>name!=='package.json'),
      extensions:selectedExtensions,artifacts:state.artifacts,
      next:'Open this directory in Studio; edit and regenerate before review/export.'};
  }catch(error){
    // Exact validated library copies remain useful even if publication fails;
    // another bundle may already use them, so failure must never remove them.
    if(installedExtensions.length)error.installedExtensions=installedExtensions;
    throw error;
  }finally{
    if(staging!==resolve(scratch,'bundle'))
      throw Error('Invalid bundle import staging directory.');
    await rm(staging,{recursive:true,force:true});
    await workspace?.release();
    if(destination.created&&!destination.completed){
      const actual=await realpath(target);
      if(actual!==target||dirname(actual)!==parent)throw Error('Incomplete import destination changed; cleanup refused.');
      await rm(target,{recursive:true,force:true});
    }
  }
}
