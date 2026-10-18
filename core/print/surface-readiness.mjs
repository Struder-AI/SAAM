import {geometrySelections} from '../geom/selections.mjs';
// Manufactured reference readiness comes from nominal slice ownership, never
// finalized deposition paths. Artificial references have no prerequisites.
import {prepareSliceMaterial,subtractSliceMaterial,offsetSliceMaterial,clipFootprintsToBounds,triangleFootprints} from '../geom/slice-material.mjs';
import {clipLineToRegion} from '../geom/curve-region.mjs';
import {sampleSpatialCurve} from '../geom/spatial-curve.mjs';
import {surfaceRegion} from '../geom/surface-region.mjs';
import {surfaceChartBounds,surfaceChartStep} from '../region/surface-operations.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {referenceSurface} from '../geom/reference-surface.mjs';
import {difference} from '../region/intersection.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';

const sliceMaterials=new WeakMap();

export function manufacturedSurfaceReadiness(contexts,footprints,{part=null,exclude=null,sampleStepMm=.2,side='material'}={}){
  const required=[];
  for(const record of contexts){
    if(record.owner.part!==part||record.owner.assignment.id===exclude)continue;
    // Native construction order includes every earlier slice. One greatest
    // touched slice is sufficient for this producer, including empty gaps.
    let last,remaining=footprints;
    const materialAt=layer=>{
      let cached=sliceMaterials.get(layer);
      if(!cached||cached.sampleStepMm!==sampleStepMm){cached={sampleStepMm,material:prepareSliceMaterial(layer,{sampleStepMm})};sliceMaterials.set(layer,cached);}
      return cached.material;
    };
    if(side==='material')for(const layer of record.spec.layers){
      const ownership=subtractSliceMaterial(materialAt(layer),remaining);
      if(ownership.touched)last=layer;
      remaining=ownership.remaining;if(!remaining.length)break;
    }
    // An exposed CAD face can lie in a column's final unsliced remainder,
    // even when other columns continue. Upper-frontier queries consume from
    // the latest slice backwards; a later containing slab is not support for
    // a surface below it. This never claims actual bead or nozzle coverage.
    remaining=clipFootprintsToBounds(remaining,record.owner.shell?.bounds??record.context?.shell?.bounds);
    for(const layer of record.spec.layers.toReversed()){
      if(!remaining.length)break;
      const material=materialAt(layer);if(!material)continue;
      const ownership=subtractSliceMaterial(offsetSliceMaterial(material,material.advance),remaining,{boundary:side!=='upper'});
      if(ownership.touched&&(!last||layer.index>last.index))last=layer;
      remaining=ownership.remaining;
    }
    if(last)required.push(record.prerequisite??{assignment:record.owner.assignment.id,part,index:last.index});
  }
  return required;
}

export function traceSurfaceReadiness(assignment,contexts,shells){
  const edgeAfter=(assignment.edgeAfter??[]).map(entry=>({...entry,after:[...entry.after]}));
  const indices=assignment.repeat?.stack?(assignment.repeat.indices??contexts.find(record=>record.owner.assignment.id===assignment.repeat.stack)?.spec.layers.map(layer=>layer.index)):null;
  const count=indices?.length??assignment.repeat?.count??1;
  for(let repetition=0;repetition<count;repetition++){
    const index=indices?.[repetition]??repetition;
    for(const [ordinal,curve] of assignment.curves.entries()){
      if(curve.repetitions&&!curve.repetitions.includes(index))continue;
      const reference=curve.uv?.reference;if(!reference)continue;
      let required=[];
      if(reference.kind==='slice')required=[{assignment:reference.assignment,index:reference.index??index}];
      else if(reference.kind==='surface'&&['part','top'].includes(reference.surface?.kind)){
        const part=reference.part??assignment.part??null,shell=shells.find(([key])=>key===part)?.[1];
        const at=referenceSurface(reference.surface,shell),input=curve.uv;
        const {samples}=sampleSpatialCurve({points:input.points,nurbs:input.nurbs,closed:curve.closed,surface:{at}},
          {toleranceMm:PRINT_RESOLUTION_MM/2,sampleStepMm:assignment.process?.lineWidthMm??.2});
        required=manufacturedSurfaceReadiness(contexts,[samples.map(sample=>sample.point)],{part,exclude:assignment.id});
      }
      if(required.length){
        const target={assignment:assignment.id,part:assignment.part??null,repetition:assignment.repetitionIds?.[repetition]??repetition,edge:{curve:curve.id??ordinal}};
        const prior=edgeAfter.find(entry=>JSON.stringify(entry.target)===JSON.stringify(target));
        if(prior)prior.after=[...prior.after,...required];else edgeAfter.push({target,after:required});
      }
    }
  }
  return {...assignment,...(edgeAfter.length?{edgeAfter}:{})};
}

