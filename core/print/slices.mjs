import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {requireThat,normalize} from '../private/toolpath/numeric.mjs';
// General slicing: exclusive spatial claims -> chart regions/strokes -> world
// curves -> deposition. Default owners retain material outside explicit claims.
// Competing positive claims fail before deposition; no course alternation.
import {validateCurveAssignment} from './curves.mjs';
import {validateInjectionAssignment} from './injection.mjs';
import {resolveSurfaceDomain} from './surface-domains.mjs';
import {terminalBoundaryReference,boundaryOffsetField} from './terminal-boundary.mjs';
import {validateSurfaceSelection} from '../geom/surface-region.mjs';
import {assignmentPlan,assignmentFilament,validateAssignmentProcess,depositionAssignments} from './assignment-process.mjs';
import {depositedBeadSegments,depositedBeadsContain,depositedBeadBounds} from '../path/deposited-curves.mjs';
import {materialContact} from '../region/material-contact.mjs';
import { heightSlice, heightSliceNormal, referenceHeight, heightReferencePatch, heightReferenceBounds } from '../geom/height-slice.mjs';
import { validateSplineSolid } from '../geom/spline-solid.mjs';
import { geometrySelections } from '../geom/selections.mjs';
import {TOLERANCE} from '../geom/tolerance.mjs';
import {horizontalSlice,planeSlice,patchSlice,translateSlice,sliceFamily,sliceBoundaryEdges,sliceChartStep,patchMeanNormal} from '../geom/slice.mjs';
import {prepareSection,section} from '../region/section.mjs';
import {patchLayerStrokes} from '../region/patch-strokes.mjs';
import {surfaceGapCurves} from '../region/surface-curves.mjs';
import {spiralFamilyCurve} from '../path/family-curves.mjs';
import {contactCurveGaps} from '../path/contact-curves.mjs';
import {chartPrism} from '../geom/chart-prism.mjs';
import {SLICE_DEFAULTS,SLICE_PRESETS,ordinarySliceAssignment} from './slice-settings.mjs';
export {SLICE_DEFAULTS,SLICE_PRESETS} from './slice-settings.mjs';
import { solidMasks, volumeSection } from '../region/layer-region.mjs';
import { layerStrokes, mapSliceStrokes, sliceFrame, loopMaterial, fillMaterial } from '../region/layer-strokes.mjs';
import { FILL_PATTERNS } from '../region/fill-patterns.mjs';
import { offsetRegion } from '../region/offset.mjs';
import { regionArea } from '../region/region2d.mjs';
import { difference, intersect, union } from '../region/boolean.mjs';
import {allocateChartClaims,positiveClaimRegion,requireExclusiveClaims} from '../region/ownership.mjs';
import { clipReservedRegion, clipReservedSlice } from '../region/reservation.mjs';
import {depositCurveCourses} from '../path/curve-courses.mjs';
import {contactCurveCourses} from '../path/contact-curves.mjs';
import {surfaceCellField} from '../region/wrapping-curves.mjs';
import {CONNECT_MOVE_MM} from '../path/planning.mjs';
import { lineSpacing } from '../path/spacing.mjs';
import { planarPolicy, surfacePolicy } from '../path/builder.mjs';
import { publishFinishedBoundary } from '../path/finished-surface.mjs';

export const SLICE_VERSION = 1;
// The normal case: two loops, 20% fill, three solid layers top and bottom.
// fillDensity 1 is solid, 0 a shell of loops; loops 0 is fill only.
// Presets bundle settings that are not obvious. A brim is one layer of loops
// around the first-layer outline, outside the part. A support is sacrificial
// material under an assigned footprint: sparse straight rows inside one loop,
// its top layers an interface of rows at SUPPORT_INTERFACE_DENSITY.
export const SUPPORT_INTERFACE_DENSITY = 0.8;
export const SUPPORT_GAPS = Object.freeze({ topGapMm: 0.2, xyGapMm: 0.3 });
const FIELDS = ['id', 'part', 'preset', 'filament', 'process', ...Object.keys(SLICE_DEFAULTS), 'within', 'surface', 'stack','join','fillOrder','dependencies','description','contact','toolPose'];

export {ordinarySliceAssignment as sliceAssignment} from './slice-settings.mjs';
export const defaultSlices = () => ({ version: SLICE_VERSION, assignments: [ordinarySliceAssignment({ id: 'body' })] });

