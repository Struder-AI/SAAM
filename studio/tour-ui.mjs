import {TOUR_DEMOS,TOUR_STEPS} from './tour-catalog.mjs';
export function createTourUI({post,refresh,working,setTab,machineView,isBusy,state:current}){
  const $=id=>document.getElementById(id);let progress=null,expanded=null,applied=null;
  const panel=$('tour-panel');
  async function load(){const response=await fetch('/api/tour');if(!response.ok)throw Error('Could not load the tour');progress=await response.json();}
  async function action(action,step){
    await working('Opening your example…',async()=>{await post('tour',{action,step});await load();applied=null;await refresh(false);});
  }
  const attempt=fn=>async()=>{try{await fn();}catch(e){$('tour-status').textContent=e.message;}};
  $('tour-toggle').onclick=()=>{expanded=!expanded;render(current());};
  $('tour-start').onclick=attempt(()=>progress?.completed?action('step',0):action('resume'));
  $('tour-fresh').onclick=attempt(()=>action('fresh'));
  $('tour-explore').onclick=attempt(async()=>{await action('pause');expanded=false;render(current());});
  $('tour-back').onclick=attempt(()=>action('step',progress.step-1));
  $('tour-next').onclick=attempt(()=>action(progress.step===TOUR_STEPS.length-1?'finish':'step',progress.step+1));
  $('tour-copy').onclick=attempt(async()=>{const path=current()?.localPrintDirectory??current()?.printName;const prompt='Open my SAAM print at '+path+'. Help me make the cup taller while keeping its weighted foot and open lip. Explain the changes and show me the revised geometry in Studio.';$('tour-request').value=prompt;$('tour-request').hidden=false;try{await navigator.clipboard.writeText(prompt);$('tour-status').textContent='Request copied. Paste it into your agent chat.';}catch{$('tour-request').select();$('tour-status').textContent='Copy this request into your agent chat.';}});
  for(const [index,demo]of TOUR_DEMOS.entries()){
    const button=document.createElement('button');button.className='tour-card';
    const title=document.createElement('strong'),description=document.createElement('span');title.textContent=(index+1)+'. '+demo.title;description.textContent=demo.subtitle;button.append(title,description);
    button.onclick=attempt(()=>action('step',index*3));$('tour-choices').append(button);
  }
  function render(state){
    if(!progress)return;if(expanded===null)expanded=Boolean(state?.referencePreview);panel.hidden=!expanded;
    const step=TOUR_STEPS[progress.step]??TOUR_STEPS[0],active=progress.active&&state?.referencePreview?.id===step.demo;
    $('tour-welcome').hidden=active;$('tour-lesson').hidden=!active;
    $('tour-welcome-title').textContent=progress.completed?'Make something of your own':'Welcome to SAAM';
    $('tour-start').textContent=progress.completed?'Revisit the tour':progress.step?'Resume tour':'Start guided tour';
    $('tour-progress').textContent='SAAM TOUR · '+(progress.step+1)+' OF '+TOUR_STEPS.length;
    $('tour-title').textContent=step.title;$('tour-body').textContent=step.body;$('tour-try').textContent=step.try;
    for(const button of panel.querySelectorAll('button'))button.disabled=isBusy();
    $('tour-back').disabled=isBusy()||progress.step===0;$('tour-next').textContent=progress.step===TOUR_STEPS.length-1?'Finish tour':'Next';
    $('tour-copy').hidden=!active||progress.step!==8;
    if(active&&state.program&&applied!==progress.step){applied=progress.step;queueMicrotask(()=>{setTab(step.tab);if(step.machine&&!machineView())applied=null;});}
  }
  return {load,render,initialTab:()=>progress?.active?TOUR_STEPS[progress.step]?.tab:'geometry',async leave(){await post('tour',{action:'pause'});await load();applied=null;}};
}
