import {contextualActions} from '../core/path/action-context.mjs';
// Studio draws a path, never a decoded machine program: the completed output's
// prepared path (its saved SAAMpath with the locked settings' startup, priming
// and material-change motion), the saved SAAMpath before any output, or a
// mechanism study's authored motion. Times are the path's requested timing.
export async function loadPathPreview(state,{id,moves=[]}={},fetcher=fetch){
  const query=new URLSearchParams({printId:state.printId,revision:state.revision,id});
  const response=await fetcher('/api/path?'+query);
  if(!response.ok)throw Error((await response.json()).error);
  const path=JSON.parse(new TextDecoder().decode(await response.arrayBuffer()));
  return path?.schema==='saam-machine-study-source/1'?studyPreview(path,{moves}):pathPreview(path,{moves,tool:state.plan?.setup?.tool,rotaryCenterMm:state.plan?.setup?.denso?.rotaryCenterMm});
}
export const loadSavedPath=state=>state.artifacts?.path==='current'&&state.review?.path?loadPathPreview(state,{id:state.review.path.id}).then(p=>({...p,neutral:true,
  notice:'Saved SAAMpath preview. Select a printer and generate a checked machine file before exporting.'})):null;

const UPRIGHT={rotaryDeg:0,toolAxis:[0,0,-1],toolUp:[0,1,0]};
export function pathPreview(path,{moves=[],tool=null,rotaryCenterMm=[0,0,0]}={}){
  if(path?.schema!=='saampath/1'||!Array.isArray(path.actions)||!Array.isArray(path.initialPosition))throw Error('Invalid saved SAAMpath.');
  const events=[];let position=path.initialPosition,pose=path.initialPose??null,time=0,filament=null,fan=0,volumeMm3=0;
  const posed=Boolean(pose)||path.actions.some(a=>a.pose);
  for(const {action,context,index:line} of contextualActions(path)){
    if(action.kind==='toolChange'){filament=action.filament;tool=action.tool??tool;continue;}
    if(action.kind==='fan'){fan=action.percent;continue;}
    if(action.kind==='dwell'){time+=action.seconds;continue;}
    const row={line:line+1,phase:context.phase,layer:context.layer,operation:context.operation??'',fan,filament,...(Number.isInteger(tool)?{tool}:{}),startSeconds:time};
    if(action.kind==='extrude'){
      const durationSeconds=action.volumeMm3/action.flowMm3S;
      moves.push({...row,from:position,to:position,extruding:true,volumeMm3:action.volumeMm3,speedMmS:0,durationSeconds,lineWidthMm:action.lineWidthMm??null});
      events.push({line:line+1,kind:'injection',positionMm:position,volumeMm3:action.volumeMm3,
        nozzleC:action.nozzleC??0,phase:context.phase,layer:context.layer,operation:context.operation??'',startSeconds:time,seconds:durationSeconds});
      volumeMm3+=action.volumeMm3;time+=durationSeconds;continue;
    }
    if(action.kind!=='move')continue;
    const to=action.to,distance=Math.hypot(...to.map((v,i)=>v-position[i]));
    const durationSeconds=action.durationSeconds??distance/action.speedMmS;
    if(!Number.isFinite(durationSeconds)||durationSeconds<0)throw Error('Invalid saved SAAMpath motion.');
    const from=pose??UPRIGHT,next=action.pose??UPRIGHT;
    moves.push({...row,from:position,to,extruding:action.volumeMm3>0,volumeMm3:action.volumeMm3,speedMmS:action.speedMmS,durationSeconds,lineWidthMm:action.lineWidthMm??null,
      ...(posed?{rotaryFromDeg:from.rotaryDeg,rotaryToDeg:next.rotaryDeg,toolAxisFrom:from.toolAxis,toolAxisTo:next.toolAxis,toolUpFrom:from.toolUp,toolUpTo:next.toolUp,rotaryCenterMm}:{})});
    volumeMm3+=action.volumeMm3;position=to;pose=action.pose??pose;time+=durationSeconds;
  }
  return {moves,events,summary:{moves:moves.length,motionSeconds:time,volumeMm3},volumeMm3};
}

// A mechanism study's authored design motion (tools/kinematics); not a controller dialect.
export function studyPreview(s,{moves=[]}={}){
  if(s?.schema!=='saam-machine-study-source/1'||s.orientation!=='euler-xyz'||!Array.isArray(s.moves)||!s.moves.length)throw Error('Invalid machine study source');
  const vector=(v,name)=>{if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))throw Error('Invalid study '+name);return [...v];};
  let from=vector(s.initial?.tcp,'initial TCP'),anglesFrom=vector(s.initial?.anglesDeg,'initial angles'),seconds=0,volume=0;
  for(const [i,command] of s.moves.entries()){
    const to=vector(command.tcp,'TCP'),anglesTo=vector(command.anglesDeg,'angles'),dt=command.seconds,amount=command.volumeMm3??0;
    if(!Number.isFinite(dt)||dt<=0||!Number.isFinite(amount)||amount<0)throw Error('Invalid study duration or volume');
    const length=Math.hypot(...to.map((v,j)=>v-from[j]));
    moves.push({from,to,anglesFrom,anglesTo,interpolation:s.orientation,startSeconds:seconds,durationSeconds:dt,
      line:i+1,extruding:amount>0,volumeMm3:amount,phase:typeof command.phase==='string'?command.phase:amount>0?'study':'travel',
      operation:typeof command.operation==='string'?command.operation:'mechanism-study',layer:Number.isInteger(command.layer)?command.layer:0,fan:0,speedMmS:length/dt});
    seconds+=dt;volume+=amount;from=to;anglesFrom=anglesTo;
  }
  return {moves,events:[],seconds,volumeMm3:volume,summary:{motionSeconds:seconds,moves:moves.length,volumeMm3:volume}};
}
