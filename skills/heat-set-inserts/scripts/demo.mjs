import {resolve} from 'node:path';
import {initBundle,proposedPlan,generateBundle,loadBundle} from '../../../core/print/bundle.mjs';
import {applyHeatSet} from '../../../core/print/heat-set.mjs';

const directory=resolve(process.argv[2]??'Prints/development/heat-set-inserts');
const plan=await proposedPlan('ultimaker-s5');
plan.geometry={shape:'box',runMm:54,widthMm:32,heightMm:12};
plan.placement={xMm:80,yMm:80};
plan.skills['draped-skin'].enabled=false;
plan.skills['planar-infill'].enabled=true;
plan.skills['planar-infill'].perimeters=2;
plan.skills['planar-infill'].density=0.15;
plan.skills['full-fill'].mode='solid-surfaces';
await initBundle(directory,plan,{machineId:'ultimaker-s5'});
await applyHeatSet(directory,{feature:{id:'metric',insertId:'spirol-29-m3-long',positionMm:[14,16,12]}});
await applyHeatSet(directory,{feature:{id:'imperial',insertId:'spirol-19-4-40-short',positionMm:[40,16,12]}});
const checks=await generateBundle(directory,{development:true});
const state=await loadBundle(directory);
console.log(JSON.stringify({directory,checks,toolpathApproved:state.toolpathApproved},null,2));
