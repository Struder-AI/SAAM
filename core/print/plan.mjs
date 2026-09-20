// Process plan for shell-based prints: geometry, placement, setup, shared
// process settings, and the settings of each selected skill.
//
// A locked plan must carry everything generation needs, so generation makes no
// further process choices. Unknown or missing fields are rejected rather than
// defaulted at generation time, which is what keeps a regenerated path
// identical to the reviewed one.

import { createHash } from 'node:crypto';
import { FULL_FILL_DEFAULTS } from '../../skills/full-fill/scripts/fill.mjs';
import { DRAPED_SKIN_DEFAULTS } from '../../skills/draped-skin/scripts/drape.mjs';
import { requireThat } from '../geom/tolerance.mjs';
import {loadMachine,validateSetup,toolBounds,requireMachine,centeredPlacement} from '../machine/profile.mjs';
import {makeMesh} from '../geom/mesh.mjs';
import {PLANAR_INFILL_DEFAULTS} from '../../skills/planar-infill/scripts/infill.mjs';
import {INFILL_PATTERNS} from '../../skills/planar-infill/scripts/patterns.mjs';
import {LINE_NETWORK_DEFAULTS} from '../../skills/line-network/scripts/network.mjs';
import {VASE_WALL_DEFAULTS} from '../../skills/vase-wall/scripts/vase.mjs';
import {THICK_LIP_DEFAULTS} from '../../skills/thick-lip/scripts/lip.mjs';
import {validateVasePattern} from '../../skills/vase-wall/scripts/paths.mjs';
import {SUPPORT_DEFAULTS,validateSupports} from '../../skills/supports/scripts/supports.mjs';
import {RIMMING_DEFAULTS,validateRimming} from '../../skills/rimming-planar/scripts/rimming.mjs';
import {PIPE_CLADDING_DEFAULTS,validateCladding} from '../../skills/pipe-cladding/scripts/clad.mjs';
import {pipeMesh} from '../geom/cylinder.mjs';
import {validateSplineTube} from '../geom/spline-tube.mjs';
import {gridfinityTemplate,validateGridfinityRecord} from '../../skills/gridfinity/scripts/record.mjs';
import {textTemplate,validateTextRecord} from '../geom/text-record.mjs';
import {geometrySelections} from '../geom/selections.mjs';
import {SPACING_SKILLS,lineSpacing} from '../path/spacing.mjs';
import {WAVE_DEFAULTS,validateWaves} from '../../skills/wave-overhangs/scripts/wave.mjs';
import {PLASTIC_WELD_DEFAULTS,validatePlasticWeld} from '../../skills/plastic-weld/scripts/weld.mjs';
import {heatSetTemplate,validateHeatSetRecord} from '../../skills/heat-set-inserts/scripts/feature.mjs';

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
    geometry: { shape: 'spline-top', runMm: 40, widthMm: 30, cpU: 5, cpV: 5, heightsMm: domeHeights(5, 5) },
    placement: centeredPlacement(machine, machine.defaultSetup.tool, { runMm: 40, widthMm: 30 }) ?? { xMm: 140, yMm: 100 },
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
      'wave-overhangs':structuredClone(WAVE_DEFAULTS),
      'pipe-cladding':structuredClone(PIPE_CLADDING_DEFAULTS),
      supports: structuredClone(SUPPORT_DEFAULTS),
      'rimming-planar':structuredClone(RIMMING_DEFAULTS),
      'rimming-normal':structuredClone(RIMMING_DEFAULTS),
      'full-fill': { enabled: true, parts: [], ...FULL_FILL_DEFAULTS },
      'planar-infill': {enabled:false,parts:[],...PLANAR_INFILL_DEFAULTS},
      'line-network': structuredClone(LINE_NETWORK_DEFAULTS),
      'vase-wall': {enabled:false,part:null,...VASE_WALL_DEFAULTS},
      'thick-lip': {enabled:false,part:null,...THICK_LIP_DEFAULTS},
      'draped-skin': { enabled: machine.capabilities.includes('nonplanar'), part: null, ...DRAPED_SKIN_DEFAULTS }
    },
    composition: { order: [], dependencies: [], batchLayers: 1, regions: [] },
    output: 'griffin-gcode'
  };
  Object.assign(plan.process,machine.defaultProcess??{});
  plan.output=machine.outputs[0].id;
  return plan;
}

