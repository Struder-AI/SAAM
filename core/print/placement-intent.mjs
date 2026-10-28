// Bundle retains origin independently of the resolved numerical coordinates.
// Missing legacy origin facts stay unknown; a number never establishes origin.
import {requireThat} from '../private/bundle/numeric.mjs';

const AXES=['xMm','yMm'];
const MESSAGE='Placement origins must contain only xMm/yMm authored or derived values.';
export function checkedPlacementOrigins(value){
  if(value===undefined)return undefined;
  requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null),MESSAGE);
  const entries=Reflect.ownKeys(value).map(key=>[key,value[key]]);
  requireThat(entries.every(([key,origin])=>AXES.includes(key)&&['authored','derived'].includes(origin)),MESSAGE);
  return Object.freeze(Object.fromEntries(AXES.flatMap(axis=>entries.filter(([key])=>key===axis))));
}

export function editedPlacementOrigins(previous,placement){
  const origins=checkedPlacementOrigins(previous);
  const supplied=placement&&typeof placement==='object'&&!Array.isArray(placement)
    ?AXES.filter(key=>Object.hasOwn(placement,key)&&Number.isFinite(placement[key])):[];
  return supplied.length?checkedPlacementOrigins({...origins,...Object.fromEntries(supplied.map(key=>[key,'authored']))}):origins;
}

export function initialPlacementOrigins(placement){
  return editedPlacementOrigins({xMm:'derived',yMm:'derived'},placement);
}
