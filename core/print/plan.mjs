// Recipe (plan.json) for shell-based prints: geometry, placement, setup, shared
// process settings, and the settings of each selected skill.
//
// A locked plan must carry everything generation needs, so generation makes no
// further process choices. Unknown or missing fields are rejected rather than
// defaulted at generation time, which is what keeps a regenerated path
// identical to the reviewed one.

import { createHash } from 'node:crypto';
import { requireThat } from '../geom/tolerance.mjs';
import {loadMachine,validateSetup,toolBounds,requireMachine,centeredPlacement} from '../machine/profile.mjs';
import {makeMesh} from '../geom/mesh.mjs';
import {SUPPORT_DEFAULTS,validateSupports} from '../../skills/supports/scripts/supports.mjs';
import {splineSolidTemplate,validateSplineSolid,splineSolidBounds} from '../geom/spline-solid.mjs';
import {gridfinityTemplate,validateGridfinityRecord} from '../../skills/gridfinity/scripts/record.mjs';
import {textTemplate,validateTextRecord} from '../geom/text-record.mjs';
import {blobFieldTemplate,validateBlobFieldRecord} from '../geom/blob-field-record.mjs';
import {booleanSolidTemplate,validateBooleanSolid,booleanShell} from '../geom/boolean-solid.mjs';
import {geometrySelections,selectionsOverlap} from '../geom/selections.mjs';
import {defaultSlices,validateSlices} from './slices.mjs';
import {defaultModulations,validateModulations} from '../path/modulation.mjs';
import {assignmentPlan} from './assignment-process.mjs';
import {PLASTIC_WELD_DEFAULTS,validatePlasticWeld} from '../../skills/plastic-weld/scripts/weld.mjs';
import {heatSetTemplate,validateHeatSetRecord} from '../../skills/heat-set-inserts/scripts/feature.mjs';
import {filamentPlan} from '../machine/filaments.mjs';

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
    composition: { order: [], dependencies: [], batchLayers: 1 },
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

export function validatePlanFields(plan,machine) {
  requireThat(plan && typeof plan === 'object' && GEOMETRY_SHAPES.includes(plan.geometry?.shape), `Unsupported shape; geometry.shape is one of ${GEOMETRY_SHAPES.join(', ')}.`);
  // Validation is check-only: a plan carries every current field or it is
  // rejected. Pre-policy bundles are recreated from their skills, not migrated.
  const expected = { ...defaults(machine), geometry: geometryTemplate(plan.geometry.shape,plan.geometry) };
  keys(plan, expected);
  requireThat(plan.schema === expected.schema && plan.generatorVersion === VERSION, 'Unsupported plan or generator version.');
  requireThat(Number.isInteger(plan.composition.batchLayers)&&plan.composition.batchLayers>=1&&plan.composition.batchLayers<=20,'Batch size must be 1–20 layers.');
  requireThat(Array.isArray(plan.composition.order) && plan.composition.order.every(id=>typeof id==='string') && Array.isArray(plan.composition.dependencies) && plan.composition.dependencies.every(e=>e && typeof e.before==='string' && typeof e.after==='string' && Object.keys(e).sort().join()==='after,before'), 'Invalid composition rules.');

  return plan;
}

export function validatePlanGeometry(plan,machine) {
  const {geometry,placement,setup}=plan;
  validatePlasticWeld(plan,machine);
  if(geometry.shape==='spline'){
    // The control-net hull contains the surface, so this check can only be
    // conservative; generation checks the actual moves.
    const hull=splineSolidBounds(validateSplineSolid(geometry)),bounds=toolBounds(machine,setup.tool),at=[placement.xMm,placement.yMm,0];
    requireThat(machine.motionChecks==='deferred'||hull.min.every((v,i)=>v+at[i]>=bounds.min[i]-1e-8)&&hull.max.every((v,i)=>v+at[i]<=bounds.max[i]+1e-8),'Placed spline control net exceeds selected tool bounds.');
  }
  if(geometry.shape==='boolean'){
    const hull=authoredBounds(geometry),bounds=toolBounds(machine,setup.tool),at=[placement.xMm,placement.yMm,0];
    requireThat(machine.motionChecks==='deferred'||hull.min.every((v,i)=>v+at[i]>=bounds.min[i]-1e-8)&&hull.max.every((v,i)=>v+at[i]<=bounds.max[i]+1e-8),'Placed boolean operands exceed selected tool bounds.');
  }
  if(geometry.shape==='text')validateTextRecord(geometry);
  if(geometry.shape==='heat-set')validateHeatSetRecord(geometry);
  if(geometry.shape==='gridfinity')validateGridfinityRecord(geometry);
  if(geometry.shape==='blob-field')validateBlobFieldRecord(geometry);
  if(['mesh','blob-field','text','gridfinity','heat-set'].includes(geometry.shape)) {
    const mesh=makeMesh(geometry.vertices,geometry.triangles),bounds=toolBounds(machine,setup.tool);
    requireThat(machine.motionChecks==='deferred'||mesh.bounds.min.every((v,i)=>v+[placement.xMm,placement.yMm,0][i]>=bounds.min[i]-1e-8)&&mesh.bounds.max.every((v,i)=>v+[placement.xMm,placement.yMm,0][i]<=bounds.max[i]+1e-8),'Placed mesh exceeds selected tool bounds.');
    if(geometry.shape==='mesh')validateMeshSource(geometry);
  }

  return plan;
}