// A selected exterior region is an area, so include its interior chart rows;
// inspecting only its outline would miss independently owned material inside.
export function surfaceFootprints(surface,region,{sampleStepMm=.2,normalMm=0}={}){
  const bounds=surfaceChartBounds(surface,region.flat()),steps=surfaceChartStep(surface,bounds,sampleStepMm);
  const counts=bounds.map(([a,b],k)=>Math.max(1,Math.ceil((b-a)/steps[k])));
  return Array.from({length:counts[0]+1},(_,i)=>{
    const u=bounds[0][0]+(bounds[0][1]-bounds[0][0])*i/counts[0];
    const clipped=clipLineToRegion([u,0],[0,1],region,{range:bounds[1]});
    return [...clipped.spans,...clipped.contacts].map(([a,b])=>{
      const count=Math.max(1,Math.ceil((b-a)/steps[1]));
      return Array.from({length:count+1},(_,j)=>evaluateSurface(surface,[u,a+(b-a)*j/count],normalMm).point);
    });
  }).flat();
}

export function referenceSliceReadiness(record,contexts){
  if(!record.reference||record.reference.selection.kind==='terminal')return record.prerequisites??[];
  const surface=surfaceRegion(record.context.shell,record.reference.selection);
  return manufacturedSurfaceReadiness(contexts,surfaceFootprints(surface,[[[0,0],[1,0],[1,1],[0,1]]],record.spec.settings),
    {part:record.owner.part,exclude:record.owner.assignment.id,sampleStepMm:record.spec.settings.sampleStepMm});
}

// A finite declared contact is a manufactured surface relationship. Each
// regeneration derives current native identities; the recipe stores no stale
// slice indices and the agent supplies no operation dependency wiring.
export function contactSliceReadiness(record,contexts,plan){
  const contact=record.spec.settings.contact,explicit=contact?.source!==null&&contact?.source!==undefined;
  if(!contact?.surfaces?.length&&!explicit)return record;
  const selected=plan.geometry?geometrySelections(plan.geometry).get(record.owner.part):null;
  const placement=[selected?.xMm??0,selected?.yMm??0,selected?.zMm??0],byLayer=new Map();
  const sources=contact.surfaces??(explicit?[{source:typeof contact.source==='string'?{assignment:contact.source}:contact.source,part:record.owner.part,offsetMm:contact.offsetMm??[0,0,0]}]:[]);
  for(const surface of sources){
    if(surface.part!==record.owner.part)continue;
    const reference=surface.source,sourcePart=Object.hasOwn(reference,'part')?reference.part:record.owner.part;
    const supporting=contexts.filter(other=>other.owner.assignment.id===reference.assignment&&other.owner.part===sourcePart);
    if(!supporting.length)throw Error('Contact surface names an absent support producer or different part: '+reference.assignment);
    let remaining=surface.triangles?triangleFootprints(surface.triangles,{sampleStepMm:record.spec.settings.sampleStepMm,offset:placement}):null;
    let prior=[];
    for(const layer of record.spec.layers){
      let footprint;
      if(remaining){footprint=subtractSliceMaterial(prepareSliceMaterial(layer),remaining);remaining=footprint.remaining;}
      else {
        const region=difference(layer.region,prior);prior=layer.region;
        const depth=layer.heightMm??layer.gap?.normalMm,direction=layer.direction??layer.slice.normal;
        const points=region.length?surfaceFootprints(layer.slice,region,{...record.spec.settings,normalMm:direction?0:-depth}):[];
        footprint={touched:points.length>0,covered:direction?points.map(row=>row.map(point=>
          point.map((v,k)=>v-(layer.translationMm??depth)*direction[k]))):points};
      }
      if(!footprint.touched)continue;
      const supportFootprint=footprint.covered.map(points=>points.map(point=>point.map((v,k)=>v+surface.offsetMm[k])));
      const required=manufacturedSurfaceReadiness(supporting,supportFootprint,{part:sourcePart,side:'upper'});
      if(required.length)byLayer.set(layer.index,[...(byLayer.get(layer.index)??[]),...required]);
    }
  }
  return {...record,spec:{...record.spec,layers:record.spec.layers.map(layer=>({...layer,
    onSubstrate:layer.onSubstrate??Boolean(byLayer.has(layer.index)||typeof contact.source==='string'),
    prerequisites:[...(layer.prerequisites??[]),...(byLayer.get(layer.index)??[])]}))}};
}

// Material newly entering a native owner needs the manufactured frontier below
// it. Existing columns retain only their native predecessor, including ordinary
// body work before/after another producer's owned band.
export function nativeBaseReadiness(record,materials){
  if(record.owner.assignment.geometry||record.reference)return record;
  let prior=null;
  const layers=record.spec.layers.map(layer=>{
    const region=difference(layer.region,prior&&prior.index+1===layer.index?prior.region:[]);prior=layer;
    if(!region.length)return layer;
    const direction=layer.direction??layer.slice.normal,depth=layer.heightMm??layer.gap?.normalMm;
    const footprint=surfaceFootprints(layer.slice,region,{...record.spec.settings,normalMm:direction?0:-depth});
    const base=direction?footprint.map(row=>row.map(point=>point.map((v,k)=>v-(layer.translationMm??depth)*direction[k]))):footprint;
    const required=manufacturedSurfaceReadiness(materials,base,{part:record.owner.part,exclude:record.owner.assignment.id,side:'upper'});
    return required.length?{...layer,onSubstrate:true,firstBedLayer:false,gap:{...layer.gap,substrate:null},prerequisites:[...(layer.prerequisites??[]),...required]}:layer;
  });
  return {...record,spec:{...record.spec,layers}};
}
