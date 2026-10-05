import {requireThat as requireThat_toolpath} from '../private/toolpath/numeric.mjs';
import {ASSIGNMENT_RECORDS,GEOMETRY_RECORDS,extensionSettings,validateExtensionRecipe,extensionProducerIds,validateExtensionAssignment} from '../../skills/records.mjs';
// Recipe (plan.json) for shell-based prints: geometry, placement, setup, shared
// process settings, and the settings of each selected skill.
//
// A locked plan must carry everything generation needs, so generation makes no
// further process choices. Unknown or missing fields are rejected rather than
// defaulted at generation time, which is what keeps a regenerated path
// identical to the reviewed one.

import { createHash } from 'node:crypto';
import {requireThat} from '../geom/tolerance.mjs';
import {loadMachine} from '../machine/profile.mjs';
import {settingsDefaults} from '../machine/settings.mjs';
import {makeMesh} from '../geom/mesh.mjs';
import {splineSolidTemplate,validateSplineSolid,splineSolidBounds} from '../geom/spline-solid.mjs';
import {blobFieldTemplate,validateBlobFieldRecord} from '../geom/blob-field-record.mjs';
import {booleanSolidTemplate,validateBooleanSolid,booleanShell} from '../geom/boolean-solid.mjs';
import {geometrySelections} from '../geom/selections.mjs';
import {spatialTemplate} from '../geom/spatial.mjs';
import {normalizeSpatialPlan,resolveSpatialPlan} from './spatial-inputs.mjs';
import {defaultSlices,validateSlices} from './slices.mjs';
import {defaultModulations,validateModulations} from '../path/modulation.mjs';
import {modulationGeometrySources} from '../path/modulation-field.mjs';
import {assignmentPlan,depositionAssignments} from './assignment-process.mjs';
import {materialProcess} from '../machine/filaments.mjs';

// Fixed release metadata, so regenerating a reviewed plan is byte-identical.
import {VERSION} from './version.mjs';
export {VERSION,BUILD_DATE} from './version.mjs';

export const canonical = value => JSON.stringify(value, function (_key, item) {
  if (item && typeof item === 'object' && !Array.isArray(item)) return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  return item;
});
export const hash = value => createHash('sha256')
  .update(typeof value === 'string' || Buffer.isBuffer(value) || value instanceof Uint8Array ? value : canonical(value)).digest('hex');

export function defaults(machine=loadMachine()) {
  return {...recipeDefaults(),...settingsDefaults(machine)};
}

export function recipeDefaults(){
  return {
    schema:'saam-shell-plan/1',generatorVersion:VERSION,
    experimental:{substrateAdaptation:false},skills:extensionSettings(),
    slices:defaultSlices(),modulations:defaultModulations(),
    composition:{order:[],dependencies:[],filaments:[]}
  };
}

// Each shape carries its own parameters, so the strict field check is made
// against the selected shape rather than against whichever shape is the default.
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
export function compileRecipe(plan){
  const owned=ownedRecipes.get(plan);
  if(owned)return owned;
  const key=JSON.stringify(plan);
  if(compiledRecipes.has(key))return compiledRecipes.get(key);
  const value={plan:structuredClone(resolveSpatialPlan(normalizeSpatialPlan(plan)))};
  validateRecipeValue(value.plan);
  freezeRecipe(value);
  // Eviction only affects reuse, never which recipes are accepted.
  if(compiledRecipes.size>=4)compiledRecipes.delete(compiledRecipes.keys().next().value);
  compiledRecipes.set(key,value);ownedRecipes.set(value.plan,value);return value;
}
export function validatePlan(plan){compileRecipe(plan);return plan;}
function validateRecipeValue(plan) {
  const fields=validatePlanFields(plan);
  const geometry=validatePlanGeometry(fields);
  const process=validatePlanProcess(geometry);
  const auxiliary=validatePlanAuxiliary(process);
  const selections=validatePlanSelections(auxiliary);
  return validatePlanPlacement(selections);
}

// Authored forms (spline patches, meshes, assemblies of them) and the
// compiled records of geometry skills.
export const GEOMETRY_SHAPES=['spline','blob-field','mesh','boolean','assembly','spatial',...Object.keys(GEOMETRY_RECORDS)];

