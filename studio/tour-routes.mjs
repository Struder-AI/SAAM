// Tour participation in a Studio window: playback events, lesson actions and
// leaving the tour when the person takes the window elsewhere.
import {useExample,tourExample} from './tour.mjs';
import {TOUR_LESSONS as L,TOUR_STEPS} from './tour-catalog.mjs';
import {resolve} from 'node:path';

export function createTourRoutes(ctx){
  // The window's records and values this part uses; ctx.NAME marks a call into another part.
  const {chat,note,session,tourHere}=ctx;
  // The person opening, importing or adopting another print in the tour's Studio leaves
  // the tour first, as its Exit does; an agent's import there still waits for the tour.
  const leaveTour=async reason=>{
    const result=await chat.current.tour.action('exit');if(session.dir)await useExample(session.dir);
    note('tour-exited',{action:'exit',reason,step:result.data.step,runId:result.data.runId,active:result.data.active,completed:result.data.completed});
  };
  // Tour participation: playback events and tour actions, and adopting an example print.
  async function tourRoute(url,data,progress,current,send){
    if(url.pathname==='/api/tour-playback'){
      if(!['play','pause','tick'].includes(data.event))throw Error('Unknown playback event');
      const played=await chat.current.tour.playback(data.event);if(data.event!=='tick')note('tour-playback',{event:data.event,step:played.step});send(played);return true;
    }
    if(url.pathname==='/api/tour'){
      // Enter playback only from the geometry that was actually displayed.
      if(data.action==='step'&&progress.step===L.geometry&&data.step===L.playback)
        await ctx.validateGeometrySelection(current,data);
      const ending=['exit','cancel','finish','finish-view'].includes(data.action);
      const result=await chat.current.tour.action(data.action,data.step);
      if(ending&&session.dir)await useExample(session.dir);
      if(!ending&&result.directory&&resolve(result.directory)!==session.dir)await ctx.openPrint(result.directory);
      const lesson=TOUR_STEPS[result.data.step];
      note(data.action==='fresh'?'tour-started':data.action==='step'?'tour-lesson':ending&&data.action!=='exit'&&data.action!=='cancel'?'tour-finished':'tour-exited',
        {action:data.action,step:result.data.step,lesson:lesson?{title:lesson.title,tab:lesson.tab,gate:lesson.gate??null}:null,runId:result.data.runId,lessonId:result.data.lessonId,
         active:result.data.active,completed:result.data.completed,canNext:result.data.canNext,agentInstruction:result.data.agentInstruction??null});
      if(result.directory&&result.data.active&&TOUR_STEPS[result.data.step].tab==='toolpath'){
        await ctx.runBundleEdit(session.dir,()=>ctx.generate({trigger:'tour-step',onlyIfMissingOutput:true}));
      }
    }
    else if(url.pathname==='/api/use-example'){
      if(tourHere(progress))await leaveTour('use-example');
      else if(await tourExample(session.dir)){await useExample(session.dir);note('example-adopted',{});}
    }
    else return false;
    send({ok:true});return true;
  }
  return {leaveTour,tourRoute};
}
