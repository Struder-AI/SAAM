import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

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
  return load();
}
