// One reviewed solid; the print plan selects its prepared material partitions.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {surfaceDrapePlan} from '../../../examples/prints/surface-drape/recipe.mjs';
import {initBundle,adjustBundle} from '../../../core/print/bundle.mjs';
import {applyText} from '../../../core/print/text.mjs';
import {skinAssignment} from '../../../core/print/surface-constructions.mjs';

const directory=resolve(process.argv[2]??'Prints/draped-lettering');
const text=process.argv[3]??'SAAM',plan=surfaceDrapePlan();
await initBundle(directory,plan,{machineId:'ultimaker-s5'});
const state=await applyText(directory,{feature:{id:'label',text,
  fontPath:fileURLToPath(new URL('../tests/fixtures/Abel-Regular.ttf',import.meta.url)),
  sizeMm:20,align:'center',positionMm:[50,23],outlineOffsetMm:0.15,depthMm:0.8,reference:{kind:'top'}}});
// The base is sliced under its draped roof; the letters are skin only.
await adjustBundle(directory,{slices:{...state.plan.slices,assignments:[
  ...state.plan.slices.assignments.map(a=>({...a,part:'base',...(a.construction==='skin'?{id:'finished-roof'}:{})})),
  skinAssignment({id:'raised-lettering',part:'text/label',supportFrom:'finished-roof',layers:4,normalMm:0.2,sampleStepMm:0.2,surveyStepMm:0.1})
]}},{expectedRevision:state.revision});
console.log(JSON.stringify({directory,text,roofLayers:3,letterLayers:4,letterReliefMm:0.8,approvals:'none'}));
