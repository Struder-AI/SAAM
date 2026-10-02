// The toolpath owner admits raw paths once. Owned values cannot be changed
// after admission; exporters validate their changed, encoded representation.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {validatePose} from './pose.mjs';
import {CONTEXT_KEYS,sameContext,contextualActions} from './action-context.mjs';

const paths=new WeakSet();
const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
function freeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freeze(child);
    Object.freeze(value);
  }
  return value;
}
function pathAction(input){
  const a=structuredClone(input);
  if(a.kind==='move')requireThat(point(a.to)&&Number.isFinite(a.speedMmS)&&a.speedMmS>0&&Number.isFinite(a.volumeMm3)&&a.volumeMm3>=0,'Invalid SAAMpath move.');
  else if(a.kind==='retract'||a.kind==='recover')requireThat(Number.isFinite(a.filamentMm)&&a.filamentMm>=0&&Number.isFinite(a.speedMmS)&&a.speedMmS>0,'Invalid filament action.');
  else if(a.kind==='extrude')requireThat(Number.isFinite(a.volumeMm3)&&a.volumeMm3>0&&Number.isFinite(a.flowMm3S)&&a.flowMm3S>0,'Invalid stationary deposition.');
  else if(a.kind==='temperature')requireThat(Number.isFinite(a.targetC)&&a.targetC>0,'Invalid nozzle temperature.');
  else if(a.kind==='toolChange')requireThat(Number.isInteger(a.filament)&&a.filament>=0&&!Object.hasOwn(a,'tool'),
    'Neutral material selection needs a logical filament, not an installed tool.');
  else if(a.kind==='fan')requireThat(Number.isFinite(a.percent)&&a.percent>=0&&a.percent<=100,'Fan outside limits.');
  else if(a.kind==='dwell')requireThat(Number.isFinite(a.seconds)&&a.seconds>=0,'Dwell outside limits.');
  else throw Error('Unsupported SAAMpath action: '+a.kind);
  if(a.pose)validatePose(a.pose);
  if(a.durationSeconds!==undefined)requireThat(a.kind==='move'&&Number.isFinite(a.durationSeconds)&&a.durationSeconds>0,'Motion needs positive duration.');
  return freeze(a);
}
export function saamPath(input){
  if(paths.has(input))return input;
  requireThat(input?.schema==='saampath/1'&&point(input.initialPosition)&&Array.isArray(input.actions),'Invalid SAAMpath or initial position.');
  if(input.initialPose)validatePose(input.initialPose);
  const {actions:source,...metadata}=input;
  const compact=[];let previous=null,from=input.initialPosition;
  for(const {action,context} of contextualActions({actions:source})){
    requireThat(typeof context.phase==='string'&&Number.isFinite(context.layer),'Invalid SAAMpath context.');
    if(!previous||!sameContext(previous,context)){
      const changes=previous?Object.fromEntries(CONTEXT_KEYS.filter(key=>previous[key]!==context[key]).map(key=>[key,context[key]??null])):context;
      compact.push(freeze({kind:'context',...(!previous?{reset:true}:{}),...structuredClone(changes)}));previous=context;
    }
    const physical=Object.fromEntries(Object.entries(action).filter(([key])=>!CONTEXT_KEYS.includes(key)));
    if(physical.kind==='move'){
      requireThat(point(physical.to),'Invalid SAAMpath move.');
      const length=Math.hypot(...physical.to.map((v,i)=>v-from[i]));
      if(physical.durationSeconds!==undefined)requireThat(Number.isFinite(physical.durationSeconds)&&physical.durationSeconds>0,'Motion needs positive duration.');
      if(length>0&&physical.durationSeconds!==undefined){
        if(length/physical.speedMmS!==physical.durationSeconds)physical.speedMmS=length/physical.durationSeconds;
        delete physical.durationSeconds;
      }
      if(physical.durationSeconds!==undefined)requireThat(length===0&&physical.pose,'Explicit duration requires a zero-length pose move.');
      if(length===0)requireThat(physical.pose&&physical.durationSeconds!==undefined&&physical.volumeMm3===0,'A zero-length move needs a timed pose change; use extrusion for stationary deposition.');
      from=physical.to;
    }
    compact.push(pathAction(physical));
  }
  const path=freeze({...structuredClone(metadata),actions:compact});
  paths.add(path);return path;
}