const validateMeshSource=geometry=>requireThat(geometry.source===null||(geometry.source?.format==='stl'&&/^[a-f0-9]{64}$/.test(geometry.source.sha256)&&['mm','inch'].includes(geometry.source.units)&&Number.isFinite(geometry.source.scale)&&geometry.source.scale>0),'Invalid mesh source provenance.');

// A boolean's operands are validated by their own forms and bounded without
// building them: control-net hulls for splines, vertices for meshes.
function authoredBounds(geometry){
  if(geometry.shape==='boolean')return booleanShell(validateBooleanSolid(geometry).operation,geometry.operands.map(operand=>({bounds:authoredBounds(operand)}))).bounds;
  if(geometry.shape==='spline')return splineSolidBounds(validateSplineSolid(geometry));
  if(geometry.shape==='blob-field')validateBlobFieldRecord(geometry);
  else {keys(geometry,{shape:'mesh',vertices:[],triangles:[],source:null},'boolean operand');validateMeshSource(geometry);}
  return makeMesh(geometry.vertices,geometry.triangles).bounds;
}

// Layer height, bead width, flow and retraction ceilings are declared by the
// selected tool and material, and validateSetup enforces them against that
// profile two steps later. Repeating them here as chosen numbers refused a
// legitimate 0.8 mm nozzle, so this pass keeps only the floors that say a value
// is not a usable process value at all. Axis speeds are bounded by the machine's
// own declared feed, which is a property of the hardware rather than a budget.
export function validatePlanProcess(plan,machine) {
  const {process}=plan;
  requireThat(typeof process.experimentalDeposition==='boolean','experimentalDeposition must be boolean.');
  const feed=machine?.maxFeedMmS,xy=feed?Math.min(feed.x,feed.y):null;
  const finiteAtLeast=(value,min,name)=>requireThat(typeof value==='number'&&Number.isFinite(value)&&value>=min,
    `${name} must be a finite value of at least ${min}.`);
  const bounded2=(value,min,max,name)=>max===null||max===undefined?finiteAtLeast(value,min,name):number(value,min,max,name);
  const bounded=(key,min,max)=>max===null||max===undefined?finiteAtLeast(process[key],min,key):number(process[key],min,max,key);
  for (const [key, min] of [['firstLayerMm', 0.01], ['layerMm', 0.01], ['lineWidthMm', 0.05], ['maxFlowMm3S', 0.1],
    ['retractMm', 0], ['retractSpeedMmS', 1], ['liftMm', 0], ['maxCombMm', 0], ['minimumLayerSeconds', 0]])
    finiteAtLeast(process[key], min, key);
  for (const [key, min, max] of [['planarSpeedMmS', 2, xy], ['skinSpeedMmS', 2, xy], ['firstLayerSpeedMmS', 2, xy],
    ['travelSpeedMmS', 5, xy], ['zSpeedMmS', 1, feed?feed.z:null]]) bounded(key, min, max);
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
        Math.hypot(pass.endMm[0]-pass.startMm[0],pass.endMm[1]-pass.startMm[1])>=10,'Prime pass needs two finite XY endpoints at least 10 mm apart.');
      finiteAtLeast(pass.zMm,.05,'Prime line Z');finiteAtLeast(pass.widthMm,.05,'Prime line width');
      finiteAtLeast(pass.heightMm,.01,'Prime line height');bounded2(pass.speedMmS,2,xy,'Prime line speed');
    }
  }

  return plan;
}

export function validatePlanAuxiliary(plan,machine) {
  const {geometry,process,setup,skills}=plan;
  validateSetup(plan,machine);
  validateSupports(skills.supports,process);
  if(skills.supports.enabled)requireMachine(machine,['xyz-extrusion','planar'],'supports');
  requireThat(typeof setup.startupVerified === 'boolean' && typeof setup.firmwareVersion === 'string' && /^[\w .+-]{0,80}$/.test(setup.firmwareVersion), 'Invalid firmware setup.');

  return plan;
}

