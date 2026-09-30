// One command-time evaluator for source playback and machine presentation.
import {bedPoint,rotateZ,interpolateDirections} from '../path/pose.mjs';
import {rotation,mm,mv} from '../machine/rigid.mjs';
export function frameAtTime(moves, seconds) {
  if(!moves.length)return {completed:0,active:-1,fraction:0,point:null};
  let low=0,high=moves.length;
  while(low<high){const mid=(low+high)>>1;if(moves[mid].startSeconds<=seconds)low=mid+1;else high=mid;}
  const before=low===0,index=Math.max(0,low-1);
  const move=moves[index],elapsed=Math.max(0,Math.min(move.durationSeconds,seconds-move.startSeconds));
  let fraction=move.durationSeconds>0?Math.max(0,Math.min(1,elapsed/move.durationSeconds)):1;
  if(before)fraction=0;
  if(move.interpolation==='rest-to-rest-linear'&&move.controllerLengthMm>0&&move.accelerationMmS2>0&&move.peakSpeedMmS>0){
    const acceleration=move.accelerationMmS2,ramp=move.peakSpeedMmS/acceleration;
    const cruiseEnd=move.durationSeconds-ramp;
    const traveled=elapsed<ramp ? acceleration*elapsed*elapsed/2
      : elapsed<=cruiseEnd ? acceleration*ramp*ramp/2+move.peakSpeedMmS*(elapsed-ramp)
      : move.controllerLengthMm-acceleration*(move.durationSeconds-elapsed)**2/2;
    fraction=Math.max(0,Math.min(1,traveled/move.controllerLengthMm));
  }
  const result={completed:before?0:index+(fraction>=1?1:0),active:before?-1:index,fraction,point:move.from.map((v,i)=>v+(move.to[i]-v)*fraction)};
  if(Number.isInteger(move.tool))Object.assign(result,{tool:move.tool,filament:move.filament,nozzleMm:move.nozzleMm});
  if(Number.isFinite(move.rotaryFromDeg)){
    result.rotaryDeg=move.rotaryFromDeg+(move.rotaryToDeg-move.rotaryFromDeg)*fraction;
    const center=move.rotaryCenterMm,from=bedPoint(move.from,move.rotaryFromDeg,center),to=bedPoint(move.to,move.rotaryToDeg,center);
    result.point=bedPoint(from.map((v,i)=>v+(to[i]-v)*fraction),result.rotaryDeg,center,true);
    const dirs=interpolateDirections({toolAxis:rotateZ(move.toolAxisFrom,move.rotaryFromDeg),toolUp:rotateZ(move.toolUpFrom,move.rotaryFromDeg)},
      {toolAxis:rotateZ(move.toolAxisTo,move.rotaryToDeg),toolUp:rotateZ(move.toolUpTo,move.rotaryToDeg)},fraction);
    result.toolAxis=rotateZ(dirs.toolAxis,-result.rotaryDeg);
    result.toolUp=rotateZ(dirs.toolUp,-result.rotaryDeg);
  }
  if(move.controllerFrom)result.controllerPoint=move.controllerFrom.map((v,i)=>v+(move.controllerTo[i]-v)*fraction);
  if(move.anglesFrom){
    const a=move.anglesFrom.map((v,i)=>(v+(move.anglesTo[i]-v)*fraction)*Math.PI/180);
    result.rotation=mm(rotation([0,0,1],a[2]),mm(rotation([0,1,0],a[1]),rotation([1,0,0],a[0])));
    result.toolAxis=mv(result.rotation,[0,0,-1]);result.toolUp=mv(result.rotation,[0,1,0]);
  }else if(move.toolAxisFrom&&!Number.isFinite(move.rotaryFromDeg))Object.assign(result,interpolateDirections({toolAxis:move.toolAxisFrom,toolUp:move.toolUpFrom},{toolAxis:move.toolAxisTo,toolUp:move.toolUpTo},fraction));
  return result;
}