export function depositionOnlyPlan(plan){
  return plan?.geometry===undefined&&plan.slices?.assignments?.length>0&&plan.slices.assignments.every(a=>['curves','inject'].includes(a.construction)||!a.construction&&a.surface?.kind==='terminal');
}

const positiveProcessFields=['firstLayerMm','layerMm','lineWidthMm','maxFlowMm3S','retractSpeedMmS',
  'planarSpeedMmS','skinSpeedMmS','firstLayerSpeedMmS','travelSpeedMmS','zSpeedMmS'];
const nonnegativeProcessFields=['retractMm','liftMm','maxCombMm','minimumLayerSeconds','planarWallToleranceMm'];

export function validatePlanFields(plan) {
  requireThat_toolpath(plan && typeof plan === 'object' && (depositionOnlyPlan(plan)||GEOMETRY_SHAPES.includes(plan.geometry?.shape)), `Author geometry (${GEOMETRY_SHAPES.join(', ')}) or a Trace/Inject recipe.`);
  // Validation is check-only: a plan carries every current field or it is
  // rejected. Supported older fields require explicit recipe migration and regeneration.
  const {skills,...base}=recipeDefaults();
  const expected = {...base,setup:null,output:null,placement:{xMm:null,yMm:null},
    process:{...Object.fromEntries([...positiveProcessFields,...nonnegativeProcessFields].map(key=>[key,null])),
      fanPercent:null,experimentalDeposition:null,primeLine:null,clearanceResponsibility:null,clearanceNote:null},
    ...(Object.hasOwn(plan,'skills')?{skills:Object.fromEntries(Object.entries(skills).filter(([id])=>Object.hasOwn(plan.skills??{},id)))}:{}),
    ...(plan.geometry?{geometry:geometryTemplate(plan.geometry.shape,plan.geometry)}:{}),...(Object.hasOwn(plan,'workspace')?{workspace:null}:{})};
  if(plan.workspace){
    requireThat_toolpath(plan.workspace.schema==='saam-workspace-source/1'&&plan.workspace.source&&plan.workspace.requirements,'Invalid workspace construction source.');

  }
  requireThat_toolpath(!plan.composition||!Object.hasOwn(plan.composition,'batchLayers'),'composition.batchLayers is retired; explicitly migrate the recipe to ascending-height scheduling and regenerate.');
  keys({...plan,setup:null},{...expected,setup:null});
  requireThat_toolpath(typeof plan.experimental.substrateAdaptation==='boolean','experimental.substrateAdaptation must be true or false.');
  requireThat_toolpath(plan.schema === expected.schema && plan.generatorVersion === VERSION, 'Unsupported plan or generator version.');
  requireThat_toolpath(Array.isArray(plan.composition.order) && plan.composition.order.every(id=>typeof id==='string') && Array.isArray(plan.composition.dependencies) && plan.composition.dependencies.every(e=>e && typeof e.before==='string' && typeof e.after==='string' && Object.keys(e).sort().join()==='after,before'), 'Invalid composition rules.');
  requireThat_toolpath(Array.isArray(plan.composition.filaments),'composition.filaments must be a list of part or assignment selections.');
  const routes=new Set();
  for(const route of plan.composition.filaments){
    requireThat_toolpath(route&&['filament,part','assignment,filament'].includes(Object.keys(route).sort().join())&&Number.isInteger(route.filament)&&route.filament>=0,'Filament routing needs {part,filament} or {assignment,filament}.');
    const key=Object.hasOwn(route,'part')?'part':'assignment',target=route[key];
    requireThat_toolpath(typeof target==='string'&&target.length>0||key==='part'&&target===null,'Invalid filament routing target.');
    const identity=key+':'+target;requireThat_toolpath(!routes.has(identity),'Duplicate filament routing target.');routes.add(identity);
    validatePlanProcess({...plan,process:materialProcess(plan,route.filament)});
  }

  return plan;
}

