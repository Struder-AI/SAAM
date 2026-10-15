// The toolpath owner admits raw paths once. Owned values cannot be changed
// after admission; exporters validate their changed, encoded representation.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {validatePose} from './pose.mjs';
import {CONTEXT_KEYS,sameContext,contextualActions} from './action-context.mjs';
import {BUILD_SCALE_MM,PROGRAM_DECIMALS} from '../dimensions.mjs';

const paths=new WeakSet();
// Admitted action lists and the initial position they were admitted from.
const admittedActions=new WeakMap();
// Authored speeds pass through, and firmware clamps feed rates. A move without
// a positive speed has no known duration.
export const moveSeconds=(lengthMm,speedMmS)=>speedMmS>0?lengthMm/speedMmS:Infinity;
// The known part of a time estimate: an untimed move counts as zero, and the
// estimate says how many it excludes.
export const knownSeconds=(lengthMm,speedMmS)=>speedMmS>0?lengthMm/speedMmS:0;
const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
function freeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freeze(child);
    Object.freeze(value);
  }
  return value;
}

// Stored precision: admission keeps the digits a program can use, so the path a
// program is written from is the path saved. Coordinates and other motion values
// keep program resolution in their unit. Amounts, rates and times keep it relative
// to their own size (PROGRAM_DECIMALS+1 significant digits), so a positive one
// stays positive. Direction components keep program resolution at build scale: a
// turn moving a point BUILD_SCALE_MM away by less than one program step.
// Temperature, fan and material actions are stored as authored.
const PROGRAM_SCALE=10**PROGRAM_DECIMALS,DIRECTION_SCALE=PROGRAM_SCALE*BUILD_SCALE_MM;
const RELATIVE_KEYS=new Set(['volumeMm3','speedMmS','flowMm3S','durationSeconds','seconds']);
const DIRECTION_KEYS=new Set(['surfaceNormal','toolAxis','toolUp']);
const ROUNDED_KINDS=new Set(['move','extrude','retract','recover','dwell']);
// Adding zero stores negative zero as its JSON text reads back.
const stepped=(value,scale)=>Math.round(value*scale)/scale+0;
function rounded(value,precision){
  if(precision==='authored'||value===0)return value+0;
  if(precision==='direction')return stepped(value,DIRECTION_SCALE);
  if(precision==='program')return stepped(value,PROGRAM_SCALE);
  const exponent=PROGRAM_DECIMALS-Math.floor(Math.log10(Math.abs(value)));
  return exponent>=0?stepped(value,10**exponent):Math.round(value/10**-exponent)*10**-exponent;
}
const precisionOf=(key,authored)=>authored?'authored':DIRECTION_KEYS.has(key)?'direction':RELATIVE_KEYS.has(key)?'relative':'program';
// A copy holding exactly what its JSON text reads back: stored numbers,
// non-finite numbers as null, no undefined fields.
function stored(value,precision,authored){
  if(value===undefined)return null;
  if(typeof value==='number')return Number.isFinite(value)?rounded(value,precision):null;
  if(Array.isArray(value))return Object.freeze(value.map(item=>stored(item,precision,authored)));
  if(value&&typeof value==='object')return Object.freeze(storedFields(value,authored));
  return value;
}
function storedFields(object,authored,omitted=[]){
  const copy={};
  for(const [key,value] of Object.entries(object))
    if(value!==undefined&&!omitted.includes(key))copy[key]=stored(value,precisionOf(key,authored),authored);
  return copy;
}

function pathAction(a){
  if(a.kind==='move')requireThat(point(a.to)&&Number.isFinite(a.speedMmS)&&Number.isFinite(a.volumeMm3)&&a.volumeMm3>=0,'Invalid SAAMpath move.');
  else if(a.kind==='retract'||a.kind==='recover')requireThat(Number.isFinite(a.filamentMm)&&a.filamentMm>=0&&Number.isFinite(a.speedMmS),'Invalid filament action.');
  else if(a.kind==='extrude')requireThat(Number.isFinite(a.volumeMm3)&&a.volumeMm3>0&&Number.isFinite(a.flowMm3S)&&a.flowMm3S>0,'Invalid stationary deposition.');
  else if(a.kind==='temperature')requireThat(Number.isFinite(a.targetC)&&a.targetC>0,'Invalid nozzle temperature.');
  else if(a.kind==='toolChange')requireThat(Number.isInteger(a.filament)&&a.filament>=0&&!Object.hasOwn(a,'tool'),
    'Neutral material selection needs a logical filament, not an installed tool.');
  // Fan percent is authored intent; firmware clamps it to the fan's range.
  else if(a.kind==='fan')requireThat(Number.isFinite(a.percent),'Fan percent must be a number.');
  else if(a.kind==='dwell')requireThat(Number.isFinite(a.seconds)&&a.seconds>=0,'Dwell outside limits.');
  else throw Error('Unsupported SAAMpath action: '+a.kind);
  if(a.pose)validatePose(a.pose);
  if(a.durationSeconds!==undefined)requireThat(a.kind==='move'&&Number.isFinite(a.durationSeconds)&&a.durationSeconds>0,'Motion needs positive duration.');
  return Object.freeze(a);
}

