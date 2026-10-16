import {splineBox} from './shapes.mjs';
import {plasticWeldRuntime,PLASTIC_WELD_DEFAULTS} from '../../../skills/plastic-weld/scripts/runtime.mjs';
import {defaults} from '../../../core/print/plan.mjs';
import {assignmentFilament} from '../../../core/print/assignment-process.mjs';
import {injectionAssignment} from '../../../core/print/injection.mjs';
export default async function(G){const plan=defaults();plan.geometry=splineBox({runMm:12,widthMm:9,heightMm:7});plan.skills['plastic-weld']={...structuredClone(PLASTIC_WELD_DEFAULTS),enabled:true,sites:[{id:'side-anchor',part:null,positionMm:[12,4.7,4.1],axis:[-1,.21,-.08],depthMm:5.4}]};const host=await G.buildGeometry(plan.geometry),runtime=plasticWeldRuntime({Geometry:G,Recipe:{assignmentFilament,injectionAssignment}}),prepared=await runtime.preparePlasticWeld({plan,placed:host,componentShells:null,processForAssignment:()=>plan.process});if(prepared.sites.length!==1)throw Error(prepared.notes.join('; '));return {name:'Plastic weld entering a side wall at a compound angle',operation:'difference',operands:[host,prepared.sites[0].cavity]};}