export function validatePlanGeometry(plan) {
  const {geometry,placement,setup}=plan;
  if(!geometry)requireThat(Object.values(plan.skills??{}).every(settings=>!settings.enabled),'Geometry-free deposition cannot enable geometry-dependent skills.');
  if(!geometry)return plan;
  if(geometry.shape==='spline')validateSplineSolid(geometry);
  if(geometry.shape==='boolean')authoredBounds(geometry);
  GEOMETRY_RECORDS[geometry.shape]?.validate(geometry);
  if(geometry.shape==='blob-field')validateBlobFieldRecord(geometry);
  if(Array.isArray(geometry.vertices)&&Array.isArray(geometry.triangles)) {
    makeMesh(geometry.vertices,geometry.triangles);
    if(geometry.shape==='mesh')validateMeshSource(geometry);
  }

  return plan;
}

const validateMeshSource=geometry=>requireThat(geometry.source===null||(geometry.source?.format==='stl'&&/^[a-f0-9]{64}$/.test(geometry.source.sha256)&&['mm','inch'].includes(geometry.source.units)&&Number.isFinite(geometry.source.scale)&&geometry.source.scale>0),'Invalid mesh source provenance.');

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
  else {
    requireThat(Object.keys(geometry).sort().join()==='shape,source,triangles,vertices','Boolean mesh operands need shape, source, triangles and vertices only.');
    validateMeshSource(geometry);
  }
  return makeMesh(geometry.vertices,geometry.triangles).bounds;
}

// Only authored-value validity belongs here. Physical device/material envelopes
// are checked when translating SAAMpath into a machine program.
export function validatePlanProcess(plan) {
  const {process}=plan;
  const positive=(value,name)=>requireThat_toolpath(Number.isFinite(value)&&value>0,`${name} must be positive and finite.`);
  for(const key of positiveProcessFields)positive(process[key],key);
  for(const key of nonnegativeProcessFields)
    requireThat_toolpath(Number.isFinite(process[key])&&process[key]>=0,`${key} must be nonnegative and finite.`);
  requireThat_toolpath(Number.isFinite(process.fanPercent)&&process.fanPercent>=0&&process.fanPercent<=100,'fanPercent must be between 0 and 100.');
  if(process.primeLine!==null){
    const p=process.primeLine;
    requireThat_toolpath(p&&typeof p==='object'&&!Array.isArray(p),'Invalid primeLine.');
    const multi=Object.keys(p).sort().join()==='passes',passes=multi?p.passes:[p];
    requireThat_toolpath((multi&&Array.isArray(passes)&&passes.length>=1)||Object.keys(p).sort().join()==='endMm,heightMm,speedMmS,startMm,widthMm,zMm','Invalid primeLine fields.');
    for(const pass of passes){
      requireThat_toolpath(pass&&typeof pass==='object'&&!Array.isArray(pass)&&Object.keys(pass).sort().join()==='endMm,heightMm,speedMmS,startMm,widthMm,zMm','Invalid prime pass fields.');
      requireThat_toolpath([pass.startMm,pass.endMm].every(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite))&&
        Math.hypot(pass.endMm[0]-pass.startMm[0],pass.endMm[1]-pass.startMm[1])>0,'Prime pass needs two distinct finite XY endpoints.');
      requireThat_toolpath(Number.isFinite(pass.zMm),'Prime line Z must be finite.');
      for(const key of ['widthMm','heightMm','speedMmS'])positive(pass[key],'Prime line '+key);
    }
  }

  return plan;
}

export function validatePlanAuxiliary(plan) {
  validateExtensionRecipe(plan,assignment=>assignmentPlan(plan,assignment).process);
  return plan;
}

