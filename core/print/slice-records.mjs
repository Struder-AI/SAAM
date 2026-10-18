// Recipe records are explicit inputs, independent of deposition and execution.

import {requireThat} from "../private/toolpath/numeric.mjs";

import {validateSurfaceSelection} from '../geom/surface-region.mjs';
import {validateAssignmentProcess} from "./assignment-process.mjs";

import { validateSplineSolid } from '../geom/spline-solid.mjs';

import {planeSlice} from "../geom/slice.mjs";

import {SLICE_DEFAULTS,SLICE_PRESETS,ordinarySliceAssignment} from './slice-settings.mjs';

import { FILL_PATTERNS } from '../region/fill-patterns.mjs';

import {spacingFactor} from "../path/spacing.mjs";
import {operationPrerequisite,validateEdgeAfter} from './operation-references.mjs';

export {SLICE_DEFAULTS,SLICE_PRESETS} from './slice-settings.mjs';

export const SLICE_VERSION = 1;

const OPTIONAL_FIELDS=['sliceOverrides','loopInsetMm','roles','connectNearby','operationAfter','substrate','geometry','edgeAfter'];

const FIELDS = ['id', 'part', 'preset', 'filament', 'process', ...Object.keys(SLICE_DEFAULTS), 'within', 'surface', 'stack','join','fillOrder','dependencies','description','contact','toolPose'];

export {ordinarySliceAssignment as sliceAssignment} from './slice-settings.mjs';

export const defaultSlices = () => ({ version: SLICE_VERSION, assignments: [ordinarySliceAssignment({ id: 'body' })] });

const between = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

const loopsList = loops => Array.isArray(loops) && loops.length > 0 && loops.every(loop => Array.isArray(loop) && loop.length >= 3 && loop.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)));

const contactProducer=value=>value&&typeof value==='object'&&!Array.isArray(value)&&operationPrerequisite(value)&&Object.keys(value).every(key=>['assignment','part'].includes(key));
const contactOffset=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);

function validateStackContact(a){
  requireThat(a.substrate===undefined||a.substrate===null||operationPrerequisite(a.substrate),'Slice substrate must select manufactured work.');
  requireThat(a.contact===null||a.contact&&Object.keys(a.contact).every(key=>['source','surfaces','offsetMm'].includes(key))&&(a.contact.source===null||typeof a.contact.source==='string'&&a.contact.source!==a.id||contactProducer(a.contact.source)&&a.contact.source.assignment!==a.id)&&
    (a.contact.offsetMm===undefined||contactOffset(a.contact.offsetMm))&&
    (a.contact.surfaces===undefined||Array.isArray(a.contact.surfaces)&&a.contact.surfaces.length>0&&a.contact.surfaces.every(surface=>
      surface&&Object.keys(surface).sort().join()==='offsetMm,part,source,triangles'&&contactProducer(surface.source)&&surface.source.assignment!==a.id&&
      (surface.part===null||typeof surface.part==='string')&&Array.isArray(surface.offsetMm)&&surface.offsetMm.length===3&&surface.offsetMm.every(Number.isFinite)&&
      Array.isArray(surface.triangles)&&surface.triangles.length>0&&surface.triangles.every(triangle=>Array.isArray(triangle)&&triangle.length===3&&triangle.every(point=>Array.isArray(point)&&point.length===3&&point.every(Number.isFinite))))),
    'Slice contact selects a distinct source or finite manufactured contact surfaces.');
  const p=a.toolPose;
  requireThat(p===null||p&&Object.keys(p).join()==='alignToSliceNormal'&&typeof p.alignToSliceNormal==='boolean','Slice toolPose is null or {alignToSliceNormal:boolean}; poses are derived from the slice, not authored samples.');
  for(const v of a.within??[])if(v.kind==='surface-domain'){
    requireThat(v.maxSlopeDeg===undefined||Number.isFinite(v.maxSlopeDeg)&&v.maxSlopeDeg>0&&v.maxSlopeDeg<=90,'Surface domain slope must be greater than 0 and at most 90 degrees.');
    requireThat(v.sampleStepMm===undefined||Number.isFinite(v.sampleStepMm)&&v.sampleStepMm>0,'Surface survey step must be positive.');
  }
}

