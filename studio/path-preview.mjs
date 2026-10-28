import {contextualActions} from '../core/path/action-context.mjs';
import {pathInitialPosition,pathInitialPose,pathSummary,PATH_VIEW_TOLERANCES} from '../core/path/curve-path.mjs';
import {pathViewPositionTolerance} from './path-view-quality.mjs';
// Studio draws the SAAMpath, never a machine program: the completed output's,
// else the saved one, at its placement (readDrawnPath), or a mechanism study's
// authored motion. Times are the path's own requested timing.
export async function loadPathPreview(state,{id,moves=[],onSource}={},fetcher=fetch){
  const query=new URLSearchParams({printId:state.printId,revision:state.revision,id});
  const response=await fetcher(state.valueURL??'/api/path?'+query);
  if(!response.ok)throw Error((await response.json()).error);
  const value=JSON.parse(new TextDecoder().decode(await response.arrayBuffer()));
  // Selection contributes an admitted value URL, never a second Paath reader.
  // A related schedule is usable only when the value owner has joined it.
  if(state.valueURL&&value.kind!=='paath')throw Error(value.reason??'The selected Paath is unavailable.');
  const path=value.kind==='paath'?(value.path?{...value.path,deposition:value.source}:{deposition:value.source}):value;
  onSource?.(path,{sourceIdentity:value.sourceIdentity??{printId:state.printId,outputId:id,revision:String(state.revision),sourcePathId:path.sourcePathId},relatedFinding:value.relatedFinding??null});
  if(path.deposition?.schema==='saampath/3'&&!path.schedule)return null;
  return path?.schema==='saam-machine-study-source/1'?studyPreview(path,{moves}):pathPreview(path,{moves,plan:state.plan,inspection:state.inspection});
}
export const loadSavedPath=state=>state.review?.path?loadPathPreview(state,{id:state.review.path.id}).then(p=>({...p,neutral:true,
  notice:state.outputAvailability??'Generate to write its machine program before exporting.'})):null;