// A gentle dome whose slope stays inside the S5's non-planar limit.
export function domeHeights(cpU, cpV, peak = 6, rise = 1.2) {
  const grid = [];
  for (let i = 0; i < cpU; i++) {
    const row = [];
    for (let j = 0; j < cpV; j++)
      row.push(Number((peak + rise * Math.sin(Math.PI * i / (cpU - 1)) * Math.sin(Math.PI * j / (cpV - 1))).toFixed(4)));
    grid.push(row);
  }
  return grid;
}

// Each shape carries its own parameters, so the strict field check is made
// against the selected shape rather than against whichever shape is the default.
export function geometryTemplate(shape,geometry) {
  if(shape==='heat-set')return heatSetTemplate();
  if(shape==='gridfinity')return gridfinityTemplate();
  if(shape==='text')return textTemplate(geometry);
  if(shape==='spline-tube')return {shape,innerRadiusMm:8,heightMm:24,controlPoints:[]};
  if(shape==='pipe')return {shape:'pipe',innerRadiusMm:8,outerRadiusMm:10.4,heightMm:12,toleranceMm:0.01};
  if(shape==='mesh')return {shape:'mesh',vertices:[],triangles:[],source:null};
  if(shape==='assembly')return {shape:'assembly',parts:[]};
  if (shape === 'box') return { shape: 'box', runMm: 30, widthMm: 20, heightMm: 10 };
  if (shape === 'wedge') return { shape: 'wedge', runMm: 30, widthMm: 20, baseMm: 2, angleDeg: 15 };
  if (shape === 'spline-shell') return {
    shape: 'spline-shell', runMm: 40, widthMm: 30, cpU: 5, cpV: 5,
    longSideInsetMm: 1, shortSideOutsetMm: 1, heightsMm: []
  };
  if (shape === 'vertical-spline-shell') return {
    shape: 'vertical-spline-shell', runMm: 40, widthMm: 30, cpU: 4, cpV: 4,
    xBulgeMm: 4, yInsetMm: 3, heightsMm: []
  };
  return { shape: 'spline-top', runMm: 40, widthMm: 30, cpU: 5, cpV: 5, heightsMm: [] };
}

// The process keys a line network may override for itself; the region override keys.
const LINE_NETWORK_PROCESS_KEYS=['firstLayerMm','layerMm','lineWidthMm','planarSpeedMmS','firstLayerSpeedMmS'];

