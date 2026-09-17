import {TOUR_STEPS,TOUR_LESSONS as L} from './tour-catalog.mjs';
import {hasUnpreparedEdit} from './work-state.mjs';
export const needsTourGeometryReview=state=>Boolean(state?.tour?.active&&state.tour.directory===state.localPrintDirectory
  &&state.tour.step>=L.playback&&!state.geometryApproved);
export const needsTourToolpath=state=>Boolean(state?.tour?.active&&state.tour.directory===state.localPrintDirectory
  &&state.tour.step>=L.playback&&state.geometryApproved&&!state.generationError&&!state.generationCancelled&&!state.outputAvailability
  &&!hasUnpreparedEdit(state.work?.requests?.filter(r=>r.printId===state.work.printId),state.work?.snapshot)&&(!state.program||state.programError));
export function createTourUI({post,refresh,working,setTab,isBusy,state:current,seek}){
  const $=id=>document.getElementById(id);let progress=null,expanded=null,applied=null;
  const panel=$('tour-panel');let displayedStep=null,workActive=false,playStarted=false,playedSource=null,importObserved=false;
  async function load(){const response=await fetch('/api/tour');if(!response.ok)throw Error('Could not load the tour');progress=await response.json();if(current())current().tour=progress;}
  async function action(action,step){await working(TOUR_STEPS[step]?.tab==='toolpath'?'Preparing your toolpath…':'Opening your example…',async()=>{
    // The server saves the lesson before generation. Refresh that lesson even
    // when generation fails, so its error is not erased by a later step change.
    try{await post('tour',{action,step,...(action==='step'&&progress?.step===L.import&&step===L.playback
      ?{revision:current()?.revision,geometryHash:current()?.geometryHash}:{})});}
    finally{await load();applied=null;await refresh(false);}
  });}
  const attempt=fn=>async()=>{try{$('tour-status').textContent='';await fn();}catch(e){$('tour-status').textContent=e.message;}};
  $('tour-toggle').onclick=attempt(async()=>{
    if(progress?.active&&progress.directory===current()?.localPrintDirectory){expanded=!expanded;render(current());}
    else await action('fresh',0);
  });
  $('tour-exit').onclick=attempt(()=>action('exit'));
  $('tour-back').onclick=attempt(()=>action('step',progress.step-1));
  $('tour-next').onclick=attempt(()=>action('step',progress.step+1));
  $('import-stl').onpointerenter=()=>{
    if(progress?.active&&progress.step===L.import&&!importObserved){
      importObserved=true;$('import-stl').classList.remove('tour-highlight');render(current());
    }
  };
  async function playback(event){
    if(!progress?.active||progress.step!==L.playback)return;
    if(event==='play'){playStarted=true;playedSource=current().printId+':'+current().exportHash;$('play').classList.remove('tour-highlight');}
    if(event!=='play')return;
    try{const response=await post('tour-playback',{event});progress=await response.json();current().tour=progress;render(current());}catch(e){$('tour-status').textContent=e.message;}
  }
  function render(state){
    if(state?.tour)progress=state.tour;
    if(!progress||!state)return;
    const active=progress.active&&progress.directory===state.localPrintDirectory,step=TOUR_STEPS[progress.step];
    const geometryReview=needsTourGeometryReview(state);
    const displayKey=active?progress.step:progress.completed?'completed':'idle';
    if(displayKey!==displayedStep){$('tour-status').textContent='';displayedStep=displayKey;expanded=true;playStarted=false;importObserved=false;}
    panel.parentElement.dataset.tourStep=active?String(progress.step):'';
    const completed=progress.completed&&progress.directory===state.localPrintDirectory&&!progress.dismissed;
    panel.hidden=!(active||completed)||!expanded;
    $('tour-complete').hidden=!completed;$('tour-lesson').hidden=!active;$('tour-exit').hidden=!active&&!completed;
    $('canvas').classList.toggle('tour-faded',active&&progress.step===L.open);
    for(const id of ['import-stl','tour-next'])$(id).classList.toggle('tour-choice',active&&progress.step===L.import);
    $('tour-progress').textContent='SAAM TOUR · '+(progress.step+1)+' OF '+TOUR_STEPS.length;
    $('tour-title').textContent=step.title;$('tour-body').textContent=step.body;$('tour-try').textContent=step.try;
    for(const button of panel.querySelectorAll('button'))button.disabled=isBusy();
    $('tour-back').disabled=isBusy()||geometryReview||progress.step===0;
    $('tour-next').disabled=isBusy()||geometryReview||!progress.canNext||(active&&[L.geometry,L.roof,L.settings].includes(progress.step)&&workActive);
    $('tour-next').hidden=progress.step===TOUR_STEPS.length-1;
    $('tour-next').textContent=progress.step===L.import?'Continue with this part':'Next';
    $('import-stl').disabled=isBusy()||active;
    $('tour-toggle').disabled=isBusy();$('open-print').disabled=isBusy()||(active&&progress.step!==2);
    const highlights=active&&!geometryReview?(progress.step===L.import?(importObserved?['tour-next']:['import-stl','tour-next']):step.highlight?[step.highlight]:[]):[];
    if(active&&[L.geometry,L.roof].includes(progress.step)&&progress.gates?.[progress.step]&&!$('tour-next').disabled)highlights.push('tour-next');
    if(highlights.includes('play')&&progress.step===L.playback&&playStarted)highlights.splice(highlights.indexOf('play'),1);
    document.querySelectorAll('.tour-highlight').forEach(el=>{if(!highlights.includes(el.id))el.classList.remove('tour-highlight');});
    if(active){
      for(const button of document.querySelectorAll('[data-tab]'))button.disabled=true;
      $('confirm').disabled=isBusy()||(!geometryReview&&(progress.step!==L.export||!state.program||Boolean(state.programError)));
      if(geometryReview)$('confirm').textContent='Confirm geometry & return to lesson';
      else if(progress.step===L.export)$('confirm').textContent='Confirm settings & export';
      $('review-note').textContent=geometryReview?'Review the updated shape and dimensions. Confirm here or tell your agent this geometry is right to resume this lesson.':progress.step===L.export?'Confirming approves the displayed settings and toolpath, downloads the file and finishes the tour.':'Ask your agent for changes. Your current print stays selected.';
      for(const id of highlights)$(id)?.classList.add('tour-highlight');
      if(progress.step===L.setup)$('more-settings').open=true;
      const desired=geometryReview?'geometry':step.tab;
      const key=progress.step+':'+state.printId+':'+(progress.step===L.playback?JSON.stringify(progress.startAt):'')+':'+desired+':'+Boolean(state.program)+':'+(state.generationError??state.programError??'');
      if(applied!==key){
        const keepPlayback=!geometryReview&&progress.step===L.playback&&playStarted&&state.program&&playedSource===state.printId+':'+state.exportHash;
        applied=key;queueMicrotask(()=>{
          if(keepPlayback)return;
          setTab(desired);
          if(geometryReview){$('tour-status').textContent='Waiting for geometry confirmation. Your current lesson is saved.';return;}
          if(desired==='toolpath'&&!state.program){$('tour-status').textContent=state.generationError??state.programError??'Preparing your toolpath…';return;}
          $('tour-status').textContent='';
          if(progress.step===L.playback){try{
            const start=progress.startAt??{layer:1,fallback:true};let landed,fallback=start.fallback;
            try{landed=seek(start);}catch(error){
              if(start.fallback)throw error;
              landed=seek({layer:1,fallback:true});fallback=true;
            }
            $('tour-status').textContent=(fallback?'Starting at layer '+((landed?.layer??1)+1)+'. ':'')+'Press Play to continue. You can keep watching, scrub or change the speed.';
          }catch(e){$('tour-status').textContent=e.message;}}
        });
      }
    }
  }
  async function acknowledgeView(state,stage){
    const response=await post('view-ready',{revision:state.revision,exportHash:state.exportHash,stage});
    const {presentedRequests=[],...guide}=await response.json();
    progress=guide;state.tour=progress;render(state);return presentedRequests;
  }
  return {load,render,playback,acknowledgeView,activity(active){workActive=active;render(current());},active:()=>Boolean(progress?.active&&progress.directory===current()?.localPrintDirectory),initialTab:()=>progress?.active?TOUR_STEPS[progress.step]?.tab:'geometry'};
}
