import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {frontAssignment} from '../../../core/print/surface-constructions.mjs';
import {defaults} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
// A box is six flat patches, each a 2 × 2 net of shared corners (GEOMETRY.md).
const splineBox=({runMm:x,widthMm:y,heightMm:z})=>{
  const face=(name,a,b,c,d)=>({name,degreeU:1,degreeV:1,controlPoints:[[a,b],[c,d]]});
  return {shape:'spline',patches:[face('top',[0,0,z],[0,y,z],[x,0,z],[x,y,z]),face('bottom',[0,0,0],[0,y,0],[x,0,0],[x,y,0]),
    face('front',[0,0,0],[0,0,z],[x,0,0],[x,0,z]),face('right',[x,0,0],[x,0,z],[x,y,0],[x,y,z]),
    face('back',[0,y,0],[0,y,z],[x,y,0],[x,y,z]),face('left',[0,0,0],[0,0,z],[0,y,0],[0,y,z])]};
};

export function waveExamplePlan(machine=loadMachine()){
  const plan=defaults(machine);
  plan.geometry=splineBox({runMm:5,widthMm:5,heightMm:1});
  plan.slices.assignments.push(frontAssignment({id:'cantilever',lineSpacingMm:.3,propagationStepMm:.3,
      reason:'The X=5 edge matches the box top at Z=1; grow a saddle-shaped surface beyond it in one continuous pass.',
      surface:{kind:'spline',offsetMm:0,patch:{name:'cantilever',degreeU:1,degreeV:1,controlPoints:[[[0,0,0.7],[0,5,0.45]],[[10,0,1.3],[10,5,1.55]]] }},
      domainUv:[[[0.4,0],[1,0],[1,1],[0.4,1]]],
      seedUv:[[[0.4,0],[0.5,0],[0.5,1],[0.4,1]]],afterParts:[null],beforeParts:[]}));
  return plan;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(!process.argv[2])throw new Error('Provide a new print directory for this development example.');
  const {initBundle,generateBundle,loadBundle}=await import('../../../core/print/bundle.mjs');
  const dir=resolve(process.argv[2]);
  await initBundle(dir,waveExamplePlan());
  const result=await generateBundle(dir,{development:true});
  const state=await loadBundle(dir);
  console.log(JSON.stringify({directory:dir,mode:result.mode,fronts:state.pathSummary.slices.instances.filter(r=>r.fillOrder).map(r=>({id:r.id,...r.fillOrder}))},null,2));
}