const between = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const loopsList = loops => Array.isArray(loops) && loops.length > 0 && loops.every(loop => Array.isArray(loop) && loop.length >= 3 && loop.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)));
function validateFamilyContact(a){
  requireThat(a.contact===null||a.contact&&Object.keys(a.contact).join()==='source'&&(a.contact.source===null||typeof a.contact.source==='string'&&a.contact.source!==a.id),'Slice contact needs a distinct source assignment or null.');
  const p=a.toolPose;
  requireThat(p===null||p&&Object.keys(p).join()==='alignToSliceNormal'&&typeof p.alignToSliceNormal==='boolean','Slice toolPose is null or {alignToSliceNormal:boolean}; poses are derived from the slice, not authored samples.');
  for(const v of a.within??[])if(v.kind==='surface-domain'){
    requireThat(v.maxSlopeDeg===undefined||Number.isFinite(v.maxSlopeDeg)&&v.maxSlopeDeg>0&&v.maxSlopeDeg<=90,'Surface domain slope must be greater than 0 and at most 90 degrees.');
    requireThat(v.sampleStepMm===undefined||Number.isFinite(v.sampleStepMm)&&v.sampleStepMm>0,'Surface survey step must be positive.');
  }
}
function validateReferenceSlice(a){
  requireThat(a.preset===null&&a.join===null&&a.solidTop===0&&a.solidBottom===0,'Reference families have explicit course spans; omit presets, caps and spiral joins.');
  requireThat(a.dependencies&&Object.keys(a.dependencies).sort().join()==='after,afterParts,beforeParts'&&Object.values(a.dependencies).every(Array.isArray),'Slice dependencies need after, afterParts and beforeParts arrays.');
  if(a.surface.kind==='terminal'){
    requireThat(Object.keys(a.surface).sort().join()==='assignment,kind,minFeatureMm'&&typeof a.surface.assignment==='string'&&a.surface.assignment!==a.id&&Number.isFinite(a.surface.minFeatureMm)&&a.surface.minFeatureMm>0,'Terminal surface names a separate finished-boundary assignment and positive minFeatureMm.');
    requireThat(Array.isArray(a.loops)&&a.loops.length&&a.loops.every(n=>Number.isSafeInteger(n)&&n>0)&&a.fillDensity===0&&a.fillOrder===null&&a.within.length===0,'Terminal boundary courses need explicit positive loop counts and no fill/volume selector.');
    return;
  }
  validateSurfaceSelection(a.surface);
  requireThat(a.surface.periodicU,'Periodic cell fill requires a periodic U reference.');
  requireThat(a.loops===0&&a.fillDensity===1,'Normal-band cell fill owns complete cells; use zero boundary loops and full density.');
  requireThat(Object.keys(a.stack).sort().join()==='direction,firstLayerMm,layerMm'&&[a.stack.firstLayerMm,a.stack.layerMm].every(v=>Number.isFinite(v)&&v>0),'Normal stack needs positive firstLayerMm and layerMm.');
  const volume=a.within[0],fill=a.fillOrder;
  requireThat(a.within.length===1&&volume?.kind==='normal-band'&&Object.keys(volume).sort().join()==='fromMm,kind,toMm'&&Number.isFinite(volume.fromMm)&&Number.isFinite(volume.toMm)&&volume.toMm>volume.fromMm,'Normal band needs an increasing finite depth interval.');
  requireThat(fill?.kind==='surface-cells'&&Object.keys(fill).sort().join()==='directions,kind,offsetTightness,toleranceMm'&&Array.isArray(fill.directions)&&fill.directions.length>0&&fill.directions.every(d=>['axial','circumferential','forward','reverse'].includes(d))&&Number.isFinite(fill.toleranceMm)&&fill.toleranceMm>0&&between(fill.offsetTightness,0,1),'Surface cell fill needs directions, positive toleranceMm and offsetTightness 0–1.');
}
// parts: the component ids a part may name (null for a single part).
export function validateSlices(slices, { parts, lineWidthMm, firstLayerMm, validateConstruction=()=>false }) {
  requireThat(slices && typeof slices === 'object' && Object.keys(slices).sort().join() === 'assignments,version', 'plan.slices needs version and assignments.');
  requireThat(slices.version === SLICE_VERSION, `Unsupported slice version ${slices.version}; this generator reads version ${SLICE_VERSION}.`);
  requireThat(Array.isArray(slices.assignments), 'Slice assignments must be a list.');
  const ids = new Set();
  for (const a of slices.assignments) {
    validateAssignmentProcess(a?.process);
    // IDs address the whole batch, including dependencies across constructions.
    requireThat(!ids.has(a.id),'Duplicate slice assignment id.');ids.add(a.id);
    if(a.construction==='inject'){validateInjectionAssignment(a,{parts});continue;}
    if(validateConstruction(a,{parts}))continue;
    if(a.construction){validateCurveAssignment(a,{parts});continue;}
    const unexpected = Object.keys(a ?? {}).filter(k => !FIELDS.includes(k)), missing = FIELDS.filter(k => !Object.hasOwn(a ?? {}, k));
    requireThat(!unexpected.length && !missing.length, `Slice assignment ${a?.id ?? ''} has ${[unexpected.length ? 'unexpected ' + unexpected.join(', ') : '', missing.length ? 'missing ' + missing.join(', ') : ''].filter(Boolean).join('; ')}.`);
    requireThat(typeof a.id === 'string' && /^[a-z][a-z0-9-]*$/.test(a.id), 'Invalid slice assignment id.');
    requireThat(a.part === null || parts?.includes(a.part), `Slice ${a.id} names an unknown part.`);
    requireThat(a.preset === null || Object.hasOwn(SLICE_PRESETS, a.preset), `Slice ${a.id} has an unknown preset.`);
    requireThat(a.filament === null || Number.isInteger(a.filament) && a.filament >= 0, `Slice ${a.id} filament must be null or a filament index.`);
    requireThat((Number.isSafeInteger(a.loops) && a.loops >= 0 || a.surface?.kind==='terminal'&&Array.isArray(a.loops)&&a.loops.length>0&&a.loops.every(n=>Number.isSafeInteger(n)&&n>0)), `Slice ${a.id} loops must be a whole number.`);
    requireThat(between(a.fillDensity, 0, 1), `Slice ${a.id} fillDensity must be between 0 and 1.`);
    requireThat(FILL_PATTERNS.includes(a.fillPattern), `Slice ${a.id} fillPattern must be one of ${FILL_PATTERNS.join(', ')}.`);
    requireThat(Array.isArray(a.fillAnglesDeg) && a.fillAnglesDeg.length > 0 && a.fillAnglesDeg.every(Number.isFinite), `Slice ${a.id} has invalid fill angles.`);
    requireThat(typeof a.rotateFill === 'boolean', `Slice ${a.id} rotateFill must be true or false.`);
    for (const key of ['solidTop', 'solidBottom']) requireThat(Number.isSafeInteger(a[key]) && a[key] >= 0, `Slice ${a.id} ${key} must be a nonnegative safe integer.`);
    requireThat(Number.isFinite(a.fillOverlap) && a.fillOverlap>=0 && Number.isFinite(a.sampleStepMm) && a.sampleStepMm>0, `Slice ${a.id} fillOverlap must be nonnegative and sampleStepMm positive.`);
    lineSpacing(lineWidthMm, a);
    validateFamilyContact(a);
    if(a.surface?.kind==='terminal'||a.stack?.direction==='normal'){validateReferenceSlice(a);continue;}
    validateSliceSurface(a.surface, a.id);
    requireThat(typeof a.description==='string'&&a.dependencies&&Object.keys(a.dependencies).sort().join()==='after,afterParts,beforeParts','Slice description/dependencies have invalid fields.');
    for(const key of ['afterParts','beforeParts'])requireThat(Array.isArray(a.dependencies[key])&&a.dependencies[key].every(part=>parts?.length?parts.includes(part):part===null),'Slice dependency part is not selected geometry.');
    requireThat(Array.isArray(a.dependencies.after)&&a.dependencies.after.every(id=>typeof id==='string'&&id.length),'Slice after dependencies name operation IDs.');
    if(a.fillOrder!==null){
      requireThat(a.fillOrder.kind==='fronts'&&Object.keys(a.fillOrder).sort().join()==='kind,lineSpacingMm,propagationStepMm,seedUv,toleranceMm'&&(a.fillOrder.seedUv===null||loopsList(a.fillOrder.seedUv)),`Slice ${a.id} front fill order needs seedUv or null.`);
      for(const field of ['lineSpacingMm','propagationStepMm','toleranceMm'])requireThat(Number.isFinite(a.fillOrder[field])&&a.fillOrder[field]>0,'Front fill order dimensions must be positive.');
    }
    requireThat(a.join===null||Object.keys(a.join).sort().join()==='levelEnd,mode'&&a.join.mode==='spiral'&&typeof a.join.levelEnd==='boolean'&&a.loops===1&&a.fillDensity===0&&a.solidTop===0&&a.solidBottom===0,`Slice ${a.id}: spiral join requires {mode:'spiral',levelEnd:boolean}, one loop and no fill/solid caps.`);
    requireThat(!a.preset || a.surface.kind === 'horizontal', `Slice ${a.id}: brim and support presets need horizontal references.`);
    requireThat(a.stack === null || Object.keys(a.stack).every(k=>['firstLayerMm','layerMm','direction'].includes(k)) && Number.isFinite(a.stack.firstLayerMm) && a.stack.firstLayerMm>0 && Number.isFinite(a.stack.layerMm) && a.stack.layerMm>0&&(!a.stack.direction||Array.isArray(a.stack.direction)&&a.stack.direction.length===3&&a.stack.direction.every(Number.isFinite)&&Math.hypot(...a.stack.direction)>0),
      `Slice ${a.id} stack must be null or { firstLayerMm, layerMm, direction? }.`);
    requireThat(Array.isArray(a.within), `Slice ${a.id} within must be a list of volumes.`);
    for (const v of a.within) {
      const keys = Object.keys(v ?? {}).sort().join();
      requireThat(v?.kind === 'slab' && keys === 'fromMm,kind,toMm' && Number.isFinite(v.fromMm) && v.fromMm>=0 && (v.toMm === null || Number.isFinite(v.toMm) && v.toMm>v.fromMm)
        || v?.kind === 'geometry' && keys === 'geometry,kind' && v.geometry && typeof v.geometry === 'object'
        || v?.kind === 'outline' && keys === 'kind'
        || v?.kind==='surface-domain'&&Object.keys(v).every(k=>['kind','loopsUv','fromLayer','toLayer','maxSlopeDeg','sampleStepMm'].includes(k))&&(loopsList(v.loopsUv)||v.loopsUv===null&&a.surface.kind==='roof')&&Number.isInteger(v.fromLayer)&&Number.isInteger(v.toLayer)&&v.fromLayer<v.toLayer&&['spline','patch','roof'].includes(a.surface.kind)
        || v?.kind === 'support' && keys === 'contactZMm,footprint,kind,topGapMm,xyGapMm' && loopsList(v.footprint) && Number.isFinite(v.topGapMm) && v.topGapMm>=0 && Number.isFinite(v.xyGapMm) && v.xyGapMm>=0
          && Number.isFinite(v.contactZMm) && v.contactZMm>=firstLayerMm+v.topGapMm,
      `Slice ${a.id} volumes are { kind: 'slab', fromMm, toMm } above the part bottom, { kind: 'geometry', geometry }, { kind: 'outline' } or { kind: 'support', footprint, contactZMm, topGapMm, xyGapMm } (contact above a first layer and the top gap).`);
    }
    for (const kind of ['outline', 'support']) requireThat(!a.within.some(v => v.kind === kind) || a.within.length === 1, `Slice ${a.id}: an ${kind} volume stands alone.`);
    requireThat(!a.within.some(v=>v.kind==='surface-domain')||a.within.length===1,'A surface-domain prism is a complete owned volume.');
    requireThat((a.preset === 'support') === a.within.some(v => v.kind === 'support'), `Slice ${a.id}: a support volume goes with the support preset, and the preset needs one.`);
    requireThat(a.preset !== 'support' || a.part === null, `Slice ${a.id}: a support footprint is placed with the whole print; leave part null.`);
  }
  return slices;
}

