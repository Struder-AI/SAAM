// Structural records used to store and view supplied bundle values. Technique
// validation runs on regeneration through the selected extension copy.
import {loadExtensionEntry} from '../core/extensions/library.mjs';

const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
const sleeveDefaults={zStartMm:0,zEndMm:null,endTransition:'level',pattern:null,pathMode:'continuous',meshSleeve:null,
  sampleStepMm:1,toleranceMm:0.02,boundaryToleranceMm:0.02,minFeatureMm:0.4,sleeveToleranceMm:0.08};
const sleeveAssignment=({id,...options})=>structuredClone({id,construction:'sleeve',part:null,filament:null,process:null,after:[],...sleeveDefaults,...options});
const sameFields=(value,template)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join()===Object.keys(template).sort().join();

export const ASSIGNMENT_RECORDS=Object.freeze({
  sleeve:{make:sleeveAssignment,validate(assignment,{parts}={}){
    requireThat(sameFields(assignment,sleeveAssignment({id:assignment.id})),'Invalid sleeve assignment fields.');
    requireThat(typeof assignment.id==='string'&&/^[a-z][a-z0-9-]*$/.test(assignment.id),'Invalid sleeve assignment id.');
    requireThat(assignment.part===null||parts?.includes(assignment.part),'Sleeve names an unknown part.');
  },requiresComponent:true,
    family:()=> 'trace'}
});

const textTemplate=(record={})=>({shape:'text',base:null,features:[],toleranceMm:0.02,maxEdgeMm:1,
  vertices:[],triangles:[],materialParts:[],...(Object.hasOwn(record,'standalone')?{standalone:false}:{})});
const gridfinityTemplate=()=>({shape:'gridfinity',parameters:null,vertices:[],triangles:[]});
const heatSetTemplate=(record={})=>({shape:'heat-set',base:null,features:[],toleranceMm:0.01,...(Object.hasOwn(record,'solid')?{solid:null}:{vertices:[],triangles:[]})});
const meshRecord=(record,template)=>{
  if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).sort().join()!==Object.keys(template(record)).sort().join())
    throw Error(`Unexpected ${record?.shape} geometry fields.`);
  if(!Array.isArray(record.vertices)||!Array.isArray(record.triangles))
    throw Error(`Invalid ${record.shape} saved geometry record.`);
};
function heatSetRecord(record){
  if(!record?.solid)return meshRecord(record,heatSetTemplate);
  requireThat(sameFields(record,heatSetTemplate(record))&&typeof record.solid.shape==='string','Invalid native heat-set geometry record.');
}
// Every geometry in a recipe tree: the root, bases, solids, parts and operands.
export function geometryTree(geometry){
  const geometries=[];
  const visit=node=>{
    if(!node||typeof node!=='object')return;
    geometries.push(node);visit(node.base);visit(node.solid);
    for(const part of node.parts??[])visit(part.geometry);
    for(const operand of node.operands??[])visit(operand);
  };
  visit(geometry);return geometries;
}
// Compiled geometry changes only through the tool that compiles it.
export const COMPILED_GEOMETRY_TOOLS=Object.freeze({'blob-field':'blob_field',gridfinity:'gridfinity',text:'apply_text','heat-set':'apply_heat_set'});
export const GEOMETRY_RECORDS=Object.freeze({
  text:{extension:'text',template:textTemplate,validate:record=>meshRecord(record,textTemplate)},
  gridfinity:{extension:'gridfinity',template:gridfinityTemplate,validate:record=>meshRecord(record,gridfinityTemplate)},
  'heat-set':{extension:'heat-set-inserts',template:heatSetTemplate,validate:heatSetRecord}
});

export function validateExtensionRecipe(plan){
  requireThat(plan.skills&&typeof plan.skills==='object'&&!Array.isArray(plan.skills),'Extension settings must be named records.');
  for(const [id,settings] of Object.entries(plan.skills))requireThat(/^[a-z][a-z0-9-]*$/.test(id)&&settings&&typeof settings==='object'&&!Array.isArray(settings),'Invalid extension settings record.');
}

export function validateExtensionAssignment(assignment,options){
  const record=ASSIGNMENT_RECORDS[assignment.construction];
  if(!record)return false;
  record.validate(assignment,options);
  return true;
}

// The selected copy validates the construction about to run. Completed
// geometry records use their stored meshes; their authors run only on edits.
export async function validateSelectedExtensionRecipe(plan){
  const failures=[];
  const sleeves=plan.slices?.assignments?.filter(assignment=>assignment.construction==='sleeve')??[];
  if(sleeves.length){
    try{
      const runtime=(await loadExtensionEntry('vase-wall','record-runtime'))();
      for(const assignment of sleeves)try{runtime.validateSleeveAssignment(assignment);}catch(error){
        if(error.name==='AbortError'||error.code==='ABORT_ERR')throw error;
        failures.push({assignment:assignment.id,message:error.message});
      }
    }catch(error){
      if(error.name==='AbortError'||error.code==='ABORT_ERR')throw error;
      for(const assignment of sleeves)failures.push({assignment:assignment.id,message:error.message});
    }
    const patterns=sleeves.filter(assignment=>assignment.pattern!==null&&!failures.some(failure=>failure.assignment===assignment.id));
    if(patterns.length){
      try{
        const advanced=(await loadExtensionEntry('advanced-vase-wall','record-runtime'))();
        for(const assignment of patterns)try{advanced.validateSleevePattern(assignment.pattern,assignment.pathMode);}catch(error){
          if(error.name==='AbortError'||error.code==='ABORT_ERR')throw error;
          failures.push({assignment:assignment.id,message:error.message});
        }
      }catch(error){
        if(error.name==='AbortError'||error.code==='ABORT_ERR')throw error;
        for(const assignment of patterns)failures.push({assignment:assignment.id,message:error.message});
      }
    }
  }
  return {failures};
}
