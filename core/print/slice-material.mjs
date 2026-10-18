// Upstream material claims and reference contexts; no deposition execution.
import {intersect,difference} from '../region/intersection.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {requireThat,normalize} from '../private/toolpath/numeric.mjs';
import {resolveSurfaceDomain} from './surface-domains.mjs';
import {referenceSliceContext} from "./slice-stacks.mjs";
import {surveySurfaceDomain} from './surface-domains.mjs';

import {assignmentPlan,assignmentFilament,depositionAssignments} from "./assignment-process.mjs";

import {heightSlice,heightReferencePatch} from "../geom/height-slice.mjs";

import { geometrySelections } from '../geom/selections.mjs';
import {horizontalSlice,planeSlice,patchSlice,translateSlice,sliceStack,patchMeanNormal} from '../geom/slice.mjs';
import {section} from '../region/section.mjs';

import {chartPrism} from '../geom/chart-prism.mjs';
import {layerStrokes,mapSliceStrokes} from "../region/layer-strokes.mjs";
import {prepareMaterialRegions} from '../region/shared-material/prepare.mjs';
import {validateSliceAssignment} from './slice-records.mjs';
function failedSlicePreparation(assignment,error){
  if(error.name==='AbortError')throw error;
  error.assignment=assignment.id;throw error;
}

export function sliceOwners(assignments, { shells, processes, materials=[], volumes = new Map(), sources = new Map(), selections = new Map() }) {
  const owners = [];
  for (const [n, assignment] of assignments.entries()) {
    try{
    if(assignment.construction||assignment.surface?.kind==='terminal'||assignment.stack?.direction==='normal')continue;
    const stack = assignment.stack ?? processes[n], widthMm = processes[n].lineWidthMm;
    const selected = assignment.geometry?[[assignment.part,sources.get(assignment.id)]]:shells.filter(([part, , whole]) => assignment.part === null ? whole : part === assignment.part);
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
      const owner = { id: part !== null ? `${part}:${assignment.id}` : assignment.id, ...(assignment.geometry?{sectionKey:assignment.id,publicationShell:shell}:{}),kind: outline ? 'outline' : 'part', assignment:settings, process, part, shell, within, referenceStack, widthMm, startMm, endMm };
      owners.push(owner);
    }
    }catch(error){failedSlicePreparation(assignment,error);}
  }
  return owners;
}



