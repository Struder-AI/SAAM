import {requireThat as requireThat_toolpath} from '../private/toolpath/numeric.mjs';
import {ASSIGNMENT_RECORDS,GEOMETRY_RECORDS,validateExtensionRecipe} from '../../skills/records.mjs';
// Recipe (plan.json) for shell-based prints: geometry, placement, setup, shared
// process settings, and the settings of each selected skill.
//
// Any recipe is read as a current one (readRecipe): a missing field takes its
// current default, an unknown field is ignored, and a piece generation cannot
// use is skipped. Each is a recipe note; the rest generates. Validation refuses
// only what cannot be built.

import {requireThat} from '../geom/tolerance.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {settingsDefaults} from '../machine/settings.mjs';
import {makeMesh,hasMesh} from '../geom/mesh.mjs';
import {splineSolidTemplate,validateSplineSolid,splineSolidBounds} from '../geom/spline-solid.mjs';
import {blobFieldTemplate,validateBlobFieldRecord} from '../geom/blob-field-record.mjs';
import {booleanSolidTemplate,validateBooleanSolid,booleanShell} from '../geom/boolean-solid.mjs';
import {assemblyComponents} from '../geom/selections.mjs';
import {spatialTemplate} from '../geom/spatial.mjs';
import {normalizeSpatialPlan,resolveSpatialPlan} from './spatial-inputs.mjs';
import {defaultSlices,validateSlices} from "./slice-records.mjs";
import {defaultModulations,readModulations,validateModulations} from '../path/modulation.mjs';
import {modulationGeometrySources} from '../path/modulation-field.mjs';
import {assignmentPlan,depositionAssignments} from './assignment-process.mjs';
import {currentAssignmentForms,currentSupportForms} from './recipe-migration.mjs';

// Fixed release metadata, so regenerating a reviewed plan is byte-identical.
import {VERSION} from './version.mjs';
export {VERSION,BUILD_DATE} from './version.mjs';

export function defaults(machine=loadMachine()) {
  return {...recipeDefaults(),...settingsDefaults(machine)};
}

export function recipeDefaults(){
  return {
    schema:'saam-shell-plan/1',generatorVersion:VERSION,
    experimental:{substrateAdaptation:false,sharedMaterial:false},skills:{},
    slices:defaultSlices(),modulations:defaultModulations(),
    composition:{order:[],dependencies:[],filaments:[]}
  };
}

// Each shape carries its own parameters, so its fields are read against the
// selected shape rather than against whichever shape is the default.
export function geometryTemplate(shape,geometry) {
  if(shape==='spatial')return spatialTemplate();
  if(shape==='blob-field')return blobFieldTemplate();
  if(shape==='boolean')return booleanSolidTemplate(geometry);
  if(Object.hasOwn(GEOMETRY_RECORDS,shape))return GEOMETRY_RECORDS[shape].template(geometry);
  if(shape==='mesh')return {shape:'mesh',vertices:[],triangles:[],source:null};
  if(shape==='assembly')return {shape:'assembly',parts:[]};
  return splineSolidTemplate();
}

const compiledRecipes=new Map();
const ownedRecipes=new WeakMap();
function freezeRecipe(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    Object.values(value).forEach(freezeRecipe);Object.freeze(value);
  }
  return value;
}
// The generation input of a recipe and its recipe notes.
export function compileRecipe(plan){
  const owned=ownedRecipes.get(plan);
  if(owned)return owned;
  const key=JSON.stringify(plan);
  if(compiledRecipes.has(key))return compiledRecipes.get(key);
  const read=readRecipe(structuredClone(resolveSpatialPlan(normalizeSpatialPlan(plan))));
  const value={plan:read.generated,notes:read.notes};
  validateRecipeValue(value.plan,read.plan);
  freezeRecipe(value);
  // Eviction only affects reuse, never which recipes are accepted.
  if(compiledRecipes.size>=4)compiledRecipes.delete(compiledRecipes.keys().next().value);
  compiledRecipes.set(key,value);ownedRecipes.set(value.plan,value);return value;
}
export function validatePlan(plan){compileRecipe(plan);return plan;}