// Plane origins use selected geometry coordinates before placement; horizontal references retain the part's base.
export function validateSliceSurface(surface, id) {
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

const horizontal = slice => slice.kind === 'plane' && slice.normal[0] === 0 && slice.normal[1] === 0 && slice.normal[2] === 1
  && slice.xAxis[0] === 1 && slice.xAxis[1] === 0 && slice.yAxis[0] === 0 && slice.yAxis[1] === 1 && slice.origin[0] === 0 && slice.origin[1] === 0;
const sliceKey = slice => slice.kind==='patch'?JSON.stringify([slice.kind,slice.patch]):slice.kind==='height-field'?JSON.stringify([slice.kind,slice.reference,slice.offsetMm,slice.normalDepthMm,slice.sampleStepMm]):JSON.stringify([slice.kind, slice.origin, slice.normal, slice.xAxis]);

// Bounds projected into this plane chart, rather than unrelated world XY.
function chartExtent(owner, slice) {
  if(slice.kind==='patch')return {min:[slice.patch.domainU[0],slice.patch.domainV[0]],max:[slice.patch.domainU[1],slice.patch.domainV[1]]};
  if(slice.kind==='height-field')return {min:owner.shell.bounds.min.slice(0,2),max:owner.shell.bounds.max.slice(0,2)};
  const corners = Array.from({ length: 8 }, (_, i) => [0, 1, 2].map(k => ((i >> k) & 1 ? owner.shell.bounds.max[k] : owner.shell.bounds.min[k]) - slice.origin[k]));
  const points = corners.map(p => [slice.xAxis, slice.yAxis].map(axis => axis.reduce((n, v, k) => n + v * p[k], 0)));
  const box = regionBox([points]);
  return { min: box.min.map(v => v - 1), max: box.max.map(v => v + 1) };
}

// A support volume's footprint over the bed, moved with the print.
const placedFootprint = (volume, placement) => union(volume.footprint.map(loop => loop.map(([x, y]) => [x + placement.xMm, y + placement.yMm])), []);
const regionBox = loops => {
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (const loop of loops) for (const [a, b] of loop) { min[0] = Math.min(min[0], a); min[1] = Math.min(min[1], b); max[0] = Math.max(max[0], a); max[1] = Math.max(max[1], b); }
  return { min, max };
};

// Owners of every assignment, in definition order. shells: [[part, shell,
// whole]] (part null for a single part; whole marks the shells an assignment
// without a part cuts); processes: each assignment's process (its
// filament's, when it names one); volumes: built geometry volumes by
// assignment id and index; placement moves support footprints. Each owner:
// {id, kind (part, outline or support), assignment, part, shell, within,
// family, widthMm, startMm, endMm}; a part owner's family spans its whole
// part, so solid masks see where the part ends.
export function sliceOwners(assignments, { shells, processes, materials=[], volumes = new Map(), placement = { xMm: 0, yMm: 0 }, selections = new Map() }) {
  const owners = [];
  for (const [n, assignment] of assignments.entries()) {
    if(assignment.construction||assignment.surface?.kind==='terminal'||assignment.stack?.direction==='normal')continue;
    const stack = assignment.stack ?? processes[n], widthMm = processes[n].lineWidthMm;
    if (assignment.preset === 'support') {
      const volume = assignment.within[0], footprint = placedFootprint(volume, placement), box = regionBox(footprint);
      const top = volume.contactZMm - volume.topGapMm;
      const family = sliceFamily({ base: horizontalSlice(0), pitchMm: stack.layerMm, firstLayerMm: stack.firstLayerMm }, { min: [box.min[0], box.min[1], 0], max: [box.max[0], box.max[1], top] });
      owners.push({ id: assignment.id, kind: 'support', assignment, part: `support:${assignment.id}`, shell: { bounds: { min: [box.min[0], box.min[1], 0], max: [box.max[0], box.max[1], top] } },
        within: [], widthMm, footprint, gaps: { topGapMm: volume.topGapMm, xyGapMm: volume.xyGapMm }, contactZMm: volume.contactZMm, family, startMm: 0, endMm: top });
      continue;
    }
    const selected = shells.filter(([part, , whole]) => assignment.part === null ? whole : part === assignment.part);
    for (const [part, shell] of selected) {
      const material=materials.find(item=>item.id===assignment.id&&item.part===part);
      const process=material?.process??processes[n],stack=assignment.stack??process,widthMm=process.lineWidthMm;
      const settings=material?{...assignment,filament:material.filament}:assignment;
      const domain=assignment.within.find(v=>v.kind==='surface-domain');
      if(domain){
        const selectedPlacement=assignment.part===null?null:selections.get(assignment.part),shift=[placement.xMm+(selectedPlacement?.xMm??0),placement.yMm+(selectedPlacement?.yMm??0),selectedPlacement?.zMm??0];
        const roof=assignment.surface.kind==='roof';
        const patch=roof?null:assignment.surface.kind==='patch'?shell.patches?.find(p=>p.name===assignment.surface.patch):heightReferencePatch(assignment.surface.patch,shift);
        requireThat(roof||patch,`Slice ${assignment.id} names an absent native patch.`);
        let base=roof?heightSlice({kind:'roof',geometry:shell},{sampleStepMm:assignment.sampleStepMm}):patchSlice(patch),direction=stack.direction??(roof?[0,0,1]:patchMeanNormal(patch).normal);
        base=translateSlice(base,normalize(direction).map(v=>v*assignment.surface.offsetMm));
        const fitted=sliceFamily({base,direction,pitchMm:stack.layerMm,firstLayerMm:stack.firstLayerMm},shell.bounds);
        const prism=chartPrism(base,{loopsUv:domain.loopsUv,direction,fromMm:domain.fromLayer*fitted.translationStepMm,toMm:domain.toLayer*fitted.translationStepMm});
        const family=sliceFamily({base,direction,pitchMm:stack.layerMm,firstLayerMm:stack.firstLayerMm},prism.bounds),id=part===null?assignment.id:`${part}:${assignment.id}`;
        owners.push({id,sectionKey:id,kind:'part',assignment:settings,process,part,shell:prism,publicationShell:shell,within:[{kind:'geometry',geometry:prism}],family,widthMm,startMm:prism.bounds.min[2],endMm:prism.bounds.max[2]});
        continue;
      }
      const bottom = shell.bounds.min[2], top = shell.bounds.max[2];
      const outline = assignment.within.some(v => v.kind === 'outline');
      const within = outline ? [] : assignment.within.map((v, i) => v.kind === 'slab'
        ? { kind: 'slab', fromMm: bottom + v.fromMm, toMm: v.toMm === null ? top : bottom + v.toMm }
        : { kind: 'geometry', geometry: volumes.get(assignment.id)[i] });
      const slabs = within.filter(v => v.kind === 'slab');
      const from = Math.max(bottom, ...slabs.map(v => v.fromMm)), to = Math.min(top, ...slabs.map(v => v.toMm));
      requireThat(to > from, `Slice ${assignment.id} owns no height of its part.`);
      // An owner with its own stack starts its grid at its lowest slab.
      const selectedPlacement = assignment.part === null ? null : selections.get(assignment.part);
      const shift = [placement.xMm + (selectedPlacement?.xMm ?? 0), placement.yMm + (selectedPlacement?.yMm ?? 0), selectedPlacement?.zMm ?? 0];
      const reference=assignment.surface.kind==='roof'?{kind:'roof',geometry:shell}:null;
      let base = assignment.surface.kind==='patch'?patchSlice(shell.patches?.find(p=>p.name===assignment.surface.patch)):assignment.surface.kind==='spline'?patchSlice(heightReferencePatch(assignment.surface.patch,shift)):reference?heightSlice(reference,{offsetMm:assignment.surface.offsetMm,sampleStepMm:assignment.sampleStepMm}):assignment.surface.kind === 'plane' ? planeSlice({ ...assignment.surface, origin: assignment.surface.origin.map((v, k) => v + shift[k]) }) : horizontalSlice(assignment.stack && slabs.length ? from : bottom);
      const direction=stack.direction??(base.kind==='patch'?patchMeanNormal(base.patch,null,{sampleStepMm:assignment.sampleStepMm}).normal:null);
      if(base.kind==='patch'){
        base=translateSlice(base,normalize(direction).map(v=>v*assignment.surface.offsetMm));
      }
      const [startMm, endMm] = outline ? [bottom, bottom + stack.firstLayerMm] : [from, to];
      const family = sliceFamily({ base, direction, pitchMm: stack.layerMm, firstLayerMm: stack.firstLayerMm },
        { min: [shell.bounds.min[0], shell.bounds.min[1], assignment.surface.kind === 'horizontal' ? base.origin[2] : bottom], max: [shell.bounds.max[0], shell.bounds.max[1], outline ? endMm : top] });
      const owner = { id: part !== null ? `${part}:${assignment.id}` : assignment.id, kind: outline ? 'outline' : 'part', assignment:settings, process, part, shell, within, family, widthMm, startMm, endMm };
      owners.push(owner);
    }
  }
  for (const part of new Set(owners.map(o => o.part))) {
    const defaults = owners.filter(o => o.part === part && o.kind === 'part' && !o.within.length);
    if(defaults.length>1)requireExclusiveClaims(defaults[0],defaults[1]);
  }
  return owners;
}

// A volume's box: geometry bounds and slab heights, for skipping owner pairs
// that cannot meet.
function volumeBox(owner) {
  const box = { min: [...owner.shell.bounds.min], max: [...owner.shell.bounds.max] };
  for (const v of owner.within) {
    const [lo, hi] = v.kind === 'slab' ? [[-Infinity, -Infinity, v.fromMm], [Infinity, Infinity, v.toMm]] : [v.geometry.bounds.min, v.geometry.bounds.max];
    for (let i = 0; i < 3; i++) { box.min[i] = Math.max(box.min[i], lo[i]); box.max[i] = Math.min(box.max[i], hi[i]); }
  }
  box.min[2]=Math.max(box.min[2],owner.startMm);box.max[2]=Math.min(box.max[2],owner.endMm);
  if(owner.kind==='outline'){const pad=owner.assignment.loops*lineSpacing(owner.widthMm,owner.assignment);for(const k of [0,1]){box.min[k]-=pad;box.max[k]+=pad;}}
  return box;
}
const boxesMeet = (a, b) => [0, 1, 2].every(i => Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]) > TOLERANCE.point);

