// Recipe (plan.json) for shell-based prints: geometry, placement, setup, shared
// process settings, and the settings of each selected skill.
//
// A locked plan must carry everything generation needs, so generation makes no
// further process choices. Unknown or missing fields are rejected rather than
// defaulted at generation time, which is what keeps a regenerated path
// identical to the reviewed one.

import { createHash } from 'node:crypto';
import { requireThat } from '../geom/tolerance.mjs';
import {loadMachine,centeredPlacement} from '../machine/profile.mjs';
import {makeMesh} from '../geom/mesh.mjs';
import {SUPPORT_DEFAULTS,validateSupports} from '../../skills/supports/scripts/supports.mjs';
import {splineSolidTemplate,validateSplineSolid,splineSolidBounds} from '../geom/spline-solid.mjs';
import {gridfinityTemplate,validateGridfinityRecord} from '../../skills/gridfinity/scripts/record.mjs';
import {textTemplate,validateTextRecord} from '../geom/text-record.mjs';
import {blobFieldTemplate,validateBlobFieldRecord} from '../geom/blob-field-record.mjs';
import {booleanSolidTemplate,validateBooleanSolid,booleanShell} from '../geom/boolean-solid.mjs';
import {geometrySelections} from '../geom/selections.mjs';
import {defaultSlices,validateSlices} from './slices.mjs';
import {defaultModulations,validateModulations} from '../path/modulation.mjs';
import {modulationGeometrySources} from '../path/modulation-field.mjs';
import {assignmentPlan,depositionAssignments} from './assignment-process.mjs';
import {PLASTIC_WELD_DEFAULTS,validatePlasticWeld} from '../../skills/plastic-weld/scripts/weld.mjs';
import {heatSetTemplate,validateHeatSetRecord} from '../../skills/heat-set-inserts/scripts/feature.mjs';
import {filamentPlan} from '../machine/filaments.mjs';
import {validateRecipeSetup} from './recipe-setup.mjs';

export const VERSION = '0.1.0';
// Fixed release metadata, so regenerating a reviewed plan is byte-identical.
export const BUILD_DATE = '2026-09-08';

export const canonical = value => JSON.stringify(value, function (_key, item) {
  if (item && typeof item === 'object' && !Array.isArray(item)) return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  return item;
});
export const hash = value => createHash('sha256')
  .update(typeof value === 'string' || Buffer.isBuffer(value) || value instanceof Uint8Array ? value : canonical(value)).digest('hex');

export function number(value, min, max, name) {
  requireThat(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, `${name} must be between ${min} and ${max}.`);
}

export function defaults(machine=loadMachine()) {
  const plan = {
    schema: 'saam-shell-plan/1',
    generatorVersion: VERSION,
    placement: centeredPlacement(machine, machine.defaultSetup.tool, { runMm: 0, widthMm: 0 }) ?? { xMm: 140, yMm: 100 },
    setup: structuredClone(machine.defaultSetup),
    experimental: {substrateAdaptation:false},
    process: {
      firstLayerMm: 0.2, layerMm: 0.2, lineWidthMm: 0.4,
      planarSpeedMmS: 20, skinSpeedMmS: 10, firstLayerSpeedMmS: 12, travelSpeedMmS: 60, zSpeedMmS: 5,
      retractMm: 6.5, retractSpeedMmS: 25, liftMm: 1, maxCombMm: 6,
      fanPercent: 100, maxFlowMm3S: 4, minimumLayerSeconds: 6,
      experimentalDeposition: false,
      primeLine: null,
      clearanceResponsibility: 'operator',
      clearanceNote: 'No collision model is implemented; the operator owns physical clearance.'
    },
    skills: {
      'plastic-weld':structuredClone(PLASTIC_WELD_DEFAULTS),
      supports: structuredClone(SUPPORT_DEFAULTS),
    },
    slices: defaultSlices(),
    modulations: defaultModulations(),
    composition: { order: [], dependencies: [], filaments: [] },
    output: 'griffin-gcode'
  };
  Object.assign(plan.process,machine.defaultProcess??{});
  plan.output=machine.outputs[0].id;
  return plan;
}

