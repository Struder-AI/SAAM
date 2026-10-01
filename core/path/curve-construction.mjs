import {distance,requireThat} from '../geom/tolerance.mjs';

// Explicit centerlines stay independent. Closure is materialized so callers
// can retain their supplied seam and direction through ordinary composition.
export function placeCenterlines(curves,{offset=[0,0,0],zMm=null,role='trace'}={}) {
  return curves.map(curve=>{
    const {points:sourcePoints,closed,courses,layers,...properties}=curve;
    const local=curve.closed?[...curve.points,curve.points[0]]:curve.points;
    const points=local.map(p=>[p[0]+offset[0],p[1]+offset[1],(zMm??p[2]??0)+offset[2]]);
    return {role,...properties,closed:false,points};
  });
}

export function curveLength(points) {
  return points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0);
}

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

// Mapped samples and their unwrapped turns determine gaps and cooling speed.
// This returns a curve, not deposited volume, and never selects a skill.
export function spiralBeadCurve({profile,points,turns,role='spiral',speedMmS,minimumTurnSeconds=0}){
  requireThat(points.length===turns.length&&points.length>=2&&turns.every((t,i)=>Number.isFinite(t)&&(!i||t>turns[i-1])),
    'A spiral needs matching mapped points and increasing turn coordinates.');
  const lengths=points.slice(1).map((p,i)=>distance(points[i],p)),turnLengths=new Map();
  for(let i=0;i<lengths.length;i++){
    const turn=Math.floor((turns[i]+turns[i+1])/2);turnLengths.set(turn,(turnLengths.get(turn)??0)+lengths[i]);
  }
  const complete=[...turnLengths].filter(([turn])=>turn+1<=profile.turns+1e-9).map(([,length])=>length);
  const speed=Math.min(speedMmS,minimumTurnSeconds>0?Math.min(...complete)/minimumTurnSeconds:Infinity);
  const heightsMm=lengths.map((length,i)=>{
    const mid=(turns[i]+turns[i+1])/2;
    return turns[i+1]<=1+1e-9?profile.firstHeightMm:spiralHeight(profile,mid)-spiralHeight(profile,mid-1);
  });
  return {role,closed:false,points,heightsMm,speedMmS:speed,
    segmentMetadata:turns.slice(1).map((t,i)=>({layer:Math.floor((turns[i]+t)/2),...(t<=1+1e-9?{contactRole:'foundation'}:{}),...(profile.levelEnd&&turns[i]>=profile.risingTurns-1e-9?{boundaryRole:'rim'}:{})}))};
}