// A pose is the toolhead's orientation in the part frame; machine axes, such
// as a rotary table, are the machine view's (its kinematics).
const UPRIGHT={toolAxis:[0,0,-1],toolUp:[0,1,0]};
// Flat optional columns survive the compact store even when the first row is a
// transfer. Per-segment range objects would become an unbounded category table.
function executionIdentity(action){
  return {entityId:action.entityId??null,scheduleIndex:action.scheduleIndex??NaN,
    executionKind:action.stationaryRange?'stationary':action.sourceRange?.curveId?'deposit':'transfer',toolIndex:action.toolIndex??NaN,
    sourceCurveId:action.sourceRange?.curveId??null,sourceFromU:action.sourceRange?.from??NaN,sourceToU:action.sourceRange?.to??NaN,
    sourceReverse:Boolean(action.sourceRange?.reverse),stationaryFromU:action.stationaryRange?.from??NaN,stationaryToU:action.stationaryRange?.to??NaN};
}
function appendStationaryEvent(events,event){
  const previous=events.at(-1);
  if(event.entityId){
    event.endSeconds=event.startSeconds+event.seconds;
    if(previous?.entityId===event.entityId&&previous.kind===event.kind&&previous.endSeconds===event.startSeconds){
      previous.endSeconds=event.endSeconds;previous.seconds=previous.endSeconds-previous.startSeconds;
      previous.stationaryToU=event.stationaryToU;previous.toolAxis=event.toolAxis;
      if(event.volumeMm3!==undefined)previous.volumeMm3+=event.volumeMm3;
      return;
    }
  }
  events.push(event);
}
// A move without its own line width has its material's (a filament process override), else the recipe's.
export function pathPreview(path,{moves=[],plan=null,inspection=null}={}){
  if(!Array.isArray(pathInitialPosition(path))||!(path?.deposition&&path.schedule||['saampath/1','saam-export-prepared/1'].includes(path?.schema)&&path.actions))throw Error('Invalid saved SAAMpath.');
  const width=(action,filament)=>action.beadWidthMm??action.lineWidthMm??plan?.setup?.filaments?.[filament]?.process?.lineWidthMm??NaN;
  const metadata=pathSummary(path)?.inspection??inspection,nativeLayers=path.deposition?.layers;
  const events=[];let position=pathInitialPosition(path),pose=pathInitialPose(path)??null,time=0,filament=plan?.setup?.filament??null,fan=0,volumeMm3=0,tool=plan?.setup?.tool??null,legacyKey=null,legacyRun=0;
  const canonical=path.deposition?.schema==='saampath/3',posed=Boolean(pose)||Boolean(path.deposition)||Array.isArray(path.actions)&&path.actions.some(a=>a.pose);
  // A drawing is a bounded view of the same source. Machine-output precision
  // needlessly expands curved material fields into millions of display moves.
  // Keep this budget local: Export continues to use its own reader tolerances.
  const positionToleranceMm=pathViewPositionTolerance({plan,source:path.deposition});
  for(const {action,context,index:line} of contextualActions(path,{...PATH_VIEW_TOLERANCES,positionToleranceMm})){
    if(action.toolIndex!==undefined)filament=action.toolIndex;
    if(action.kind==='toolChange'){filament=action.filament;tool=action.tool??tool;continue;}
    if(action.kind==='fan'){fan=action.percent;continue;}
    if(action.kind==='dwell'&&!action.stationaryRange){
      time+=action.seconds;pose=action.pose??pose;continue;
    }
    if(!['move','extrude','dwell'].includes(action.kind))continue;
    // Older paths lack layer references. Give each contiguous operation/layer
    // run its own display identity rather than infer ownership from its name.
    const key=JSON.stringify([context.phase,context.operation,context.layer]);
    if(key!==legacyKey){legacyKey=key;legacyRun++;}
    const info=metadata?.operations?.[context.operation],layer=info?.layers?.[context.layer],native=nativeLayers?.[context.layerId];
    const from=action.poseFrom??pose??UPRIGHT,next=action.pose??from;
    const row={line:line+1,phase:context.phase,layer:context.layer,layerId:context.layerId??null,legacyRun,operation:context.operation??'',
      sliceStack:(nativeLayers?native?.stackId:info?.family)??null,sliceIndex:(nativeLayers?native?.index:layer?.index)??null,modulated:!!info?.modifiers?.length,
      fan,filament,...(Number.isInteger(tool)?{tool}:{}),startSeconds:time,
      ...(canonical?executionIdentity(action):{}),
      ...(posed?{toolAxisFrom:from.toolAxis,toolAxisTo:next.toolAxis,toolUpFrom:from.toolUp,toolUpTo:next.toolUp}:{}),
      ...(path.deposition?.schema==='saampath/3'?{toolAxisInterpolation:'slerp'}:{}),
      surfaceNormal:action.surfaceNormal??[0,0,0],beadHeightMm:action.beadHeightMm??NaN};
    if(action.kind==='dwell'){
      const point=action.at??position;
      moves.push({...row,from:point,to:point,extruding:false,volumeMm3:0,speedMmS:0,durationSeconds:action.seconds,lineWidthMm:width(action,filament)});
      appendStationaryEvent(events,{line:line+1,kind:'dwell',positionMm:point,operation:action.operation??context.operation,
        ...executionIdentity(action),toolAxis:action.toolAxis,startSeconds:time,seconds:action.seconds});
      time+=action.seconds;position=point;pose=next;continue;
    }
    if(action.kind==='extrude'){
      const durationSeconds=action.volumeMm3/action.flowMm3S;
      moves.push({...row,from:position,to:position,extruding:true,volumeMm3:action.volumeMm3,speedMmS:0,durationSeconds,lineWidthMm:width(action,filament)});
      appendStationaryEvent(events,{line:line+1,kind:'injection',positionMm:position,volumeMm3:action.volumeMm3,
        ...(canonical?executionIdentity(action):{}),
        nozzleC:action.nozzleC??0,phase:context.phase,layer:context.layer,operation:context.operation??'',startSeconds:time,seconds:durationSeconds});
      volumeMm3+=action.volumeMm3;time+=durationSeconds;pose=next;continue;
    }
    const to=action.to,distance=Math.hypot(...to.map((v,i)=>v-position[i]));
    // A move with no positive speed has no known time; playback shows it at once.
    const durationSeconds=action.durationSeconds??(action.speedMmS>0?distance/action.speedMmS:0);
    if(!Number.isFinite(durationSeconds)||durationSeconds<0)throw Error('Invalid saved SAAMpath motion.');
    moves.push({...row,from:position,to,extruding:action.volumeMm3>0,volumeMm3:action.volumeMm3,speedMmS:action.speedMmS,durationSeconds,lineWidthMm:width(action,filament)});
    if(action.stationaryRange)appendStationaryEvent(events,{line:line+1,kind:'dwell',positionMm:to,operation:action.operation??context.operation,
      ...executionIdentity(action),toolAxis:action.toolAxis,startSeconds:time,seconds:durationSeconds});
    volumeMm3+=action.volumeMm3;position=to;pose=action.pose??pose;time+=durationSeconds;
  }
  return {moves,events,...(path.deposition?.schema==='saampath/3'?{orientation:{kind:'paath-axis/1',sourceSchema:'saampath/3'}}:{}),summary:{moves:moves.length,motionSeconds:time,volumeMm3,inspection:metadata??null},volumeMm3};
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
