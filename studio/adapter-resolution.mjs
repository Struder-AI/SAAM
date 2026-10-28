import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// How Studio reads the print it shows. A Bundle print is Bundle's state plus
// Studio's drawing and presentation of it; a machine study is Studio's own file.
async function shellBundle(){
  const [bundle,{readDrawnPath},{presentBundle}]=await Promise.all([import('../core/print/bundle.mjs'),
    import('./drawn-path.mjs'),import('./bundle-presentation.mjs')]);
  return {...bundle,readDrawnPath,presentBundle};
}
const bundles={
  'saam-machine-study/1':()=>import('./machine-study.mjs'),
  'saam-shell-plan/1':shellBundle,
  // A wedge plan reads as a shell plan whose retired geometry is its saved mesh.
  'saam-wedge-plan/1':shellBundle
};

function bundleLoader(schema){
  const key=schema??'saam-shell-plan/1';return Object.hasOwn(bundles,key)?bundles[key]:null;
}
export const supportsBundleSchema=schema=>Boolean(bundleLoader(schema));

// Studio reviews whatever print it is opened on. A print names its own schema,
// and that selects how Studio reads it.
export async function bundleFor(directory) {
  const plan=JSON.parse(await readFile(resolve(directory,'plan.json'),'utf8'));
  const load=bundleLoader(plan.schema);
  if(!load)throw new Error(`This print uses ${plan.schema??'an unknown plan format'}, which Studio cannot review.`);
  return load();
}
