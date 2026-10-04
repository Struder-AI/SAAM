// Native file/construction runtime is loaded only by geometry operations.
import rhino3dm from 'rhino3dm';
const loaded={runtime:null};
export const rhino=()=>loaded.runtime??=rhino3dm();