// Authored forms (spline patches, meshes, assemblies of them) and the
// compiled records of geometry skills.
export const GEOMETRY_SHAPES=['spline','blob-field','mesh','boolean','assembly','spatial',...Object.keys(GEOMETRY_RECORDS)];

const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
// Layer and line steps are read as authored: an assignment without a positive
// step produces nothing and says so (generationRecipe).
const STEP_FIELDS=['firstLayerMm','layerMm','lineWidthMm'];

// One reading of a recipe: plan is the recipe with current fields and
// assignment forms (what a bundle presents and saves on its next commit),
// generated is what generation uses, and notes name every field filled or
// ignored, every form rewritten and every piece skipped.
export function readRecipe(plan,machine=null){
  const supports=currentSupportForms(plan),fields={filled:[],ignored:[]},forms=currentAssignmentForms(currentFields(supports.plan,machine,fields)),current=forms.plan,generated=generationRecipe(current,forms.unread);
  return {plan:current,generated:generated.plan,notes:[...supports.notes,...forms.notes,
    ...(fields.filled.length?[`Recipe fields filled from current defaults: ${fields.filled.join(', ')}; the next save or migrate_bundle records them.`]:[]),
    ...(fields.ignored.length?[`Recipe fields ignored, not read by this SAAM: ${fields.ignored.join(', ')}; the next save or migrate_bundle drops them.`]:[]),
    ...generated.notes]};
}

// Each section takes its defaults' missing and unreadable fields and drops the
// fields it does not read. Fields are removed by name and sections rebuilt by
// name, so no value moves to another field. Geometry is only trimmed: its
// fields are never invented; retired supports become independent Slice solids
// (currentSupportForms). A setup is machine-specific: completed, never trimmed.
function currentFields(plan,machine,fields){
  const {skills,...base}=recipeDefaults(),settings=settingsDefaults(machine),defaults={...base,...settings};
  const present=isRecord(plan.skills)?plan.skills:{};
  const geometry=isRecord(plan.geometry)?geometryTemplate(plan.geometry.shape,plan.geometry):null;
  noteFields(plan,{...defaults,...(Object.hasOwn(plan,'skills')?{skills}:{}),...(Object.hasOwn(plan,'geometry')?{geometry}:{}),...(Object.hasOwn(plan,'workspace')?{workspace:null}:{})},'',fields,true);
  for(const name of ['process','placement','experimental','composition','slices','modulations'])
    if(isRecord(plan[name]))noteFields(plan[name],defaults[name],name+'.',fields,true);
  if(isRecord(plan.setup))for(const key of Object.keys(settings.setup))if(!Object.hasOwn(plan.setup,key))fields.filled.push('setup.'+key);
  if(geometry)noteFields(plan.geometry,geometry,'geometry.',fields,false);
  const experimental=section(plan.experimental,base.experimental);
  return {...defaults,...knownFields(plan,{...defaults,skills,geometry:null,workspace:null}),
    process:section(plan.process,defaults.process),placement:section(plan.placement,defaults.placement),
    experimental:{...experimental,substrateAdaptation:Boolean(experimental.substrateAdaptation),sharedMaterial:experimental.sharedMaterial===true},
    composition:currentComposition(section(plan.composition,base.composition)),
    slices:section(plan.slices,base.slices),modulations:section(plan.modulations,base.modulations),
    setup:{...settings.setup,...(isRecord(plan.setup)?plan.setup:{})},
    skills:structuredClone(present),
    ...(geometry?{geometry:knownFields(plan.geometry,geometry)}:{})};
}
const section=(value,defaults)=>({...structuredClone(defaults),...(isRecord(value)?knownFields(value,defaults):{})});
// A copy without the fields the template does not have or cannot read.
function knownFields(value,template){
  const copy={...value};
  for(const key of Object.keys(copy))
    if(!Object.hasOwn(template,key)||!isRecord(template[key])&&!readable(copy[key],template[key],key))delete copy[key];
  return copy;
}
// Names, without reading values onward, the fields a reading fills (fill) or
// ignores; known names a field the template lacks but the reading keeps.
function noteFields(value,template,path,fields,fill,known=template){
  if(fill)for(const key of Object.keys(template))
    if(!Object.hasOwn(value,key)||!(isRecord(template[key])?isRecord(value[key]):readable(value[key],template[key],key)))fields.filled.push(path+key);
  for(const key of Object.keys(value))if(!Object.hasOwn(known,key)&&!Object.hasOwn(template,key))fields.ignored.push(path+key);
}
// A value of the template's kind. Booleans are read by truthiness; lists and
// open values are read by their consumers.
function readable(value,fallback,key){
  if(isRecord(fallback))return false;
  if(typeof fallback==='number')return STEP_FIELDS.includes(key)||Number.isFinite(value);
  if(typeof fallback==='string')return typeof value==='string'&&value.length>0;
  return true;
}