// Each shape carries its own parameters, so the strict field check is made
// against the selected shape rather than against whichever shape is the default.
export function geometryTemplate(shape,geometry) {
  if(shape==='blob-field')return blobFieldTemplate();
  if(shape==='boolean')return booleanSolidTemplate();
  if(shape==='heat-set')return heatSetTemplate();
  if(shape==='gridfinity')return gridfinityTemplate();
  if(shape==='text')return textTemplate(geometry);
  if(shape==='mesh')return {shape:'mesh',vertices:[],triangles:[],source:null};
  if(shape==='assembly')return {shape:'assembly',parts:[]};
  return splineSolidTemplate();
}

export function validatePlan(plan,machine) {
  const fields=validatePlanFields(plan,machine);
  const geometry=validatePlanGeometry(fields,machine);
  const process=validatePlanProcess(geometry,machine);
  const auxiliary=validatePlanAuxiliary(process,machine);
  const selections=validatePlanSelections(auxiliary,machine);
  return validatePlanPlacement(selections,machine);
}

// Authored forms (spline patches, meshes, assemblies of them) and the
// compiled records of geometry skills.
export const GEOMETRY_SHAPES=['spline','blob-field','mesh','boolean','assembly','text','gridfinity','heat-set'];

export function depositionOnlyPlan(plan){
  return plan?.geometry===undefined&&plan.slices?.assignments?.length>0&&plan.slices.assignments.every(a=>['curves','inject'].includes(a.construction)||!a.construction&&a.surface?.kind==='terminal');
}

export function validatePlanFields(plan,machine) {
  requireThat(plan && typeof plan === 'object' && (depositionOnlyPlan(plan)||GEOMETRY_SHAPES.includes(plan.geometry?.shape)), `Author geometry (${GEOMETRY_SHAPES.join(', ')}) or a Trace/Inject recipe.`);
  // Validation is check-only: a plan carries every current field or it is
  // rejected. Supported older fields require explicit recipe migration and regeneration.
  const expected = { ...defaults(), ...(plan.geometry?{geometry:geometryTemplate(plan.geometry.shape,plan.geometry)}:{}) };
  requireThat(!plan.composition||!Object.hasOwn(plan.composition,'batchLayers'),'composition.batchLayers is retired; explicitly migrate the recipe to ascending-height scheduling and regenerate.');
  keys({...plan,setup:null},{...expected,setup:null});
  validateRecipeSetup(plan);
  requireThat(typeof plan.experimental.substrateAdaptation==='boolean','experimental.substrateAdaptation must be true or false.');
  requireThat(plan.schema === expected.schema && plan.generatorVersion === VERSION, 'Unsupported plan or generator version.');
  requireThat(Array.isArray(plan.composition.order) && plan.composition.order.every(id=>typeof id==='string') && Array.isArray(plan.composition.dependencies) && plan.composition.dependencies.every(e=>e && typeof e.before==='string' && typeof e.after==='string' && Object.keys(e).sort().join()==='after,before'), 'Invalid composition rules.');
  requireThat(Array.isArray(plan.composition.filaments),'composition.filaments must be a list of part or assignment selections.');
  const routes=new Set();
  for(const route of plan.composition.filaments){
    requireThat(route&&['filament,part','assignment,filament'].includes(Object.keys(route).sort().join())&&Number.isInteger(route.filament)&&route.filament>=0,'Filament routing needs {part,filament} or {assignment,filament}.');
    const key=Object.hasOwn(route,'part')?'part':'assignment',target=route[key];
    requireThat(typeof target==='string'&&target.length>0||key==='part'&&target===null,'Invalid filament routing target.');
    const identity=key+':'+target;requireThat(!routes.has(identity),'Duplicate filament routing target.');routes.add(identity);
    validateRecipeSetup(filamentPlan(plan,machine,route.filament));
  }

  return plan;
}

