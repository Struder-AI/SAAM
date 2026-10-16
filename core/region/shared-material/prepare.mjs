// Material-region stage. Input owners are authored-order records with id, part,
// shell, within volumes, referenceStack, assignment, process and widthMm.
// Output: {owner, referenceStack, stackId, layers, material, notes, sharedReport}.
// Distances are mm; layer regions retain their slice's native chart coordinates.
// Settings stay with each claimant; returned layers contain no constructed strokes.
import {difference,intersect,union} from '../intersection.mjs';
import {offsetRegion} from '../offset.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM,ROUNDING_RELATIVE} from '../../dimensions.mjs';
import {prepareSharedInterior} from './depth.mjs';
import {boundaryCaps} from './caps.mjs';
import {sliceKey,planeSlice,sliceBoundaryEdges,sliceStack,translateSlice,prepareSliceRay,sliceRayIntersections,sliceChartStep} from '../../geom/slice.mjs';
import {evaluateSurface} from '../../geom/surface-evaluation.mjs';
import {sampledChartRegion} from '../../geom/height-slice.mjs';
import {volumeSection} from '../layer-region.mjs';
import {dot} from '../../geom/frame.mjs';

// Shared-claim depth, independent of bead overlap and nozzle forgiveness.
const MIN_SHARED_CLAIM_DEPTH_MM=.1;

const claimInterior=owners=>prepareSharedInterior({solids:[...new Set(owners.flatMap(owner=>[owner.shell,...owner.within.filter(v=>v.kind==='geometry').map(v=>v.geometry)]))],slabs:owners.flatMap(owner=>owner.within.filter(v=>v.kind==='slab'))});
const chartBounds=region=>({min:[0,1].map(k=>Math.min(...region.flat().map(p=>p[k]))),max:[0,1].map(k=>Math.max(...region.flat().map(p=>p[k])))});
const modulo=(i,n)=>((i%n)+n)%n;

// One preparation owns principal selection, layer-height adaptation and spatial
// fingers. Every chart evaluates the same partition; no execution order is
// invented here. Settings and native reference origins stay with each owner.
function cadence(owners,witness){
  const principal=owners[0],stack=principal.referenceStack;
  const principalHits=sliceRayIntersections(prepareSliceRay(stack.base,stack.direction),witness);
  const normal=principalHits.length?evaluateSurface(stack.base,principalHits[0].chartPoint).normal:stack.direction;
  const scale=stack.meanProjection/dot(normal,stack.direction);
  const pitches=owners.map(owner=>{
    const other=owner.referenceStack,growth=Math.abs(dot(normal,other.direction)*scale),independent=growth<=ROUNDING_RELATIVE;
    // Compare actual reference advances in one joint coordinate. Normal target
    // thickness alone is insufficient on differently curved reference stacks.
    return {requestedMm:other.pitchMm,growth,meanProjection:other.meanProjection,independent,
      jointMm:independent?owner.widthMm*scale:other.pitchMm/other.meanProjection*growth};
  });
  pitches[0]={...pitches[0],jointMm:stack.pitchMm};
  let best=null;
  const nearest=(period,pitch)=>{
    const ratio=period/pitch,low=Math.max(1,Math.floor(ratio)),high=Math.max(1,Math.ceil(ratio));
    return Math.abs(Math.log(period/low/pitch))<=Math.abs(Math.log(period/high/pitch))?low:high;
  };
  // At least one count is one. Once period exceeds every requested joint pitch
  // by more than the current error permits, no such primitive repeat can win.
  for(let count=1;;count++){
    const period=count*stack.pitchMm;
    if(best&&period>Math.max(...pitches.map(p=>p.jointMm))*Math.exp(Math.sqrt(best.error))+PRINT_RESOLUTION_MM)break;
    const regular=pitches.map(p=>nearest(period,p.jointMm));regular[0]=count;
    for(let single=0;single<owners.length;single++){
      if(single===0&&count!==1)continue;
      const counts=regular.slice();counts[single]=1;
      const error=pitches.reduce((sum,p,i)=>sum+Math.log(period/counts[i]/p.jointMm)**2,0);
      if(!best||error<best.error-ROUNDING_RELATIVE||Math.abs(error-best.error)<=ROUNDING_RELATIVE&&period<best.periodMm){
        best={periodMm:period,counts,error,pitches,effectiveMm:pitches.map((p,i)=>i===0||p.independent?p.requestedMm:period/counts[i]*p.meanProjection/p.growth)};
      }
    }
  }
  return best;
}