export function validatePlanSelections(plan,machine) {
  const {geometry,placement,skills}=plan;
  const sliced=plan.slices.assignments.length>0;
  // A slice part is a geometry selection: a component or a prepared material
  // part; two cut parts never share material.
  const selections=geometrySelections(geometry);
  validateSlices(plan.slices,{parts:[...selections.keys()].filter(key=>key!==null),lineWidthMm:plan.process.lineWidthMm,firstLayerMm:plan.process.firstLayerMm});
  for(const assignment of plan.slices.assignments){
    const selected=assignmentPlan(plan,machine,assignment);
    validatePlanProcess(selected,machine);validateSetup(selected,machine);
  }
  validateModulations(plan.modulations,{assignmentIds:plan.slices.assignments.map(a=>a.id)});
  const cut=[...new Set(plan.slices.assignments.filter(a=>!a.construction&&a.preset!=='support').flatMap(a=>a.part!==null?[a.part]:geometry.shape==='assembly'?geometry.parts.map(p=>p.id):[null]))];
  for(const [i,a] of cut.entries())for(const b of cut.slice(i+1))requireThat(!selectionsOverlap(selections.get(a),selections.get(b)),
    `Slice assignments cut overlapping parts ${a??'the whole print'} and ${b??'the whole print'}; give that material to one of them.`);
  if(geometry.shape==='assembly') {
    requireThat(Array.isArray(geometry.parts)&&geometry.parts.length>=2&&geometry.parts.length<=20,'An assembly needs 2–20 components.');
    const ids=new Set();
    for(const part of geometry.parts){
      requireThat(part&&Object.keys(part).sort().join()==='geometry,id,xMm,yMm,zMm'&&/^[a-z][a-z0-9-]*$/.test(part.id)&&!ids.has(part.id),'Invalid or duplicate component.');
      ids.add(part.id);
      requireThat(part.geometry?.shape!=='assembly','Nested assemblies are not supported.');
      number(part.xMm,-200,200,'Component X');number(part.yMm,-200,200,'Component Y');number(part.zMm,0,200,'Component Z');
      const assigned=plan.slices.assignments.filter(a=>a.part===part.id).map(a=>a.filament??undefined).find(f=>f!==undefined);
      const child=structuredClone(assigned!==undefined?filamentPlan(plan,machine,assigned):plan);child.geometry=part.geometry;
      child.placement={xMm:placement.xMm+part.xMm,yMm:placement.yMm+part.yMm};
      child.slices={...child.slices,assignments:child.slices.assignments.filter(a=>a.part===null||a.part===part.id).map(a=>({...a,part:null}))};
      child.skills['plastic-weld'].enabled=false;
      child.modulations=defaultModulations();
      // A component checked on its own is sliced whole by one default owner.
      if(!child.slices.assignments.length){for(const settings of Object.values(child.skills))settings.enabled=false;child.slices=defaultSlices();}
      validatePlan(child,machine);
    }
  }
  requireThat(sliced, 'Add a slice assignment.');
  for(const assignment of plan.slices.assignments.filter(a=>['skin','fronts','sleeve'].includes(a.construction))){
    requireMachine(machine,['xyz-extrusion','nonplanar'],assignment.construction);
    if(['skin','sleeve'].includes(assignment.construction)&&geometry.shape==='assembly')requireThat(assignment.part!==null,'An assembly skin or sleeve must select a component.');
  }
  for(const assignment of plan.slices.assignments.filter(a=>a.construction==='rim')){
    requireMachine(machine,['xyz-extrusion','planar'],'rim');
    if(geometry.shape==='assembly')requireThat(assignment.part!==null,'An assembly rim must select a component.');
  }
  for(const assignment of plan.slices.assignments.filter(a=>a.construction==='cladding')){
    requireMachine(machine,['xyz-extrusion','tool-orientation','coordinated-rotary'],'cladding');
    if(geometry.shape==='assembly')requireThat(assignment.part!==null,'Assembly cladding must select a component.');
  }
  if(sliced)requireMachine(machine,['xyz-extrusion'],'slice');
  if(plan.slices.assignments.some(a=>!a.construction))requireMachine(machine,['planar'],'slice');
  return plan;
}

export function validatePlanPlacement(plan,machine) {
  const {placement}=plan;
  requireThat(machine.schema === 'saam-machine/1' && machine.outputs.some(option => option.id === plan.output), 'Unsupported machine or output.');
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
