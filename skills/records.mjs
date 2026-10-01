// Editable extension recipes are validated here. Their saved vertices and
// triangles are ordinary mesh input to geometry; no feature builder runs there.
import {textTemplate,validateTextRecord} from './text/scripts/record.mjs';
import {gridfinityTemplate,validateGridfinityRecord} from './gridfinity/scripts/record.mjs';
import {heatSetTemplate,validateHeatSetRecord,validateHeatSetAssignments} from './heat-set-inserts/scripts/feature.mjs';
import {SUPPORT_DEFAULTS,validateSupports} from './supports/scripts/supports.mjs';
import {PLASTIC_WELD_DEFAULTS,validatePlasticWeld} from './plastic-weld/scripts/weld.mjs';
import {assignmentPlan} from '../core/print/assignment-process.mjs';
import {sleeveAssignment,validateSleeveAssignment} from './advanced-vase-wall/scripts/assignment.mjs';

export const ASSIGNMENT_RECORDS=Object.freeze({
  sleeve:{make:sleeveAssignment,validate:validateSleeveAssignment,requiresComponent:true,
    family:assignment=>assignment.pattern===null?'slice':'trace'}
});

export const GEOMETRY_RECORDS=Object.freeze({
  text:{extension:'text',template:textTemplate,validate:validateTextRecord},
  gridfinity:{extension:'gridfinity',template:gridfinityTemplate,validate:validateGridfinityRecord},
  'heat-set':{extension:'heat-set-inserts',template:heatSetTemplate,validate:validateHeatSetRecord}
});

export const extensionSettings=()=>({'plastic-weld':structuredClone(PLASTIC_WELD_DEFAULTS),supports:structuredClone(SUPPORT_DEFAULTS)});

export function validateExtensionRecipe(plan,machine){
  validatePlasticWeld(plan,machine);
  validateSupports(plan.skills.supports,assignmentPlan(plan,machine,{id:'supports'}).process);
  if(plan.geometry)validateHeatSetAssignments(plan);
}

export function extensionProducerIds(plan){
  return [...(plan.skills.supports.enabled?['supports']:[]),
    ...(plan.skills['plastic-weld'].enabled?plan.skills['plastic-weld'].sites.map(site=>'plastic-weld:'+site.id):[])];
}

export function validateExtensionAssignment(assignment,options){
  const record=ASSIGNMENT_RECORDS[assignment.construction];
  if(!record)return false;
  record.validate(assignment,options);
  return true;
}