export function validateSlices(slices) {
  requireThat(slices && typeof slices === 'object' && Object.keys(slices).sort().join() === 'assignments,version', 'plan.slices needs version and assignments.');
  requireThat(Array.isArray(slices.assignments), 'Slice assignments must be a list.');
  const ids = new Set();
  for (const a of slices.assignments) {
    requireThat(!ids.has(a.id),'Duplicate slice assignment id.');ids.add(a.id);
  }
  return slices;
}

export function validateSliceAssignment(a,{parts,firstLayerMm}) {
    if(a.construction)return;
    validateAssignmentProcess(a?.process);validateEdgeAfter(a.edgeAfter,a.id);
    requireThat(a.geometry===undefined||a.geometry&&typeof a.geometry==='object'&&!Array.isArray(a.geometry),'Slice geometry must be an authored solid.');
    const unexpected = Object.keys(a ?? {}).filter(k => !FIELDS.includes(k)&&!OPTIONAL_FIELDS.includes(k)), missing = FIELDS.filter(k => !Object.hasOwn(a ?? {}, k));
    requireThat(!unexpected.length && !missing.length, `Slice assignment ${a?.id ?? ''} has ${[unexpected.length ? 'unexpected ' + unexpected.join(', ') : '', missing.length ? 'missing ' + missing.join(', ') : ''].filter(Boolean).join('; ')}.`);
    requireThat(typeof a.id === 'string' && /^[a-z][a-z0-9-]*$/.test(a.id), 'Invalid slice assignment id.');
    requireThat(a.part === null || parts?.includes(a.part), `Slice ${a.id} names an unknown part.`);
    requireThat(a.preset === null || Object.hasOwn(SLICE_PRESETS, a.preset), `Slice ${a.id} has an unknown preset.`);
    requireThat(a.filament === null || Number.isInteger(a.filament) && a.filament >= 0, `Slice ${a.id} filament must be null or a filament index.`);
    requireThat((Number.isSafeInteger(a.loops) && a.loops >= 0 || Array.isArray(a.loops)&&a.loops.length>0&&a.loops.every(n=>Number.isSafeInteger(n)&&n>=0)), `Slice ${a.id} loops must be a whole number.`);
    requireThat(between(a.fillDensity, 0, 1), `Slice ${a.id} fillDensity must be between 0 and 1.`);
    requireThat(FILL_PATTERNS.includes(a.fillPattern), `Slice ${a.id} fillPattern must be one of ${FILL_PATTERNS.join(', ')}.`);
    requireThat(Array.isArray(a.fillAnglesDeg) && a.fillAnglesDeg.length > 0 && a.fillAnglesDeg.every(Number.isFinite), `Slice ${a.id} has invalid fill angles.`);
    requireThat(typeof a.rotateFill === 'boolean', `Slice ${a.id} rotateFill must be true or false.`);
    requireThat(a.connectNearby===undefined||typeof a.connectNearby==='boolean',`Slice ${a.id} connectNearby must be boolean.`);
    for (const key of ['solidTop', 'solidBottom']) requireThat(Number.isSafeInteger(a[key]) && a[key] >= 0, `Slice ${a.id} ${key} must be a nonnegative safe integer.`);
    requireThat(Number.isFinite(a.fillOverlap) && a.fillOverlap>=0 && Number.isFinite(a.sampleStepMm) && a.sampleStepMm>0, `Slice ${a.id} fillOverlap must be nonnegative and sampleStepMm positive.`);
    // Bead width is checked where lines are stepped, for the assignments using it.
    spacingFactor(a);
    validateStackContact(a);
    validateSliceSurface(a.surface, a.id);
    requireThat(typeof a.description==='string'&&a.dependencies&&Object.keys(a.dependencies).sort().join()==='after,afterParts,beforeParts','Slice description/dependencies have invalid fields.');
    for(const key of ['afterParts','beforeParts'])requireThat(Array.isArray(a.dependencies[key])&&a.dependencies[key].every(part=>parts?.length?parts.includes(part):part===null),'Slice dependency part is not selected geometry.');
    requireThat(Array.isArray(a.dependencies.after)&&a.dependencies.after.every(id=>typeof id==='string'&&id.length),'Slice after dependencies name operation IDs.');
    requireThat(a.operationAfter===undefined||a.operationAfter&&typeof a.operationAfter==='object'&&!Array.isArray(a.operationAfter)&&
      Object.entries(a.operationAfter).every(([group,after])=>['walls','infill','fill'].includes(group)&&Array.isArray(after)&&after.every(operationPrerequisite)),
      'Slice operationAfter maps walls, infill or fill to required operation IDs or {assignment}.');
    if(a.fillOrder!==null){
      const fill=a.fillOrder;
      if(fill.kind==='surface-cells')requireThat(Object.keys(fill).every(key=>['kind','directions','toleranceMm','offsetTightness'].includes(key))&&
        Array.isArray(fill.directions)&&fill.directions.length>0&&fill.directions.every(d=>['axial','circumferential','forward','reverse'].includes(d))&&
        Number.isFinite(fill.toleranceMm)&&fill.toleranceMm>0&&(fill.offsetTightness===undefined||between(fill.offsetTightness,0,1)),'Physical cell fill needs directions and positive toleranceMm.');
      else {
        requireThat(fill.kind==='fronts'&&Object.keys(fill).sort().join()==='kind,lineSpacingMm,propagationStepMm,seedUv,toleranceMm'&&(fill.seedUv===null||loopsList(fill.seedUv)),'Front fill needs seedUv or null.');
        for(const field of ['lineSpacingMm','propagationStepMm','toleranceMm'])requireThat(Number.isFinite(fill[field])&&fill[field]>0,'Front fill dimensions must be positive.');
      }
    }
    requireThat(a.loopInsetMm===undefined||Number.isFinite(a.loopInsetMm),'Loop inset must be finite.');
    requireThat(a.roles===undefined||a.roles&&typeof a.roles==='object'&&!Array.isArray(a.roles)&&Object.keys(a.roles).every(key=>['perimeter','perimeter-inner','infill','fill'].includes(key)&&typeof a.roles[key]==='string'&&a.roles[key].length),'Slice roles map stroke groups to named roles.');
    if(a.sliceOverrides!==undefined){
      requireThat(Array.isArray(a.sliceOverrides)&&a.sliceOverrides.length>0&&a.sliceOverrides.every(batch=>batch&&Object.keys(batch).every(key=>[...Object.keys(SLICE_DEFAULTS),'loopInsetMm','roles','connectNearby','operationAfter'].includes(key))),'sliceOverrides contains per-slice settings.');
      for(const batch of a.sliceOverrides){const {sliceOverrides,...settings}=a;validateSliceAssignment({...settings,...batch},{parts,firstLayerMm});}
    }
    requireThat(a.join===null||Object.keys(a.join).sort().join()==='levelEnd,mode'&&a.join.mode==='spiral'&&typeof a.join.levelEnd==='boolean'&&a.loops===1&&a.fillDensity===0&&a.solidTop===0&&a.solidBottom===0,`Slice ${a.id}: spiral join requires {mode:'spiral',levelEnd:boolean}, one loop and no fill/solid caps.`);
    requireThat(!a.preset || a.surface.kind === 'horizontal', `Slice ${a.id}: brim presets need horizontal references.`);
    requireThat(a.stack === null || Object.keys(a.stack).every(k=>['firstLayerMm','layerMm','direction','offsetTightness'].includes(k)) && Number.isFinite(a.stack.firstLayerMm) && a.stack.firstLayerMm>0 && Number.isFinite(a.stack.layerMm) && a.stack.layerMm>0&&(a.stack.offsetTightness===undefined||between(a.stack.offsetTightness,0,1))&&(!a.stack.direction||a.stack.direction==='normal'||Array.isArray(a.stack.direction)&&a.stack.direction.length===3&&a.stack.direction.every(Number.isFinite)&&Math.hypot(...a.stack.direction)>0),
      `Slice ${a.id} stack must be null or { firstLayerMm, layerMm, direction? }.`);
    requireThat(Array.isArray(a.within), `Slice ${a.id} within must be a list of volumes.`);
    for (const v of a.within) {
      const keys = Object.keys(v ?? {}).sort().join();
      requireThat(v?.kind === 'slab' && keys === 'fromMm,kind,toMm' && Number.isFinite(v.fromMm) && v.fromMm>=0 && (v.toMm === null || Number.isFinite(v.toMm) && v.toMm>v.fromMm)
        || v?.kind === 'geometry' && keys === 'geometry,kind' && v.geometry && typeof v.geometry === 'object'
        || v?.kind === 'normal-band'&&keys==='fromMm,kind,toMm'&&Number.isFinite(v.fromMm)&&Number.isFinite(v.toMm)&&v.toMm>v.fromMm
        || v?.kind === 'outline' && keys === 'kind'
        || v?.kind==='surface-domain'&&Object.keys(v).every(k=>['kind','loopsUv','fromLayer','toLayer','maxSlopeDeg','sampleStepMm'].includes(k))&&(loopsList(v.loopsUv)||v.loopsUv===null&&a.surface.kind==='roof')&&Number.isInteger(v.fromLayer)&&Number.isInteger(v.toLayer)&&v.fromLayer<v.toLayer&&['spline','patch','roof'].includes(a.surface.kind),
      `Slice ${a.id} has an invalid spatial volume.`);
    }
    requireThat(a.stack?.direction!=='normal'||a.within.length===1&&a.within[0].kind==='normal-band','A normal stack needs a finite normal-depth volume.');
    requireThat(!a.within.some(v=>v.kind==='outline')||a.within.length===1,`Slice ${a.id}: an outline volume stands alone.`);
    requireThat(!a.within.some(v=>v.kind==='surface-domain')||a.within.length===1,'A surface-domain prism is a complete owned volume.');
}

