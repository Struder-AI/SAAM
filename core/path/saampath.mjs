// Bundle admits compact immutable source and execution. Older saved motion is
// decoded only by curve-path's compatibility reader; it is never a new writer.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {admitSource,admitSchedule,serializableSource,validateExecutionSource} from './source-admission.mjs';
const paths=new WeakSet();
export const moveSeconds=(lengthMm,speedMmS)=>speedMmS>0?lengthMm/speedMmS:Infinity;
export const knownSeconds=(lengthMm,speedMmS)=>speedMmS>0?lengthMm/speedMmS:0;
function freeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function saamPath(input){
  if(paths.has(input))return input;
  requireThat(input?.schema==='saampath/2'||input?.schema==='saam-schedule/1','New paths require compact source or execution.');
  const copy=serializableSource(input);
  if(copy.schema==='saampath/2')admitSource(copy);else admitSchedule(copy);
  const path=freeze(copy);paths.add(path);return path;
}
// Exact source parameters and profile values survive JSON; no admission rounding.
export const saamPathText=input=>JSON.stringify(saamPath(input));

// Bundle supplies the immutable saved source identity. A joined view is never
// another persisted motion path, and contains no materialized segment list.
export function joinSaamPath({sourcePathId,deposition,schedule}){
  requireThat(typeof sourcePathId==='string'&&sourcePathId.length>0&&schedule?.sourcePathId===sourcePathId,'Schedule source identity mismatch.');
  const source=saamPath(deposition),execution=saamPath(schedule);
  requireThat(source.schema==='saampath/2'&&execution.schema==='saam-schedule/1','Compact join requires source and execution.');
  validateExecutionSource(source,execution);
  return Object.freeze({sourcePathId,deposition:source,schedule:execution});
}
