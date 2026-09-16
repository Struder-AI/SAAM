import {readFile,mkdir,stat,realpath,unlink} from 'node:fs/promises';
import {resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {TOUR_VERSION,TOUR_DECK_VERSION,TOUR_DEMOS,TOUR_STEPS,TOUR_LESSONS as L,tourAgentInstruction} from './tour-catalog.mjs';
import {starterPlan} from '../examples/prints/starter/recipe.mjs';
import {demos} from '../examples/prints/create.mjs';
import {canonical} from '../core/print/plan.mjs';
import {createAgentRequests,workSnapshot} from './agent-requests.mjs';
import {hasPresentedResult,requestActivity} from './work-state.mjs';
import {replaceFile} from '../core/file-write.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),packages=resolve(root,'examples/prints');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async file=>JSON.parse(await readFile(file,'utf8'));
async function optional(file){try{return await json(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function save(file,value){await replaceFile(file,JSON.stringify(value,null,2)+'\n');}
function demo(id){if(!TOUR_DEMOS.some(d=>d.id===id))throw Error('Unknown tour example');return resolve(packages,id);}
const validPath=name=>typeof name==='string'&&!name.includes('\\')&&!name.includes(':')&&!name.startsWith('/')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..');
export async function tourExample(directory){const marker=await optional(resolve(directory,'.tour-reference.json'));return marker?.version===TOUR_VERSION&&(marker.id==='imported'||TOUR_DEMOS.some(d=>d.id===marker.id))?{id:marker.id,version:marker.version}:null;}
export function referenceAdapter(live){
  return {...live,async loadBundle(directory,options={}){
    const example=await tourExample(directory),state=await live.loadBundle(directory,options);
    return example?{...state,tourExample:example,localPrintDirectory:directory}:state;
  },async bundleFingerprint(directory,options){return await live.bundleFingerprint(directory,options)+(options?.presentation?'':Boolean(await tourExample(directory)));},
  ...Object.fromEntries(['approve','generateBundle','deliver'].map(method=>[method,async(directory,...args)=>{
    if(await tourExample(directory)&&method!=='generateBundle'&&!(method==='approve'&&args[0]?.stage==='geometry'))throw Error('Exit the tour before confirming a real print.');
    return live[method](directory,...args);
  }]))};
}
export async function useExample(directory){try{await unlink(resolve(directory,'.tour-reference.json'));}catch(e){if(e.code!=='ENOENT')throw e;}}
export function createTour(libraryRoot,{now=Date.now,ownerId,studioId}={}){
  const library=resolve(libraryRoot),progress=resolve(library,'.tour-progress.json'),base=resolve(library,'tour');
  const requests=createAgentRequests(library,{now,ownerId});
  let playbackAt=null;
  const initial=()=>({imports:[],version:TOUR_VERSION,deckVersion:TOUR_DECK_VERSION,runId:null,lessonId:null,step:0,active:false,completed:false,copies:{},selected:null,gates:{},baseline:null,watchedMs:0,startAt:null,repairReviewRequired:false});
  async function read(){const value=await optional(progress);return value?.deckVersion===TOUR_DECK_VERSION&&value.runId?{...initial(),...value}:initial();}
  const scope=data=>({runId:data.runId,lessonId:data.lessonId});
  const studioOwner=()=>studioId?{instanceId:studioId}:null;
  async function confined(name){
    if(!validPath(name))throw Error('Invalid saved tour path');
    const [realBase,target]=await Promise.all([realpath(base),realpath(resolve(base,name))]);
    if(!target.startsWith(realBase+sep))throw Error('The saved example must stay inside the tour folder.');
    return target;
  }
  async function ensure(id,data){
    demo(id);await mkdir(base,{recursive:true});
    const [realBase,realLibrary]=await Promise.all([realpath(base),realpath(library)]);
    if(!realBase.startsWith(realLibrary+sep))throw Error('The tour folder must stay inside the Prints library.');
    if(data.copies[id])try{const existing=await confined(data.copies[id]);await stat(resolve(existing,'plan.json'));return existing;}catch(e){if(e.code!=='ENOENT')throw e;}
    const title=id==='starter'?'handle':id==='surface-drape'?'wavy-roof':id;
    let name=title,index=1,directory;
    for(;;){directory=resolve(base,name);try{await mkdir(directory);break;}catch(e){if(e.code!=='EEXIST')throw e;name=title+'-'+(++index);}}
    const recipe=id==='starter'?{plan:starterPlan,machineId:'ultimaker-s5'}:demos[id];
    const {initBundle}=await import('../core/print/bundle.mjs');
    await initBundle(directory,recipe.plan(),{machineId:recipe.machineId});
    await save(resolve(directory,'.tour-reference.json'),{id,version:TOUR_VERSION});data.copies[id]=name;return directory;
  }
  async function signature(data){
    if(!data.selected)return null;
    const dir=await confined(data.selected),plan=await json(resolve(dir,'plan.json'));
    return hash(canonical([L.geometry,L.roof].includes(data.step)?plan.geometry:{plan,machine:await json(resolve(dir,'machine.json'))}));
  }
  async function editLessonBaseline(data){
    const printId=requests.printId(await confined(data.selected));
    if(data.editLesson?.printId===printId)return false;
    const records=await requests.list({printId});
    data.editLesson={printId,inputKey:await signature({...data,step:L.settings}),
      priorRequestIds:records.filter(r=>r.printId===printId).map(r=>r.id)};
    data.baseline=data.editLesson.inputKey;
    if(data.gates[L.settings]&&data.viewWork)data.viewSignature=data.viewWork.inputKey;
    return true;
  }
  async function observed(){
    const data=await read();
    if(data.active&&data.step===L.settings&&await editLessonBaseline(data))await save(progress,data);
    if(data.active&&[L.geometry,L.roof,L.settings].includes(data.step)&&data.gates[data.step]&&await signature(data)!==data.viewSignature){data.gates[data.step]=false;await save(progress,data);}
    return data;
  }
  async function describe(data,records){
    const gate=TOUR_STEPS[data.step]?.gate;
    const directory=(data.active||data.completed)&&data.selected?await confined(data.selected):null;
    const waiting=data.active&&[L.geometry,L.roof,L.settings].includes(data.step)&&directory&&(records??await requests.query({printId:requests.printId(directory)})).some(r=>
      requestActivity(r,{now:now(),view:{printId:requests.printId(directory),ready:true,snapshot:data.viewWork}})==='working');
    return {...data,directory,canNext:!waiting&&(!gate||data.gates[data.step]===true),agentInstruction:tourAgentInstruction(data)};
  }
  async function enter(data,index){
    if(data.lessonId)await requests.cancelScope(scope(data));
    const step=TOUR_STEPS[index];data.lessonId=randomUUID();data.step=index;data.active=true;data.completed=false;data.dismissed=false;playbackAt=null;
    if(step.demo){await ensure(step.demo,data);data.selected=data.copies[step.demo];}
    if(index===2){await ensure('starter',data);await ensure('surface-drape',data);}
    if(index===L.roof){data.gates[index]=false;data.baseline=await signature(data);data.viewWork=null;}
    if(index===L.playback)data.repairReviewRequired=false;
    if(index===L.geometry&&!data.gates[index])data.baseline=await signature(data);
    if(index===L.settings){
      data.editLesson=null;data.gates[index]=false;
      await editLessonBaseline(data);data.baseline=data.editLesson.inputKey;
      await requests.begin({directory:await confined(data.selected),source:'studio',kind:'guidance',scope:scope(data),key:'tour-infill:'+data.lessonId,instruction:tourAgentInstruction(data)});
    }
  }
  return {
    close(){requests.close();},
    async info({records}={}){return describe(await observed(),records);},
    async attachStudio(directory){
      if(!studioId)return;
      const data=await read();
      if(!data.active||data.studioOwner||!data.selected||await confined(data.selected)!==resolve(directory))return;
      data.studioOwner=studioOwner();await save(progress,data);
    },
    async closeStudio(){
      if(!studioId)return;
      const data=await read();if(data.studioOwner?.instanceId!==studioId)return;
      // End only this server's run. A later fresh run can belong to another
      // Studio, and ordinary previews must never close somebody else's tour.
      await save(progress,initial());playbackAt=null;
      await requests.cancelScope({runId:data.runId});
      for(const name of [...Object.values(data.copies),...data.imports]){
        const directory=await confined(name);await useExample(directory);await requests.cancelFor(directory);
      }
    },
    async restoreReference(directory){
      const data=await read();if(!data.active)return;
      const name=relative(base,resolve(directory)).split(sep).join('/');
      const id=Object.entries(data.copies).find(([,copy])=>copy===name)?.[0]??(data.imports.includes(name)?'imported':null);
      if(id)await save(resolve(await confined(name),'.tour-reference.json'),{id,version:TOUR_VERSION});
    },
    async downloaded(exportHash){const data=await read();if(!data.active||data.step!==L.export)throw Error('Continue to the export lesson first.');data.downloadedHash=exportHash;await save(progress,data);},
    async acknowledgeView(directory,seen,state){
      const data=await observed();
      if(!data.active||await confined(data.selected)!==resolve(directory)||seen.revision!==state.revision)return describe(data);
      if(data.step===L.settings){
        if(seen.stage!=='toolpath'||!state.geometryApproved||!state.program||state.programError||!seen.exportHash||seen.exportHash!==state.exportHash)return describe(data);
        const shown={...workSnapshot(state),stage:'toolpath'},baseline=data.editLesson;
        const requested=(await requests.list({printId:baseline.printId})).some(r=>r.source==='agent'&&r.kind!=='guidance'
          &&!baseline.priorRequestIds.includes(r.id)&&['working','waiting','completed'].includes(r.status)
          &&r.baseline?.inputKey!==shown.inputKey&&hasPresentedResult({...r,presented:false},shown));
        if(!requested)return describe(data);
      }
      if([L.geometry,L.roof,L.settings].includes(data.step)){
        const current=await signature(data);
        if(current!==data.baseline){data.gates[data.step]=true;data.viewSignature=current;data.viewWork={...workSnapshot(state),stage:seen.stage};await save(progress,data);}
      }
      return describe(data);
    },
    async landing(){const data=await read();if(!data.selected){await ensure('starter',data);data.selected=data.copies.starter;}await save(progress,data);return confined(data.selected);},
    async setStartAt(startAt,expected){
      if(!Number.isInteger(startAt?.layer)||startAt.layer<1)throw Error('startAt.layer must be an infill layer after the first layer.');
      const data=await read();
      if(expected&&(!data.active||data.runId!==expected.runId||data.lessonId!==expected.lessonId))throw Error('That tour lesson ended. Discard its start-layer choice.');
      data.startAt={layer:startAt.layer};await save(progress,data);return describe(data);
    },
    async select(directory,{requiresReview=false}={}){
      const data=await observed();if(!data.active||data.step!==2)throw Error('Open a print during the print-switching lesson.');
      const target=await realpath(directory),allowed=await Promise.all([...Object.values(data.copies),...data.imports].map(confined));
      if(!allowed.includes(target))throw Error('Choose one of the two prints from this tour.');
      data.selected=relative(base,target).split(sep).join('/');data.repairReviewRequired=requiresReview;data.gates[2]=true;await enter(data,L.import);await save(progress,data);return describe(data);
    },
    async imported(directory,{requiresReview=false}={}){
      const data=await observed();if(!data.active||data.step!==L.import)throw Error('Import an STL during the mesh lesson.');
      const name=relative(base,resolve(directory)).split(sep).join('/');await confined(name);
      if(!data.imports.includes(name))data.imports.push(name);data.selected=name;data.startAt=null;data.watchedMs=0;data.gates[L.playback]=false;data.gates[L.settings]=false;
      await save(resolve(directory,'.tour-reference.json'),{id:'imported',version:TOUR_VERSION});
      data.repairReviewRequired=requiresReview;
      await enter(data,requiresReview?L.import:L.playback);await save(progress,data);
      return describe(data);
    },
    async requestStartLayer(){
      const data=await read();if(!data.active||data.step!==L.playback)return describe(data);
      const directory=await confined(data.selected);
      await requests.begin({directory,source:'studio',kind:'guidance',scope:scope(data),key:'tour-layer:'+data.lessonId,instruction:'The participant imported an STL and advanced to playback. If its existing toolpath has a sparse-infill layer after the first layer, set startAt to that layer using set_tour_start_at. Otherwise keep Studio’s deposited-layer fallback. Do not change geometry or settings or regenerate solely to choose a viewing position. Complete this preparation silently; it must not delay playback. Studio supplies the Play instruction; chat teaching begins at the designated infill lesson.'});
      return describe(data);
    },
    async playback(event){
      const data=await observed(),time=now();
      if(!data.active||data.step!==L.playback){playbackAt=null;return describe(data);}
      if(playbackAt!==null)data.watchedMs+=Math.max(0,Math.min(1000,time-playbackAt));
      playbackAt=event==='play'||event==='tick'&&playbackAt!==null?time:null;
      if(data.watchedMs>=5000)data.gates[L.playback]=true;
      await save(progress,data);return describe(data);
    },
    async action(action,step){
      let data=await observed();
      if(action==='exit'||action==='cancel'){data.active=false;data.dismissed=true;playbackAt=null;for(const name of [...Object.values(data.copies),...data.imports]){await useExample(await confined(name));await requests.cancelFor(await confined(name));}if(data.runId)await requests.cancelScope({runId:data.runId});if(!data.completed)data=initial();}
      else if(action==='finish'){if(data.step!==TOUR_STEPS.length-1||!data.downloadedHash)throw Error('Download the print file to complete the tour.');data.active=false;data.completed=true;playbackAt=null;for(const name of [...Object.values(data.copies),...data.imports]){await useExample(await confined(name));await requests.cancelFor(await confined(name));}await requests.begin({directory:await confined(data.selected),source:'studio',kind:'guidance',scope:{runId:data.runId},key:'tour-finish:'+data.runId,instruction:tourAgentInstruction(data)});}
      else if(action==='fresh'){for(const name of [...Object.values(data.copies),...data.imports]){await useExample(await confined(name));await requests.cancelFor(await confined(name));}if(data.runId)await requests.cancelScope({runId:data.runId});data={...initial(),runId:randomUUID(),studioOwner:studioOwner()};await enter(data,0);await ensure('surface-drape',data);}
      else if(action==='step'){
        if(!data.active)throw Error('Start a new tour first.');
        if(!Number.isInteger(step)||!TOUR_STEPS[step])throw Error('Unknown tour step');
        if(Math.abs(step-data.step)>1)throw Error('Use Next or Back to follow the tour.');
        if(step>data.step&&!(await describe(data)).canNext)throw Error('Complete this lesson before continuing.');
        await enter(data,step);
      }else throw Error('Unknown tour action.');
      await save(progress,data);return {data:await describe(data),directory:data.selected?await confined(data.selected):null};
    }
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [action='status',library='Prints',value]=process.argv.slice(2),tour=createTour(library);
  console.log(JSON.stringify(action==='start-at'?await tour.setStartAt({layer:Number(value)}):action==='status'?await tour.info():(await tour.action(action)).data,null,2));
}
