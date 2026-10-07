import {replaceFile} from '../core/private/studio/file-write.mjs';
import {readFile,mkdir,stat,realpath,unlink} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {TOUR_VERSION,TOUR_DECK_VERSION,TOUR_EXAMPLE,TOUR_STEPS,TOUR_LESSONS as L,tourAgentInstruction} from './tour-catalog.mjs';

import {requestPrintId} from '../core/application/chat-requests.mjs';
import {bundleFor} from './adapter-resolution.mjs';
import {requestReceiptState} from './work-state.mjs';

// Tour content: the example's {machineId, plan}, copied into the tour folder when a lesson needs it.
const starterRecipe=async()=>({machineId:'ultimaker-s5',plan:(await import('../examples/prints/starter/recipe.mjs')).starterPlan()});
const json=async file=>JSON.parse(await readFile(file,'utf8'));
async function optional(file){try{return await json(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function save(file,value){await replaceFile(file,JSON.stringify(value,null,2)+'\n');}
const validPath=name=>typeof name==='string'&&!name.includes('\\')&&!name.includes(':')&&!name.startsWith('/')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..');
export async function tourExample(directory){const marker=await optional(resolve(directory,'.tour-reference.json'));return marker?.version===TOUR_VERSION&&marker.id===TOUR_EXAMPLE?{id:marker.id,version:marker.version}:null;}
export async function useExample(directory){try{await unlink(resolve(directory,'.tour-reference.json'));}catch(e){if(e.code!=='ENOENT')throw e;}}
// The tour as one chat binding sees it; studioId names the Studio running it (none for a status read).
export function createTour(libraryRoot,{now=Date.now,studioId,chat}){
  const library=resolve(libraryRoot),progress=resolve(library,'.tour-progress.json'),base=resolve(library,'tour');
  const printIdOf=directory=>requestPrintId(library,directory);
  const initial=()=>({version:TOUR_VERSION,deckVersion:TOUR_DECK_VERSION,runId:null,lessonId:null,step:0,active:false,completed:false,copies:{},selected:null,gates:{},baseline:null,startAt:null});
  async function read(){const value=await optional(progress);return value?.deckVersion===TOUR_DECK_VERSION&&value.runId?{...initial(),...value}:initial();}
  const scope=data=>({runId:data.runId,lessonId:data.lessonId});
  const studioOwner=()=>studioId?{instanceId:studioId}:null;
  async function confined(name){
    if(!validPath(name))throw Error('Invalid saved tour path');
    const [realBase,target]=await Promise.all([realpath(base),realpath(resolve(base,name))]);
    if(!target.startsWith(realBase+sep))throw Error('The saved example must stay inside the tour folder.');
    return target;
  }
  async function ensure(data){
    const id=TOUR_EXAMPLE;await mkdir(base,{recursive:true});
    const [realBase,realLibrary]=await Promise.all([realpath(base),realpath(library)]);
    if(!realBase.startsWith(realLibrary+sep))throw Error('The tour folder must stay inside the Prints library.');
    if(data.copies[id])try{const existing=await confined(data.copies[id]);await stat(resolve(existing,'plan.json'));return existing;}catch(e){if(e.code!=='ENOENT')throw e;}
    const title='handle';
    let name=title,index=1,directory;
    for(;;){directory=resolve(base,name);try{await mkdir(directory);break;}catch(e){if(e.code!=='EEXIST')throw e;name=title+'-'+(++index);}}
    const {machineId,plan}=await starterRecipe();
    const {initBundle}=await import('../core/print/bundle.mjs');
    await initBundle(directory,plan,{machineId});
    await save(resolve(directory,'.tour-reference.json'),{id,version:TOUR_VERSION});data.copies[id]=name;return directory;
  }
  async function signature(data,shown){
    if(!data.selected)return null;
    const dir=await confined(data.selected),state=shown?.dir===dir?shown:(await (await bundleFor(dir)).loadBundleSnapshot(dir,{program:false})).state;
    return data.step===L.geometry?state.workEvidence.geometryKey:state.workEvidence.inputKey;
  }
  async function editLessonBaseline(data,state){
    const directory=await confined(data.selected),printId=printIdOf(directory);
    if(data.editLesson?.printId===printId)return false;
    // Read the print's whole request history, not this owner's share of it: a
    // Studio relaunch may carry a different agent owner, and a record made
    // before the lesson must still count as prior work.
    const records=await chat.requestsFor(directory,studioId,{history:true});
    data.editLesson={printId,inputKey:await signature({...data,step:L.settings},state),
      priorRequestIds:records.filter(r=>r.printId===printId).map(r=>r.id)};
    data.baseline=data.editLesson.inputKey;
    if(data.gates[L.settings]&&data.viewWork)data.viewSignature=data.viewWork.inputKey;
    return true;
  }
  async function observed(state){
    const data=await read();
    if(data.active&&data.step===L.settings&&await editLessonBaseline(data,state))await save(progress,data);
    if(data.active&&[L.geometry,L.settings,L.setup,L.export].includes(data.step)&&data.gates[data.step]&&await signature(data,state)!==data.viewSignature){
      data.gates[data.step]=false;data.downloadedHash=null;await save(progress,data);
    }
    return data;
  }
  async function describe(data,records){
    const gate=TOUR_STEPS[data.step]?.gate;
    const directory=(data.active||data.completed)&&data.selected?await confined(data.selected):null;
    const waiting=data.active&&[L.geometry,L.settings,L.setup,L.export].includes(data.step)&&directory&&(records??await chat.requestsFor(directory,studioId)).some(r=>
      ['queued','working'].includes(requestReceiptState(r,{now:now(),view:{printId:printIdOf(directory),ready:true,snapshot:data.viewWork}}).activity));
    return {...data,directory,canNext:!waiting&&(!gate||data.gates[data.step]===true),agentInstruction:tourAgentInstruction(data)};
  }
  async function enter(data,index){
    if(data.lessonId)await chat.withdraw({scope:scope(data)});
    const step=TOUR_STEPS[index];data.lessonId=randomUUID();data.step=index;data.active=true;data.completed=false;data.dismissed=false;
    if(step.example){await ensure(data);data.selected=data.copies[TOUR_EXAMPLE];}
    if(index===L.geometry&&!data.gates[index])data.baseline=await signature(data);
    if(index===L.settings){
      data.editLesson=null;data.gates[index]=false;
      await editLessonBaseline(data);data.baseline=data.editLesson.inputKey;
      await chat.ask({directory:await confined(data.selected),kind:'guidance',scope:scope(data),key:'tour-change:'+data.lessonId,studioInstanceId:studioId,instruction:tourAgentInstruction(data)});
    }
    if(index===L.setup||index===L.export)data.gates[index]=data.viewSignature===await signature(data);
  }
  return {
    async info({records,state}={}){return describe(await observed(state),records);},
    async attachStudio(directory){
      if(!studioId)return;
      const data=await read();
      if(!data.active||data.studioOwner||!data.selected||await confined(data.selected)!==resolve(directory))return;
      data.studioOwner=studioOwner();data.lessonId=randomUUID();await save(progress,data);
      if(data.step===L.settings&&!data.gates[L.settings])await chat.ask({directory,kind:'guidance',
        scope:scope(data),key:'tour-change:'+data.lessonId,studioInstanceId:studioId,instruction:tourAgentInstruction(data)});
    },
    async closeStudio(){
      if(!studioId)return;
      const data=await read();if(data.studioOwner?.instanceId!==studioId)return;
      // Release only this Studio's ownership; the saved print can resume the
      // same lesson in a later Studio instance.
      data.studioOwner=null;await save(progress,data);
      await chat.withdraw({scope:{runId:data.runId}});
      for(const name of Object.values(data.copies))await chat.withdraw({directory:await confined(name)});
    },
    async downloaded(outputId){const data=await read();if(!data.active||data.step!==L.export)throw Error('Reach the final tour lesson before exporting.');data.downloadedHash=outputId;await save(progress,data);},
    async acknowledgeView(directory,seen,state){
      const data=await observed(state);
      if(!data.active||await confined(data.selected)!==resolve(directory)||seen.revision!==state.revision)return describe(data);
      if(data.step===L.settings){
        if(seen.stage!=='toolpath'||!state.program||state.programError||!seen.outputId||seen.outputId!==state.outputId)return describe(data);
        const shown={...state.workEvidence,stage:'toolpath',studioInstanceId:studioId},baseline=data.editLesson;
        // A current lesson request or a new agent edit must publish the changed
        // inputs actually drawn. Old lessons and automatic generation cannot
        // supply that request target. History survives a change of chat owner.
        const requested=(await chat.requestsFor(directory,studioId,{history:true})).some(r=>
          (r.source==='agent'&&r.kind==='edit'||r.source==='studio'&&r.scope?.runId===data.runId&&r.scope?.lessonId===data.lessonId)
          &&!baseline.priorRequestIds.includes(r.id)&&['working','waiting','completed'].includes(r.status)
          &&r.baseline?.inputKey!==shown.inputKey&&requestReceiptState({...r,presented:false},{view:{ready:true,snapshot:shown}}).receipt);
        if(!requested)return describe(data);
      }
      if([L.setup,L.export].includes(data.step)){
        if(seen.stage!=='toolpath'||!state.program||state.programError||!seen.outputId||seen.outputId!==state.outputId)return describe(data);
        data.gates[data.step]=true;data.viewSignature=state.workEvidence.inputKey;await save(progress,data);
      }
      if([L.geometry,L.settings].includes(data.step)){
        const current=data.step===L.geometry?state.workEvidence.geometryKey:state.workEvidence.inputKey;
        if(current!==data.baseline){data.gates[data.step]=true;data.viewSignature=current;data.viewWork={...state.workEvidence,stage:seen.stage};await save(progress,data);}
      }
      return describe(data);
    },
    async landing(){const data=await read();if(!data.selected){await ensure(data);data.selected=data.copies[TOUR_EXAMPLE];}await save(progress,data);return confined(data.selected);},
    async setStartAt(startAt,expected){
      if(!Number.isInteger(startAt?.layer)||startAt.layer<1)throw Error('startAt.layer must be a deposited layer after the first.');
      const data=await read();
      if(expected&&(!data.active||data.runId!==expected.runId||data.lessonId!==expected.lessonId))throw Error('That tour lesson ended. Discard its start-layer choice.');
      data.startAt={layer:startAt.layer};await save(progress,data);return describe(data);
    },
    async playback(event){
      const data=await observed();
      if(!data.active||data.step!==L.playback)return describe(data);
      if(event==='play')data.gates[L.playback]=true;
      await save(progress,data);return describe(data);
    },
    async action(action,step){
      let data=await observed();
      if(action==='exit'||action==='cancel'){data.active=false;data.dismissed=true;for(const name of Object.values(data.copies)){await useExample(await confined(name));await chat.withdraw({directory:await confined(name)});}if(data.runId)await chat.withdraw({scope:{runId:data.runId}});if(!data.completed)data=initial();}
      else if(action==='finish'||action==='finish-view'){
        if(!data.active||data.step!==L.export||!data.gates[L.export]||await signature(data)!==data.viewSignature)
          throw Error('Review the current toolpath before finishing.');
        if(action==='finish'&&!data.downloadedHash)throw Error('Download the print file to complete the tour.');
        data.active=false;data.completed=true;data.completion=action==='finish'?'download':'view';
        for(const name of Object.values(data.copies)){await useExample(await confined(name));await chat.withdraw({directory:await confined(name)});}
        await chat.ask({directory:await confined(data.selected),kind:'guidance',scope:{runId:data.runId},
          key:'tour-finish:'+data.runId,studioInstanceId:studioId,instruction:tourAgentInstruction(data)});
      }
      else if(action==='fresh'){for(const name of Object.values(data.copies)){await useExample(await confined(name));await chat.withdraw({directory:await confined(name)});}if(data.runId)await chat.withdraw({scope:{runId:data.runId}});data={...initial(),runId:randomUUID(),studioOwner:studioOwner()};await enter(data,0);}
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
// The tour status for a chat outside any Studio (the agent's get_tour).
export const tourStatus=(libraryRoot,chat)=>createTour(libraryRoot,{chat}).info();