export function validatePlan(plan, machine) {
  requireThat(plan && typeof plan === 'object' && ['box', 'wedge', 'spline-top', 'spline-shell', 'vertical-spline-shell', 'assembly','mesh','pipe','spline-tube','text','gridfinity','heat-set'].includes(plan.geometry?.shape), 'Unsupported shape.');
  // Validation is check-only: a plan carries every current field or it is
  // rejected. Pre-policy bundles are recreated from their skills, not migrated.
  const expected = { ...defaults(machine), geometry: geometryTemplate(plan.geometry.shape,plan.geometry) };
  keys(plan, expected);
  requireThat(plan.schema === expected.schema && plan.generatorVersion === VERSION, 'Unsupported plan or generator version.');
  requireThat(Array.isArray(plan.composition.regions)&&plan.composition.regions.length<=80,'Composition regions must be an array of at most 80 assignments.');
  const regional=plan.composition.regions.length>0;
  requireThat(Number.isInteger(plan.composition.batchLayers)&&plan.composition.batchLayers>=1&&plan.composition.batchLayers<=20,'Batch size must be 1–20 layers.');
  requireThat(Array.isArray(plan.composition.order) && plan.composition.order.every(id=>typeof id==='string') && Array.isArray(plan.composition.dependencies) && plan.composition.dependencies.every(e=>e && typeof e.before==='string' && typeof e.after==='string' && Object.keys(e).sort().join()==='after,before'), 'Invalid composition rules.');
  // Regional overrides use these same settings through the ordinary child-plan
  // validation below.
  for(const name of SPACING_SKILLS)lineSpacing(plan.process.lineWidthMm,plan.skills[name]);

  const { geometry, placement, process, setup, skills } = plan;
  validatePlasticWeld(plan,machine);
  if(geometry.shape==='spline-tube')validateSplineTube(geometry);
  if(geometry.shape==='text')validateTextRecord(geometry);
  if(geometry.shape==='heat-set')validateHeatSetRecord(geometry);
  if(geometry.shape==='gridfinity')validateGridfinityRecord(geometry);
  if(!['assembly','mesh','pipe','spline-tube','text','gridfinity','heat-set'].includes(geometry.shape)) for (const [key, min, max] of [['runMm', 5, 200], ['widthMm', 5, 200]]) number(geometry[key], min, max, key);
  if(geometry.shape==='pipe'){
    for(const key of ['innerRadiusMm','outerRadiusMm','heightMm','toleranceMm'])requireThat(Number.isFinite(geometry[key])&&geometry[key]>0,'Invalid pipe '+key+'.');
    requireThat(geometry.toleranceMm<geometry.innerRadiusMm/4,'Pipe mesh tolerance exceeds its bore radius.');pipeMesh(geometry);
  }
  validateCladding(plan,machine);
  if(['mesh','text','gridfinity','heat-set'].includes(geometry.shape)) {
    const mesh=makeMesh(geometry.vertices,geometry.triangles),bounds=toolBounds(machine,setup.tool);
    requireThat(machine.motionChecks==='deferred'||mesh.bounds.min.every((v,i)=>v+[placement.xMm,placement.yMm,0][i]>=bounds.min[i]-1e-8)&&mesh.bounds.max.every((v,i)=>v+[placement.xMm,placement.yMm,0][i]<=bounds.max[i]+1e-8),'Placed mesh exceeds selected tool bounds.');
    if(geometry.shape==='mesh')requireThat(geometry.source===null||(geometry.source?.format==='stl'&&/^[a-f0-9]{64}$/.test(geometry.source.sha256)&&['mm','inch'].includes(geometry.source.units)&&Number.isFinite(geometry.source.scale)&&geometry.source.scale>0),'Invalid mesh source provenance.');
  }
  if (geometry.shape === 'box') number(geometry.heightMm, 0.5, 200, 'heightMm');
  if (geometry.shape === 'wedge') {
    number(geometry.baseMm, 0.5, 50, 'baseMm');
    number(geometry.angleDeg, 0.5, 60, 'angleDeg');
  }
  if (geometry.shape === 'spline-top' || geometry.shape === 'spline-shell' || geometry.shape === 'vertical-spline-shell') {
    for (const [key, min, max] of [['cpU', 3, 12], ['cpV', 3, 12]]) number(geometry[key], min, max, key);
    requireThat(Array.isArray(geometry.heightsMm) && geometry.heightsMm.length === geometry.cpU, 'heightsMm must have cpU rows.');
    for (const row of geometry.heightsMm) {
      requireThat(Array.isArray(row) && row.length === geometry.cpV, 'heightsMm rows must have cpV entries.');
      for (const value of row) number(value, 0.5, 200, 'control height');
    }
  }
  if (geometry.shape === 'spline-shell') {
    number(geometry.longSideInsetMm, 0, (geometry.widthMm - 5) / 2, 'Long-side inset');
    number(geometry.shortSideOutsetMm, 0, 50, 'Short-side outset');
  }
  if (geometry.shape === 'vertical-spline-shell') {
    number(geometry.xBulgeMm, 0, 50, 'X-side bulge');
    number(geometry.yInsetMm, 0, (geometry.widthMm - 5) / 2, 'Y-side inset');
  }

  requireThat(typeof process.experimentalDeposition==='boolean','experimentalDeposition must be boolean.');
  const planarLimits=process.experimentalDeposition?{firstLayerMm:1,layerMm:1,lineWidthMm:2,maxFlowMm3S:30}:{firstLayerMm:.3,layerMm:.3,lineWidthMm:.8,maxFlowMm3S:15};
  for (const [key, min, max] of [['firstLayerMm', 0.1, planarLimits.firstLayerMm], ['layerMm', 0.06, planarLimits.layerMm], ['lineWidthMm', 0.3, planarLimits.lineWidthMm],
    ['planarSpeedMmS', 2, 80], ['skinSpeedMmS', 2, 40], ['firstLayerSpeedMmS', 2, 40], ['travelSpeedMmS', 5, 200],
    ['zSpeedMmS', 1, 20], ['retractMm', 0, 10], ['retractSpeedMmS', 1, 50], ['liftMm', 0, 20],
    ['maxCombMm', 0, 100], ['fanPercent', 0, 100], ['maxFlowMm3S', 0.1, planarLimits.maxFlowMm3S], ['minimumLayerSeconds', 0, 60]])
    number(process[key], min, max, key);
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
      number(pass.zMm,.05,10,'Prime line Z');number(pass.widthMm,.3,planarLimits.lineWidthMm,'Prime line width');
      number(pass.heightMm,.05,planarLimits.layerMm,'Prime line height');number(pass.speedMmS,2,80,'Prime line speed');
    }
  }

  validateSetup(plan,machine);
  validateWaves(skills['wave-overhangs']);
  if(skills['wave-overhangs'].enabled){
    requireMachine(machine,['xyz-extrusion','nonplanar'],'wave-overhangs');
    for(const slice of skills['wave-overhangs'].slices){
      const parts=[...slice.afterParts,...slice.beforeParts,...(Object.hasOwn(slice.surface,'patch')?[slice.surface.part]:[])];
      requireThat(parts.every(id=>geometry.shape==='assembly'?id!==null&&geometry.parts.some(p=>p.id===id):id===null),'Wave dependencies and native surfaces must name existing assembly parts, or null for a single part.');
    }
  }
  validateSupports(skills.supports,process);
  const rimSurfaces=new Set();
  for(const name of ['rimming-planar','rimming-normal']){
    validateRimming(skills[name]);
    if(skills[name].enabled){
      requireMachine(machine,name==='rimming-normal'?['xyz-extrusion','nonplanar']:['xyz-extrusion','planar'],name);
      for(const surface of skills[name].surfaces){
        const key=JSON.stringify(surface.controlPoints);
        requireThat(!rimSurfaces.has(key),'Choose one rimming offset skill for a given surface; compare the two in separate prints.');rimSurfaces.add(key);
        if(geometry.shape==='assembly')requireThat([surface.basePart,surface.supportedPart].every(id=>id===null||geometry.parts.some(p=>p.id===id)),'Unknown rimming component.');
        else requireThat(surface.basePart===null&&surface.supportedPart===null,'Rimming component names require an assembly.');
      }
    }
  }
  if(skills.supports.enabled)requireMachine(machine,['xyz-extrusion','planar'],'supports');
  requireThat(typeof setup.startupVerified === 'boolean' && typeof setup.firmwareVersion === 'string' && /^[\w .+-]{0,80}$/.test(setup.firmwareVersion), 'Invalid firmware setup.');

  const fill = skills['full-fill'], skin = skills['draped-skin'],normal=skills['planar-infill'],network=skills['line-network'];
  const vase=skills['vase-wall'];
  requireThat(['continuous','segmented'].includes(vase.pathMode),'Path mode must be continuous or segmented.');
  validateVasePattern(vase.pattern,vase.pathMode);
  requireThat(vase.pattern!==null||vase.pathMode==='continuous','Segmented mode requires a sleeve pattern; ordinary vase walls are continuous.');
  requireThat(['spiral','level'].includes(vase.endTransition),'Vase ending transition must be spiral or level.');
  // Zero keeps the exact per-section wall; a positive tolerance lets standard
  // mesh walls follow a fitted sleeve within that sampled deviation.
  number(vase.sleeveToleranceMm,0,0.5,'Vase sleeve tolerance');
  if(vase.meshSleeve!==null){
    const fit=vase.meshSleeve;
    requireThat(fit&&typeof fit==='object'&&!Array.isArray(fit)&&[
      'circumferentialControls,contactSide,detailToleranceMm,fidelity,heightControls',
      'circumferentialControls,contactSide,detailToleranceMm,fidelity,heightControls,offsetTightness'
    ].includes(Object.keys(fit).sort().join()),
      'Mesh sleeve settings require fidelity, contactSide, circumferentialControls, heightControls and detailToleranceMm, with optional offsetTightness.');
    number(fit.fidelity,0,1,'Mesh sleeve fidelity');
    if(Object.hasOwn(fit,'offsetTightness'))number(fit.offsetTightness,0,1,'Mesh sleeve offset tightness');
    requireThat(['inside','outside'].includes(fit.contactSide),'Mesh sleeve contactSide must be inside or outside.');
    requireThat(Number.isInteger(fit.circumferentialControls)&&fit.circumferentialControls>=8&&fit.circumferentialControls<=48,'Mesh sleeve circumferentialControls must be an integer from 8 to 48.');
    requireThat(Number.isInteger(fit.heightControls)&&fit.heightControls>=4&&fit.heightControls<=32,'Mesh sleeve heightControls must be an integer from 4 to 32.');
    number(fit.detailToleranceMm,.005,.5,'Mesh sleeve detail tolerance');
  }
  requireThat(typeof vase.enabled==='boolean'&&(vase.part===null||typeof vase.part==='string'),'Invalid vase-wall selection.');
  requireThat(Number.isFinite(vase.zStartMm)&&vase.zStartMm>=0,'Vase start height must be at or above the component base.');
  requireThat(vase.zEndMm===null||(Number.isFinite(vase.zEndMm)&&vase.zEndMm>vase.zStartMm),'Vase end height must be null or greater than its start.');
  number(vase.sampleStepMm,0.1,5,'Vase sampling step');number(vase.toleranceMm,0.002,0.05,'Vase chord tolerance');
  number(vase.boundaryToleranceMm,0.002,0.05,'Vase boundary tolerance');
  number(vase.minFeatureMm,0.05,5,'Vase minimum section feature');
  const lip=skills['thick-lip'];
  requireThat(typeof lip.enabled==='boolean'&&(lip.part===null||typeof lip.part==='string'),'Invalid thick-lip selection.');
  requireThat(Array.isArray(lip.steps)&&lip.steps.length>=1&&lip.steps.length<=50&&lip.steps.every(n=>Number.isInteger(n)&&n>=1),'Lip steps must be 1–50 layer entries, each a whole number of perimeters from 1 up.');
  number(lip.minFeatureMm,0.05,5,'Lip minimum section feature');
  requireThat(typeof normal.enabled==='boolean'&&Array.isArray(normal.parts)&&new Set(normal.parts).size===normal.parts.length&&normal.parts.every(id=>typeof id==='string'),'Invalid planar-infill selection.');
  // Course, group, stroke and point counts follow the authored frame; only the
  // shape of each entry is checked.
  requireThat(typeof network.enabled==='boolean'&&Number.isInteger(network.layers)&&network.layers>=1&&Array.isArray(network.networks),'Invalid line-network settings.');
  const networkIds=new Set();
  for(const item of network.networks){
    requireThat(item&&typeof item==='object'&&['id,strokes','id,layers,strokes','id,process,strokes','id,layers,process,strokes'].includes(Object.keys(item).sort().join())&&/^[a-z][a-z0-9-]*$/.test(item.id)&&!networkIds.has(item.id)&&Array.isArray(item.strokes)&&item.strokes.length>0,'Invalid line network.');networkIds.add(item.id);
    // A network may own its course count and its layer grid, bead width and speeds, the
    // same five process keys a region may override. The override is checked as if the whole
    // plan ran with it, so machine, layer and width limits apply to that network unchanged.
    requireThat(item.layers===undefined||Number.isInteger(item.layers)&&item.layers>=1,'Invalid line-network course count.');
    const courses=item.layers??network.layers;
    if(item.process!==undefined){
      requireThat(item.process&&typeof item.process==='object'&&!Array.isArray(item.process)&&Object.keys(item.process).length>0&&Object.keys(item.process).every(key=>LINE_NETWORK_PROCESS_KEYS.includes(key)),
        `Line network ${item.id} process overrides must be a non-empty object of ${LINE_NETWORK_PROCESS_KEYS.join(', ')}.`);
      const child=structuredClone(plan);Object.assign(child.process,item.process);
      child.skills['line-network'].networks=[{id:item.id,strokes:[{closed:false,points:[[0,0],[1,0]]}]}];
      validatePlan(child,machine);
    }
    for(const stroke of item.strokes){
      const keys=Object.keys(stroke).sort().join();
      requireThat(stroke&&(keys==='closed,points'||keys==='closed,layers,points')&&typeof stroke.closed==='boolean'&&Array.isArray(stroke.points)&&stroke.points.length>=(stroke.closed?3:2)&&stroke.points.every(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)),'Invalid line-network stroke.');
      requireThat(stroke.layers===undefined||Array.isArray(stroke.layers)&&stroke.layers.length>0&&new Set(stroke.layers).size===stroke.layers.length&&stroke.layers.every(layer=>Number.isInteger(layer)&&layer>=0&&layer<courses),'Invalid line-network stroke layers.');
    }
  }
  requireThat(!network.enabled||(!regional&&!fill.enabled&&!skin.enabled&&!normal.enabled&&!vase.enabled&&!lip.enabled),'line-network is a standalone planar path; disable filled, skin, vase and regional patterns.');
  requireThat(['body','solid-surfaces'].includes(fill.mode),'Invalid full-fill mode.');
  for(const key of ['bottomLayers','topLayers'])requireThat(Number.isInteger(fill[key])&&fill[key]>=0&&fill[key]<=20,`${key} must be 0–20.`);
  requireThat(regional||!fill.enabled||fill.mode!=='solid-surfaces'||normal.enabled,'Solid surface masks require planar-infill.');
  requireThat(Array.isArray(fill.parts)&&new Set(fill.parts).size===fill.parts.length&&fill.parts.every(id=>typeof id==='string'),'Invalid full-fill component selection.');
  requireThat(skin.part===null||typeof skin.part==='string','Invalid draped surface component.');
  if(geometry.shape==='assembly') {
    requireThat(Array.isArray(geometry.parts)&&geometry.parts.length>=2&&geometry.parts.length<=20,'An assembly needs 2–20 components.');
    const ids=new Set();
    for(const part of geometry.parts){
      requireThat(part&&Object.keys(part).sort().join()==='geometry,id,xMm,yMm,zMm'&&/^[a-z][a-z0-9-]*$/.test(part.id)&&!ids.has(part.id),'Invalid or duplicate component.');
      ids.add(part.id);
      requireThat(part.geometry?.shape!=='assembly','Nested assemblies are not supported.');
      number(part.xMm,-200,200,'Component X');number(part.yMm,-200,200,'Component Y');number(part.zMm,0,200,'Component Z');
      const child=structuredClone(plan);child.geometry=part.geometry;
      child.placement={xMm:placement.xMm+part.xMm,yMm:placement.yMm+part.yMm};
      child.skills['full-fill'].parts=[];child.skills['draped-skin'].part=null;
      child.skills['planar-infill'].parts=[];
      child.skills['vase-wall'].part=null;
      child.skills['thick-lip'].part=null;
      child.skills['pipe-cladding'].enabled=false;child.skills['pipe-cladding'].part=null;
      child.skills['wave-overhangs'].enabled=false;
      child.skills['plastic-weld'].enabled=false;
      for(const name of ['rimming-planar','rimming-normal'])child.skills[name].enabled=false;
      child.composition.regions=[];
      if(regional){for(const settings of Object.values(child.skills))settings.enabled=false;child.skills['full-fill'].enabled=true;child.skills['full-fill'].mode='body';}
      validatePlan(child,machine);
    }
    requireThat(fill.parts.every(id=>ids.has(id))&&(skin.part===null||ids.has(skin.part)),'Unknown selected component.');
    requireThat(normal.parts.every(id=>ids.has(id)),'Unknown planar-infill component.');
    requireThat(regional||!skin.enabled||skin.part!==null,'An assembly must select the component whose roof is draped.');
    requireThat((vase.part===null||ids.has(vase.part))&&(regional||!vase.enabled||vase.part!==null),'An assembly must select a known vase-wall component.');
    requireThat(lip.part===null||ids.has(lip.part),'Unknown thick-lip component.');
  } else requireThat(fill.parts.length===0&&normal.parts.length===0&&skin.part===null&&vase.part===null&&lip.part===null,'Component selection requires assembly geometry.');
  requireThat(typeof fill.enabled === 'boolean' && typeof skin.enabled === 'boolean', 'Each skill needs an enabled flag.');
  requireThat(regional||fill.enabled || skin.enabled || normal.enabled || vase.enabled || lip.enabled || network.enabled || skills['wave-overhangs'].enabled, 'Select at least one pattern skill.');
  if(!regional&&vase.enabled)requireMachine(machine,['xyz-extrusion','nonplanar'],'vase-wall');
  if(!regional&&lip.enabled)requireMachine(machine,['xyz-extrusion','planar'],'thick-lip');
  if(!regional&&normal.enabled)requireMachine(machine,['xyz-extrusion','planar'],'planar-infill');
  if(network.enabled)requireMachine(machine,['xyz-extrusion','planar'],'line-network');
  if(!regional&&fill.enabled)requireMachine(machine,['xyz-extrusion','planar'],'full-fill');
  if(!regional&&skin.enabled)requireMachine(machine,['xyz-extrusion','nonplanar'],'draped-skin');
  requireThat(Number.isInteger(fill.perimeters), 'perimeters must be an integer.');
  requireThat(fill.perimeters >= 0, 'perimeters must be zero or more.');
  requireThat(['all','outer'].includes(fill.perimeterScope),'Full-fill perimeterScope must be all or outer.');
  requireThat(fill.holeLineWidthMm===null||(Number.isFinite(fill.holeLineWidthMm)&&fill.holeLineWidthMm>=0.3&&fill.holeLineWidthMm<=process.lineWidthMm),'Full-fill holeLineWidthMm must be null or 0.3 mm through the main line width.');
  requireThat(Array.isArray(fill.fillAnglesDeg) && fill.fillAnglesDeg.length >= 1 && fill.fillAnglesDeg.every(angle => typeof angle === 'number' && angle >= -180 && angle <= 180), 'Invalid fill angles.');
  number(fill.fillOverlap, 0, 0.5, 'fillOverlap');
  number(fill.minFeatureMm, 0.05, 5, 'minFeatureMm');
  number(normal.density,0,1,'Infill density');
  requireThat(normal.density===0||normal.density>=0.01,'Infill density must be zero or 0.01–1.');
  requireThat(INFILL_PATTERNS.includes(normal.pattern),'Unknown infill pattern.');
  number(normal.sampleStepMm,0.01,2,'Infill sample step');
  requireThat(Number.isInteger(normal.perimeters)&&normal.perimeters>=0,'Infill perimeters must be a whole number, zero or more.');
  requireThat(['all','outer'].includes(normal.perimeterScope),'Planar-infill perimeterScope must be all or outer.');
  requireThat(Array.isArray(normal.fillAnglesDeg)&&normal.fillAnglesDeg.length>0&&normal.fillAnglesDeg.every(v=>Number.isFinite(v)&&v>=-180&&v<=180),'Invalid infill angles.');
  number(normal.fillOverlap,0,0.5,'Infill overlap');number(normal.minFeatureMm,0.05,5,'Infill feature size');
  requireThat(Number.isInteger(skin.layers), 'draped skin layers must be an integer.');
  requireThat(skin.layers >= 1, 'draped skin layers must be one or more.');
  number(skin.normalMm, 0.05, 0.5, 'skin normal thickness');
  number(skin.strokeAngleDeg, -180, 180, 'skin stroke angle');
  number(skin.sampleStepMm, 0.1, 5, 'skin sample step');
  number(skin.surveyStepMm, 0.1, 5, 'survey step');
  requireThat(skin.maxAngleDegOverride === null || (Number.isFinite(skin.maxAngleDegOverride)
    && skin.maxAngleDegOverride > 0 && skin.maxAngleDegOverride < 90),
  'Experimental non-planar override must be null or an angle between 0 and 90 degrees.');

  requireThat(machine.schema === 'saam-machine/1' && machine.outputs.some(option => option.id === plan.output), 'Unsupported machine or output.');
  if (!regional&&skin.enabled) requireThat(Number.isFinite(machine.nonplanar?.maxAngleDeg), 'The machine file must declare nonplanar.maxAngleDeg.');
  const xBulgeMm = geometry.shape === 'spline-shell' ? geometry.shortSideOutsetMm
    : geometry.shape === 'vertical-spline-shell' ? geometry.xBulgeMm : 0;
  const bounds=toolBounds(machine,setup.tool);
  if(machine.motionChecks!=='deferred'&&!['assembly','mesh','pipe','spline-tube','text','gridfinity','heat-set'].includes(geometry.shape)) number(placement.xMm, bounds.min[0]+5 + xBulgeMm, bounds.max[0] - geometry.runMm - xBulgeMm - 5, 'Placement X');
  if(machine.motionChecks!=='deferred'&&!['assembly','mesh','pipe','spline-tube','text','gridfinity','heat-set'].includes(geometry.shape)) number(placement.yMm, bounds.min[1]+5, bounds.max[1] - geometry.widthMm - 5, 'Placement Y');
  requireThat(Number.isFinite(placement.xMm)&&Number.isFinite(placement.yMm),'Placement must be finite.');
  const regionIds=new Set(),selections=geometrySelections(geometry);
  for(const region of plan.composition.regions) {
    // process is the one optional assignment field: present only to override layer/bead settings.
    requireThat(region&&Object.keys(region).filter(key=>key!=='process').sort().join()==='id,lowerSurfaceFrom,part,skills,zEndMm,zStartMm','Invalid region assignment fields.');
    requireThat(typeof region.id==='string'&&/^[a-z][a-z0-9-]*$/.test(region.id)&&!regionIds.has(region.id),'Invalid or duplicate region ID.');regionIds.add(region.id);
    const part=selections.get(region.part);
    requireThat(part,'Region must select its geometry component or a prepared text material partition (base, text/feature-id). Rebuild older lettering with the text skill to expose its partitions.');
    // Region heights are bounded by the geometry and the machine, not by a
    // chosen ceiling.
    requireThat(Number.isFinite(region.zStartMm)&&region.zStartMm>=0,'Region start must be a height at or above the bed.');
    requireThat(region.zEndMm===null||(Number.isFinite(region.zEndMm)&&region.zEndMm>region.zStartMm),'Region end must exceed its start or be null.');
    requireThat(region.lowerSurfaceFrom===null||typeof region.lowerSurfaceFrom==='string','Invalid region lower-surface reference.');
    requireThat(region.skills&&typeof region.skills==='object'&&!Array.isArray(region.skills)&&Object.keys(region.skills).length>0,'A region needs selected skills.');
    const child=structuredClone(plan);child.composition.regions=[];
    if(part){child.geometry=part.geometry;child.placement={xMm:placement.xMm+part.xMm,yMm:placement.yMm+part.yMm};}
    for(const [name,settings] of Object.entries(child.skills)){settings.enabled=Object.hasOwn(region.skills,name);if('part' in settings)settings.part=null;if('parts' in settings)settings.parts=[];}
    if(Object.hasOwn(region,'process')){
      requireThat(region.process&&typeof region.process==='object'&&!Array.isArray(region.process)&&Object.keys(region.process).length>0,'Region process overrides must be a non-empty object; omit process to use the plan process.');
      const regionalProcessKeys=new Set(['firstLayerMm','layerMm','lineWidthMm','planarSpeedMmS','firstLayerSpeedMmS']);
      requireThat(Object.keys(region.process).every(key=>regionalProcessKeys.has(key)),'Unknown or region-owned process override.');
      Object.assign(child.process,region.process);
    }
    for(const [name,overrides] of Object.entries(region.skills)) {
      requireThat(!['supports','rimming-planar','rimming-normal','pipe-cladding','wave-overhangs','plastic-weld'].includes(name),'Assign supports, exterior cladding, wave slices and plastic welds through their global skill settings, outside part material regions.');
      const settings=child.skills[name];
      requireThat(settings&&overrides&&typeof overrides==='object'&&!Array.isArray(overrides),'Unknown region skill or invalid overrides.');
      requireThat(Object.keys(overrides).every(key=>Object.hasOwn(settings,key)&&!['enabled','part','parts','zStartMm','zEndMm'].includes(key)),'Unknown or region-owned skill override.');
      Object.assign(settings,overrides);
    }
    validatePlan(child,machine);
  }
  for(const region of plan.composition.regions)requireThat(region.lowerSurfaceFrom===null||(region.lowerSurfaceFrom!==region.id&&regionIds.has(region.lowerSurfaceFrom)),'Unknown or self-referenced region lower surface.');
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
