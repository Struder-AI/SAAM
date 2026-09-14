import {access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {initBundle,generateBundle} from '../../core/print/bundle.mjs';
import {surfaceDrapePlan} from './surface-drape/recipe.mjs';
import {wavyDensoPlan} from './wavy-denso/recipe.mjs';
import {nudgeCupPlan} from './nudge-cup/recipe.mjs';

export const demos=Object.freeze({
  'surface-drape':{machineId:'ultimaker-s5',plan:surfaceDrapePlan},
  'wavy-denso':{machineId:'denso-vp6242-rc8',plan:wavyDensoPlan},
  'nudge-cup':{machineId:'ultimaker-s5',plan:nudgeCupPlan}
});

export async function createDemos(selection='all',outputRoot='Prints/tour',{generate=false}={}){
  const ids=selection==='all'?Object.keys(demos):[selection];
  for(const id of ids){
    if(!Object.hasOwn(demos,id))throw Error('Choose all, '+Object.keys(demos).join(', '));
    try{await access(resolve(outputRoot,id));}
    catch(error){if(error.code==='ENOENT')continue;throw error;}
    throw Error('Demo destination already exists: '+resolve(outputRoot,id)+'. Choose a new output root.');
  }
  const results=[];
  for(const id of ids){
    const directory=resolve(outputRoot,id),demo=demos[id];
    await initBundle(directory,demo.plan(),{machineId:demo.machineId});
    const checks=generate?await generateBundle(directory,{development:true}):undefined;
    results.push({id,directory,checks});
  }
  return results;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),generate=args.includes('--generate');
  const positional=args.filter(arg=>arg!=='--generate');
  if(positional.length>2||positional.some(arg=>arg.startsWith('--')))throw Error('Usage: node examples/prints/create.mjs [all|demo-id] [output-root] [--generate]');
  console.log(JSON.stringify(await createDemos(positional[0],positional[1],{generate}),null,2));
  console.log('Unapproved development workspaces. Review each part in Studio before manufacturing.');
}
