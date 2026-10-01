// The toolpath owner admits raw paths once. Owned values cannot be changed
// after admission; exporters validate their changed, encoded representation.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {validatePose} from './pose.mjs';

const paths=new WeakSet(),actions=new WeakSet();
const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
function freeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freeze(child);
    Object.freeze(value);
  }
  return value;
}
function pathAction(input){
  if(actions.has(input))return input;
  const a=structuredClone(input);
  requireThat(typeof a.phase==='string'&&Number.isFinite(a.layer),'Invalid SAAMpath context.');
  if(a.kind==='move')requireThat(point(a.to)&&Number.isFinite(a.speedMmS)&&a.speedMmS>0&&Number.isFinite(a.volumeMm3)&&a.volumeMm3>=0,'Invalid SAAMpath move.');
  else if(a.kind==='retract'||a.kind==='recover')requireThat(Number.isFinite(a.filamentMm)&&a.filamentMm>=0&&Number.isFinite(a.speedMmS)&&a.speedMmS>0,'Invalid filament action.');
  else if(a.kind==='extrude')requireThat(Number.isFinite(a.volumeMm3)&&a.volumeMm3>0&&Number.isFinite(a.flowMm3S)&&a.flowMm3S>0,'Invalid stationary deposition.');
  else if(a.kind==='temperature')requireThat(Number.isFinite(a.targetC)&&a.targetC>0,'Invalid nozzle temperature.');
  else if(a.kind==='toolChange')requireThat(Number.isInteger(a.filament)&&a.filament>=0&&Number.isInteger(a.tool)&&a.tool>=0,'Invalid material selection.');
  else if(a.kind==='fan')requireThat(Number.isFinite(a.percent)&&a.percent>=0&&a.percent<=100,'Fan outside limits.');
  else if(a.kind==='dwell')requireThat(Number.isFinite(a.seconds)&&a.seconds>=0,'Dwell outside limits.');
  else throw Error('Unsupported SAAMpath action: '+a.kind);
  if(a.pose)validatePose(a.pose);
  if(a.durationSeconds!==undefined)requireThat(Number.isFinite(a.durationSeconds)&&a.durationSeconds>0,'Motion needs positive duration.');
  freeze(a);actions.add(a);return a;
}
export function saamPath(input){
  if(paths.has(input))return input;
  requireThat(input?.schema==='saampath/1'&&point(input.initialPosition)&&Array.isArray(input.actions),'Invalid SAAMpath or initial position.');
  if(input.initialPose)validatePose(input.initialPose);
  const {actions:source,...metadata}=input;
  const path=freeze({...structuredClone(metadata),actions:source.map(pathAction)});
  paths.add(path);return path;
}