// Order and dependency entries are operation IDs; a filament route names one
// part or assignment, and the first route for a target is the one used.
function currentComposition({order,dependencies,filaments}){
  const list=value=>Array.isArray(value)?value:[],routes=new Map();
  for(const route of list(filaments)){
    const target=['part','assignment'].find(key=>isRecord(route)&&Object.hasOwn(route,key));
    if(!target||!Number.isSafeInteger(route.filament)||route.filament<0)continue;
    const identity=target+':'+route[target];
    if(!routes.has(identity))routes.set(identity,{[target]:route[target],filament:route.filament});
  }
  return {order:list(order).filter(id=>typeof id==='string'),
    dependencies:list(dependencies).filter(edge=>isRecord(edge)&&typeof edge.before==='string'&&typeof edge.after==='string').map(({before,after})=>({before,after})),
    filaments:[...routes.values()]};
}

// What generation makes of a current recipe: assemblies become one level of
// uniquely named components, and each piece that cannot produce anything is
// left out with a note. Never throws: what cannot be built is validation's.
function generationRecipe(plan,unread=[]){
  const notes=[];
  // A spatial record (curves and points around an optional solid) is resolved at compilation.
  const spatial=plan.geometry?.shape==='spatial',solid=componentGeometry(spatial?plan.geometry.solid:plan.geometry,notes);
  const geometry=spatial?{...plan.geometry,solid:solid??null}:solid;
  const process={...plan.process,primeLine:usablePrimeLine(plan.process.primeLine,notes)};
  const modulations=readModulations(plan.modulations);
  const stepped={...plan,geometry,process};
  const skills=plan.skills;
  const assignments=Array.isArray(plan.slices?.assignments)
    ?plan.slices.assignments.filter(assignment=>!unread.includes(assignment?.id)&&producingAssignment(stepped,solid,assignment,notes)):plan.slices?.assignments;
  const generated={...stepped,...(skills?{skills}:{}),modulations:modulations.record,slices:{...plan.slices,assignments}};
  if(!geometry)delete generated.geometry;
  if(Array.isArray(assignments)&&!assignments.length&&!Object.values(generated.skills??{}).some(settings=>settings?.enabled))
    notes.push('Nothing to print: no slice, Trace or Inject assignment can produce material.');
  return {plan:generated,notes:[...notes,...modulations.notes]};
}