export function validateSliceSurface(surface, id) {
  if(surface?.kind==='terminal'){
    requireThat(Object.keys(surface).sort().join()==='assignment,kind,minFeatureMm'&&typeof surface.assignment==='string'&&surface.assignment!==id&&surface.assignment.length&&Number.isFinite(surface.minFeatureMm)&&surface.minFeatureMm>0,'A prepared-boundary reference needs another assignment and positive minFeatureMm.');return;
  }
  if(surface?.kind==='mesh-strip'||surface?.kind==='spline'&&typeof surface.patch==='string'){validateSurfaceSelection(surface);return;}
  if (surface?.kind === 'horizontal' && Object.keys(surface).join() === 'kind') return;
  if(surface?.kind==='patch'){requireThat(Object.keys(surface).sort().join()==='kind,offsetMm,patch'&&typeof surface.patch==='string'&&Number.isFinite(surface.offsetMm),'A native patch reference needs patch name and offsetMm.');return;}
  if(['roof','spline'].includes(surface?.kind)){
    const fields=surface.kind==='roof'?['kind','offsetMm']:['kind','offsetMm','patch'];
    requireThat(Object.keys(surface).sort().join()===fields.sort().join()&&Number.isFinite(surface.offsetMm),`Slice ${id}: height references need finite offsetMm and a spline needs its authored patch.`);
    if(surface.kind==='spline')validateSplineSolid({shape:'spline',patches:[surface.patch]});
    return;
  }
  requireThat(surface?.kind === 'plane' && Object.keys(surface).every(k => ['kind', 'origin', 'normal', 'xAxis'].includes(k)), `Slice ${id}: expected a horizontal, plane, roof or spline reference.`);
  const plane = planeSlice(surface);
  requireThat(Math.hypot(...plane.normal)>0, `Slice ${id}: plane needs a normal.`);
}
