// Bundle admits compact immutable source and execution. Older saved motion is
// decoded only by curve-path's compatibility reader; it is never a new writer.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {admitPath as saamPath,validateExecutionSource} from './source-admission.mjs';
export {saamPath};
export const moveSeconds=(lengthMm,speedMmS)=>speedMmS>0?lengthMm/speedMmS:Infinity;
export const knownSeconds=(lengthMm,speedMmS)=>speedMmS>0?lengthMm/speedMmS:0;
// Exact source parameters and profile values survive JSON; no admission rounding.
export const saamPathText=input=>JSON.stringify(saamPath(input));

// Bundle supplies the immutable saved source identity. A joined view is never
// another persisted motion path, and contains no materialized segment list.
export function joinSaamPath({sourcePathId,deposition,schedule}){
  requireThat(typeof sourcePathId==='string'&&sourcePathId.length>0&&schedule?.sourcePathId===sourcePathId,'Schedule source identity mismatch.');
  const source=saamPath(deposition),execution=saamPath(schedule);
  requireThat(source.schema==='saampath/3'&&execution.schema==='saam-schedule/1','Compact join requires source and execution.');
  requireThat(execution.sourcePathId===sourcePathId,'Schedule source identity mismatch.');
  return validateExecutionSource(source,execution);
}
