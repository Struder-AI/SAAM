import {requireThat} from '../private/bundle/numeric.mjs';

// Authored edits opt into their input identity. A legacy full-manifest revision
// remains strict; supplying both explicitly selects the edit identity.
export function requireEditRevision(state,{expectedRevision,expectedEditRevision}={}, {optional=false}={}){
  if(expectedEditRevision!==undefined){
    requireThat(typeof expectedEditRevision==='string'&&expectedEditRevision.length>0&&expectedEditRevision===state.editRevision,'This edit is stale. Reload before changing the print.');
    return;
  }
  requireThat(optional&&expectedRevision===undefined||typeof expectedRevision==='string'&&expectedRevision.length>0&&expectedRevision===state.revision,'This review is stale. Supply expectedEditRevision or reload before changing the print.');
}
