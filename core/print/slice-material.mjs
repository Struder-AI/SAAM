// Upstream material claims and reference contexts; no deposition execution.
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {requireThat,normalize} from '../private/toolpath/numeric.mjs';
import {resolveSurfaceDomain} from './surface-domains.mjs';
import {referenceSliceContext} from "./slice-stacks.mjs";
import {surveySurfaceDomain} from './surface-domains.mjs';

import {assignmentPlan,assignmentFilament,depositionAssignments} from "./assignment-process.mjs";

import {heightSlice,heightReferencePatch,heightReferenceBounds} from "../geom/height-slice.mjs";

import { geometrySelections } from '../geom/selections.mjs';
import {PRINT_RESOLUTION_MM} from "../dimensions.mjs";
import {horizontalSlice,planeSlice,patchSlice,translateSlice,sliceStack,sliceBoundaryEdges,patchMeanNormal} from '../geom/slice.mjs';
import {prepareSection,section} from '../region/section.mjs';

import {chartPrism} from '../geom/chart-prism.mjs';

import {volumeSection} from "../region/layer-region.mjs";
import {layerStrokes,mapSliceStrokes} from "../region/layer-strokes.mjs";

import { offsetRegion } from '../region/offset.mjs';

import {difference,intersect} from "../region/intersection.mjs";
import {allocateChartClaims} from '../region/ownership.mjs';

import {lineSpacing} from "../path/spacing.mjs";

import {validateSliceAssignment} from './slice-records.mjs';
import {horizontal,sliceKey} from '../geom/slice.mjs';
function chartExtent(owner, slice) {
  if(slice.kind==='patch')return {min:[slice.patch.domainU[0],slice.patch.domainV[0]],max:[slice.patch.domainU[1],slice.patch.domainV[1]]};
  if(slice.kind==='height-field')return {min:owner.shell.bounds.min.slice(0,2),max:owner.shell.bounds.max.slice(0,2)};
  const corners = Array.from({ length: 8 }, (_, i) => [0, 1, 2].map(k => ((i >> k) & 1 ? owner.shell.bounds.max[k] : owner.shell.bounds.min[k]) - slice.origin[k]));
  const points = corners.map(p => [slice.xAxis, slice.yAxis].map(axis => axis.reduce((n, v, k) => n + v * p[k], 0)));
  const box = regionBox([points]);
  return { min: box.min.map(v => v - 1), max: box.max.map(v => v + 1) };
}

const regionBox = loops => {
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (const loop of loops) for (const [a, b] of loop) { min[0] = Math.min(min[0], a); min[1] = Math.min(min[1], b); max[0] = Math.max(max[0], a); max[1] = Math.max(max[1], b); }
  return { min, max };
};

function failedSlicePreparation(assignment,error){
  if(error.name==='AbortError')throw error;
  error.assignment=assignment.id;throw error;
}

