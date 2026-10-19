import {createTravelAdvisory} from './travel-advisory.mjs';
import {knownSeconds} from './saampath.mjs';
import {contextualActions} from './action-context.mjs';
import {pathInitialPosition} from './curve-path.mjs';

// Requested-path facts collected in a consumer's existing pass. A writer's
// quantized command totals remain separate and authoritative for its output.
export function createMotionReport(initialPosition,lineWidthMm){
  const state={from:initialPosition,moves:0,seconds:0,volumeMm3:0,untimedMoves:0,index:0};
  const advisory=createTravelAdvisory(lineWidthMm),min=[...initialPosition],max=[...initialPosition];
  function record(action){
    const index=state.index++;
    if(action.kind==='move'||action.kind==='extrude'){
      const to=action.kind==='move'?action.to:state.from;
      advisory.record({from:state.from,to,extruding:action.volumeMm3>0,operation:action.operation,phase:action.phase,layer:action.layer,action:index});
      for(let k=0;k<3;k++){min[k]=Math.min(min[k],to[k]);max[k]=Math.max(max[k],to[k]);}
      state.volumeMm3+=action.volumeMm3??0;
      if(action.kind==='move'){
        state.moves++;
        if(action.durationSeconds===undefined&&!(action.speedMmS>0))state.untimedMoves++;
        state.seconds+=action.durationSeconds??knownSeconds(Math.hypot(...to.map((v,k)=>v-state.from[k])),action.speedMmS);
      }else state.seconds+=action.volumeMm3/action.flowMm3S;
      state.from=to;
    }else if(action.kind==='dwell')state.seconds+=action.seconds;
  }
  return {record,result(){return {moves:state.moves,seconds:state.seconds,volumeMm3:state.volumeMm3,untimedMoves:state.untimedMoves,
    boundsMm:{min,max},shortTravel:advisory.result()};}};
}
export function summarizeMotion(initialPosition,actions,lineWidthMm){
  const report=createMotionReport(initialPosition,lineWidthMm);for(const action of actions)report.record(action);return report.result();
}
export function summarizePath(path,lineWidthMm){
  const report=createMotionReport(pathInitialPosition(path),lineWidthMm);
  for(const {action,context} of contextualActions(path))report.record({...context,...action});
  return report.result();
}
