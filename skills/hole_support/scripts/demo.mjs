import {resolve} from 'node:path';
import {initBundle,proposedPlan,generateBundle} from '../../../core/print/bundle.mjs';
import {referenceControl,referenceInventory} from './reference.mjs';
import {inspectHoleSupport,applyHoleSupport} from './bundle.mjs';

const directory=resolve(process.argv[2]??'Prints/development/hole-support'),strategy=process.argv[3];
const plan=await proposedPlan('ultimaker-s5');
plan.geometry=await referenceControl();plan.placement={xMm:80,yMm:80};
plan.skills['draped-skin'].enabled=false;
plan.skills['planar-infill'].enabled=true;plan.skills['planar-infill'].density=0.15;
plan.skills['full-fill'].mode='solid-surfaces';
await initBundle(directory,plan,{machineId:'ultimaker-s5'});
const inspection=await inspectHoleSupport(directory);
if(strategy){const {part,applied,...feature}=inspection.features[0];await applyHoleSupport(directory,{feature:{...feature,strategy}},{expectedRevision:inspection.revision});await generateBundle(directory,{development:true});}
console.log(JSON.stringify({directory,inspection,references:await referenceInventory(),development:true},null,2));
