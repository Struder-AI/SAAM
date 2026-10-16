import {splineBlock} from './shapes.mjs';
import {compileHeatSet} from '../../../skills/heat-set-inserts/scripts/geometry.mjs';
import {plasticWeldRuntime,PLASTIC_WELD_DEFAULTS} from '../../../skills/plastic-weld/scripts/runtime.mjs';
import {defaults} from '../../../core/print/plan.mjs';
import {assignmentFilament} from '../../../core/print/assignment-process.mjs';
import {injectionAssignment} from '../../../core/print/injection.mjs';
// A second Boolean consumes an already trimmed insert part through Geometry.
export default async function(G){
 const base=splineBlock({runMm:16,widthMm:16,heightsMm:[[8,8,8],[8,9,8],[8,8,8]]});
 const insert=await compileHeatSet(base,[{id:'top-seat',insertId:'spirol-19-m2-short',positionMm:[5.2,5.8,8.2],axis:[.12,0,-1],chamferDepthMm:.3}],G),host=await G.buildGeometry(insert.geometry);
 const plan=defaults();plan.geometry=insert.geometry;plan.skills['plastic-weld']={...structuredClone(PLASTIC_WELD_DEFAULTS),enabled:true,sites:[{id:'side-tie',part:null,positionMm:[16,10.4,5.5],axis:[-1,-.17,-.09],depthMm:5.2}]};
 const runtime=plasticWeldRuntime({Geometry:G,Recipe:{assignmentFilament,injectionAssignment}}),prepared=await runtime.preparePlasticWeld({plan,placed:host,componentShells:null,processForAssignment:()=>plan.process});
 if(prepared.sites.length!==1)throw Error(prepared.notes.join('; '));
 return {name:'A side-entry weld cut into an already trimmed insert part',operation:'difference',operands:[host,prepared.sites[0].cavity]};
}