function retimeLayers(owner,others,heightMm,claimAt,onProgress){
  const stack=owner.referenceStack,nominal=stack.layers,participating=nominal.map((layer,index)=>{
    onProgress?.({stage:'Adapting shared layers',assignment:owner.assignment.id,completed:index,total:nominal.length});
    const own=claimAt(owner,layer);
    return own.length&&others.some(other=>intersect(own,claimAt(other,layer)).length);
  });
  const layers=[];let transitions=0;
  for(let i=0;i<nominal.length;){
    if(!participating[i]){layers.push(nominal[i++]);continue;}
    let last=i;while(last+1<nominal.length&&participating[last+1])last++;
    const from=i?nominal[i-1].offsetMm:nominal[i].offsetMm-nominal[i].translationMm,to=nominal[last].offsetMm,step=heightMm/stack.meanProjection;
    let previous=from;
    const first=from+step;
    for(let offset=first;previous<to-PRINT_RESOLUTION_MM;offset+=step){
      const end=Math.min(offset,to),advance=end-previous,transition=Math.abs(advance-step)>PRINT_RESOLUTION_MM;
      if(transition)transitions++;
      const character=nominal.slice(i,last+1).reduce((best,candidate)=>Math.abs(candidate.offsetMm-end)<Math.abs(best.offsetMm-end)?candidate:best,nominal[i]);
      layers.push({...nominal[i],offsetMm:end,slice:translateSlice(stack.base,stack.direction.map(v=>v*end)),translationMm:advance,
        heightMm:advance*stack.meanProjection,targetGapMm:advance*stack.meanProjection,characterIndex:character.index,sharedMaterial:true,sharedTransition:transition});
      previous=end;
    }
    i=last+1;
  }
  return {referenceStack:{...stack,layers:layers.map((layer,index)=>({...layer,characterIndex:layer.characterIndex??layer.index,index}))},participating:participating.filter(Boolean).length,transitions};
}

// Shared and exclusive courses on the same native chart must become one
// region before toolpath construction. Repeated pitch arithmetic can differ by
// floating-point rounding; exact serialized slice keys are only a fast lookup.
function sameLayerChart(a,b){
  if(a.kind!==b.kind)return false;
  const close=(x,y,tolerance)=>x.every((v,k)=>Math.abs(v-y[k])<=tolerance);
  if(a.kind==='plane')return close(a.origin,b.origin,ROUNDING_MM)&&
    close(a.normal,b.normal,ROUNDING_RELATIVE)&&close(a.xAxis,b.xAxis,ROUNDING_RELATIVE);
  if(a.kind==='patch'&&a.referencePatch===b.referencePatch)return close(a.translation,b.translation,ROUNDING_MM);
  return sliceKey(a)===sliceKey(b);
}

function sharedStack(source,pitchMm,bounds){
  const ratio=pitchMm/source.pitchMm,stride=Math.round(ratio),advance=pitchMm/source.meanProjection;
  if(stride>=1&&Math.abs(ratio-stride)<=ROUNDING_RELATIVE){
    const layers=source.layers.filter(layer=>(layer.referenceIndex+1)%stride===0).map((layer,index)=>({...layer,index,
      translationMm:advance,heightMm:layer.heightMm/layer.translationMm*advance,targetGapMm:pitchMm}));
    return {...source,pitchMm,translationStepMm:advance,layers};
  }
  const start=source.firstLayerMm-source.pitchMm,base=translateSlice(source.base,source.direction.map(v=>v*start/source.meanProjection));
  return sliceStack({base,direction:source.direction,pitchMm,firstLayerMm:pitchMm},bounds);
}

