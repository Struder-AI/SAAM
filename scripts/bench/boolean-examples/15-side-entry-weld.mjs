import {splineBox} from './shapes.mjs';
import {plasticWeldSource,PLASTIC_WELD_DEFAULTS} from '../../../skills/plastic-weld/scripts/runtime.mjs';
import {defaults} from '../../../core/print/plan.mjs';
import {assignmentFilament} from '../../../core/print/assignment-process.mjs';
import {injectionAssignment} from '../../../core/print/injection.mjs';
export default async function(G){const plan=defaults();plan.geometry=splineBox({runMm:12,widthMm:9,heightMm:7});plan.skills['plastic-weld']={...structuredClone(PLASTIC_WELD_DEFAULTS),enabled:true,sites:[{id:'side-anchor',part:null,positionMm:[12,4.7,4.1],axis:[-1,.21,-.08],depthMm:5.4}]};const host=await G.buildGeometry(plan.geometry),runtime=plasticWeldSource({Geometry:G,Recipe:{assignmentFilament,injectionAssignment},extensionId:'plastic-weld',settings:plan.skills['plastic-weld']}),prepared=await runtime.prepare({plan,placed:host,componentShells:null,processForAssignment:()=>plan.process});if(prepared.contributions.length!==1)throw Error(prepared.notes.join('; '));return {name:'Plastic weld entering a side wall at a compound angle',operation:'difference',operands:[host,prepared.contributions[0].geometryCuts[0].geometry]};}