// Conservative control hulls can prove separation; intersecting hulls never
// prove material overlap. A centroid direction also proves touching fin boundaries
// without relying on scheduled print layers or introducing a solid solver.
function hullPoints(shell){
  if(shell.kind==='triangle-mesh')return shell.vertices;
  if(shell.kind==='boolean')return shell.operands.flatMap(hullPoints);
  if(shell.patches)return shell.patches.flatMap(p=>Array.from({length:p.cp.length/4},(_,i)=>[0,1,2].map(k=>p.cp[4*i+k]/p.cp[4*i+3])));
  return Array.from({length:8},(_,i)=>[0,1,2].map(k=>(i>>k)&1?shell.bounds.max[k]:shell.bounds.min[k]));
}
function hullsSeparate(a,b){
  const ap=hullPoints(a),bp=hullPoints(b),axes=[[1,0,0],[0,1,0],[0,0,1]];
  // One additional separating direction between control-hull centroids handles
  // tangent annulus/fin claims without quadratic face-normal × vertex work.
  const center=points=>points.reduce((sum,p)=>sum.map((v,k)=>v+p[k]/points.length),[0,0,0]);
  const ac=center(ap),bc=center(bp),delta=bc.map((v,k)=>v-ac[k]),length=Math.hypot(...delta);
  if(length)axes.push(delta.map(v=>v/length));
  const xy=Math.hypot(delta[0],delta[1]);if(xy)axes.push([delta[0]/xy,delta[1]/xy,0]);
  return axes.some(axis=>{
    const extent=points=>{let lo=Infinity,hi=-Infinity;for(const p of points){const v=p.reduce((sum,v,k)=>sum+v*axis[k],0);lo=Math.min(lo,v);hi=Math.max(hi,v);}return [lo,hi];};
    const [alo,ahi]=extent(ap),[blo,bhi]=extent(bp);
    return Math.min(ahi,bhi)-Math.max(alo,blo)<=TOLERANCE.point;
  });
}
// Check effective claims, including default remainders, on both families and
// between volume boundary heights. Unknown separation remains unsupported;
// sampled sections are evidence of overlap, not a general nonintersection proof.
export function resolveSliceOwnership(owners,{claim=null}={}) {
  const claimAt=claim??((owner,layer)=>{
    let region=section(owner.shell,layer.slice).loops;
    for(const volume of owner.within){const cut=volumeSection(volume,layer,chartExtent(owner,layer.slice));if(cut!==null)region=intersect(region,cut);}
    return region;
  });
  for(let i=0;i<owners.length;i++)for(let j=i+1;j<owners.length;j++){
    const a=owners[i],b=owners[j];
    if(a.id===b.id)continue;
    // An unbounded owner on a component means its explicit claims' remainder.
    if(a.part===b.part&&a.kind==='part'&&b.kind==='part'&&(!a.within.length||!b.within.length))continue;
    const ab=volumeBox(a),bb=volumeBox(b);
    if(!boxesMeet(ab,bb))continue;
    if(a.shell.kind==='chart-prism'&&b.shell.kind==='chart-prism'){
      const x=a.shell,y=b.shell,r=x.reference,t=y.reference,same=r.kind===t.kind&&(r.kind==='height-field'?r.reference.kind===t.reference.kind&&r.reference.geometry===t.reference.geometry:r.referencePatch===t.referencePatch);
      if(same&&x.direction.every((v,k)=>Math.abs(v-y.direction[k])<1e-12)){
        const offset=s=>s.kind==='height-field'?s.offsetMm:(s.translation??[0,0,0]).reduce((sum,v,k)=>sum+v*x.direction[k],0);
        if(Math.min(x.toMm+offset(r),y.toMm+offset(t))-Math.max(x.fromMm+offset(r),y.fromMm+offset(t))<=TOLERANCE.point)continue;
        if(!positiveClaimRegion(intersect(x.loopsUv,y.loopsUv),Math.min(...sliceChartStep(r,TOLERANCE.point))))continue;
        requireExclusiveClaims(a,b);
      }
    }
    const av=[a.shell,...a.within.filter(v=>v.kind==='geometry').map(v=>v.geometry)],bv=[b.shell,...b.within.filter(v=>v.kind==='geometry').map(v=>v.geometry)];
    if(av.some(x=>bv.some(y=>hullsSeparate(x,y))))continue;
    const low=Math.max(ab.min[2],bb.min[2]),high=Math.min(ab.max[2],bb.max[2]);
    const heights=[low,high,...av.flatMap(s=>[s.bounds.min[2],s.bounds.max[2]]),...bv.flatMap(s=>[s.bounds.min[2],s.bounds.max[2]])].filter(z=>z>=low&&z<=high).sort((a,b)=>a-b);
    const probes=heights.slice(1).flatMap((z,i)=>z-heights[i]>TOLERANCE.point?[{slice:horizontalSlice((z+heights[i])/2)}]:[]);
    for(const layer of [...probes,...a.family.layers,...b.family.layers]){
      if(layer.slice.kind!=='plane')continue; // UV distances are not millimetres.
      const overlap=intersect(claimAt(a,layer),claimAt(b,layer));
      const exact=s=>s.kind==='triangle-mesh'||s.kind==='boolean'&&s.operands.every(exact);
      const polygonal=[...av,...bv].every(exact);
      if(positiveClaimRegion(overlap,polygonal?TOLERANCE.point:2*TOLERANCE.chord))requireExclusiveClaims(a,b,{uncertain:av.concat(bv).some(s=>s.kind==='chart-prism')});
    }
    requireExclusiveClaims(a,b,{uncertain:true});
  }
  return {owners:owners.map(owner=>({...owner,ownershipGroup:null})),overlaps:[]};
}

export function ownedLayers(inputOwners, { shells = [], bands = [], reserves = [], onProgress }) {
  const owners = inputOwners;
  const cache = new Map();
  const cached = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
  const partSection = (owner, slice) => cached(`section|${owner.sectionKey??owner.part}|${sliceKey(slice)}`, () => {
    const prepared = cached(`prepared|${owner.sectionKey??owner.part}|${JSON.stringify(slice.normal)}`, () => prepareSection(owner.shell, slice));
    return section(prepared, slice).loops;
  });
  const material = (owner, slice) => cached(`material|${owner.sectionKey??owner.part}|${sliceKey(slice)}`, () => {
    if (owner.kind === 'support') return slice.origin[2] <= owner.endMm + 1e-8 ? owner.footprint : [];
    let region = partSection(owner, slice);
    for (const band of bands.filter(b => b.part === owner.part)) {
      const cut = volumeSection({ kind: 'slab', fromMm: band.startMm, toMm: band.endMm }, { slice }, chartExtent(owner, slice));
      region = cut === null ? [] : difference(region, cut);
    }
    for (const reserve of reserves) region = horizontal(slice)?clipReservedRegion(region, slice.origin[2], reserve):clipReservedSlice(region,slice,reserve,{sampleStepMm:owner.assignment.sampleStepMm});
    return region;
  });
  const volume = (owner, layer) => cached(`volume|${owner.id}|${sliceKey(layer.slice)}`, () => {
    const cuts = owner.within.map(v => volumeSection(v, layer, chartExtent(owner, layer.slice))).filter(c => c !== null);
    return cuts.length ? cuts.reduce((a, b) => a.length && b.length ? intersect(a, b) : []) : null;
  });
  const explicit = owners.filter(o => o.kind === 'part' && o.within.length), results = [];
  const claim=(owner,layer)=>{
    if(layer.slice.kind==='plane'&&(layer.slice.origin[2]<=owner.startMm+TOLERANCE.point||layer.slice.origin[2]>owner.endMm+TOLERANCE.point)&&horizontal(layer.slice))return [];
    let region=material(owner,layer.slice),cut=volume(owner,layer);
    if(owner.kind==='outline')return difference(offsetRegion(region,owner.assignment.loops*lineSpacing(owner.widthMm,owner.assignment)),region);
    if(cut!==null)region=intersect(region,cut);
    if(owner.kind==='part'&&!owner.within.length)for(const other of explicit.filter(o=>o.part===owner.part)){
      const claimed=volume(other,layer);region=claimed===null?[]:difference(region,claimed);
    }
    return region;
  };
  const ownership=resolveSliceOwnership(owners,{claim});
  let done = 0;
  const total = owners.reduce((n, o) => n + o.family.layers.length, 0);
  for (const principal of owners) {
    const family = principal.family, byOwner = new Map(), materialMasks = new Map();
    for (const layer of family.layers) {
      onProgress?.({ stage: 'Slicing layers', completed: done++, total });
      const own = material(principal, layer.slice);
      materialMasks.set(layer.index, own);
      if (!own.length) continue;
      const z = layer.slice.origin?.[2]??layer.slice.offsetMm;
      if (horizontal(layer.slice) && (z <= principal.startMm + 1e-9 || z > principal.endMm + 1e-9)) continue;
      const candidates = explicit.filter(o => o.part === principal.part);
      let allocated;
      if (principal.kind === 'outline') {
        const boundary = partSection(principal, layer.slice);
        allocated = [{ owner: principal, region: difference(offsetRegion(boundary, principal.assignment.loops * lineSpacing(principal.widthMm, principal.assignment)), boundary), boundary }];
      } else if (principal.kind === 'support') {
        for (const [part, shell, whole] of shells) {
          if (!whole || z < shell.bounds.min[2] - 1e-8 || z > shell.bounds.max[2] + 1e-8) continue;
          const obstacle = offsetRegion(partSection({ part, shell }, layer.slice), principal.gaps.xyGapMm);
          requireThat(regionArea(intersect(own, obstacle)) < 1e-8, `Support ${principal.id} meets its part clearance at Z ${z.toFixed(3)} mm; revise its footprint.`);
        }
        allocated = [{ owner: principal, region: own, boundary: own }];
      } else {
        const claims=allocateChartClaims(own,candidates.map(owner=>({owner,region:volume(owner,layer)})),
          {principal,retainUnclaimed:!principal.within.length,toleranceMm:layer.slice.kind==='patch'?Math.min(...sliceChartStep(layer.slice,TOLERANCE.point)):TOLERANCE.point});
        allocated=claims.allocated.map(cell=>({...cell,boundary:own}));
      }
      for (const owner of new Set(allocated.map(a => a.owner))) {
        const cells = allocated.filter(a => a.owner === owner), region = cells.length === 1 ? cells[0].region : union(cells.flatMap(a => a.region), []);
        const edges=sliceBoundaryEdges(layer.slice,region);
        const authoredBoundary=owner.shell.kind==='chart-prism'&&layer.slice.referencePatch===owner.shell.reference.referencePatch;
        requireThat(authoredBoundary||!edges.length,`Slice ${owner.assignment.id} layer ${layer.index} stops inside owned material at patch edge ${edges.join(', ')}; extend the reference to fully cross.`);
        const layers = byOwner.get(owner) ?? [];
        layers.push({ ...layer, region, material: cells[0].boundary,
          outward: owner.kind === 'outline', shared: cells.some(a => a.shared) });
        byOwner.set(owner, layers);
      }
    }
    for (const [owner, layers] of byOwner) results.push({ owner, leader: owner === principal ? null : principal.id,
      family, familyId: principal.id, layers, material: materialMasks, ownership });
  }
  return results;
}