function prepareMaterialClaims(inputOwners,{claimAt,onProgress}){
  const explicit=inputOwners.filter(o=>o.kind==='part'&&o.within.length),groups=explicit.map(owner=>[owner]),interiors=new Map(),policies=new Map(),notes=[],reports=new Map();
  const interior=members=>{
    const key=members.map(o=>o.id).join('|');
    if(!interiors.has(key)){
      const query=claimInterior(members);
      interiors.set(key,{supported:query.supported,witness:query.supported?query.find(MIN_SHARED_CLAIM_DEPTH_MM):null});
    }
    return interiors.get(key);
  };
  const byPart=new Map();for(const owner of explicit){if(!byPart.has(owner.part))byPart.set(owner.part,[]);byPart.get(owner.part).push(owner);}
  const pairCount=[...byPart.values()].reduce((n,owners)=>n+owners.length*(owners.length-1)/2,0);let checked=0;
  for(const claimants of byPart.values())for(let i=0;i<claimants.length;i++)for(let j=i+1;j<claimants.length;j++){
    const a=claimants[i],b=claimants[j];
    onProgress?.({stage:'Checking material overlap',completed:checked++,total:pairCount,assignment:a.assignment.id});
    const query=interior([a,b]);
    if(!query.witness)continue;
    const first=groups.find(g=>g.includes(a)),second=groups.find(g=>g.includes(b));
    if(first!==second){first.push(...second);groups.splice(groups.indexOf(second),1);}
  }
  const replacements=new Map(),cadences=new Map(),frames=[];
  for(const group of groups){
    group.sort((a,b)=>explicit.indexOf(a)-explicit.indexOf(b));
    const principal=group[0],query=group.length>1?interior(group):null;
    const witness=query?.witness;
    // A connected set need not have an n-way common volume. Its first actual
    // junction supplies the reference point; each active subset is partitioned.
    let point=witness;
    if(!point)for(let i=0;i<group.length&&!point;i++)for(let j=i+1;j<group.length&&!point;j++){
      point=interior([group[i],group[j]]).witness;
    }
    if(point)onProgress?.({stage:'Resolving shared material',assignment:principal.assignment.id});
    const joint=group.length>1&&point?cadence(group,point):null;
    for(const owner of group){
      let referenceStack=owner.referenceStack,adjustment=null;
      if(joint&&owner!==principal){adjustment=retimeLayers(owner,group.filter(o=>o!==owner),joint.effectiveMm[group.indexOf(owner)],claimAt,onProgress);referenceStack=adjustment.referenceStack;}
      const adapted={...owner,referenceStack};replacements.set(owner,adapted);
      if(joint){cadences.set(adapted,joint);reports.set(owner.id,{principal:principal.id,requestedLayerMm:owner.referenceStack.pitchMm,effectiveLayerMm:joint.effectiveMm[group.indexOf(owner)],
        courseCounts:Object.fromEntries(group.map((o,i)=>[o.id,joint.counts[i]])),periodMm:joint.periodMm,participatingLayers:adjustment?.participating??null,transitionLayers:adjustment?.transitions??0,
        jointGeometry:'principal-reference shared courses'});}
    }
    if(joint)frames.push({members:group.map(owner=>replacements.get(owner)),principal:replacements.get(principal),joint,witness:point});
  }
  const owners=inputOwners.map(owner=>replacements.get(owner)??owner),original=new Map(owners.map((owner,i)=>[owner,inputOwners[i]]));
  const policy=members=>{
    const key=members.map(o=>o.id).join('|');if(policies.has(key))return policies.get(key);
    const originals=members.map(o=>original.get(o)),principal=members[0],query=interior(originals);
    const result={principal,members,interlock:false};policies.set(key,result);
    if(!query.witness){
      notes.push(`Shared material ${key}: overlap is assigned solely to ${principal.id}; ${query.supported?`minimum shared-claim depth ${MIN_SHARED_CLAIM_DEPTH_MM} mm could not be established`:'the native claim has no interior-depth query'}.`);
      return result;
    }
    const frame=frames.find(frame=>frame.members.includes(principal)),stack=frame?.principal.referenceStack??principal.referenceStack,normal=stack.base.kind==='plane'?stack.base.normal:stack.direction,joint=cadences.get(principal)??cadence(originals,query.witness);
    Object.assign(result,{interlock:true,stack,bandMm:joint.periodMm,startMm:stack.firstLayerMm-stack.pitchMm,ray:prepareSliceRay(stack.base,stack.direction),normal});
    return result;
  };
  const mask=(region,layer,rule,owner)=>{
    const index=rule.members.indexOf(owner),stack=rule.stack,extent=chartBounds(region);
    if(layer.sharedHeightMm!==undefined)return modulo(Math.floor((layer.sharedHeightMm-rule.startMm-ROUNDING_MM)/rule.bandMm),rule.members.length)===index?region:[];
    if(sliceKey(owner.referenceStack.base)===sliceKey(stack.base)&&owner.referenceStack.direction.every((v,k)=>v===stack.direction[k])){
      const height=layer.offsetMm*stack.meanProjection;
      return modulo(Math.floor((height-rule.startMm-ROUNDING_MM)/rule.bandMm),rule.members.length)===index?region:[];
    }
    if(stack.base.kind==='plane'&&layer.slice.kind==='plane'){
      const axis=stack.base.normal,origin=dot(axis,stack.base.origin),points=region.flat().map(uv=>dot(axis,evaluateSurface(layer.slice,uv).point)-origin),low=Math.min(...points),high=Math.max(...points);
      const first=Math.floor((low-rule.startMm-ROUNDING_MM)/rule.bandMm),last=Math.floor((high-rule.startMm-ROUNDING_MM)/rule.bandMm);
      if(first===last)return modulo(first,rule.members.length)===index?region:[];
      let kept=[];
      for(let band=first;band<=last;band++)if(modulo(band,rule.members.length)===index){
        const cut=volumeSection({kind:'slab',axis,fromMm:origin+rule.startMm+band*rule.bandMm,toMm:origin+rule.startMm+(band+1)*rule.bandMm},layer,extent);
        kept=union(kept,cut===null?region:intersect(region,cut));
      }
      return kept;
    }
    const step=Math.min(...rule.members.map(o=>o.widthMm/4),rule.bandMm/4);
    const selected=uv=>{
      const hits=sliceRayIntersections(rule.ray,evaluateSurface(layer.slice,uv).point);
      // The partition remains total where a finite reference does not cover it.
      if(!hits.length){if(!rule.uncovered){notes.push(`Shared material ${rule.members.map(o=>o.id).join('|')}: material beyond the principal reference is assigned solely to ${rule.principal.id}.`);rule.uncovered=true;}return index===0;}
      const height=Math.min(...hits.map(hit=>hit.distanceMm))*stack.meanProjection;
      return modulo(Math.floor((height-rule.startMm-ROUNDING_MM)/rule.bandMm),rule.members.length)===index;
    };
    return intersect(region,sampledChartRegion(extent,sliceChartStep(layer.slice,step),selected,{surface:layer.slice}));
  };
  return {owners,notes,reports,frames,allocate(region,claims,{owner,retainUnclaimed,layer,joint=false}){
    let cells=[{region,members:[]}];
    for(const claim of claims){
      const next=[];
      for(const cell of cells){
        const inside=claim.region===null?cell.region:intersect(cell.region,claim.region),outside=claim.region===null?[]:difference(cell.region,claim.region);
        if(inside.length)next.push({region:inside,members:[...cell.members,claim.owner]});
        if(outside.length)next.push({region:outside,members:cell.members});
      }
      cells=next;
    }
    let kept=[];
    for(const cell of cells){
      if(!cell.members.length){if(retainUnclaimed&&!joint)kept=union(kept,cell.region);continue;}
      if(!cell.members.includes(owner))continue;
      if(cell.members.length===1){if(!joint)kept=union(kept,cell.region);continue;}
      const rule=policy(cell.members);
      if(rule.interlock){if(joint)kept=union(kept,mask(cell.region,layer,rule,owner));}
      else if(!joint&&rule.principal===owner)kept=union(kept,cell.region);
    }
    return kept;
  }};
}

