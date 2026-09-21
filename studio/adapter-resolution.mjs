import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {referenceAdapter} from './tour.mjs';

const bundles={
  'saam-machine-study/1':()=>import('./machine-study.mjs'),
  'saam-shell-plan/1':()=>import('../core/print/bundle.mjs')
};

export const supportsBundleSchema=schema=>Boolean(bundles[schema]);

// Studio reviews whatever print it is opened on. A bundle names its own schema,
// and that selects its geometry/recipe adapter. Both adapters use the single
// workflow implementation in core/print/workflow.mjs.
export async function bundleFor(directory) {
  const plan=JSON.parse(await readFile(resolve(directory,'plan.json'),'utf8'));
  const load=bundles[plan.schema];
  if(!load)throw new Error(`This print uses ${plan.schema??'an unknown plan format'}, which Studio cannot review.`);
  const adapter=await load();return plan.schema==='saam-shell-plan/1'?referenceAdapter(adapter):adapter;
}

// A CLI update replaces several bundle files. Retry only reads caught between
// those replacements; persistent corruption still fails the normal validation.
// One fingerprint pass on each side of the load yields both the source and
// presentation fingerprints; presentation derives from files source covers.
export async function readStableBundle(adapter,directory,options){
  for(let attempt=0;;attempt++){
    let before;
    try{
      before=await adapter.bundleFingerprints(directory,options);
      const state=await adapter.loadBundle(directory,options);
      if(before.source!==(await adapter.bundleFingerprints(directory,options)).source)throw Error('The print is being updated.');
      return {state,fingerprint:before.source,presentationFingerprint:before.presentation};
    }catch(error){
      const changing=before!==undefined&&before.source!==(await adapter.bundleFingerprints(directory,options)).source;
      if(attempt>=3||!changing&&error.code!=='ENOENT'&&!/Plan and geometry disagree|being updated/.test(error.message))throw error;
      await new Promise(resolve=>setTimeout(resolve,60*(attempt+1)));
    }
  }
}
