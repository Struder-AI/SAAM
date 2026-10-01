// Native file/construction runtime is loaded only by geometry operations.
import rhino3dm from 'rhino3dm';
let runtime;
export const rhino=()=>runtime??=rhino3dm();
