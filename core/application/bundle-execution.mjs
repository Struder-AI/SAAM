import {resolve} from 'node:path';

// One admitted Bundle solve, shared by the current generation entry and the
// recipe executor. Draft edits never enter this registry or start work.
const active=new Set();
export async function runBundleSolve(directory,action){
  if(typeof directory!=='string'||!directory)throw TypeError('Supply the admitted Bundle directory.');
  const absolute=resolve(directory),key=process.platform==='win32'?absolute.toLowerCase():absolute;
  if(active.has(key))throw Object.assign(Error('This Bundle already has a solve running. Wait for it to finish before submitting again.'),{code:'BUNDLE_SOLVE_RUNNING'});
  active.add(key);
  try{return await action();}finally{active.delete(key);}
}