export function prepareSliceContexts({plan,shells,volumes,sources=new Map(),bands=[],geometryCuts=[],solidVolumes=[],combineSolids,onProgress}) {
  const all=depositionAssignments(plan,{expandParts:false}).filter(a=>!a.construction);
  for(const assignment of all){
    try{validateSliceAssignment(assignment,{parts:shells.map(([part])=>part).filter(part=>part!==null),firstLayerMm:plan.process.firstLayerMm});}
    catch(error){failedSlicePreparation(assignment,error);}
  }
  const surfaceAssignments=all.filter(a=>a.within?.some(v=>v.kind==='surface-domain'&&v.loopsUv===null)).map(assignment=>{
    try{
    const shell=sources.get(assignment.id)??shells.find(([part])=>part===assignment.part)?.[1];
    return {assignment,shell,survey:surveySurfaceDomain({assignment,shell})};
    }catch(error){failedSlicePreparation(assignment,error);}
  });
  const lowered=new Map(surfaceAssignments.map(input=>{
    try{return [input.assignment.id,{assignment:resolveSurfaceDomain(input),contact:input.assignment.contact,survey:input.survey}];}
    catch(error){failedSlicePreparation(input.assignment,error);}
  }));
  const assignments=all.filter(a=>a.surface.kind!=='terminal'&&a.stack?.direction!=='normal').map(a=>lowered.get(a.id)?.assignment??a);
  const referenceAssignments=all.filter(a=>a.surface.kind==='terminal'||a.stack?.direction==='normal').map(assignment=>{
    const shell=sources.get(assignment.id)??shells.find(([part])=>part===assignment.part)?.[1],process=assignmentPlan(plan,assignment).process;
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
  const owners = sliceOwners(assignments, { shells:processShells, processes, materials, volumes, sources, selections: plan.geometry?geometrySelections(plan.geometry):new Map() });
  for(const owner of owners)owner.publicationShell??=shells.find(([part])=>part===owner.part)?.[1];
  const owned = prepareMaterialRegions(owners, { bands, onProgress, sharedMaterial:plan.experimental?.sharedMaterial===true });
  const contexts=[],notes=[...new Set([...processShells.flatMap(([,shell])=>shell.notes??[]),...owned.flatMap(stack=>stack.notes)])];
  for (const { owner, referenceStack, stackId, layers, material, substrate, sharedReport } of owned) {
    const { assignment } = owner;
    if(assignment.join||!layers.length)continue;
    const process = owner.process??processes[assignments.indexOf(assignment)];
    const held = solidVolumes.filter(volume => volume.part === owner.part&&!owner.assignment.geometry);
    const solidRegions = new Map(held.length ? layers.map(layer => [layer.index,held.flatMap(volume=>
      section(volume.geometry,layer.slice,layer.slice.kind==='plane'?{side:'negative'}:{}).loops)]) : []);
    const report = { ...(sharedReport?{sharedMaterial:sharedReport}:{}),owner: assignment.id, part: owner.part, layerMm: referenceStack.pitchMm,
      ...(lowered.has(assignment.id)?{referenceStackKind:'roof',excludedFraction:lowered.get(assignment.id).survey.steepFraction,maxSlopeDeg:lowered.get(assignment.id).survey.maxSlopeDeg,limitDeg:lowered.get(assignment.id).survey.limitDeg}:{}),
      targetGapMm:referenceStack.pitchMm,translationStepMm:referenceStack.translationStepMm,firstTranslationMm:referenceStack.firstTranslationMm,meanProjectedGapMm:referenceStack.pitchMm,minProjectedGapMm:referenceStack.minProjectedGapMm,maxProjectedGapMm:referenceStack.maxProjectedGapMm,stackMetric:'area-mean-normal-projection',
      ...(referenceStack.base.kind==='height-field'?{beadHeightMetric:'local-normal-projection',chartMetric:'world-xy',topologySampleStepMm:referenceStack.base.sampleStepMm}:{}),
      };
    contexts.push({contact:assignment.contact?{...assignment.contact,predecessorReference:translateSlice(layers[0].slice,layers[0].direction.map(v=>-v*layers[0].translationMm))}:null,spec:{id:owner.id,settings:assignment,layers,material,solidRegions,filament:assignment.filament,totalLayerCount:layers.length,predecessorRegions:new Map(layers.map(layer=>[layer.index,layers.find(previous=>previous.index===layer.index-1)?.region??[]]))},context:{process,shell:owner.publicationShell??owner.shell,substrate,startMm:owner.startMm,endMm:owner.endMm,report},referenceStack,owner,stackId,
      layerOrder:layers.map(layer=>({index:layer.index,rank:layer.ownerOffsetMm??layer.offsetMm??layer.index}))});
  }
  contexts.push(...referenceAssignments.map(input=>{
    try{return referenceSliceContext(input);}catch(error){failedSlicePreparation(input.assignment,error);}
  }));
  return {contexts:contexts.map(record=>record.reference?record:prepareOwnedSliceRegions(record)),notes};
}

// All resolved Slice geometry crosses this boundary, including normal and
// terminal references. Layout, readiness and Trace sources read these same
// owned regions; masking is never an instruction to a deposition backend.
export function prepareOwnedSliceRegions(record){
  const {settings}=record.spec,material=new Map(record.spec.material??record.spec.layers.map(layer=>[layer.index,layer.material??layer.region]));
  const layers=record.spec.layers.map(layer=>{
    const mask=settings.sliceOverrides?.[layer.characterIndex??layer.index]?.regionUv??settings.regionUv;
    if(mask===undefined)return layer;
    const region=intersect(layer.region,mask),removed=difference(layer.region,region);
    material.set(layer.index,difference(material.get(layer.index)??layer.material??layer.region,removed));
    return {...layer,region,material:difference(layer.material??layer.region,removed)};
  }).filter(layer=>layer.region.length);
  const prepared=layers.map(layer=>layer.materialGrid?{...layer,materialGrid:{...layer.materialGrid,
    layers:layer.materialGrid.layers.map(entry=>({...entry,region:material.get(entry.index)??entry.region}))}}:layer);
  return {...record,spec:{...record.spec,layers:prepared,material,
    predecessorRegions:new Map(prepared.map(layer=>[layer.index,prepared.find(prior=>prior.index===layer.index-1)?.region??[]]))},
    referenceStack:{...record.referenceStack,layers:prepared},
    layerOrder:record.layerOrder.filter(layer=>prepared.some(owned=>owned.index===layer.index))};
}

export function prepareSliceBoundaryStack({plan,assignment,shells,volumes,sources}){
  const request={...assignment,join:null},local={...plan,slices:{...plan.slices,assignments:plan.slices.assignments.map(a=>a.id===assignment.id?request:a)}};
  const contexts=prepareSliceContexts({plan:local,shells,volumes,sources}).contexts.filter(record=>record.owner.assignment.id===assignment.id);
  requireThat(contexts.length===1&&!contexts[0].reference,'A spiral boundary needs one resolved region stack.');
  const record=contexts[0],process=record.context.process;
  const layers=record.spec.layers.map(layer=>{
    const strokes=layerStrokes(layer.region,{...request,widthMm:process.lineWidthMm,fillAngleDeg:0,patternAngleDeg:0,wallToleranceMm:process.planarWallToleranceMm,slice:layer.slice});
    return {...layer,curves:mapSliceStrokes(strokes.walls,layer.slice)};
  });
  requireThat(layers.length,'The spiral reference has no boundary slices.');
  return {referenceStack:{...record.referenceStack,layers},process,shell:record.context.shell,startMm:record.context.startMm,endMm:record.context.endMm};
}