// Nested assemblies are flattened: component outer holding inner becomes
// outer/inner at their summed offsets. The first component keeps a repeated
// id; later ones stay in the displayed geometry and receive no deposition.
function componentGeometry(geometry,notes){
  if(!geometry)return undefined;
  if(Array.isArray(geometry.triangles)&&!geometry.triangles.length||geometry.shape==='spline'&&!geometry.patches?.length)return undefined;
  if(geometry.shape==='boolean'&&Array.isArray(geometry.operands)){
    const sources=geometry.operands.map(operand=>componentGeometry(operand,notes));
    if(geometry.operation==='intersection'&&sources.some(source=>!source)||geometry.operation==='difference'&&!sources[0])return undefined;
    const operands=sources.filter(Boolean);
    if(!operands.length)return undefined;
    if(operands.length===1)return operands[0];
    return {...geometry,operands,...(Object.hasOwn(geometry,'displayOperand')?{displayOperand:Math.max(0,operands.indexOf(sources[geometry.displayOperand]))}:{})};
  }
  if(geometry?.shape!=='assembly'||!Array.isArray(geometry.parts))return geometry;
  const parts=[],seen=new Set(),repeated=new Set();
  for(const part of assemblyComponents(geometry.parts)){
    if(!componentGeometry(part.geometry,notes))continue;
    if(!seen.has(part.id)){seen.add(part.id);parts.push(part);}
    else repeated.add(part.id);
  }
  for(const id of repeated)notes.push(`Component id ${id} is used more than once: the first component with it is printed; later ones are shown but receive no deposition. Give each component its own id.`);
  return parts.length?{...geometry,parts}:undefined;
}

const finite=value=>Number.isFinite(value),positive=value=>Number.isFinite(value)&&value>0;
const usablePrimePass=pass=>isRecord(pass)&&[pass.startMm,pass.endMm].every(point=>Array.isArray(point)&&point.length===2&&point.every(finite))
  &&finite(pass.zMm)&&positive(pass.widthMm)&&positive(pass.heightMm)&&finite(pass.speedMmS);
function usablePrimeLine(primeLine,notes){
  if(primeLine===null||primeLine===undefined)return null;
  const passes=Array.isArray(primeLine?.passes)?primeLine.passes:[primeLine],usable=passes.filter(usablePrimePass);
  if(usable.length<passes.length)notes.push(`Prime line: ${passes.length-usable.length} of ${passes.length} pass(es) skipped; each needs startMm and endMm [x,y], zMm, positive widthMm and heightMm, and speedMmS.`);
  if(!usable.length)return null;
  return Array.isArray(primeLine.passes)?{...primeLine,passes:usable}:primeLine;
}

const processOf=(plan,assignment)=>{try{return assignmentPlan(plan,assignment).process;}catch{return null;}};
const unusableSteps=(process,fields)=>process?fields.filter(key=>!positive(process[key])):[];
const stepNote=(id,process,bad)=>`${id}: ${bad.map(key=>`${key} ${JSON.stringify(process[key]??null)}`).join(', ')} must be a positive number; ${id} produces nothing.`;

// Inject places points; every other construction steps layers and lines.
function producingAssignment(plan,solid,assignment,notes){
  if(!isRecord(assignment))return true;
  const id=assignment.id??'An assignment',standalone=['curves','inject'].includes(assignment.construction)||!assignment.construction&&assignment.surface?.kind==='terminal';
  if(!solid&&!standalone){notes.push(`${id} slices geometry and the recipe has none; it produces nothing.`);return false;}
  if(ASSIGNMENT_RECORDS[assignment.construction]?.requiresComponent&&(assignment.part??null)===null&&solid?.shape==='assembly'&&hasMesh(solid)){
    notes.push(`${id} needs one surface; this assembly has mesh components, so the whole assembly is not one. Choose its part; ${id} produces nothing.`);return false;
  }
  if(typeof assignment.part==='string'&&solid?.shape==='assembly'&&solid.parts.some(part=>String(part.id).startsWith(assignment.part+'/'))){
    notes.push(`${id} names nested assembly ${assignment.part}; name one of its components (${assignment.part}/…) or null. ${id} produces nothing.`);return false;
  }
  const process=processOf(plan,assignment),bad=unusableSteps(process,assignment.construction==='inject'?['lineWidthMm']:STEP_FIELDS);
  if(bad.length){notes.push(stepNote(id,process,bad));return false;}
  return true;
}

