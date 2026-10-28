import {readFile,readdir,realpath,stat} from 'node:fs/promises';
import {resolve,relative,basename} from 'node:path';
import {summary} from './summary.mjs';
import {bundleIdSchema} from './identity.mjs';
import {bundleInstance} from './studio-ownership.mjs';
import {recipeDefaults} from './plan.mjs';
import {intersectRequest} from './geometry-tools.mjs';
import {machineLabel} from './revisions.mjs';
import {installedMachine} from '../machine/profile.mjs';
// A listed print names its machine by the installed profile, else by its label.
const labelledMachine=id=>id?installedMachine(id)??{id,name:id}:null;

export async function printName(directory,plan){
  if(!plan)try{plan=JSON.parse(await readFile(resolve(directory,'plan.json'),'utf8'));}catch{return basename(directory);}
  function named(g){return g?.shape==='extension'&&g.label?g.label:null;}
  const g=plan.geometry?.shape==='spatial'?plan.geometry.solid:plan.geometry;
  const handle=g?.shape==='assembly'&&g.parts?.find(p=>p.id==='fin');
  if(handle)return named(handle.geometry)?'Named handle · '+named(handle.geometry):'Handle';
  return named(g)?'Named part · '+named(g):basename(directory);
}

// Prints this Bundle reads: shell plans and wedge plans (a shell plan whose retired geometry is its saved mesh).
const bundlePlan=(dir,plan)=>[undefined,'saam-shell-plan/1','saam-wedge-plan/1'].includes(plan.schema);
// The native library view and CLI discovery share the same enumeration query.
// A caller may list other print kinds it reads itself; accepts is code, never a path supplied by a print.
export async function listPrints(libraryRoot,accepts=bundlePlan){
  const prints=[];
  async function walk(dir){
    let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
    if(entries.some(entry=>entry.name==='plan.json'&&entry.isFile())){
      try{
        const document=JSON.parse(await readFile(resolve(dir,'plan.json'),'utf8')),{bundle,...plan}=document;
        const machine=bundle?labelledMachine(machineLabel(bundle)):JSON.parse(await readFile(resolve(dir,'machine.json'),'utf8'));
        if(await accepts(dir,plan))prints.push({path:dir,name:await printName(dir,plan),machine:machine?.name??'No printer selected',machineId:machine?.id??null,modified:(await stat(resolve(dir,'plan.json'))).mtime.toISOString()});
      }catch{/* One damaged bundle must not hide the other prints. */}
      return;
    }
    for(const entry of entries)if(entry.isDirectory()&&!entry.name.startsWith('.'))await walk(resolve(dir,entry.name));
  }
  await walk(resolve(libraryRoot));return prints.sort((a,b)=>b.modified.localeCompare(a.modified));
}

// Caller admits the bundle identity/path. Bundle owns its captured value reads;
// no command escapes this query surface.
export function createBundleViewQueries({directory,libraryRoot,commandResults}){
  async function readBundle(bundleId,{program='source',kind}={}){
    if(kind!==undefined&&kind!=='shell')throw Error('Unknown captured Bundle kind.');
    // A just-created part carries its known owner kind; Bundle reads every part.
    const dir=await directory(bundleId),bundle=await import('./bundle.mjs');
    return {dir,state:await bundle.loadBundle(dir,{program})};
  }
  return {
    recipeDefaults,
    readBundle,
    async getBundleCommandResult({bundleId,id}){
      // A failed creation or subsequently removed part can still have a report.
      // Caller/target authority is admitted by entry; the store validates the
      // Bundle identity without creating or reading a current part directory.
      return commandResults.read({bundleId,id});
    },
    async intersectGeometry({bundleId,request}){
      return intersectRequest(bundleId===undefined?null:(await readBundle(bundleId,{program:false})).dir,request);
    },
    async checkBundle({bundleId}){
      const {state}=await readBundle(bundleId);
      return {...summary(bundleId,state),checked:[...(state.geometry?['geometry']:[]),'plan',...(state.program?['saved-neutral-toolpath']:[])],physicalValidation:'not performed'};
    },
    async listBundles(){
      const result=[];
      let base;
      try{base=await realpath(libraryRoot);}catch(error){if(error.code==='ENOENT')return [];throw error;}
      for(const entry of await listPrints(base)){
        const bundleId=relative(base,entry.path).replaceAll('\\','/');
        if(!bundleIdSchema.safeParse(bundleId).success)continue;
        try{await directory(bundleId);result.push({bundleId,name:entry.name,machine:entry.machine,modified:entry.modified,programChecked:false});}
        catch(error){result.push({bundleId,error:error.message});}
      }
      return result;
    },
    async getBundle({bundleId,includeGeometry=false}){
      const {state}=await readBundle(bundleId),plan=structuredClone(state.plan);
      if(!includeGeometry)delete plan.geometry;
      return {...summary(bundleId,state),plan,planComplete:includeGeometry||!state.plan.geometry,
        ...(!includeGeometry&&state.geometry?{geometry:{omitted:true,shape:state.plan.geometry?.shape??'unknown',nativeFile:state.geometry.nativeFile,boundsMm:state.geometry.boundsMm}}:{})};
    },
    async getBundleInstance({bundleId}){
      const record=await bundleInstance(await directory(bundleId));
      return {bundleId,instance:record?{instanceId:record.instanceId,ownerId:record.ownerId,pid:record.pid,startedAt:record.startedAt}:null};
    },
    async readSnapshot(bundleId){
      const dir=await directory(bundleId),bundle=await import('./bundle.mjs');
      return (await bundle.loadBundleSnapshot(dir,{program:false})).state;
    },
    summary
  };
}