// A move that collapses at program resolution is skipped, its material with it;
// a collapsed move with a pose keeps only that reorientation.
function admittedActionList(source,initialPosition){
  const compact=[];let previous=null,from=initialPosition;
  for(const {action,context} of contextualActions({actions:source})){
    requireThat(typeof context.phase==='string'&&Number.isFinite(context.layer),'Invalid SAAMpath context.');
    const physical=storedFields(action,!ROUNDED_KINDS.has(action.kind),CONTEXT_KEYS);
    if(physical.kind==='move'){
      requireThat(Array.isArray(physical.to),'Invalid SAAMpath move.');
      const length=Math.hypot(...physical.to.map((v,i)=>v-from[i]));
      if(physical.durationSeconds!==undefined)requireThat(Number.isFinite(physical.durationSeconds)&&physical.durationSeconds>0,'Motion needs positive duration.');
      // A zero-length move is a reorientation, timed or at the machine's own rate.
      if(length===0&&!physical.pose)continue;
      if(length===0)physical.volumeMm3=0;
      else if(physical.durationSeconds!==undefined){
        if(length/physical.speedMmS!==physical.durationSeconds)physical.speedMmS=rounded(length/physical.durationSeconds,'relative');
        delete physical.durationSeconds;
      }
      from=physical.to;
    }
    if(!previous||!sameContext(previous,context)){
      const changes=previous?Object.fromEntries(CONTEXT_KEYS.filter(key=>previous[key]!==context[key]).map(key=>[key,context[key]??null])):context;
      compact.push(freeze({kind:'context',...(!previous?{reset:true}:{}),...structuredClone(changes)}));previous=context;
    }
    compact.push(pathAction(physical));
  }
  Object.freeze(compact);admittedActions.set(compact,initialPosition);
  return compact;
}
export function saamPath(input){
  if(paths.has(input))return input;
  requireThat(input?.schema==='saampath/1'&&(Array.isArray(input.operations)||point(input.initialPosition)&&Array.isArray(input.actions)),'Invalid SAAMpath or initial position.');
  if(Array.isArray(input.operations)){
    const {operations:source,...metadata}=input,ids=new Set();
    const operations=source.map(operation=>{
      requireThat(typeof operation.id==='string'&&operation.id&&!ids.has(operation.id)&&Array.isArray(operation.after)&&Array.isArray(operation.strokes),'Invalid or duplicate constructed operation.');
      ids.add(operation.id);
      requireThat(!operation.travelPolicy,'Constructed SAAMpath contains numerical deposition, not travel callbacks.');
      // Construction remains numerical geometry. Rounding belongs to admitted
      // motion below, where collapsed moves and their material are omitted together.
      return stored(structuredClone(operation),'authored',true);
    });
    const path=freeze({...stored(structuredClone(metadata),'authored',true),operations});
    paths.add(path);return path;
  }
  if(input.initialPose)validatePose(input.initialPose);
  const {actions:source,...metadata}=input,initialPosition=stored(input.initialPosition,'program',false);
  // A path rewrapping admitted actions from the same start reuses them.
  const known=admittedActions.get(source);
  const actions=known?.every((v,i)=>v===initialPosition[i])?source:admittedActionList(source,initialPosition);
  const path=freeze({...structuredClone(metadata),initialPosition,...(input.initialPose?{initialPose:stored(input.initialPose,'program',false)}:{}),actions});
  paths.add(path);return path;
}
// The saved SAAMpath is the admitted path's JSON text. Every admitted number
// reads back from that text as itself, so a program written from the reloaded
// file is the program written from the path in memory.
export const saamPathText=input=>JSON.stringify(saamPath(input));