// Only what cannot be built is refused; current is the recipe before
// generationRecipe left pieces out, which modulations may still name.
function validateRecipeValue(plan,current) {
  requireThat_toolpath(plan.geometry===undefined||plan.geometry===null||GEOMETRY_SHAPES.includes(plan.geometry.shape),`Author geometry as one of ${GEOMETRY_SHAPES.join(', ')}.`);
  if(plan.geometry)validateGeometry(plan.geometry);
  validateExtensionRecipe(plan);
  validateSlices(plan.slices);
  for(const assignment of depositionAssignments(plan)){
    assignmentPlan(plan,assignment);
    if(assignment.geometry)validateGeometry(assignment.geometry);
  }
  validateModulations(plan.modulations,{assignmentIds:Array.isArray(current.slices?.assignments)?current.slices.assignments.map(a=>a?.id):[]});
  for(const {geometry:source} of modulationGeometrySources(plan.modulations)){
    requireThat_toolpath(GEOMETRY_SHAPES.includes(source.shape),'Unsupported solid-distance geometry shape.');
    authoredBounds(source);
  }
}

function validateGeometry(geometry) {
  if(geometry.shape==='assembly'){
    for(const part of geometry.parts){
      requireThat_toolpath(isRecord(part)&&isRecord(part.geometry)&&GEOMETRY_SHAPES.includes(part.geometry.shape),'Each assembly component needs geometry.');
      requireThat_toolpath([part.xMm,part.yMm,part.zMm].every(Number.isFinite),'Component placement must be finite XYZ.');
      validateGeometry(part.geometry);
    }
    return;
  }
  if(geometry.shape==='spline')validateSplineSolid(geometry);
  if(geometry.shape==='boolean')authoredBounds(geometry);
  GEOMETRY_RECORDS[geometry.shape]?.validate(geometry);
  if(geometry.solid)validateGeometry(geometry.solid);
  for(const part of geometry.materialParts??[])if(part.geometry){requireThat(GEOMETRY_SHAPES.includes(part.geometry.shape),'Invalid material partition geometry.');validateGeometry(part.geometry);}
  if(geometry.shape==='blob-field')validateBlobFieldRecord(geometry);
  if(Array.isArray(geometry.vertices)&&Array.isArray(geometry.triangles))makeMesh(geometry.vertices,geometry.triangles);
}

// A boolean's operands are validated by their own forms and bounded without
// building them: control-net hulls for splines, vertices for meshes.
function authoredBounds(geometry){
  if(geometry.shape==='assembly'){
    requireThat(Array.isArray(geometry.parts)&&geometry.parts.length>0,'Assembly field geometry needs components.');
    const bounds=geometry.parts.map(part=>{
      requireThat([part.xMm,part.yMm,part.zMm].every(Number.isFinite),'Assembly field component placement must be finite.');
      const box=authoredBounds(part.geometry),at=[part.xMm,part.yMm,part.zMm];
      return {min:box.min.map((v,i)=>v+at[i]),max:box.max.map((v,i)=>v+at[i])};
    });
    return {min:[0,1,2].map(i=>Math.min(...bounds.map(b=>b.min[i]))),max:[0,1,2].map(i=>Math.max(...bounds.map(b=>b.max[i])))};
  }
  if(geometry.shape==='boolean')return booleanShell(validateBooleanSolid(geometry).operation,geometry.operands.map(operand=>({bounds:authoredBounds(operand)}))).bounds;
  if(geometry.shape==='spline')return splineSolidBounds(validateSplineSolid(geometry));
  if(geometry.shape==='blob-field')validateBlobFieldRecord(geometry);
  else if(Object.hasOwn(GEOMETRY_RECORDS,geometry.shape))GEOMETRY_RECORDS[geometry.shape].validate(geometry);
  if(geometry.solid)return authoredBounds(geometry.solid);
  return makeMesh(geometry.vertices,geometry.triangles).bounds;
}
