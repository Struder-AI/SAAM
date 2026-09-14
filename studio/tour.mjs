import {readFile,writeFile,mkdir,rename,stat,realpath,unlink} from 'node:fs/promises';
import {resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {TOUR_VERSION,TOUR_DEMOS,TOUR_STEPS} from './tour-catalog.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),packages=resolve(root,'examples/prints');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async file=>JSON.parse(await readFile(file,'utf8'));
async function optional(file){try{return await json(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function save(file,value){await mkdir(dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2)+'\n');await rename(temp,file);}
function demo(id){if(!TOUR_DEMOS.some(d=>d.id===id))throw Error('Unknown tour example');return resolve(packages,id);}
const packageCache=new Map();
async function prepared(id){if(!packageCache.has(id))packageCache.set(id,json(resolve(demo(id),'prepared/manifest.json')).then(value=>{if(value.version!==TOUR_VERSION||value.id!==id||!value.files?.['plan.json'])throw Error('Unsupported packaged example');return value;}));return packageCache.get(id);}
const validPath=name=>typeof name==='string'&&!name.includes('\\')&&!name.includes(':')&&!name.startsWith('/')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..');
export async function tourReference(directory){
  const marker=await optional(resolve(directory,'.tour-reference.json'));if(!marker||marker.version!==TOUR_VERSION||!TOUR_DEMOS.some(d=>d.id===marker.id))return null;
  const manifest=await prepared(marker.id);
  for(const [name,digest]of Object.entries(manifest.files)){
    if(!validPath(name))throw Error('Invalid packaged example path');
    let bytes;try{bytes=await readFile(resolve(directory,name));}catch(e){if(e.code==='ENOENT')return null;throw e;}
    if(hash(bytes)!==digest)return null;
  }
  return {id:marker.id,version:TOUR_VERSION,manifest,base:resolve(demo(marker.id),'prepared')};
}
export function referenceAdapter(live){
  return {...live,async loadBundle(directory,options={}){
    const ref=await tourReference(directory);if(!ref)return live.loadBundle(directory,options);
    if(options.allSources||options.sourceFile)throw Error('Choose Use this example before preparing manufacturing output.');
    const bytes=await readFile(resolve(ref.base,'state.json'));if(hash(bytes)!==ref.manifest.stateHash)throw Error('Packaged example state changed');
    const state=JSON.parse(bytes);
    Object.assign(state,{geometryApproved:false,planApproved:false,toolpathApproved:false,referencePreview:{id:ref.id,version:ref.version},localPrintDirectory:directory});
    if(options.program===false)delete state.program;
    return state;
  },async bundleFingerprint(directory){return hash(await readFile(resolve(directory,'plan.json')))+await live.bundleFingerprint(directory)+((await tourReference(directory))?'reference':'live');},
  ...Object.fromEntries(['approve','generateBundle','deliver','updatePlan'].map(method=>[method,async(directory,...args)=>{
    if(await tourReference(directory))throw Error('Choose Use this example before editing or reviewing it for printing.');
    return live[method](directory,...args);
  }]))};
}
export async function previewBytes(directory){const ref=await tourReference(directory);if(!ref)throw Error('This example changed. Reopen it before continuing.');const bytes=await readFile(resolve(ref.base,'display.bin.gz'));if(hash(bytes)!==ref.manifest.displayHash)throw Error('Packaged example display changed');return bytes;}
export async function useExample(directory){await unlink(resolve(directory,'.tour-reference.json'));}
export function createTour(libraryRoot){
  const library=resolve(libraryRoot),progress=resolve(library,'.tour-progress.json');
  const initial=()=>({version:TOUR_VERSION,step:0,active:false,completed:false,copies:{}});
  async function read(){const value=await optional(progress);if(value?.version!==TOUR_VERSION)return initial();return {...initial(),step:Number.isInteger(value.step)&&TOUR_STEPS[value.step]?value.step:0,active:value.active===true,completed:value.completed===true,copies:value.copies&&typeof value.copies==='object'?value.copies:{}};}
  async function ensure(id,data,{fresh=false}={}){
    demo(id);const base=resolve(library,'tour');await mkdir(base,{recursive:true});
    // Confine copies even when a user has configured a symlinked library.
    const realBase=await realpath(base),realLibrary=await realpath(library);
    if(realBase!==realLibrary&&!realBase.startsWith(realLibrary+sep))throw Error('The tour folder must stay inside the Prints library.');
    if(!fresh&&validPath(data.copies[id])){const existing=resolve(base,data.copies[id]);try{const realExisting=await realpath(existing);if(!realExisting.startsWith(realBase+sep))throw Error('The saved example must stay inside the tour folder.');await stat(resolve(existing,'plan.json'));if(await tourReference(existing))return existing;}catch(e){if(e.code!=='ENOENT')throw e;}}
    let name=id,index=1,directory;
    for(;;){directory=resolve(base,name);try{await mkdir(directory);break;}catch(e){if(e.code!=='EEXIST')throw e;name=id+'-'+(++index);}}
    const manifest=await prepared(id);
    for(const [file,digest]of Object.entries(manifest.files)){
      if(!validPath(file))throw Error('Invalid packaged example path');
      const source=resolve(demo(id),'prepared/bundle',file),bytes=await readFile(source);
      if(hash(bytes)!==digest)throw Error('Packaged example changed: '+id);
      const target=resolve(directory,file);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);
    }
    await save(resolve(directory,'.tour-reference.json'),{id,version:TOUR_VERSION});data.copies[id]=relative(base,directory).split(sep).join('/');return directory;
  }
  return {
    async info(){return read();},
    async landing(){const data=await read(),step=TOUR_STEPS[data.step]??TOUR_STEPS[0],directory=await ensure(step.demo,data);await save(progress,data);return directory;},
    async action(action,step){const data=await read();let directory;
      if(action==='pause')data.active=false;
      else if(action==='finish'){data.active=false;data.completed=true;}
      else if(action==='step'||action==='resume'||action==='fresh'){
        const index=action==='resume'?data.step:action==='fresh'?0:step;
        if(!Number.isInteger(index)||!TOUR_STEPS[index])throw Error('Unknown tour step');
        if(action==='fresh')data.copies={};
        data.step=index;data.active=true;data.completed=false;directory=await ensure(TOUR_STEPS[index].demo,data,{fresh:action==='fresh'});
      }else throw Error('Unknown tour action');
      await save(progress,data);return {data,directory};
    }
  };
}
