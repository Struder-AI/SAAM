// Author one cell in a regular reference strip, then feed the existing sleeve mapper.
import {requireThat} from '../../../core/geom/tolerance.mjs';

export const isTiledMotif=pattern=>Boolean(pattern&&Object.hasOwn(pattern,'motif'));
const at=(value,i)=>Array.isArray(value)?value[i]:value;

// Input validity belongs to validateVasePattern. This expansion retains one
// stroke per course, including its cooling and layer identity, before mapping.
export function tileVaseMotif(pattern,maxPoints,budgetSetting='vase-wall.maxPoints'){
  const {motif,cellsPerTurn,courseRiseMm,repeats,tiltDeg}=pattern;
  const count=cellsPerTurn*(motif.points.length-1)+1;
  requireThat(Number.isSafeInteger(count)&&count<=maxPoints,
    `Vase motif course needs ${count} authored points; increase ${budgetSetting} from ${maxPoints}. No partial course generated.`);
  const points=[],offsetMm=[],beadHeightMm=[];
  const angle=tiltDeg*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const originOffset=at(motif.offsetMm??0,0),originHeight=motif.points[0][1];
  for(let cell=0;cell<cellsPerTurn;cell++)for(let i=cell?1:0;i<motif.points.length;i++){
    const [u,height]=motif.points[i],phase=(cell+u)/cellsPerTurn;
    const depth=at(motif.offsetMm??0,i)-originOffset,h=height-originHeight;
    points.push([phase,originHeight+depth*s+h*c+phase*courseRiseMm]);
    offsetMm.push(originOffset+depth*c-h*s);
    beadHeightMm.push(at(motif.beadHeightMm,i));
  }
  return {paths:[{points,offsetMm,beadHeightMm}],advance:[1,courseRiseMm],repeats};
}

// A loop includes forward cell advance in the curve itself: no connector is
// invented between loops. The authored height slope preserves the existing demo.
export function loopMotif({widthCells=1.3,depthMm=4.8,samples=64,beadHeightMm=.2,exterior='smooth'}={}){
  requireThat(Number.isFinite(widthCells)&&widthCells>0,'Loop widthCells must be positive.');
  requireThat(Number.isFinite(depthMm)&&depthMm>0,'Loop depthMm must be positive.');
  requireThat(Number.isSafeInteger(samples)&&samples>=4,'A loop needs at least four samples.');
  requireThat(['smooth','scalloped','both-scalloped'].includes(exterior),'Choose smooth, scalloped or both-scalloped.');
  const points=[],offsetMm=[];
  for(let i=0;i<=samples;i++){
    const t=i/samples,angle=2*Math.PI*t,depth=depthMm*(1-Math.cos(angle))/2;
    // Exact cell endpoints are part of the reusable motif contract.
    points.push([i===samples?1:t+widthCells/2*Math.sin(angle),.03*depth]);
    offsetMm.push(exterior==='both-scalloped'?depthMm/2-depth:exterior==='scalloped'?depth:-depth);
  }
  return {points,offsetMm,beadHeightMm};
}