// Where a tilted layer first meets the horizontal part base, its bead gap
// tapers to that base. Split at the full-gap crossing so the trapezoidal segment
// integration is exact for a planar reference. Later parallel planes are uniform.
function planeContactGaps(curves, { slice, heightMm }, bottom) {
  if(slice.kind==='patch')return curves;
  if(slice.kind==='height-field')return curves.map(curve=>{
    const gaps=curve.points.map(point=>Math.max(0,Math.min(heightMm,point[2]-bottom))*heightSliceNormal(slice,point)[2]);
    return {...curve,heightsMm:gaps.slice(1).map((gap,i)=>(gap+gaps[i])/2)};
  });
  if (horizontal(slice)) return curves;
  const cosine = slice.normal[2], ceiling = bottom + heightMm / cosine;
  return curves.map(curve => {
    if (curve.points.every(p => p[2] >= ceiling - 1e-9)) return curve;
    const source = curve.closed ? [...curve.points, curve.points[0]] : curve.points, points = [source[0]], heightsMm = [];
    const gap = point => Math.max(0, Math.min(heightMm, (point[2] - bottom) * cosine));
    for (let i = 1; i < source.length; i++) {
      const a = source[i - 1], b = source[i], cuts = [];
      if ((a[2] < ceiling && b[2] > ceiling) || (a[2] > ceiling && b[2] < ceiling)) {
        const t = (ceiling - a[2]) / (b[2] - a[2]);
        cuts.push(a.map((v, k) => v + t * (b[k] - v)));
      }
      cuts.push(b);
      for (const point of cuts) { heightsMm.push((gap(points.at(-1)) + gap(point)) / 2); points.push(point); }
    }
    const chartPoints=points.map(point=>[slice.xAxis,slice.yAxis].map(axis=>axis.reduce((sum,v,k)=>sum+v*(point[k]-slice.origin[k]),0)));
    return { ...curve, closed: false, points, heightsMm,chartPoints,normals:points.map(()=>slice.normal),frameSamples:chartPoints.map(point=>sliceFrame(slice,point)) };
  });
}

// Rank the complete supporting plane over fixed part bounds. Ranking the
// clipped region's maximum can go backwards when the upper contour shrinks.
function sliceRank(slice, bounds) {
  if(slice.kind==='patch')return heightReferenceBounds({kind:'spline',patch:slice.patch}).max[2];
  if(slice.kind==='height-field')return heightReferenceBounds(slice.reference).max[2]+slice.offsetMm;
  if (horizontal(slice)) return slice.origin[2];
  const heights = [bounds.min[0], bounds.max[0]].flatMap(x => [bounds.min[1], bounds.max[1]].map(y =>
    slice.origin[2] - ((x - slice.origin[0]) * slice.normal[0] + (y - slice.origin[1]) * slice.normal[1]) / slice.normal[2]));
  return Math.max(...heights);
}

function sliceTravelPolicy(slice, region, worldRegion, maxZ, process) {
  const options = { liftMm: process.liftMm, maxCombMm: process.maxCombMm, lineWidthMm: process.lineWidthMm };
  if (horizontal(slice)) return planarPolicy(region, { ...options, layerZ: slice.origin[2] });
  if(slice.kind==='patch'||Math.abs(slice.normal?.[2]??1)<1e-8)return {maxCombMm:0,canTravelDirect:()=>false,clearanceFor:()=>maxZ+process.liftMm};
  const surfaceZ = slice.kind==='height-field'?(x,y)=>referenceHeight(slice.reference,x,y)?evaluateSurface(slice,[x,y]).point[2]:null:(x, y) => slice.origin[2] - ((x - slice.origin[0]) * slice.normal[0] + (y - slice.origin[1]) * slice.normal[1]) / slice.normal[2];
  return surfacePolicy(worldRegion, { ...options, surfaceZ, maxZ });
}

// One owner's operations from its owned layers. spec: {id, settings, layers,
// material?: Map(index -> sliced material) for solid masks (the layers' own
// regions when absent), solidRegions?: Map(index -> loops) always filled
// solid, filament}; context: {process, shell, startMm, endMm, report}.
// A support preset's operations are sacrificial: support roles, the supports
// phase and no finished boundary.
// One evaluated region-course boundary for cut regions and reference families.
// Geometry strokes retain their chart/metric; gap adaptation precedes the same
// joining and bead construction for every Slice producer.
export function evaluateRegionCourse({id,course,process,filament=null,contact=null,contactPlacement=null,contactGaps=null,baseZMm=null,sampleStepMm=.2}){
  const {reference,strokes,...construction}=course;
  let curves=mapSliceStrokes(strokes,reference,{frames:!contactPlacement,sampleStepMm}),measured=null;
  if(contactPlacement)curves=contactCurveCourses(curves,contactPlacement);
  if(contactGaps)curves=contactCurveGaps(curves,{...contactGaps,contactRole:null});
  if(contact){
    curves=curves.map(curve=>!curve.closed?curve:{...curve,closed:false,
      ...Object.fromEntries(['points','chartPoints','normals','frameSamples'].map(key=>[key,[...curve[key],curve[key][0]]]))});
    measured=materialContact(curves,contact);
    curves=surfaceGapCurves(curves,{slice:reference,direction:measured.direction,distancesMm:measured.distancesMm,allowZero:true}).curves;
  }else if(baseZMm!==null)curves=planeContactGaps(curves,{slice:reference,heightMm:course.heightMm},baseZMm);
  const [operation]=depositCurveCourses({id,courses:[{...construction,curves,after:[...(construction.after??[]),...(measured?.after??[])]}],process,filament,sequential:false});
  return {operation,contactReport:measured?.report};
}

export function joinSliceFamily({id,family,process,filament=null,firstHeightMm,levelEnd=true,sampleStepMm=.4,toleranceMm=.02,
  speedMmS=process.planarSpeedMmS,minimumTurnSeconds=0,course={key:'spiral',layerId:id+':spiral',phase:'spiral',layer:0},role='spiral',foundationSegments=[],maxBeadHeightMm=Infinity}){
  const curve=spiralFamilyCurve({family,firstHeightMm,widthMm:process.lineWidthMm,speedMmS,levelEnd,sampleStepMm,toleranceMm,minimumTurnSeconds,role});
  const {profile,...centerline}=curve;
  const curves=foundationSegments.length?contactCurveGaps([centerline],{segments:foundationSegments,maxHeightMm:maxBeadHeightMm}):[centerline];
  const top=Math.max(...curve.points.map(point=>point[2]));
  const operations=depositCurveCourses({id,courses:[{...course,rank:course.rank??top,curves,travel:course.travel??{kind:'clearance',direct:false,clearanceZ:top+process.liftMm}}],process,filament});
  return {curve,operations:operations.map(operation=>({...operation,layerIndex:0,layerCount:family.layers.length,stackDirection:family.direction??[0,0,1]}))};
}

