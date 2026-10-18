// Manufactured reference readiness comes from nominal slice ownership, never
// finalized deposition paths. Artificial references have no prerequisites.
import {prepareSliceMaterial,sliceMaterialTouches} from '../geom/slice-material.mjs';
import {clipLineToRegion} from '../geom/curve-region.mjs';
import {sampleSpatialCurve} from '../geom/spatial-curve.mjs';
import {surfaceRegion} from '../geom/surface-region.mjs';
import {surfaceChartBounds,surfaceChartStep} from '../region/surface-operations.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {referenceSurface} from '../geom/reference-surface.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';

const sliceMaterials=new WeakMap();

export function manufacturedSurfaceReadiness(contexts,footprints,{part=null,exclude=null,sampleStepMm=.2}={}){
  const required=[];
  for(const record of contexts){
    if(record.owner.part!==part||record.owner.assignment.id===exclude)continue;
    // Native construction order includes every earlier slice. One greatest
    // touched slice is sufficient for this producer, including empty gaps.
    let last;
    for(const layer of record.spec.layers){
      let cached=sliceMaterials.get(layer);
      if(!cached||cached.sampleStepMm!==sampleStepMm){cached={sampleStepMm,material:prepareSliceMaterial(layer,{sampleStepMm})};sliceMaterials.set(layer,cached);}
      const material=cached.material;
      if(footprints.some(points=>sliceMaterialTouches(material,points)))last=layer;
    }
    if(last)required.push({assignment:record.owner.assignment.id,part,index:last.index});
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
export function surfaceFootprints(surface,region,{sampleStepMm=.2}={}){
  const bounds=surfaceChartBounds(surface,region.flat()),steps=surfaceChartStep(surface,bounds,sampleStepMm);
  const counts=bounds.map(([a,b],k)=>Math.max(1,Math.ceil((b-a)/steps[k])));
  return Array.from({length:counts[0]+1},(_,i)=>{
    const u=bounds[0][0]+(bounds[0][1]-bounds[0][0])*i/counts[0];
    const clipped=clipLineToRegion([u,0],[0,1],region,{range:bounds[1]});
    return [...clipped.spans,...clipped.contacts].map(([a,b])=>{
      const count=Math.max(1,Math.ceil((b-a)/steps[1]));
      return Array.from({length:count+1},(_,j)=>evaluateSurface(surface,[u,a+(b-a)*j/count]).point);
    });
  }).flat();
}

export function referenceSliceReadiness(record,contexts){
  if(!record.reference||record.reference.selection.kind==='terminal')return record.prerequisites??[];
  const surface=surfaceRegion(record.context.shell,record.reference.selection);
  return manufacturedSurfaceReadiness(contexts,surfaceFootprints(surface,[[[0,0],[1,0],[1,1],[0,1]]],record.spec.settings),
    {part:record.owner.part,exclude:record.owner.assignment.id,sampleStepMm:record.spec.settings.sampleStepMm});
}
