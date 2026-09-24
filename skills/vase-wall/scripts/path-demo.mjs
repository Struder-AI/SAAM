// A tile repeats around a real closed sleeve through the common lifecycle.
import {resolve} from 'node:path';
import {defaults} from '../../../core/print/plan.mjs';
import {initBundle,generateBundle} from '../../../core/print/bundle.mjs';
const mode=process.argv[3]??'continuous';
if(!['continuous','segmented'].includes(mode))throw new Error('Choose continuous or segmented.');
const plan=defaults();
plan.geometry={shape:'pipe',innerRadiusMm:12,outerRadiusMm:14,heightMm:10.5,toleranceMm:.01};
for(const settings of Object.values(plan.skills))settings.enabled=false;
plan.placement={xMm:125,yMm:105};
const points=Array.from({length:33},(_,i)=>{const u=i/32;return [u,.2*u+(i%4===2?.06:0)];});
Object.assign(plan.skills['vase-wall'],{enabled:true,endTransition:'spiral',pathMode:mode,pattern:{advance:[mode==='continuous'?1:1.0625,.2],repeats:50,paths:[{points,beadHeightMm:.2}]}});
const directory=resolve(process.argv[2]??`Prints/development/${mode}-sleeve-zigzag`);
await initBundle(directory,plan);const checked=await generateBundle(directory,{development:true});
console.log(JSON.stringify({directory,mode,moves:checked.moves,estimatedMinutes:checked.estimatedMinutes,
  scope:'Development preview on a 28 mm diameter sleeve; no human approval or physical validation.'},null,2));