export function sliceResult({ id, settings, layers, material = null, solidRegions = new Map(), filament = null,totalLayerCount=layers.length,contactSegments=[],otherFamilyContactSegments=[],seedSegments=[],contactFragments=[],predecessorReference=null,predecessorRegions=new Map(),substrateAdaptation=false,requiredContact=false }, { process, shell, startMm, endMm,maxBeadHeightMm=Infinity,report: extra = {} }) {
  const width = process.lineWidthMm, pitch = lineSpacing(width, settings), wallToleranceMm = process.planarWallToleranceMm;
  const support = settings.preset === 'support', solidDensity = support ? SUPPORT_INTERFACE_DENSITY : 1;
  const masked = settings.fillDensity < 1 && (settings.solidTop > 0 || settings.solidBottom > 0 || solidRegions.size > 0);
  const maskLayers = material ? [...material].map(([index, region]) => ({ index, region })) : layers;
  const angles = settings.fillAnglesDeg, angleAt = index => settings.rotateFill ? angles[index % angles.length] : angles[0];
  const roles = support ? { perimeter: 'support-wall', 'perimeter-inner': 'support-wall', infill: 'support', fill: 'support-interface' } : null;
  let operations = [];const familyLayers=[], report = { depositionFamily:'slice',layers: 0, skippedLayers: 0, areaMm2: 0, loops: 0, fillRows: 0, solidAreaMm2: 0, ...extra };
  let previous = [];
  for (const layer of layers) {
    const { index, slice, region } = layer, z = slice.origin?.[2]??slice.offsetMm;
    const area=loops=>!loops.length?0:slice.kind==='patch'?patchMeanNormal(slice.patch,loops,{sampleStepMm:settings.sampleStepMm}).areaMm2:regionArea(loops);
    if (!region.length) { report.skippedLayers++; continue; }
    const own = layer.material ?? region, outward = layer.outward ?? false;
    const solid = masked ? union(solidMasks(maskLayers, index, { bottomLayers: settings.solidBottom, topLayers: settings.solidTop }).solid,
      intersect(region, union(solidRegions.get(index) ?? [], []))) : null;
    const strokeSettings={ ...settings, widthMm: width, fillAngleDeg: angleAt(index), solidDensity,direction:layer.direction,layer,supportSegments:seedSegments,
      patternAngleDeg: settings.fillPattern === 'rectilinear' ? angleAt(index) : angles[0], phaseMm: z, wallToleranceMm, solid,
      material: own, outward };
    const strokes = slice.kind==='patch'?patchLayerStrokes(slice,region,strokeSettings):layerStrokes(region,strokeSettings);
    if(strokes.constructionReport)report.fillOrder=strokes.constructionReport;
    const boundaries=mapSliceStrokes(strokes.walls,slice,{frames:true,sampleStepMm:settings.sampleStepMm}).map(curve=>{
      const duplicate=curve.points.length>2&&Math.hypot(...curve.points[0].map((v,k)=>v-curve.points.at(-1)[k]))<1e-8;
      return !duplicate?curve:{...curve,closed:true,points:curve.points.slice(0,-1),chartPoints:curve.chartPoints.slice(0,-1),normals:curve.normals.slice(0,-1),frameSamples:curve.frameSamples.slice(0,-1)};
    });
    familyLayers.push({...layer,curves:boundaries});
    const wallMaterial = () => loopMaterial(region, { widthMm: width, loops: settings.loops, spacingFactor: settings.spacingFactor }, { outward });
    report.solidAreaMm2 += area(strokes.solidRegion);
    report.loops += strokes.walls.length; report.fillRows += strokes.infill.length + strokes.fill.length;
    const ordinal=(extra.layerStartOrdinal??0)+report.layers;
    const speedMmS = (horizontal(slice) ? index === 0 : ordinal === 0) ? process.firstLayerSpeedMmS : process.planarSpeedMmS;
    const worldRegion = region.map(loop => loop.map(point => evaluateSurface(slice,point).point.slice(0, 2)));
    const maxZ = Math.max(...region.flatMap(loop => loop.map(point => evaluateSurface(slice,point).point[2])));
    const travelPolicy = sliceTravelPolicy(slice, region, worldRegion, maxZ, process);
    const current = [];
    for (const [group, found] of [['walls', strokes.walls], ['infill', strokes.infill], ['fill', strokes.fill]]) {
      if (!found.length) continue;
      const spacing = group === 'infill' ? pitch / settings.fillDensity : pitch / solidDensity;
      const opId = `${id}:${index}:${group}`;
      let covered;
      const framed=slice.kind==='patch'||slice.kind==='height-field'||predecessorReference!==null||contactFragments.length>0||contactSegments.length>0||otherFamilyContactSegments.length>0;
      const evaluated=evaluateRegionCourse({id,course:{key:`${index}:${group}`,reference:slice,strokes:found,heightMm:layer.heightMm,speedMmS},
        process,filament,sampleStepMm:settings.sampleStepMm,baseZMm:framed?null:shell.bounds.min[2],contact:framed?
          {id,layer,bounds:shell.bounds,support:{previousRegion:predecessorRegions.get(index)??[],previousSegments:contactSegments,surroundingSegments:otherFamilyContactSegments},
            contactFragments,predecessorReference,maxNormalGapMm:maxBeadHeightMm,substrateAdaptation,required:requiredContact}:null});
      const deposited=evaluated.operation,lifted=deposited.strokes;
      const contactAfter=deposited.after;
      const measured=evaluated.contactReport;
      if(measured){
        report.substrateContactQueries=(report.substrateContactQueries??0)+measured.queries;
        report.uncoveredContactSamples=(report.uncoveredContactSamples??0)+measured.uncoveredSamples;
        if(measured.samples){report.contactSamples=(report.contactSamples??0)+measured.samples;report.minContactGapMm=Math.min(report.minContactGapMm??Infinity,measured.minGapMm);report.maxContactGapMm=Math.max(report.maxContactGapMm??0,measured.maxGapMm);}
      }
      operations.push({ ...deposited,id: opId, layerId: horizontal(slice) ? 'planar:' + z : 'slice:' + sliceKey(slice), phase: support ? 'supports' : 'planar', layer: index, rank: sliceRank(slice, shell.bounds), after: [...new Set([...previous,...current,...contactAfter])],
        strokes: roles ? lifted.map(stroke => ({ ...stroke, role: roles[stroke.role] })) : lifted, connectNearby: !framed,layerIndex:ordinal,layerCount:totalLayerCount,stackDirection:layer.direction??slice.normal??[0,0,1],
        // Loops a boundary between owners cuts open are laid in the order found.
        order: group === 'walls' ? (lifted.every(s => s.closed && !s.volumesMm3) ? 'nearest' : 'given') : lifted.every(s => s.scanlineCell !== undefined) ? 'nearest-cells' : 'given', region: worldRegion, slice, ownershipIndex: index,
        // Coverage is consumed by material-region publication; built on first use.
        get materialRegion() {
          return covered ??= (slice.kind==='patch'?region:group === 'walls' ? wallMaterial()
            : fillMaterial(group === 'infill' ? strokes.sparseRegion : strokes.solidRegion, width)).map(loop => loop.map(point => evaluateSurface(slice,point).point.slice(0, 2)));
        },
        materialCoverage: group !== 'walls' && spacing > width + 1e-8 ? 'sparse' : 'area',
        travelPolicy, ...((Object.hasOwn(settings.process??{},'fanPercent')||(horizontal(slice) ? index === 1 : ordinal === 1)) ? { fanPercent: process.fanPercent } : {}), ...(filament === null ? {} : { filament }) });
      current.push(opId);
    }
    previous = current;
    report.layers++; report.areaMm2 += area(region);
  }
  if(settings.join){
    requireThat(!layers.some(layer=>layer.shared),'A spiral join cannot cross alternating shared-owner layers.');
    const family={layers:familyLayers,direction:layers[0].direction??layers[0].slice.normal??[0,0,1]};
    operations=joinSliceFamily({id,family,process,filament,firstHeightMm:layers[0].heightMm,levelEnd:settings.join.levelEnd,sampleStepMm:settings.sampleStepMm}).operations;
    report.join='spiral';
  }
  if (support) return { id, operations, report,familyLayers };
  const coverage = settings.fillDensity >= 1 && pitch <= width + 1e-8 ? 'nominal' : 'sparse';
  const segments=depositedBeadSegments(operations,{widthMm:width});
  return publishFinishedBoundary({ id, operations, report,familyLayers }, { shell, startMm, endMm, coverage,contains:({point})=>depositedBeadsContain(segments,point) });
}