import {prepareSection,section} from '../section.mjs';
import {lineSpacing} from '../../path/spacing.mjs';
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
export function prepareMaterialRegions(inputOwners, { bands = [], substrate = null, onProgress } = {}) {
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
  const claimAt=(owner,layer)=>{const own=material(owner,layer.slice),cut=volume(owner,layer);return cut===null?own:intersect(own,cut);};
  onProgress?.({stage:'Checking material overlap'});
  const shared=prepareMaterialClaims(inputOwners,{claimAt,onProgress}),owners=shared.owners;
  const explicit = owners.filter(o => o.kind === 'part' && o.within.length), results = [];
  const characterAt=(owner,point)=>{
    const ray=cached('ray|'+owner.id,()=>prepareSliceRay(owner.referenceStack.base,owner.referenceStack.direction)),hits=sliceRayIntersections(ray,point);
    const offset=hits.length?hits[0].distanceMm:0,nominal=owner.referenceStack.layers;
    if(!nominal.length)return {characterIndex:0,ownerOffsetMm:offset};
    const nearest=nominal.reduce((best,candidate)=>Math.abs(candidate.offsetMm-offset)<Math.abs(best.offsetMm-offset)?candidate:best,nominal[0]);
    return {characterIndex:nearest.characterIndex??nearest.index,ownerOffsetMm:offset};
  };
  let done = 0;
  const total = owners.reduce((n, o) => n + o.referenceStack.layers.length, 0);
  for (const principal of owners) {
    try{
    const referenceStack = principal.referenceStack, layers = [], materialMasks = new Map(), findings = [];
    for (const layer of referenceStack.layers) {
      onProgress?.({ stage: 'Slicing layers', completed: done++, total });
      const own = material(principal, layer.slice);
      materialMasks.set(layer.index, own);
      findings.push({ layer, cut: partCut(principal, layer.slice) });
      if (!own.length) continue;
      const candidates = explicit.filter(o => o.part === principal.part);
      let region, boundary = own;
      if (principal.kind === 'outline') {
        boundary = partSection(principal, layer.slice);
        region = difference(offsetRegion(boundary, (Array.isArray(principal.assignment.loops)?Math.max(...principal.assignment.loops):principal.assignment.loops) * lineSpacing(principal.widthMm, principal.assignment)), boundary);

      } else {
        region = shared.allocate(own, candidates.map(owner => ({ owner, region: volume(owner, layer) })), { owner:principal, retainUnclaimed: !principal.within.length,layer });
        if (!region.length) continue;
      }
      // A patch slice reaching its own edge stops inside the material: it prints what it covers.
      const authoredBoundary=principal.shell.kind==='chart-prism'&&layer.slice.referencePatch===principal.shell.reference.referencePatch;
      if(!authoredBoundary)findings.push({ layer, edges: sliceBoundaryEdges(layer.slice,region), region });
      layers.push({ ...layer, region, material: boundary, outward: principal.kind === 'outline',...(partCut(principal,layer.slice).report?{sectionReport:partCut(principal,layer.slice).report}:{}) });
    }
    const notes = sectionNotes(principal.assignment.id, findings);
    const sharedReport=shared.reports.get(principal.id);
    const grid=[...materialMasks].map(([index,region])=>({index,region}));
    for(const layer of layers){layer.materialGrid={layers:grid,index:layer.index};layer.characterIndex??=layer.index;layer.ownerOffsetMm=layer.offsetMm;
      layer.referenceFrame={base:referenceStack.base,direction:referenceStack.direction,offsetMm:layer.offsetMm};}
    if (layers.length || notes.length || sharedReport) results.push({ owner: principal, referenceStack, stackId: principal.id, layers, material: materialMasks, substrate, notes,sharedReport });
    }catch(error){failedSlicePreparation(principal.assignment,error);}
  }
  for(const frame of shared.frames){
    const source=frame.principal.referenceStack,start=source.firstLayerMm-source.pitchMm;
    const frameHits=sliceRayIntersections(prepareSliceRay(source.base,source.direction),frame.witness);
    for(const [member,owner] of frame.members.entries()){
      try{
      const record=results.find(result=>result.owner===owner),pitch=frame.joint.periodMm/frame.joint.counts[member];
      const stack=sharedStack(source,pitch,owner.shell.bounds);
      const grid=[],added=[];
      for(const layer of stack.layers){
        onProgress?.({stage:'Preparing shared courses',assignment:owner.assignment.id,completed:layer.index,total:stack.layers.length});
        const own=material(owner,layer.slice);grid.push({index:layer.index,region:own});if(!own.length)continue;
        const jointLayer={...layer,sharedHeightMm:stack.base===source.base?layer.offsetMm*stack.meanProjection:start+layer.offsetMm*stack.meanProjection};
        const region=shared.allocate(own,explicit.filter(other=>other.part===owner.part).map(other=>({owner:other,region:volume(other,layer)})),{owner,layer:jointLayer,joint:true});
        if(!region.length)continue;
        const point=evaluateSurface(layer.slice,frameHits[0]?.chartPoint??region[0][0]).point;
        added.push({...jointLayer,region,material:own,sharedMaterial:true,patternDirection:owner.referenceStack.direction,
          ...characterAt(owner,point),materialGrid:{layers:grid,index:layer.index},
          referenceFrame:{base:source.base,direction:source.direction,offsetMm:jointLayer.sharedHeightMm/source.meanProjection}});
      }
      const same=new Map(record.layers.map(layer=>[sliceKey(layer.slice),layer]));
      for(const layer of added){
        const compatible=candidate=>Math.abs(candidate.translationMm-layer.translationMm)<=ROUNDING_MM&&
          candidate.characterIndex===layer.characterIndex&&sameLayerChart(candidate.slice,layer.slice);
        const exact=same.get(sliceKey(layer.slice)),existing=exact&&compatible(exact)?exact:record.layers.find(compatible);
        if(existing)existing.region=union(existing.region,layer.region);
        else record.layers.push(layer);
      }
      record.layers.sort((a,b)=>a.ownerOffsetMm-b.ownerOffsetMm);
      record.layers=record.layers.map((layer,index)=>({...layer,index}));
      record.referenceStack={...record.referenceStack,layers:record.layers};
      }catch(error){failedSlicePreparation(owner.assignment,error);}
    }
  }
  for(const part of new Set(shared.frames.map(frame=>frame.principal.part))){
    const records=results.filter(record=>record.owner.part===part&&record.owner.kind==='part'),partOwners=records.map(record=>record.owner);
    const solids=[...new Set(partOwners.flatMap(owner=>[owner.shell,...owner.within.filter(v=>v.kind==='geometry').map(v=>v.geometry)]))];
    const slabs=[...partOwners.flatMap(owner=>owner.within.filter(v=>v.kind==='slab')),...bands.filter(b=>b.part===part).map(b=>({fromMm:b.startMm,toMm:b.endMm}))];
    const boundaries=boundaryCaps(solids,{slabs,bounds:partOwners[0].shell.bounds});
    for(const record of records){
      const owner=record.owner;
      if(owner.assignment.fillOrder){record.notes.push(`Slice ${owner.assignment.id}: boundary courses retain nominal clipping for this chart-bound fill order.`);continue;}
      const frame=shared.frames.find(frame=>frame.members.includes(owner));
      const regimes=[{joint:false,direction:owner.referenceStack.direction,advanceMm:owner.referenceStack.layers.reduce((n,layer)=>Math.max(n,layer.translationMm),owner.referenceStack.translationStepMm)}];
      if(frame)regimes.push({joint:true,direction:frame.principal.referenceStack.direction,advanceMm:frame.joint.periodMm/frame.joint.counts[frame.members.indexOf(owner)]/frame.principal.referenceStack.meanProjection});
      const at=(slice,joint)=>shared.allocate(material(owner,slice),explicit.filter(other=>other.part===part).map(other=>({owner:other,region:volume(other,{slice,index:-1})})),{owner,layer:{slice,index:-1},retainUnclaimed:!owner.within.length,joint});
      const added=[];
      for(const regime of regimes)for(const face of boundaries.faces){
        const projection=dot(face.slice.normal,regime.direction);if(Math.abs(projection)<=ROUNDING_RELATIVE)continue;
        const slice=projection<0?planeSlice({origin:face.slice.origin,normal:face.slice.normal.map(v=>-v)}):face.slice;
        const footprint=projection<0?face.region.map(loop=>loop.map(uv=>{
          const delta=evaluateSurface(face.slice,uv).point.map((v,k)=>v-slice.origin[k]);return [dot(delta,slice.xAxis),dot(delta,slice.yAxis)];
        }).toReversed()):face.region;
        const probe=2*PRINT_RESOLUTION_MM/Math.abs(projection),before=translateSlice(slice,regime.direction.map(v=>-v*probe)),after=translateSlice(slice,regime.direction.map(v=>v*probe));
        const region=intersect(footprint,difference(at(before,regime.joint),at(after,regime.joint)));if(!region.length)continue;
        const point=evaluateSurface(slice,region[0][0]).point,character=characterAt(owner,point),settings=owner.assignment.sliceOverrides?.[character.characterIndex]??owner.assignment;
        const grid=[];
        for(let index=-(settings.solidBottom??owner.assignment.solidBottom);index<=(settings.solidTop??owner.assignment.solidTop);index++)grid.push({index,region:material(owner,translateSlice(slice,regime.direction.map(v=>v*regime.advanceMm*index)))});
        added.push({index:-1,slice,region,material:material(owner,slice),direction:regime.direction,translationMm:regime.advanceMm,heightMm:regime.advanceMm*Math.abs(projection),
          ...character,materialGrid:{layers:grid,index:0},patternDirection:owner.referenceStack.direction,boundaryCourse:true,referenceFrame:{base:slice,direction:regime.direction,offsetMm:0}});
      }
      const before=record.layers.length;
      for(const layer of added){
        // Closing faces supplement native courses; a coincident course is not
        // its own predecessor. Compare coverage in the closing face's chart.
        for(const existing of record.layers){
          const a=existing.slice,b=layer.slice;
          if(a.kind!=='plane'||b.kind!=='plane'||a.normal.some((v,k)=>Math.abs(v-b.normal[k])>ROUNDING_RELATIVE)||
            Math.abs(dot(a.normal,a.origin.map((v,k)=>v-b.origin[k])))>ROUNDING_MM)continue;
          const covered=existing.region.map(loop=>loop.map(uv=>{
            const delta=evaluateSurface(a,uv).point.map((v,k)=>v-b.origin[k]);
            return [dot(delta,b.xAxis),dot(delta,b.yAxis)];
          }));
          layer.region=difference(layer.region,covered);
          if(!layer.region.length)break;
        }
        if(layer.region.length)record.layers.push(layer);
      }
      record.layers.sort((a,b)=>a.ownerOffsetMm-b.ownerOffsetMm);
      record.layers=record.layers.map((layer,index)=>({...layer,index}));record.referenceStack={...record.referenceStack,layers:record.layers};
      if(record.layers.length>before)record.sharedReport={...record.sharedReport,boundaryCourses:record.layers.length-before};
    }
    const references=records.flatMap(record=>record.layers.map(layer=>({id:record.owner.id+':'+layer.index,slice:layer.slice,region:layer.region,frame:layer.referenceFrame})));
    for(const record of records)for(const layer of record.layers)layer.gap={advanceMm:layer.translationMm,direction:layer.direction,
      substrate:layer.onSubstrate||record.owner.assignment.contact?null:substrate,references,referenceId:record.owner.id+':'+layer.index,
      requiresReference:layer.boundaryCourse??false,sampleStepMm:Math.min(record.owner.assignment.sampleStepMm,record.owner.widthMm/2)};
    if(boundaries.report.curvedFaces&&records.length)records[0].notes.push(`Shared material: ${boundaries.report.curvedFaces} exterior boundary surface(s) retain nominal clipping; their closing courses are not yet resolved.`);
  }
  if(results.length)results[0].notes.push(...shared.notes);
  return results.filter(record=>record.layers.length||record.notes.length);
}

