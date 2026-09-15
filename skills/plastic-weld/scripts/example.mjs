import {resolve} from 'node:path';
import {initBundle,proposedPlan} from '../../../core/print/bundle.mjs';
import {staggeredWeldSites} from './weld.mjs';
const [directory,...flags]=process.argv.slice(2);
if(!directory||flags.some(f=>f!=='--sparse'))throw new Error('Use example.mjs <new-print-directory> [--sparse].');
const plan=await proposedPlan('ultimaker-s5');
plan.geometry={shape:'box',runMm:24,widthMm:16,heightMm:9};
plan.skills['draped-skin'].enabled=false;
if(flags.includes('--sparse')){plan.skills['full-fill'].enabled=false;plan.skills['planar-infill'].enabled=true;}
plan.skills['plastic-weld'].enabled=true;
plan.skills['plastic-weld'].sites=staggeredWeldSites({columns:1,rows:1,levels:2,pitchMm:12,xMm:6,yMm:8});
await initBundle(resolve(directory),plan,{machineId:'ultimaker-s5'});
console.log('Created unapproved plastic-weld coupon: '+resolve(directory));