export function validatePlanGeometry(plan,machine) {
  const {geometry,placement,setup}=plan;
  if(!geometry)requireThat(Object.values(plan.skills).every(settings=>!settings.enabled),'Geometry-free deposition cannot enable geometry-dependent skills.');
  validatePlasticWeld(plan,machine);
  if(!geometry)return plan;
  if(geometry.shape==='spline')validateSplineSolid(geometry);
  if(geometry.shape==='boolean')authoredBounds(geometry);
  if(geometry.shape==='text')validateTextRecord(geometry);
  if(geometry.shape==='heat-set')validateHeatSetRecord(geometry);
  if(geometry.shape==='gridfinity')validateGridfinityRecord(geometry);
  if(geometry.shape==='blob-field')validateBlobFieldRecord(geometry);
  if(['mesh','blob-field','text','gridfinity','heat-set'].includes(geometry.shape)) {
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
  else if(geometry.shape==='text')validateTextRecord(geometry);
  else if(geometry.shape==='heat-set')validateHeatSetRecord(geometry);
  else if(geometry.shape==='gridfinity')validateGridfinityRecord(geometry);
  else {keys(geometry,{shape:'mesh',vertices:[],triangles:[],source:null},'boolean operand');validateMeshSource(geometry);}
  return makeMesh(geometry.vertices,geometry.triangles).bounds;
}

// Only authored-value validity belongs here. Physical device/material envelopes
// are checked when translating SAAMpath into a machine program.
export function validatePlanProcess(plan) {
  const {process}=plan;
  requireThat(typeof process.experimentalDeposition==='boolean','experimentalDeposition must be boolean.');
  const positive=(value,name)=>requireThat(Number.isFinite(value)&&value>0,`${name} must be positive and finite.`);
  for(const key of ['firstLayerMm','layerMm','lineWidthMm','maxFlowMm3S','retractSpeedMmS',
    'planarSpeedMmS','skinSpeedMmS','firstLayerSpeedMmS','travelSpeedMmS','zSpeedMmS'])positive(process[key],key);
  for(const key of ['retractMm','liftMm','maxCombMm','minimumLayerSeconds'])
    requireThat(Number.isFinite(process[key])&&process[key]>=0,`${key} must be nonnegative and finite.`);
  number(process.fanPercent, 0, 100, 'fanPercent');
  requireThat(process.clearanceResponsibility === 'operator', 'Clearance responsibility must be recorded as operator.');
  requireThat(typeof process.clearanceNote === 'string' && process.clearanceNote.length <= 1000, 'Invalid clearance note.');
  if(process.primeLine!==null){
    const p=process.primeLine;
    requireThat(p&&typeof p==='object'&&!Array.isArray(p),'Invalid primeLine.');
    const multi=Object.keys(p).sort().join()==='passes',passes=multi?p.passes:[p];
    requireThat((multi&&Array.isArray(passes)&&passes.length>=1)||Object.keys(p).sort().join()==='endMm,heightMm,speedMmS,startMm,widthMm,zMm','Invalid primeLine fields.');
    for(const pass of passes){
      requireThat(pass&&typeof pass==='object'&&!Array.isArray(pass)&&Object.keys(pass).sort().join()==='endMm,heightMm,speedMmS,startMm,widthMm,zMm','Invalid prime pass fields.');
      requireThat([pass.startMm,pass.endMm].every(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite))&&
        Math.hypot(pass.endMm[0]-pass.startMm[0],pass.endMm[1]-pass.startMm[1])>0,'Prime pass needs two distinct finite XY endpoints.');
      requireThat(Number.isFinite(pass.zMm),'Prime line Z must be finite.');
      for(const key of ['widthMm','heightMm','speedMmS'])positive(pass[key],'Prime line '+key);
    }
  }

  return plan;
}

export function validatePlanAuxiliary(plan,machine) {
  const {geometry,process,setup,skills}=plan;
  validateRecipeSetup(plan);
  validateSupports(skills.supports,assignmentPlan(plan,machine,{id:'supports'}).process);
  requireThat(typeof setup.startupVerified === 'boolean' && typeof setup.firmwareVersion === 'string' && /^[\w .+-]{0,80}$/.test(setup.firmwareVersion), 'Invalid firmware setup.');

  return plan;
}