export function validatePlanSelections(plan) {
  const {geometry,placement,skills}=plan;
  const sliced=plan.slices.assignments.length>0;
  // A slice part is a geometry selection: a component or a prepared material
  // part; two cut parts never share material.
  const selections=geometry?geometrySelections(geometry):new Map();
  validateSlices(plan.slices,{validateConstruction:validateExtensionAssignment,parts:[...selections.keys()].filter(key=>key!==null),lineWidthMm:plan.process.lineWidthMm,firstLayerMm:plan.process.firstLayerMm});
  const producerIds=new Set(plan.slices.assignments.map(a=>a.id));
  for(const id of extensionProducerIds(plan))producerIds.add(id);
  for(const route of plan.composition.filaments)requireThat_toolpath(Object.hasOwn(route,'part')?selections.has(route.part):producerIds.has(route.assignment),'Filament routing names an absent part or deposition assignment.');
  for(const assignment of depositionAssignments(plan)){
    const selected=assignmentPlan(plan,assignment);
    validatePlanProcess(selected);

  }
  validateModulations(plan.modulations,{assignmentIds:plan.slices.assignments.map(a=>a.id)});
  for(const {geometry:source} of modulationGeometrySources(plan.modulations)){
    requireThat_toolpath(GEOMETRY_SHAPES.includes(source.shape),'Unsupported solid-distance geometry shape.');
    keys(source,geometryTemplate(source.shape,source),'modulation geometry');authoredBounds(source);
  }
  if(geometry?.shape==='assembly') {
    requireThat_toolpath(Array.isArray(geometry.parts)&&geometry.parts.length>=1,'An assembly needs at least one component.');
    const ids=new Set();
    for(const part of geometry.parts){
      requireThat_toolpath(part&&Object.keys(part).sort().join()==='geometry,id,xMm,yMm,zMm'&&/^[a-z][a-z0-9-]*$/.test(part.id)&&!ids.has(part.id),'Invalid or duplicate component.');
      ids.add(part.id);
      requireThat_toolpath(part.geometry?.shape!=='assembly','Nested assemblies are not supported.');
      requireThat_toolpath([part.xMm,part.yMm,part.zMm].every(Number.isFinite),'Component placement must be finite XYZ.');
      const assigned=depositionAssignments(plan).find(a=>a.part===part.id);
      const child=structuredClone(assignmentPlan(plan,assigned??{part:part.id}));child.geometry=part.geometry;
      child.placement={xMm:placement.xMm+part.xMm,yMm:placement.yMm+part.yMm};
      // Global assignment/process/dependency validation has already run. Only
      // this component's geometry and placement change in the local check.
      validatePlanFields(child);validatePlanGeometry(child);validatePlanPlacement(child);
    }
  }
  requireThat_toolpath(sliced, 'Add a slice assignment.');
  if(geometry?.shape==='assembly')for(const assignment of plan.slices.assignments){
    const needsComponent=ASSIGNMENT_RECORDS[assignment.construction]?.requiresComponent||!assignment.construction&&(assignment.surface?.kind==='terminal'||assignment.stack?.direction==='normal'||assignment.within.some(r=>r.kind==='surface-domain'&&r.loopsUv===null));
    requireThat_toolpath(!needsComponent||assignment.part!==null,'An assembly reference-surface assignment must select a component.');
  }
  return plan;
}

export function validatePlanPlacement(plan) {
  const {placement}=plan;
  requireThat_toolpath(typeof plan.output==='string'&&plan.output.length>0,'Output identity must be nonempty.');
  requireThat_toolpath(Number.isFinite(placement.xMm)&&Number.isFinite(placement.yMm),'Placement must be finite.');
  return plan;
}

// Reject misspelled or unused settings instead of silently ignoring them.
function keys(actual, expected, path = 'plan') {
  requireThat_toolpath(actual && typeof actual === 'object' && !Array.isArray(actual), `${path} must be an object.`);
  // Name the offending keys: a retired or misspelled field is otherwise invisible
  // to the agent or maker holding the recipe.
  const unexpected = Object.keys(actual).filter(key => !Object.hasOwn(expected, key)).sort();
  const missing = Object.keys(expected).filter(key => !Object.hasOwn(actual, key)).sort();
  requireThat_toolpath(!unexpected.length && !missing.length, `Unexpected or missing fields in ${path}: `
    + [unexpected.length ? 'unexpected ' + unexpected.join(', ') : '', missing.length ? 'missing ' + missing.join(', ') : ''].filter(Boolean).join('; ') + '.');
  for (const key of Object.keys(expected)) {
    const value = expected[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) keys(actual[key], value, `${path}.${key}`);
  }
}
