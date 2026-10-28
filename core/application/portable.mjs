// Bundle input exchange: saved geometry remains viewable; outputs are regenerated.
import {createHash,randomUUID} from 'node:crypto';
import {lstat,mkdir,cp,copyFile,link,readFile,realpath,rm,writeFile,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {packZip,unpackZip} from '../export/zip.mjs';
import {writeNewFile} from '../file-write.mjs';
import {loadBundle} from '../print/bundle.mjs';
import {createPart} from './part-execution.mjs';
import {machineLabel} from '../print/revisions.mjs';
import {geometryTree} from '../../skills/records.mjs';
import {withBundleInstance,requireBundleInstance} from '../print/studio-ownership.mjs';
import {recordBundleRuntime} from '../print/bundle-runtime.mjs';
import {requiredExtensionIds} from '../path/extension-dependencies.mjs';
import {relativePackageFile} from '../package-path.mjs';
import {checkedPlacementOrigins} from '../print/placement-intent.mjs';

const SCHEMA='saam-print-package/1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value)+'\n');

function portableName(name){
  relativePackageFile(name,'extension');
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

// The one sentence for each source-provenance problem; null when consistent.
function sourceProblem(document,files){
  const provenance=files.get('geometry/source.json'),sources=sourceRecords(document.geometry);
  if(provenance){
    const source=JSON.parse(provenance);
    if(source?.format!=='stl'||source.sha256!==hash(files.get('geometry/source.stl')??Buffer.alloc(0)))return 'Source provenance differs from the retained STL.';
    sources.push(source);
  }
  if(new Set(sources.map(source=>source.sha256)).size>1)
    return 'This bundle records multiple distinct STL sources, but retains only geometry/source.stl.';
  return null;
}
function checkSources(document,files){
  const problem=sourceProblem(document,files);
  if(problem)throw Error(problem+(problem.startsWith('This bundle')?' Supply a self-contained source recipe before sharing.':''));
}


const captures=new WeakMap(),capsules=new WeakMap(),candidates=new WeakMap();
function captured(map,handle){const value=map.get(handle);if(!value)throw Error('Unknown portable Bundle value.');return value;}

export async function readPortableInputs(directory,options={}){
  options.progress?.({stage:'Reading editable bundle inputs'});
  const state=await loadBundle(directory,{program:false});
  const document={...state.plan,bundle:{schema:'saam-print-bundle/2',machineId:state.machineId,
    ...(state.placementOrigins!==undefined?{placementOrigins:checkedPlacementOrigins(state.placementOrigins)}:{})}};
  const files=new Map([['plan.json',json(document)]]);
  for(const name of inputNames(document).slice(1))files.set(name,await readInput(state.dir,name));
  try{
    const provenance=await readInput(state.dir,'geometry/source.json');files.set('geometry/source.json',provenance);
    if(!files.has('geometry/source.stl'))files.set('geometry/source.stl',await readInput(state.dir,'geometry/source.stl'));
  }catch(error){if(error.code!=='ENOENT')throw error;}
  checkSources(document,files);
  // Repair provenance keeps the original input and report, but a repaired copy
  // already stored as geometry/source.stl need not be shipped twice.
  for(const name of ['repair/original.stl','repair/repair.json']){
    try{files.set(name,await readInput(state.dir,name));}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  checkRepairProvenance(files);
  const handle=Object.freeze({id:randomUUID(),requiredExtensionIds:requiredExtensionIds(state.plan)});
  captures.set(handle,{directory,state,files,document});return handle;
}
export async function writePortableArchive(handle,packages,packageFile,options={}){
  const {directory,state,files:sourceFiles}=captured(captures,handle),files=new Map(sourceFiles);
  for(const extension of packages){
    const record=JSON.parse(extension.bytes);if(record.digest!==extension.digest)throw Error(`Selected extension ${extension.id} changed during sharing.`);
    validateExtensionPaths(record);files.set(`extensions/${extension.id}.json`,extension.bytes);
  }
  if((await loadBundle(directory,{program:false})).revision!==state.revision)throw Error('The bundle changed during sharing. Retry with the current revision.');
  const inventory=[...files].map(([path,bytes])=>({path,sha256:hash(bytes),bytes:bytes.length}));
  const metadata={schema:files.has('geometry/source.json')?'saam-print-package/2':SCHEMA,extensions:packages.map(({id,digest,manifest})=>({id,digest,version:manifest.version??null,file:`extensions/${id}.json`})),files:inventory};
  files.set('package.json',json(metadata));options.progress?.({stage:'Building portable ZIP'});
  const bytes=packZip(files);await options.beforeCommit?.();await writeNewFile(resolve(packageFile),bytes);
  return {file:resolve(packageFile),bytes:bytes.length,files:inventory.map(item=>item.path),extensions:metadata.extensions,revision:state.revision,outputs:'Regenerate toolpaths and review before exporting.'};
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

function repairProblem(files){
  const original=files.get('repair/original.stl'),report=files.get('repair/repair.json');
  if(Boolean(original)!==Boolean(report))return 'Repair provenance needs both original STL and repair report.';
  if(report){
    const record=JSON.parse(report);
    if(record.sourceSha256!==hash(original)||record.repairedSha256!==hash(files.get('geometry/source.stl')??Buffer.alloc(0)))
      return 'Repair provenance differs from the retained original/repaired source.';
  }
  return null;
}
function checkRepairProvenance(files){const problem=repairProblem(files);if(problem)throw Error(problem);}

// Integrity (listed bytes, paths, extension identities, required inputs) is
// checked; saved review state, unrelated listed files and inconsistent source
// or repair provenance are left out and named in notes.
function validatePackage(files){
  const metadata=JSON.parse(files.get('package.json')??'null');
  if(![SCHEMA,'saam-print-package/2'].includes(metadata?.schema)||!Array.isArray(metadata.files)||!Array.isArray(metadata.extensions))throw Error('Unsupported bundle package.');
  const names=new Set(['package.json']);
  for(const item of metadata.files){
    distinctName(names,item.path);
    const bytes=files.get(item.path);
    if(!bytes||bytes.length!==item.bytes||hash(bytes)!==item.sha256)throw Error(`Package input changed: ${item.path}.`);
  }
  if(names.size!==files.size)throw Error('Bundle package contains unlisted files.');
  const saved=JSON.parse(files.get('plan.json')??'null'),notes=[];
  if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('Bundle package has no readable plan.');
  const {bundle:savedBundle,...recipe}=saved,placementOrigins=checkedPlacementOrigins(savedBundle?.placementOrigins),document={...recipe,bundle:{schema:'saam-print-bundle/2',machineId:machineLabel(savedBundle),
    ...(placementOrigins!==undefined?{placementOrigins}:{})}};
  if(Object.keys(savedBundle??{}).some(key=>!['machine','machineId','schema','placementOrigins'].includes(key)))notes.push('Saved review results and other bundle state in the package were not imported.');
  const expected=new Set(inputNames(document));
  if(metadata.schema==='saam-print-package/2'){
    expected.add('geometry/source.stl');
    if(files.has('geometry/source.json'))expected.add('geometry/source.json');else notes.push('The package has no source provenance record; the STL was imported without it.');
  }
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
  if([...expected].some(name=>!files.has(name)))throw Error('Bundle package input inventory is incomplete.');
  const unrelated=metadata.files.map(item=>item.path).filter(name=>!expected.has(name));
  if(unrelated.length)notes.push(`Package files that are not bundle inputs were not imported: ${unrelated.join(', ')}.`);
  const source=sourceProblem(document,files),repair=repairProblem(files);
  if(source){notes.push(source+' The source provenance record was not imported.');files.delete('geometry/source.json');}
  if(repair){notes.push(repair+' The repair record was not imported.');files.delete('repair/original.stl');files.delete('repair/repair.json');}
  return {metadata,document,notes};
}


export async function readPortableAsset(asset,options={}){
  options.progress?.({stage:'Validating portable ZIP inputs'});
  const bytes=await readFile(asset.path);
  if(bytes.length!==asset.byteLength||hash(bytes)!==asset.sha256)throw Error('Acquired portable source changed; no result accepted.');
  const files=readArchive(bytes),value={...validatePackage(files),files};
  const handle=Object.freeze({id:randomUUID(),requiredExtensionIds:requiredExtensionIds(value.document),
    extensions:value.metadata.extensions.map(record=>({...record,bytes:Buffer.from(files.get(record.file))}))});
  capsules.set(handle,value);return handle;
}

export async function admitPortablePart(capsule,directory,options={}){
  const {metadata,document,notes,files}=captured(capsules,capsule),target=resolve(directory),parent=dirname(target);
  async function requireCreationDestination(){
    if(!options.instance?.token)throw Error('Import destination already exists. Choose a new bundle directory.');
    await withBundleInstance(target,options.instance,()=>requireBundleInstance(target));
    const names=await readdir(target);if(names.some(name=>name!=='.bundle-studio.json'))throw Error('Import destination already contains files. Choose a new bundle directory.');
  }
  try{await lstat(target);await requireCreationDestination();}catch(error){if(error.code!=='ENOENT')throw error;}
  const scratch=options.workspace,staging=resolve(scratch,'bundle');
  await mkdir(parent,{recursive:true});
  const handle=Object.freeze({id:randomUUID()});
  candidates.set(handle,{target,parent,staging,scratch,metadata,document,notes,files,options,requireCreationDestination,destination:{created:false,completed:false}});
  return handle;
}
export async function preparePortablePart(handle){
  const candidate=captured(candidates,handle),{staging,document,notes,files,options}=candidate;
  await mkdir(staging);
  for(const name of [...new Set(inputNames(document).slice(1).concat(['geometry/source.stl','geometry/source.json','repair/original.stl','repair/repair.json'].filter(name=>files.has(name))))]){
    const file=resolve(staging,...name.split('/'));await mkdir(dirname(file),{recursive:true});await writeFile(file,files.get(name),{flag:'wx'});
  }
  options.progress?.({stage:'Reconstructing bundle geometry'});
  for(const geometry of geometryTree(document.geometry))delete geometry.compiledHash;
  await createPart(staging,document,{sourceBytes:files.get('geometry/source.stl'),notes});
  const state=await loadBundle(staging,{program:false});
  candidate.prepared={revision:state.revision,editRevision:state.editRevision};
}
export async function claimPortableDestination(handle){
  const value=captured(candidates,handle),{options,target,destination,requireCreationDestination}=value;
  await options.beforeCommit?.();
  if(options.instance)await requireCreationDestination();else await mkdir(target);
  destination.created=true;
}
export async function publishPortablePart(handle,selectedExtensions){
  const {target,staging,notes,files,destination,prepared}=captured(candidates,handle);
  if(!destination.created)throw Error('Portable Bundle destination has not been claimed.');
  if(!prepared)throw Error('Portable Bundle candidate has not been prepared.');
  for(const name of ['geometry','repair']){
    try{await cp(resolve(staging,name),resolve(target,name),{recursive:true,force:false,errorOnExist:true});}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  await recordBundleRuntime(target);
  const publication=resolve(target,'plan.json.publishing');
  await copyFile(resolve(staging,'plan.json'),publication,constants.COPYFILE_EXCL);
  try{await link(publication,resolve(target,'plan.json'));}
  catch(error){if(!['ENOTSUP','EOPNOTSUPP','EPERM'].includes(error.code))throw error;await copyFile(publication,resolve(target,'plan.json'),constants.COPYFILE_EXCL);}
  // This exclusive publication is the saved-part fact. Later cleanup/read
  // failures cannot make its revision disappear or make repetition safe.
  destination.completed=true;
  destination.publication=Object.freeze({directory:target,...prepared});
  let unfinishedStep='remove-publication-staging',state;
  try{
    await rm(publication);
    unfinishedStep='load-published-bundle';
    state=await loadBundle(target,{program:false});
  }catch(error){error.committedBundle=destination.publication;error.unfinishedStep=unfinishedStep;throw error;}
  return {directory:target,revision:state.revision,editRevision:state.editRevision,files:[...files.keys()].filter(name=>name!=='package.json'),extensions:selectedExtensions,artifacts:state.artifacts,...(notes.length?{notes}:{}),next:'Open this directory in Studio; edit and regenerate before review/export.'};
}
export function portablePartPublication(handle){return captured(candidates,handle).destination.publication??null;}
export async function abandonPortablePart(handle){
  const {staging,scratch,target,parent,destination}=captured(candidates,handle);
  if(staging!==resolve(scratch,'bundle'))throw Error('Invalid bundle import staging directory.');
  let failure;
  try{await rm(staging,{recursive:true,force:true});}catch(error){failure=error;}
  if(destination.created&&!destination.completed){
    try{
      const actual=await realpath(target);
      if(actual!==target||dirname(actual)!==parent)throw Error('Incomplete import destination changed; cleanup refused.');
      await rm(target,{recursive:true,force:true});
    }catch(error){if(!failure)failure=error;else failure.cleanupError=error.message;}
  }
  candidates.delete(handle);
  if(failure)throw failure;
}
