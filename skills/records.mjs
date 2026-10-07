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
const heatSetTemplate=()=>({shape:'heat-set',base:null,features:[],toleranceMm:0.01,vertices:[],triangles:[]});
const meshRecord=(record,template)=>{
  if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).sort().join()!==Object.keys(template(record)).sort().join())
    throw Error(`Unexpected ${record?.shape} geometry fields.`);
  if(!Array.isArray(record.vertices)||!Array.isArray(record.triangles))
    throw Error(`Invalid ${record.shape} saved geometry record.`);
};
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
  'heat-set':{extension:'heat-set-inserts',template:heatSetTemplate,validate:record=>meshRecord(record,heatSetTemplate)}
});

const weldDefaults={enabled:false,sites:[],shaftDiameterMm:1.2,basinDiameterMm:3,
  basinHeightMm:1.2,wallMm:1.2,floorMm:0.8,seatDepthMm:0,volumeFactor:1,flowMm3S:0.5,holdSeconds:1,nozzleC:null};
const supportDefaults={enabled:false,assignments:[],topGapMm:0.2,xyGapMm:0.3,treeChordMm:0.02};
export const extensionSettings=()=>({'plastic-weld':structuredClone(weldDefaults),supports:structuredClone(supportDefaults)});

export function validateExtensionRecipe(plan){
  for(const [id,template] of [['plastic-weld',weldDefaults],['supports',supportDefaults]])
    if(plan.skills?.[id]!==undefined)requireThat(sameFields(plan.skills[id],template),`Invalid ${id} settings fields.`);
}

export function extensionProducerIds(plan){
  return [...(plan.skills?.supports?.enabled?['supports']:[]),
    ...(plan.skills?.['plastic-weld']?.enabled&&Array.isArray(plan.skills['plastic-weld'].sites)
      ?plan.skills['plastic-weld'].sites.map(site=>'plastic-weld:'+site.id):[])];
}

export function validateExtensionAssignment(assignment,options){
  const record=ASSIGNMENT_RECORDS[assignment.construction];
  if(!record)return false;
  record.validate(assignment,options);
  return true;
}

// The selected copy validates technique semantics only when construction is
// requested. Opening a saved bundle never evaluates extension code.
export async function validateSelectedExtensionRecipe(plan,processForAssignment){
  let heatSet=false;const runtimes=new Map();
  for(const geometry of geometryTree(plan.geometry)){
    const record=GEOMETRY_RECORDS[geometry.shape];if(!record)continue;
    if(!runtimes.has(record.extension))runtimes.set(record.extension,(await loadExtensionEntry(record.extension,'record-runtime'))());
    const runtime=runtimes.get(record.extension);
    runtime.validate(geometry);
    if(geometry.shape==='heat-set')heatSet=true;
  }
  if(heatSet)runtimes.get('heat-set-inserts').validateAssignments(plan);
  if(plan.skills?.supports?.enabled){
    const runtime=(await loadExtensionEntry('supports','record-runtime'))();
    runtime.validateSupports(plan.skills.supports,processForAssignment({id:'supports'}));
  }
  if(plan.skills?.['plastic-weld']?.enabled){
    const runtime=(await loadExtensionEntry('plastic-weld','record-runtime'))();
    runtime.validatePlasticWeld(plan,processForAssignment);
  }
  const sleeves=plan.slices?.assignments?.filter(assignment=>assignment.construction==='sleeve')??[];
  if(sleeves.length){
    const runtime=(await loadExtensionEntry('vase-wall','record-runtime'))();
    for(const assignment of sleeves)runtime.validateSleeveAssignment(assignment);
    const patterns=sleeves.filter(assignment=>assignment.pattern!==null);
    if(patterns.length){
      const advanced=(await loadExtensionEntry('advanced-vase-wall','record-runtime'))();
      for(const assignment of patterns)advanced.validateSleevePattern(assignment.pattern,assignment.pathMode);
    }
  }
}