// Every slice assignment of a plan: owners, owned layers, results. Support
// owners' results come back apart: they print before the part operations
// they hold up (supportDependencies).
// -> {results, supports, summary: {layers, instances}}
// envelopes: [{part, solidRegionAt(z)}] regions a process (a plastic-weld
// rivet) needs solid in the slices of its part.
// Matching references give an exact normal-depth interval comparison. Other
// reference pairs have no certified common material chart in this release.
export function normalBandCourses(assignments){
  for(let i=0;i<assignments.length;i++)for(let j=i+1;j<assignments.length;j++){
    const a=assignments[i].assignment,b=assignments[j].assignment;
    if(a.part!==b.part){
      const bounds=(context)=>{const band=context.assignment.within[0],pad=Math.max(Math.abs(band.fromMm),Math.abs(band.toMm)),box=context.shell.bounds;return {min:box.min.map(v=>v-pad),max:box.max.map(v=>v+pad)};};
      if(!boxesMeet(bounds(assignments[i]),bounds(assignments[j])))continue;
      requireExclusiveClaims(a,b,{uncertain:true});
    }
    const same=JSON.stringify([a.contact?.source,a.surface,a.fillOrder.offsetTightness])===JSON.stringify([b.contact?.source,b.surface,b.fillOrder.offsetTightness]);
    if(!same)requireExclusiveClaims(a,b,{uncertain:true});
    const x=a.within[0],y=b.within[0];
    if(Math.min(x.toMm,y.toMm)-Math.max(x.fromMm,y.fromMm)>TOLERANCE.point)requireExclusiveClaims(a,b);
  }
  return new Map();
}

export function prepareSliceContexts({ plan, shells, volumes, bands, reserves, envelopes = [],surfaceAssignments=[],referenceAssignments=[],terminalAssignments=[], onProgress }) {
  const lowered=new Map(surfaceAssignments.map(input=>[input.assignment.id,{assignment:resolveSurfaceDomain(input),contact:input.assignment.contact,survey:input.survey}]));
  const assignments = depositionAssignments(plan,{expandParts:false}).flatMap(a=>lowered.has(a.id)?[{...lowered.get(a.id).assignment,filament:a.filament}]:!a.construction&&a.surface?.kind!=='terminal'&&a.stack?.direction!=='normal'?[a]:[]);

  if(!assignments.length&&!referenceAssignments.length&&!terminalAssignments.length)return {contexts:[]};
  const processes = assignments.map(a => assignmentPlan(plan,a).process);
  const materials=assignments.flatMap(a=>shells.filter(([part,,whole])=>a.part===null?whole:part===a.part).map(([part])=>{
    const selected={...a,part,filament:assignmentFilament(plan,{...a,part})};
    return {id:a.id,part,filament:selected.filament,process:assignmentPlan(plan,selected).process};
  }));
  const owners = sliceOwners(assignments, { shells, processes, materials, volumes, placement: plan.placement, selections: plan.geometry?geometrySelections(plan.geometry):new Map() });
  // Outward normal families meet their source solid at its surface. Inward
  // bands and other components have no certified common claim chart here.
  for(const context of referenceAssignments){
    const a=context.assignment,band=a.within[0],pad=Math.max(Math.abs(band.fromMm),Math.abs(band.toMm)),box=context.shell.bounds;
    const normalBounds={min:box.min.map(v=>v-pad),max:box.max.map(v=>v+pad)};
    for(const owner of owners){
      if(owner.part===a.part&&owner.kind==='part'&&owner.shell.kind!=='chart-prism'&&band.fromMm*a.surface.normalSide>=-TOLERANCE.point&&band.toMm*a.surface.normalSide>=-TOLERANCE.point)continue;
      if(boxesMeet(normalBounds,volumeBox(owner)))requireExclusiveClaims(a,owner,{uncertain:true});
    }
  }
  const owned = ownedLayers(owners, { shells, bands, reserves, onProgress });
  const contexts=[];
  for (const { owner, leader, family, familyId, layers, material } of owned) {
    const { assignment } = owner;
    const process = owner.process??processes[assignments.indexOf(assignment)];
    const held = envelopes.filter(e => e.part === owner.part);
    const solidRegions = new Map(held.length ? layers.map(l => [l.index, held.flatMap(e => horizontal(l.slice)?e.solidRegionAt(l.slice.origin[2]):
      difference(l.region,clipReservedSlice(l.region,l.slice,{footprint:[[owner.shell.bounds.min.slice(0,2),[owner.shell.bounds.max[0],owner.shell.bounds.min[1]],owner.shell.bounds.max.slice(0,2),[owner.shell.bounds.min[0],owner.shell.bounds.max[1]]]],regionAt:e.solidRegionAt},{sampleStepMm:assignment.sampleStepMm})))]) : []);
    const report = { owner: assignment.id, part: owner.kind === 'support' ? null : owner.part, leader, layerMm: family.pitchMm,
      ...(lowered.has(assignment.id)?{referenceFamily:'roof',excludedFraction:lowered.get(assignment.id).survey.steepFraction,maxSlopeDeg:lowered.get(assignment.id).survey.maxSlopeDeg,limitDeg:lowered.get(assignment.id).survey.limitDeg}:{}),
      targetGapMm:family.pitchMm,translationStepMm:family.translationStepMm,firstTranslationMm:family.firstTranslationMm,meanProjectedGapMm:family.pitchMm,minProjectedGapMm:family.minProjectedGapMm,maxProjectedGapMm:family.maxProjectedGapMm,stackMetric:'area-mean-normal-projection',
      ...(family.base.kind==='height-field'?{beadHeightMetric:'local-normal-projection',chartMetric:'world-xy',topologySampleStepMm:family.base.sampleStepMm}:{}),
      ...(owner.kind === 'support' ? { contactZMm: owner.contactZMm, actualTopGapMm: owner.contactZMm - Math.max(...layers.filter(l => l.region.length).map(l => l.slice.origin[2])) } : {}) };
    const resultId = familyId === owner.id ? owner.id : `${owner.id}:shared:${familyId}`;
    const maxBeadHeightMm=Infinity;
    contexts.push({contact:assignment.contact?{...assignment.contact,predecessorReference:translateSlice(layers[0].slice,layers[0].direction.map(v=>-v*layers[0].translationMm))}:null,spec:{id:resultId,settings:assignment,layers,material,solidRegions,filament:assignment.filament,totalLayerCount:layers.length,predecessorRegions:new Map(layers.map(layer=>[layer.index,layers.find(previous=>previous.index===layer.index-1)?.region??[]]))},context:{process,shell:owner.publicationShell??owner.shell,startMm:owner.startMm,endMm:owner.endMm,maxBeadHeightMm,report},family,owner,familyId,
      layerOrder:layers.map(layer=>({index:layer.index,rank:sliceRank(layer.slice,owner.shell.bounds)}))});
  }
  const normalOwnership=normalBandCourses(referenceAssignments);
  for(const {assignment,shell,process} of referenceAssignments){
    const id=assignment.id;
    const ownership=normalOwnership.get(id);
    contexts.push({spec:{id,settings:assignment,layers:[],filament:assignment.filament},
      reference:{selection:assignment.surface,source:assignment.contact?.source??null},
      regionField:{kind:'periodic-cells',settings:{...assignment,normalMm:assignment.stack.layerMm,firstLayerMm:assignment.stack.firstLayerMm,shells:Math.ceil((assignment.within[0].toMm-assignment.within[0].fromMm)/assignment.stack.layerMm),fromMm:assignment.within[0].fromMm,toMm:assignment.within[0].toMm,directions:assignment.fillOrder.directions,toleranceMm:assignment.fillOrder.toleranceMm,offsetTightness:assignment.fillOrder.offsetTightness},...(ownership?{courses:ownership.courses}:{})},
      context:{shell,process,maxBeadHeightMm:Infinity,
        report:{owner:id,part:assignment.part,referenceFamily:'normal',...(ownership?{normalOwnership:{principal:ownership.principal,courseCount:ownership.courses.length,courses:ownership.courses}}:{})}},
      owner:{id,assignment,part:assignment.part,...(ownership?{ownershipGroup:'normal:'+ownership.principal}:{})},familyId:ownership?.principal??id,
      family:{constructTogether:!ownership,region:{kind:'normal-band',selection:assignment.surface,fromMm:assignment.within[0].fromMm,toMm:assignment.within[0].toMm},layers:[]},
      layerOrder:ownership?ownership.courses.map(course=>({index:course.index,ownershipRank:course.index,rank:shell.bounds.max[2]})):[{index:null,rank:shell.bounds.max[2]}]});
  }
  for(const {assignment,shell,process} of terminalAssignments){
    const id=assignment.id;
    contexts.push({spec:{id,settings:assignment,layers:[],filament:assignment.filament},reference:{kind:'terminal',source:assignment.surface.assignment},
      regionField:{kind:'boundary-offsets',settings:assignment},context:{shell,process,report:{owner:id,part:assignment.part,referenceFamily:'terminal',steps:assignment.loops}},
      owner:{id,assignment,part:assignment.part},familyId:id,family:{layers:[]},
      layerOrder:assignment.loops.map((count,index)=>({index,rank:(shell?.bounds.max[2]??0)+(index+1)*process.layerMm}))});
  }
  return {contexts};
}