function sectionNotes(id, findings) {
  const at = (layer, point) => { const p = evaluateSurface(layer.slice, point).point; return `X ${p[0].toFixed(1)} Y ${p[1].toFixed(1)} Z ${p[2].toFixed(2)}`; };
  const notes = [], open = findings.filter(f => f.cut?.open.length), edged = findings.filter(f => f.edges?.length);
  if (open.length) {
    const items = open.flatMap(f => f.cut.open.map(item => ({ ...item, layer: f.layer })));
    const widest = kind => items.filter(i => i.kind === kind).reduce((a, b) => !a || b.sizeMm > a.sizeMm ? b : a, null);
    const joined = widest('joined'), dropped = widest('dropped');
    notes.push(`Slice ${id}: the part's section did not close at ${open.length} layer(s), indices ${open[0].layer.index} to ${open.at(-1).layer.index}; those layers print only what closes.` +
      (joined ? ` ${items.filter(i => i.kind === 'joined').length} gap(s) up to the line width were joined, widest ${joined.sizeMm.toFixed(2)} mm at ${at(joined.layer, joined.point)}.` : '') +
      (dropped ? ` ${items.filter(i => i.kind === 'dropped').length} open piece(s) were left out, longest ${dropped.sizeMm.toFixed(1)} mm at ${at(dropped.layer, dropped.point)}; the geometry is open there.` : ''));
  }
  if (edged.length) {
    const first = edged[0], point = first.region.flat().find(p => sliceBoundaryEdges(first.layer.slice, [[p]]).length);
    notes.push(`Slice ${id}: ${edged.length} layer(s), ${first.layer.index} to ${edged.at(-1).layer.index}, reach the reference's ${[...new Set(edged.flatMap(f => f.edges))].join(', ')} edge inside the part, first at ${at(first.layer, point)}; material beyond it is not printed. Extend the reference to fully cross the part.`);
  }
  return notes;
}