export function validatePlanSelections(plan,machine) {
  const {geometry,placement,skills}=plan;
  const sliced=plan.slices.assignments.length>0;
  // A slice part is a geometry selection: a component or a prepared material
  // part; two cut parts never share material.
  const selections=geometry?geometrySelections(geometry):new Map();
  validateSlices(plan.slices,{parts:[...selections.keys()].filter(key=>key!==null),lineWidthMm:plan.process.lineWidthMm,firstLayerMm:plan.process.firstLayerMm});
  const producerIds=new Set(plan.slices.assignments.map(a=>a.id));
  if(skills.supports.enabled)producerIds.add('supports');
  if(skills['plastic-weld'].enabled)for(const site of skills['plastic-weld'].sites)producerIds.add('plastic-weld:'+site.id);
  for(const route of plan.composition.filaments)requireThat(Object.hasOwn(route,'part')?selections.has(route.part):producerIds.has(route.assignment),'Filament routing names an absent part or deposition assignment.');
  for(const assignment of depositionAssignments(plan)){
    const selected=assignmentPlan(plan,machine,assignment);
    validatePlanProcess(selected);validateRecipeSetup(selected);

  }
  validateModulations(plan.modulations,{assignmentIds:plan.slices.assignments.map(a=>a.id)});
  for(const {geometry:source} of modulationGeometrySources(plan.modulations)){
    requireThat(GEOMETRY_SHAPES.includes(source.shape),'Unsupported solid-distance geometry shape.');
    keys(source,geometryTemplate(source.shape,source),'modulation geometry');authoredBounds(source);
  }
  if(geometry?.shape==='assembly') {
    requireThat(Array.isArray(geometry.parts)&&geometry.parts.length>=1,'An assembly needs at least one component.');
    const ids=new Set();
    for(const part of geometry.parts){
      requireThat(part&&Object.keys(part).sort().join()==='geometry,id,xMm,yMm,zMm'&&/^[a-z][a-z0-9-]*$/.test(part.id)&&!ids.has(part.id),'Invalid or duplicate component.');
      ids.add(part.id);
      requireThat(part.geometry?.shape!=='assembly','Nested assemblies are not supported.');
      requireThat([part.xMm,part.yMm,part.zMm].every(Number.isFinite),'Component placement must be finite XYZ.');
      const assigned=depositionAssignments(plan).find(a=>a.part===part.id);
      const child=structuredClone(assignmentPlan(plan,machine,assigned??{part:part.id}));child.geometry=part.geometry;
      child.placement={xMm:placement.xMm+part.xMm,yMm:placement.yMm+part.yMm};
      child.skills['plastic-weld'].enabled=false;
      // Global assignment/process/dependency validation has already run. Only
      // this component's geometry and placement change in the local check.
      validatePlanFields(child,machine);validatePlanGeometry(child,machine);validatePlanPlacement(child,machine);
    }
  }
  requireThat(sliced, 'Add a slice assignment.');
  if(geometry?.shape==='assembly')for(const assignment of plan.slices.assignments){
    const needsComponent=assignment.construction==='sleeve'||!assignment.construction&&(assignment.surface?.kind==='terminal'||assignment.stack?.direction==='normal'||assignment.within.some(r=>r.kind==='surface-domain'&&r.loopsUv===null));
    requireThat(!needsComponent||assignment.part!==null,'An assembly reference-surface assignment must select a component.');
  }
  return plan;
}

export function validatePlanPlacement(plan,machine) {
  const {placement}=plan;
  requireThat(typeof plan.output==='string'&&plan.output.length>0,'Output identity must be nonempty.');
  requireThat(Number.isFinite(placement.xMm)&&Number.isFinite(placement.yMm),'Placement must be finite.');
  return plan;
}

// Reject misspelled or unused settings instead of silently ignoring them.
function keys(actual, expected, path = 'plan') {
  requireThat(actual && typeof actual === 'object' && !Array.isArray(actual), `${path} must be an object.`);
  // Name the offending keys: a retired or misspelled field is otherwise invisible
  // to the agent or maker holding the recipe.
  const unexpected = Object.keys(actual).filter(key => !Object.hasOwn(expected, key)).sort();
  const missing = Object.keys(expected).filter(key => !Object.hasOwn(actual, key)).sort();
  requireThat(!unexpected.length && !missing.length, `Unexpected or missing fields in ${path}: `
    + [unexpected.length ? 'unexpected ' + unexpected.join(', ') : '', missing.length ? 'missing ' + missing.join(', ') : ''].filter(Boolean).join('; ') + '.');
  for (const key of Object.keys(expected)) {
    const value = expected[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) keys(actual[key], value, `${path}.${key}`);
  }
}