export function sliceOwners(assignments, { shells, processes, materials=[], volumes = new Map(), selections = new Map() }) {
  const owners = [];
  for (const [n, assignment] of assignments.entries()) {
    try{
    if(assignment.construction||assignment.surface?.kind==='terminal'||assignment.stack?.direction==='normal')continue;
    const stack = assignment.stack ?? processes[n], widthMm = processes[n].lineWidthMm;
    const selected = shells.filter(([part, , whole]) => assignment.part === null ? whole : part === assignment.part);
    for (const [part, shell] of selected) {
      const material=materials.find(item=>item.id===assignment.id&&item.part===part);
      const process=material?.process??processes[n],stack=assignment.stack??process,widthMm=process.lineWidthMm;
      const settings=material?{...assignment,filament:material.filament}:assignment;
      const domain=assignment.within.find(v=>v.kind==='surface-domain');
      if(domain){
        const selectedPlacement=assignment.part===null?null:selections.get(assignment.part),shift=[selectedPlacement?.xMm??0,selectedPlacement?.yMm??0,selectedPlacement?.zMm??0];
        const roof=assignment.surface.kind==='roof';
        const patch=roof?null:assignment.surface.kind==='patch'?shell.patches?.find(p=>p.name===assignment.surface.patch):heightReferencePatch(assignment.surface.patch,shift);
        requireThat(roof||patch,`Slice ${assignment.id} names an absent native patch.`);
        let base=roof?heightSlice({kind:'roof',geometry:shell},{sampleStepMm:assignment.sampleStepMm}):patchSlice(patch),direction=stack.direction??(roof?[0,0,1]:patchMeanNormal(patch).normal);
        base=translateSlice(base,normalize(direction).map(v=>v*assignment.surface.offsetMm));
        const fitted=sliceStack({base,direction,pitchMm:stack.layerMm,firstLayerMm:stack.firstLayerMm},shell.bounds);
        const prism=chartPrism(base,{loopsUv:domain.loopsUv,direction,fromMm:domain.fromLayer*fitted.translationStepMm,toMm:domain.toLayer*fitted.translationStepMm});
        const referenceStack=sliceStack({base,direction,pitchMm:stack.layerMm,firstLayerMm:stack.firstLayerMm},prism.bounds),id=part===null?assignment.id:`${part}:${assignment.id}`;
        owners.push({id,sectionKey:id,kind:'part',assignment:settings,process,part,shell:prism,publicationShell:shell,within:[{kind:'geometry',geometry:prism}],referenceStack,widthMm,startMm:prism.bounds.min[2],endMm:prism.bounds.max[2]});
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
      const shift = [selectedPlacement?.xMm ?? 0, selectedPlacement?.yMm ?? 0, selectedPlacement?.zMm ?? 0];
      const reference=assignment.surface.kind==='roof'?{kind:'roof',geometry:shell}:null;
      let base = assignment.surface.kind==='patch'?patchSlice(shell.patches?.find(p=>p.name===assignment.surface.patch)):assignment.surface.kind==='spline'?patchSlice(heightReferencePatch(assignment.surface.patch,shift)):reference?heightSlice(reference,{offsetMm:assignment.surface.offsetMm,sampleStepMm:assignment.sampleStepMm}):assignment.surface.kind === 'plane' ? planeSlice({ ...assignment.surface, origin: assignment.surface.origin.map((v, k) => v + shift[k]) }) : horizontalSlice(assignment.stack && slabs.length ? from : bottom);
      const direction=stack.direction??(base.kind==='patch'?patchMeanNormal(base.patch,null,{sampleStepMm:assignment.sampleStepMm}).normal:null);
      if(base.kind==='patch'){
        base=translateSlice(base,normalize(direction).map(v=>v*assignment.surface.offsetMm));
      }
      const [startMm, endMm] = outline ? [bottom, bottom + stack.firstLayerMm] : [from, to];
      const referenceStack = sliceStack({ base, direction, pitchMm: stack.layerMm, firstLayerMm: stack.firstLayerMm },
        { min: [shell.bounds.min[0], shell.bounds.min[1], assignment.surface.kind === 'horizontal' ? base.origin[2] : bottom], max: [shell.bounds.max[0], shell.bounds.max[1], outline ? endMm : top] });
      const owner = { id: part !== null ? `${part}:${assignment.id}` : assignment.id, kind: outline ? 'outline' : 'part', assignment:settings, process, part, shell, within, referenceStack, widthMm, startMm, endMm };
      owners.push(owner);
    }
    }catch(error){failedSlicePreparation(assignment,error);}
  }
  return owners;
}

export function ownedLayers(inputOwners, { bands = [], onProgress } = {}) {
  const owners = inputOwners;
  const cache = new Map();
  const cached = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
  // A section that does not close joins gaps up to the owner's line width.
  const partCut = (owner, slice) => cached(`section|${owner.sectionKey??owner.part}|${owner.widthMm}|${sliceKey(slice)}`, () => {
    const prepared = cached(`prepared|${owner.sectionKey??owner.part}|${JSON.stringify(slice.normal)}`, () => prepareSection(owner.shell, slice));
    return section(prepared, slice, { gapMm: owner.widthMm,...(slice.kind==='plane'?{side:'negative'}:{}) });
  });
  const partSection = (owner, slice) => partCut(owner, slice).loops;
  const material = (owner, slice) => cached(`material|${owner.sectionKey??owner.part}|${owner.widthMm}|${sliceKey(slice)}`, () => {
    let region = partSection(owner, slice);
    for (const band of bands.filter(b => b.part === owner.part)) {
      const cut = volumeSection({ kind: 'slab', fromMm: band.startMm, toMm: band.endMm }, { slice }, chartExtent(owner, slice));
      region = cut === null ? [] : difference(region, cut);
    }
    return region;
  });
  const volume = (owner, layer) => cached(`volume|${owner.id}|${sliceKey(layer.slice)}`, () => {
    const cuts = owner.within.map(v => volumeSection(v, layer, chartExtent(owner, layer.slice))).filter(c => c !== null);
    return cuts.length ? cuts.reduce((a, b) => a.length && b.length ? intersect(a, b) : []) : null;
  });
  const explicit = owners.filter(o => o.kind === 'part' && o.within.length), results = [];
  let done = 0;
  const total = owners.reduce((n, o) => n + o.referenceStack.layers.length, 0);
  for (const principal of owners) {
    try{
    const referenceStack = principal.referenceStack, layers = [], materialMasks = new Map(), findings = [];
    for (const layer of referenceStack.layers) {
      onProgress?.({ stage: 'Slicing layers', completed: done++, total });
      const own = material(principal, layer.slice);
      materialMasks.set(layer.index, own);
      const z = layer.slice.origin?.[2]??layer.slice.offsetMm;
      if (horizontal(layer.slice) && (z <= principal.startMm + PRINT_RESOLUTION_MM || z > principal.endMm + PRINT_RESOLUTION_MM)) continue;
      findings.push({ layer, cut: partCut(principal, layer.slice) });
      if (!own.length) continue;
      const candidates = explicit.filter(o => o.part === principal.part);
      let region, boundary = own;
      if (principal.kind === 'outline') {
        boundary = partSection(principal, layer.slice);
        region = difference(offsetRegion(boundary, (Array.isArray(principal.assignment.loops)?Math.max(...principal.assignment.loops):principal.assignment.loops) * lineSpacing(principal.widthMm, principal.assignment)), boundary);

      } else {
        region = allocateChartClaims(own, candidates.map(owner => ({ owner, region: volume(owner, layer) })), { principal, retainUnclaimed: !principal.within.length });
        if (!region.length) continue;
      }
      // A patch slice reaching its own edge stops inside the material: it prints what it covers.
      const authoredBoundary=principal.shell.kind==='chart-prism'&&layer.slice.referencePatch===principal.shell.reference.referencePatch;
      if(!authoredBoundary)findings.push({ layer, edges: sliceBoundaryEdges(layer.slice,region), region });
      layers.push({ ...layer, region, material: boundary, outward: principal.kind === 'outline',...(partCut(principal,layer.slice).report?{sectionReport:partCut(principal,layer.slice).report}:{}) });
    }
    const notes = sectionNotes(principal.assignment.id, findings);
    if (layers.length || notes.length) results.push({ owner: principal, referenceStack, stackId: principal.id, layers, material: materialMasks, notes });
    }catch(error){failedSlicePreparation(principal.assignment,error);}
  }
  return results;
}

function sectionNotes(id, findings) {
  const at = (layer, point) => { const p = evaluateSurface(layer.slice, point).point; return `X ${p[0].toFixed(1)} Y ${p[1].toFixed(1)} Z ${p[2].toFixed(2)}`; };
  const zOf = layer => (layer.slice.origin?.[2] ?? layer.slice.offsetMm).toFixed(2);
  const notes = [], open = findings.filter(f => f.cut?.open.length), edged = findings.filter(f => f.edges?.length);
  if (open.length) {
    const items = open.flatMap(f => f.cut.open.map(item => ({ ...item, layer: f.layer })));
    const widest = kind => items.filter(i => i.kind === kind).reduce((a, b) => !a || b.sizeMm > a.sizeMm ? b : a, null);
    const joined = widest('joined'), dropped = widest('dropped');
    notes.push(`Slice ${id}: the part's section did not close at ${open.length} layer(s), Z ${zOf(open[0].layer)} to ${zOf(open.at(-1).layer)} mm; those layers print only what closes.` +
      (joined ? ` ${items.filter(i => i.kind === 'joined').length} gap(s) up to the line width were joined, widest ${joined.sizeMm.toFixed(2)} mm at ${at(joined.layer, joined.point)}.` : '') +
      (dropped ? ` ${items.filter(i => i.kind === 'dropped').length} open piece(s) were left out, longest ${dropped.sizeMm.toFixed(1)} mm at ${at(dropped.layer, dropped.point)}; the geometry is open there.` : ''));
  }
  if (edged.length) {
    const first = edged[0], point = first.region.flat().find(p => sliceBoundaryEdges(first.layer.slice, [[p]]).length);
    notes.push(`Slice ${id}: ${edged.length} layer(s), ${first.layer.index} to ${edged.at(-1).layer.index}, reach the reference's ${[...new Set(edged.flatMap(f => f.edges))].join(', ')} edge inside the part, first at ${at(first.layer, point)}; material beyond it is not printed. Extend the reference to fully cross the part.`);
  }
  return notes;
}

function sliceRank(slice, bounds) {
  if(slice.kind==='patch')return heightReferenceBounds({kind:'spline',patch:slice.patch}).max[2];
  if(slice.kind==='height-field')return heightReferenceBounds(slice.reference).max[2]+slice.offsetMm;
  if (horizontal(slice)) return slice.origin[2];
  const heights = [bounds.min[0], bounds.max[0]].flatMap(x => [bounds.min[1], bounds.max[1]].map(y =>
    slice.origin[2] - ((x - slice.origin[0]) * slice.normal[0] + (y - slice.origin[1]) * slice.normal[1]) / slice.normal[2]));
  return Math.max(...heights);
}

export function prepareSliceContexts({plan,shells,volumes,bands=[],geometryCuts=[],solidVolumes=[],combineSolids,onProgress}) {
  const all=depositionAssignments(plan,{expandParts:false}).filter(a=>!a.construction);
  for(const assignment of all){
    try{validateSliceAssignment(assignment,{parts:shells.map(([part])=>part).filter(part=>part!==null),firstLayerMm:plan.process.firstLayerMm});}
    catch(error){failedSlicePreparation(assignment,error);}
  }
  const surfaceAssignments=all.filter(a=>a.within?.some(v=>v.kind==='surface-domain'&&v.loopsUv===null)).map(assignment=>{
    try{
    const shell=shells.find(([part])=>part===assignment.part)?.[1];
    return {assignment,shell,survey:surveySurfaceDomain({assignment,shell})};
    }catch(error){failedSlicePreparation(assignment,error);}
  });
  const lowered=new Map(surfaceAssignments.map(input=>{
    try{return [input.assignment.id,{assignment:resolveSurfaceDomain(input),contact:input.assignment.contact,survey:input.survey}];}
    catch(error){failedSlicePreparation(input.assignment,error);}
  }));
  const assignments=all.filter(a=>a.surface.kind!=='terminal'&&a.stack?.direction!=='normal').map(a=>lowered.get(a.id)?.assignment??a);
  const referenceAssignments=all.filter(a=>a.surface.kind==='terminal'||a.stack?.direction==='normal').map(assignment=>{
    const shell=shells.find(([part])=>part===assignment.part)?.[1],process=assignmentPlan(plan,assignment).process;
    if(!shell&&assignment.surface.kind!=='terminal')failedSlicePreparation(assignment,Error('A reference stack needs selected geometry.'));
    return {assignment,shell,process,volumes};
  });
  if(!all.length)return {contexts:[],notes:[]};
  const processes = assignments.map(a => assignmentPlan(plan,a).process);
  const materials=assignments.flatMap(a=>shells.filter(([part,,whole])=>a.part===null?whole:part===a.part).map(([part])=>{
    const selected={...a,part,filament:assignmentFilament(plan,{...a,part})};
    return {id:a.id,part,filament:selected.filament,process:assignmentPlan(plan,selected).process};
  }));
  const processShells=shells.map(([part,shell,whole])=>{
    const cuts=geometryCuts.filter(cut=>cut.part===part);
    return [part,cuts.length?combineSolids('difference',[shell,...cuts.map(cut=>cut.geometry)]):shell,whole];
  });
  const owners = sliceOwners(assignments, { shells:processShells, processes, materials, volumes, selections: plan.geometry?geometrySelections(plan.geometry):new Map() });
  for(const owner of owners)owner.publicationShell??=shells.find(([part])=>part===owner.part)?.[1];
  const owned = ownedLayers(owners, { bands, onProgress });
  const contexts=[],notes=owned.flatMap(stack=>stack.notes);
  for (const { owner, referenceStack, stackId, layers, material } of owned) {
    const { assignment } = owner;
    if(assignment.join||!layers.length)continue;
    const process = owner.process??processes[assignments.indexOf(assignment)];
    const held = solidVolumes.filter(volume => volume.part === owner.part);
    const solidRegions = new Map(held.length ? layers.map(layer => [layer.index,held.flatMap(volume=>
      section(volume.geometry,layer.slice,layer.slice.kind==='plane'?{side:'negative'}:{}).loops)]) : []);
    const report = { owner: assignment.id, part: owner.part, layerMm: referenceStack.pitchMm,
      ...(lowered.has(assignment.id)?{referenceStackKind:'roof',excludedFraction:lowered.get(assignment.id).survey.steepFraction,maxSlopeDeg:lowered.get(assignment.id).survey.maxSlopeDeg,limitDeg:lowered.get(assignment.id).survey.limitDeg}:{}),
      targetGapMm:referenceStack.pitchMm,translationStepMm:referenceStack.translationStepMm,firstTranslationMm:referenceStack.firstTranslationMm,meanProjectedGapMm:referenceStack.pitchMm,minProjectedGapMm:referenceStack.minProjectedGapMm,maxProjectedGapMm:referenceStack.maxProjectedGapMm,stackMetric:'area-mean-normal-projection',
      ...(referenceStack.base.kind==='height-field'?{beadHeightMetric:'local-normal-projection',chartMetric:'world-xy',topologySampleStepMm:referenceStack.base.sampleStepMm}:{}),
      };
    contexts.push({contact:assignment.contact?{...assignment.contact,predecessorReference:translateSlice(layers[0].slice,layers[0].direction.map(v=>-v*layers[0].translationMm))}:null,spec:{id:owner.id,settings:assignment,layers,material,solidRegions,filament:assignment.filament,totalLayerCount:layers.length,predecessorRegions:new Map(layers.map(layer=>[layer.index,layers.find(previous=>previous.index===layer.index-1)?.region??[]]))},context:{process,shell:owner.publicationShell??owner.shell,startMm:owner.startMm,endMm:owner.endMm,report},referenceStack,owner,stackId,
      layerOrder:layers.map(layer=>({index:layer.index,rank:sliceRank(layer.slice,owner.shell.bounds)}))});
  }
  contexts.push(...referenceAssignments.map(input=>{
    try{return referenceSliceContext(input,plan);}catch(error){failedSlicePreparation(input.assignment,error);}
  }));
  return {contexts,notes};
}

export function prepareSliceBoundaryStack({plan,assignment,shells,volumes}){
  const request={...assignment,join:null},local={...plan,slices:{...plan.slices,assignments:plan.slices.assignments.map(a=>a.id===assignment.id?request:a)}};
  const contexts=prepareSliceContexts({plan:local,shells,volumes}).contexts.filter(record=>record.owner.assignment.id===assignment.id);
  requireThat(contexts.length===1&&!contexts[0].reference,'A spiral boundary needs one resolved region stack.');
  const record=contexts[0],process=record.context.process;
  const layers=record.spec.layers.map(layer=>{
    const strokes=layerStrokes(layer.region,{...request,widthMm:process.lineWidthMm,fillAngleDeg:0,patternAngleDeg:0,wallToleranceMm:process.planarWallToleranceMm,slice:layer.slice});
    return {...layer,curves:mapSliceStrokes(strokes.walls,layer.slice)};
  });
  requireThat(layers.length,'The spiral reference has no boundary slices.');
  return {referenceStack:{...record.referenceStack,layers},process,shell:record.context.shell,startMm:record.context.startMm,endMm:record.context.endMm};
}