export function sliceContextResult(record,{layerIndex=null,contactSegments=[],otherFamilyContactSegments=[],seedSegments=[],contactFragments=[],predecessorReference=null,substrateAdaptation=false,requiredContact=false,reference=null,motion=null,sourceResult=null,sourceAssignment=null,predecessorResults=[],foundationSegments=[],fieldState=null,layoutReference=reference}={}){
  if(record.regionField?.kind==='boundary-offsets'){
    const {shell,process}=record.context,assignment=record.spec.settings,index=layerIndex;
    requireThat(Number.isInteger(index)&&index>=0&&index<assignment.loops.length,'A terminal region needs a valid course index.');
    const terminal=terminalBoundaryReference({shell,assignment,process,sourceResult,sourceAssignment,substrateAdaptation});
    const field=boundaryOffsetField(terminal,{count:assignment.loops[index],index,widthMm:process.lineWidthMm,minFeatureMm:assignment.surface.minFeatureMm});
    // The terminal curve names the reference; support comes from all actual source beads.
    // A tapered level ending can expose its preceding rising course near the seam.
    const segments=substrateAdaptation?[...depositedBeadSegments(sourceResult.operations,{widthMm:terminal.sourceWidth}),
      ...depositedBeadSegments(predecessorResults.flatMap(result=>result.operations),{widthMm:process.lineWidthMm})]:[];
    const nominalZ=terminal.zStartMm+(index+1)*process.layerMm,slice=horizontalSlice(nominalZ);
    const evaluated=evaluateRegionCourse({id:record.spec.id,process,filament:record.spec.filament,course:{key:index,layer:index,rank:nominalZ,reference:slice,
      strokes:field.strokes,heightMm:process.layerMm,order:'nearest'},contactPlacement:substrateAdaptation?{
        segments,gapMm:process.layerMm,ceilingMm:depositedBeadBounds(segments).max[2],sampleStepMm:Math.min(process.lineWidthMm/2,.2),
        toleranceMm:Math.min(.01,process.lineWidthMm/20),footprintRadiusMm:process.lineWidthMm/2}:null});
    const strokes=evaluated.operation.strokes,top=strokes.reduce((z,stroke)=>stroke.points.reduce((z,p)=>Math.max(z,p[2]),z),-Infinity);
    const planar=strokes.every(stroke=>stroke.points.every(point=>Math.abs(point[2]-top)<1e-8));
    const operation={...evaluated.operation,layerId:'lip:'+top,phase:planar?'planar':'curves',rank:top,connectNearby:planar,
      travelPolicy:planar?planarPolicy(field.region,{layerZ:top,liftMm:process.liftMm,maxCombMm:process.maxCombMm,lineWidthMm:process.lineWidthMm}):
        {maxCombMm:0,clearanceFor:()=>top+process.liftMm}};
    return {id:record.spec.id,operations:[operation],family:{...record.family,layers:[{index,slice,region:field.region}]},familyId:record.familyId,
      report:{...record.context.report,depositionFamily:'slice',layers:1,startMm:terminal.zStartMm,topMm:top,reconstructedContact:terminal.modified,substrateAdaptation,
        scope:substrateAdaptation?'Offset boundary courses raised from finalized deposited contact, including preceding rim courses. Missing contact rejects.':'Offset boundary courses on the nominal terminal reference and declared layer gap.'}};
  }
  if(record.regionField){
    requireThat(record.regionField.kind==='periodic-cells','Unknown Slice region stroke field.');
    requireThat(reference?.sourceOperationIds?.length,'A reference family needs finalized source operation prerequisites.');

    const {shell,process}=record.context,settings=record.regionField.settings;
    const ownedCourse=record.regionField.courses?.find(course=>course.index===layerIndex);
    requireThat(!record.regionField.courses||ownedCourse,'Normal-band ownership has no selected course.');
    const field=surfaceCellField({shell,settings,process,chart:reference,layoutChart:layoutReference,
      ...(ownedCourse?{courses:[ownedCourse],startU:fieldState?.nextU??0,axialStart:fieldState?.nextAxial??0}:{})});
    let after=[...reference.sourceOperationIds];
    const operations=field.courses.map(course=>{
      const evaluated=evaluateRegionCourse({id:record.spec.id,process,filament:record.spec.filament,
        contactGaps:substrateAdaptation&&ownedCourse&&requiredContact?{segments:contactSegments,maxHeightMm:record.context.maxBeadHeightMm}:null,
        course:{key:course.layer,layer:course.layer,phase:course.phase,reference:course.reference,
          strokes:course.strokes,
          join:{mode:'ordered'},connectNearby:course.axial,regionId:record.spec.id+':'+course.layer,after,
          travel:{kind:'clearance',clearanceZ:course.maxZ+process.liftMm,poseJoinMm:course.axial?CONNECT_MOVE_MM:0}}});
      after=[evaluated.operation.id];return ownedCourse?{...evaluated.operation,ownershipRank:ownedCourse.index}:evaluated.operation;
    });
    const widths=operations.reduce((range,operation)=>operation.strokes.reduce((range,stroke)=>(stroke.segmentMetadata??[]).reduce((range,metadata)=>
      Number.isFinite(metadata.beadWidthMm)?[Math.min(range[0],metadata.beadWidthMm),Math.max(range[1],metadata.beadWidthMm)]:range,range),range),[Infinity,0]);
    return {id:record.spec.id,operations,family:{...record.family,layers:field.courses.map(course=>({index:course.layer,region:course.region,reference:course.reference}))},familyId:record.familyId,ownershipGroup:record.owner.ownershipGroup,
      ...(ownedCourse?{fieldState:{nextU:field.nextU,nextAxial:field.nextAxial},normalCourse:ownedCourse}:{}),
      report:{...field.report,depositionFamily:'slice',minBeadWidthMm:widths[0],maxBeadWidthMm:widths[1],...record.context.report,
        substrate:{sourceOperationIds:reference.sourceOperationIds,coverage:reference.coverage,part:record.owner.part}}};
  }
  const layers=layerIndex===null?record.spec.layers:record.spec.layers.filter(layer=>layer.index===layerIndex);
  requireThat(layers.length,'Slice construction context has no requested layer.');
  requireThat(layerIndex===null||!record.spec.settings.join,'A joined family must be constructed as one context.');
  const context=layerIndex===null?record.context:{...record.context,report:{...record.context.report,layerStartOrdinal:record.spec.layers.findIndex(layer=>layer.index===layerIndex)}};
  const result=sliceResult({...record.spec,layers,contactSegments,otherFamilyContactSegments,seedSegments,contactFragments,predecessorReference,substrateAdaptation,requiredContact},context);
  return {...result,family:{...record.family,layers:result.familyLayers},ownershipGroup:record.owner.ownershipGroup,familyId:record.familyId};
}

export function sliceResults(args) {
  const {contexts}=prepareSliceContexts(args),results=[],supports=[];
  if(!contexts.length)return {results,supports,summary:null};
  for(const record of contexts)(record.owner.kind==='support'?supports:results).push(sliceContextResult(record));
  requireThat([...results, ...supports].some(r => r.operations.length), 'The slice assignments produced no material.');
  const layerIds = new Set([...results, ...supports].flatMap(r => r.operations.map(op => op.layerId)));
  return { results: ownershipDependencies(results), supports, summary: { layers: layerIds.size, instances: [...results, ...supports].map(r => ({ id: r.id, ...r.report })) } };
}

// Shared ownership establishes this precedence, before the composer chooses
// travel/order among unrelated operations. Merge all families in a connected
// overlap by their ascending physical upper height; same-height walls precede
// their fills through the producer's existing after links.
export function ownershipDependencies(results) {
  const groups = new Map();
  for (const result of results) if (result.ownershipGroup) {
    const entries = groups.get(result.ownershipGroup) ?? [];
    entries.push(...result.operations); groups.set(result.ownershipGroup, entries);
  }
  const prerequisites = new Map();
  for (const operations of groups.values()) {
    const ordered = operations.map((operation, index) => ({ operation, index })).sort((a, b) => (a.operation.ownershipRank??a.operation.rank) - (b.operation.ownershipRank??b.operation.rank) || a.index - b.index);
    for (let i = 1; i < ordered.length; i++) prerequisites.set(ordered[i].operation.id, ordered[i - 1].operation.id);
  }
  return results.map(result => ({ ...result, operations: result.operations.map(operation => {
    const before = prerequisites.get(operation.id);
    return before ? { ...operation, after: [...new Set([...operation.after, before])] } : operation;
  }) }));
}
