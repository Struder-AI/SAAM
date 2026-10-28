// Material-region stage. Input owners are authored-order records with id, part,
// shell, within volumes, referenceStack, assignment, process and widthMm.
// Output: {owner, referenceStack, stackId, layers, material, notes}.
// Distances are mm; layer regions retain their slice's native chart coordinates.
// Settings stay with each claimant; returned layers contain no constructed strokes.
// Ownership is ordinary: an explicit claim owns the material inside it, and a
// default owner keeps what no explicit claim covers. Overlap distribution
// between claims is local developer research outside SAAM.
import {difference,intersect} from './intersection.mjs';
import {allocateChartClaims} from './ownership.mjs';
import {randomUUID} from 'node:crypto';
import {getObservationFlow,observeContractValue} from '../contracts/observations.mjs';
import {surfaceReferenceRecord} from '../geom/surface-record.mjs';
import {offsetRegion} from './offset.mjs';
import {sliceKey,sliceBoundaryEdges} from '../geom/slice.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {volumeSection} from './layer-region.mjs';
import {prepareSection,section} from './section.mjs';
import {lineSpacing} from '../path/spacing.mjs';

// Component placement does not make an independent Slice solid part material.
const materialKey=owner=>JSON.stringify([owner.part,owner.assignment.geometry?owner.assignment.id:null]);
const sameMaterial=(a,b)=>materialKey(a)===materialKey(b);

function chartExtent(owner, slice) {
  if(slice.kind==='patch')return {min:[slice.patch.domainU[0],slice.patch.domainV[0]],max:[slice.patch.domainU[1],slice.patch.domainV[1]]};
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
function allocatedChartRegion(region,claims,options){
  const result=allocateChartClaims(region,claims,{principal:options.owner,retainUnclaimed:options.retainUnclaimed});
  if(!getObservationFlow())return result;
  try{
    const {owner,layer}=options,occurrenceId=randomUUID(),identity=owner=>({id:owner.id,assignment:owner.assignment.id,part:owner.part});
    const request=observeContractValue({wireId:'allocate-chart-region',phase:'request',typeId:'chart-allocation-request',
      implementationSchema:'saam-chart-allocation-request/1',occurrenceId,stageId:'chart-allocation:request',consumerId:'Material allocation',
      value:{region,claims:claims.map(claim=>({owner:identity(claim.owner),region:claim.region})),owner:identity(owner),
        chart:surfaceReferenceRecord(layer.slice),stackId:owner.id,layer:Object.fromEntries(['index','offsetMm','translationMm','characterIndex','ownerOffsetMm']
          .filter(key=>layer[key]!==undefined).map(key=>[key,layer[key]])),retainUnclaimed:options.retainUnclaimed??false,joint:false,policy:'ordinary'}});
    observeContractValue({wireId:'allocate-chart-region',phase:'reply',typeId:'allocated-chart-region',implementationSchema:'saam-allocated-chart-region/1',
      occurrenceId,stageId:'chart-allocation:result',consumerId:'Owned region layers',value:result,
      requestIdentity:{id:request.id,valueId:request.valueId,flowId:request.flowId}});
  }catch{/* Retention cannot change the actual region or allocation decision. */}
  return result;
}
export function prepareMaterialRegions(owners, { bands = [], substrate = null, onProgress } = {}) {
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
    for (const band of bands.filter(b => b.part === owner.part&&(!owner.assignment.geometry||b.sourceId===owner.assignment.id))) {
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
      onProgress?.({ stage: 'Slicing layers', completed: done++, total, assignment: principal.assignment.id, layer: layer.index });
      const own = material(principal, layer.slice);
      materialMasks.set(layer.index, own);
      findings.push({ layer, cut: partCut(principal, layer.slice) });
      const candidates = explicit.filter(o => sameMaterial(o,principal));
      let region=own, boundary = own;
      if (principal.kind === 'outline') {
        boundary = partSection(principal, layer.slice);
        region = difference(offsetRegion(boundary, (Array.isArray(principal.assignment.loops)?Math.max(...principal.assignment.loops):principal.assignment.loops) * lineSpacing(principal.widthMm, principal.assignment)), boundary);

      } else if(own.length) {
        region = allocatedChartRegion(own,candidates.map(owner => ({ owner, region: volume(owner, layer) })), { owner:principal, retainUnclaimed: !principal.within.length,layer });
      }
      // A patch slice reaching its own edge stops inside the material: it prints what it covers.
      const authoredBoundary=principal.shell.kind==='chart-prism'&&layer.slice.referencePatch===principal.shell.reference.referencePatch;
      if(region.length&&!authoredBoundary)findings.push({ layer, edges: sliceBoundaryEdges(layer.slice,region), region });
      layers.push({ ...layer, region, material: boundary, outward: principal.kind === 'outline',...(partCut(principal,layer.slice).report?{sectionReport:partCut(principal,layer.slice).report}:{}) });
    }
    const notes = sectionNotes(principal.assignment.id, findings);
    const grid=[...materialMasks].map(([index,region])=>({index,region}));
    for(const layer of layers){layer.materialGrid={layers:grid,index:layer.index};layer.characterIndex??=layer.index;layer.ownerOffsetMm=layer.offsetMm;
      layer.referenceFrame={base:referenceStack.base,direction:referenceStack.direction,offsetMm:layer.offsetMm};}
    if (layers.length || notes.length) results.push({ owner: principal, referenceStack, stackId: principal.id, layers, material: materialMasks, substrate, notes });
    }catch(error){failedSlicePreparation(principal.assignment,error);}
  }
  return results.filter(record=>record.layers.length||record.notes.length);
}

function sectionNotes(id, findings) {
  const at = (layer, point) => { const p = evaluateSurface(layer.slice, point).point; return `X ${p[0].toFixed(1)} Y ${p[1].toFixed(1)} Z ${p[2].toFixed(2)}`; };
  const notes = [], edged = findings.filter(f => f.edges?.length);
  for (const kind of ['joined', 'dropped']) {
    const items = findings.flatMap(f => (f.cut?.open ?? []).filter(item => item.kind === kind).map(item => ({ ...item, layer: f.layer })));
    if (!items.length) continue;
    const indices = [...new Set(items.map(item => item.layer.index))].sort((a, b) => a - b);
    const largest = items.reduce((a, b) => b.sizeMm > a.sizeMm ? b : a);
    const layers = `${indices.length} layer(s), indices ${indices[0]} to ${indices.at(-1)}`;
    notes.push(kind === 'joined'
      ? `Slice ${id}: ${items.length} section boundary gap(s) up to the line width were joined across ${layers}; widest ${largest.sizeMm.toFixed(2)} mm at ${at(largest.layer, largest.point)}.`
      : `Slice ${id}: ${items.length} open section piece(s) were left out across ${layers}, longest ${largest.sizeMm.toFixed(1)} mm at ${at(largest.layer, largest.point)}; the geometry is open there. Only closed section regions are retained.`);
  }
  if (edged.length) {
    const first = edged[0], point = first.region.flat().find(p => sliceBoundaryEdges(first.layer.slice, [[p]]).length);
    notes.push(`Slice ${id}: ${edged.length} layer(s), ${first.layer.index} to ${edged.at(-1).layer.index}, reach the reference's ${[...new Set(edged.flatMap(f => f.edges))].join(', ')} edge inside the part, first at ${at(first.layer, point)}; material beyond it is not printed. Extend the reference to fully cross the part.`);
  }
  return notes;
}
