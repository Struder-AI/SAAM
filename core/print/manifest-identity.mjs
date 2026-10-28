import {createHash} from 'node:crypto';

// A manifest's revision. One saved without a revision is identified by its
// content until its next commit records one. No storage or domain execution.
export function manifestRevision(document){
  if(!document?.bundle)return undefined;
  return document.bundle.revision??'saved-'+createHash('sha256').update(JSON.stringify(document)).digest('hex');
}
