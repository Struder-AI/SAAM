import {contextualActions} from '../core/path/action-context.mjs';
// Read a saved, machine-independent SAAMpath for display only. This projection
// never becomes a checked machine program or a manufacturing approval.
export async function loadNeutralPath(state,fetcher=fetch){
  const reference=state.review?.path;
  if(state.artifacts?.path!=='current'||!reference)return null;
  const query=new URLSearchParams({printId:state.printId,revision:state.revision,pathId:reference.id});
  const response=await fetcher('/api/neutral-path?'+query);
  if(!response.ok)throw Error((await response.json()).error);
  const bytes=await response.arrayBuffer();
  return neutralPathPreview(JSON.parse(new TextDecoder().decode(bytes)));
}

export function neutralPathPreview(path){
  if(path?.schema!=='saampath/1'||!Array.isArray(path.actions)||!Array.isArray(path.initialPosition))throw Error('Invalid saved SAAMpath.');
  const moves=[],events=[];let position=path.initialPosition,time=0,filament=null,fan=0,volumeMm3=0;
  for(const {action,context,index:line} of contextualActions(path)){
    if(action.kind==='toolChange'){filament=action.filament;continue;}
    if(action.kind==='fan'){fan=action.percent;continue;}
    if(action.kind==='dwell'){time+=action.seconds;continue;}
    if(action.kind==='extrude'){
      const durationSeconds=action.volumeMm3/action.flowMm3S;
      moves.push({line:line+1,from:position,to:position,extruding:true,volumeMm3:action.volumeMm3,
        speedMmS:0,phase:context.phase,layer:context.layer,operation:context.operation??'',fan,filament,
        startSeconds:time,durationSeconds,lineWidthMm:action.lineWidthMm??null});
      events.push({line:line+1,kind:'injection',positionMm:position,volumeMm3:action.volumeMm3,
        nozzleC:action.nozzleC??0,phase:context.phase,layer:context.layer,operation:context.operation??'',startSeconds:time,seconds:durationSeconds});
      volumeMm3+=action.volumeMm3;time+=durationSeconds;continue;
    }
    if(action.kind!=='move')continue;
    const to=action.to,distance=Math.hypot(...to.map((v,i)=>v-position[i]));
    const durationSeconds=action.durationSeconds??distance/action.speedMmS;
    if(!Number.isFinite(durationSeconds)||durationSeconds<0)throw Error('Invalid saved SAAMpath motion.');
    const move={line:line+1,from:position,to,extruding:action.volumeMm3>0,volumeMm3:action.volumeMm3,
      speedMmS:action.speedMmS,phase:context.phase,layer:context.layer,operation:context.operation??'',
      fan,filament,startSeconds:time,durationSeconds,lineWidthMm:action.lineWidthMm??null};
    moves.push(move);volumeMm3+=action.volumeMm3;position=to;time+=durationSeconds;
  }
  return {neutral:true,moves,events,summary:{moves:moves.length,motionSeconds:time,volumeMm3},volumeMm3,
    notice:'Saved SAAMpath preview. Select a printer and generate a checked machine file before exporting.'};
}
