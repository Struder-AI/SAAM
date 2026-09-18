// One reviewed solid; the print plan selects its prepared material partitions.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {surfaceDrapePlan} from '../../../examples/prints/surface-drape/recipe.mjs';
import {initBundle,adjustBundle} from '../../../core/print/bundle.mjs';
import {applyText} from '../../../core/print/text.mjs';

const directory=resolve(process.argv[2]??'Prints/draped-lettering');
const text=process.argv[3]??'SAAM',plan=surfaceDrapePlan();
await initBundle(directory,plan,{machineId:'ultimaker-s5'});
const state=await applyText(directory,{feature:{id:'label',text,
  fontPath:fileURLToPath(new URL('../tests/fixtures/Abel-Regular.ttf',import.meta.url)),
  sizeMm:20,align:'center',positionMm:[50,23],outlineOffsetMm:0.15,depthMm:0.8,reference:{kind:'top'}}});
await adjustBundle(directory,{composition:{regions:[
  {id:'finished-roof',part:'base',zStartMm:0,zEndMm:null,skills:{'planar-infill':{},'full-fill':{mode:'solid-surfaces'},'draped-skin':{}},lowerSurfaceFrom:null},
  {id:'raised-lettering',part:'text/label',zStartMm:0,zEndMm:null,skills:{'draped-skin':{layers:4,normalMm:0.2,sampleStepMm:0.2,surveyStepMm:0.1}},lowerSurfaceFrom:'finished-roof'}
]}},{expectedRevision:state.revision});
console.log(JSON.stringify({directory,text,roofLayers:3,letterLayers:4,letterReliefMm:0.8,approvals:'none'}));
