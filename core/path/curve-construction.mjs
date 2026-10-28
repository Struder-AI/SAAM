import {requireThat} from '../private/toolpath/numeric.mjs';
import {ROUNDING_RELATIVE} from '../dimensions.mjs';


export {curveLength} from '../geom/spatial-curve.mjs';

// A flat foundation turn, constant vertical pitch, then an optional level
// finishing turn. The chart is data; geometric mapping belongs to its surface.
export function spiralProfile({startMm,endMm,pitchMm,firstHeightMm,levelEnd=true}){
  requireThat([startMm,endMm,pitchMm,firstHeightMm].every(Number.isFinite)&&endMm>startMm&&pitchMm>0&&firstHeightMm>0,
    'A spiral needs a positive height interval, pitch and foundation bead height.');
  const risingTurns=1+(endMm-startMm)/pitchMm;
  return {startMm,endMm,pitchMm,firstHeightMm,levelEnd,risingTurns,turns:risingTurns+(levelEnd?1:0)};
}

export function spiralHeight(profile,turn){
  return turn<=1?profile.startMm:Math.min(profile.endMm,profile.startMm+(turn-1)*profile.pitchMm);
}

// Mapped samples and their unwrapped turns determine bead gaps.
// This returns a curve, not deposited volume, and never selects a skill.
export function spiralBeadCurve({profile,points,turns,role='spiral',speedMmS}){
  requireThat(points.length===turns.length&&points.length>=2&&turns.every((t,i)=>Number.isFinite(t)&&(!i||t>turns[i-1])),
    'A spiral needs matching mapped points and increasing turn coordinates.');
  const heightsMm=points.slice(1).map((_,i)=>{
    const mid=(turns[i]+turns[i+1])/2;
    return turns[i+1]<=1+ROUNDING_RELATIVE?profile.firstHeightMm:spiralHeight(profile,mid)-spiralHeight(profile,mid-1);
  });
  return {role,closed:false,points,heightsMm,speedMmS,
    segmentMetadata:turns.slice(1).map((t,i)=>({layer:Math.floor((turns[i]+t)/2),...(t<=1+ROUNDING_RELATIVE?{contactRole:'foundation'}:{founded:true}),...(profile.levelEnd&&turns[i]>=profile.risingTurns-ROUNDING_RELATIVE?{boundaryRole:'rim'}:{})}))};
}
