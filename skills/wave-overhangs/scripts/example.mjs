import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {defaults} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';

export function waveExamplePlan(machine=loadMachine()){
  const plan=defaults(machine);
  plan.geometry={shape:'box',runMm:5,widthMm:5,heightMm:1};
  plan.skills['draped-skin'].enabled=false;
  plan.skills['wave-overhangs']={...plan.skills['wave-overhangs'],enabled:true,
    lineSpacingMm:0.3,propagationStepMm:0.3,slices:[{id:'cantilever',
      reason:'The X=5 edge matches the box top at Z=1; grow a saddle-shaped surface beyond it in one continuous pass.',
      surface:{degreeU:1,degreeV:1,controlPoints:[[[0,0,0.7],[0,5,0.45]],[[10,0,1.3],[10,5,1.55]]]},
      domainUv:[[[0.4,0],[1,0],[1,1],[0.4,1]]],
      seedUv:[[[0.4,0],[0.5,0],[0.5,1],[0.4,1]]],afterParts:[null],beforeParts:[]}]};
  return plan;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(!process.argv[2])throw new Error('Provide a new print directory for this development example.');
  const {initBundle,generateBundle,loadBundle}=await import('../../../core/print/bundle.mjs');
  const dir=resolve(process.argv[2]);
  await initBundle(dir,waveExamplePlan());
  const result=await generateBundle(dir,{development:true});
  const state=await loadBundle(dir);
  console.log(JSON.stringify({directory:dir,mode:result.mode,waveOverhangs:state.pathSummary.waveOverhangs},null,2));
}
