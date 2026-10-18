// Selected producer edges carry geometry and the same symbolic readiness reference.
// Source construction supplies the curves; no schedule or machine is consulted.
import {requireThat,distance} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {compileRecipe} from './plan.mjs';
import {preparePathGeometry,generateModelResults} from './generate.mjs';
import {edgeReference} from './operation-references.mjs';

export async function manufacturedEdges(plan,queries,{includeGeometry=true}={}){
  requireThat(Array.isArray(queries)&&queries.length,'Select at least one producer edge or slice.');
  for(const query of queries)requireThat(query&&typeof query.assignment==='string'&&query.assignment.length&&
    Object.keys(query).every(key=>['assignment','index','repetition','part','edge'].includes(key))&&
    (query.index===undefined||Number.isSafeInteger(query.index)&&query.index>=0)&&
    (query.repetition===undefined||typeof query.repetition==='string'&&query.repetition.length||Number.isSafeInteger(query.repetition)&&query.repetition>=0)&&
    !(query.index!==undefined&&query.repetition!==undefined)&&(query.edge===undefined||edgeReference(query)),
    'Select edges by assignment, optional part and Slice index or Trace repetition.');
  plan=compileRecipe(plan).plan;
  const prepared=await preparePathGeometry(plan),model=await generateModelResults(plan,prepared),edges=[];
  for(const query of queries){
    const matching=model.results.filter(result=>(result.report.owner??result.id)===query.assignment);
    requireThat(matching.length,'Edge producer is absent: '+query.assignment);
    const found=[];
    for(const result of matching)for(const operation of result.operations){
      if(Object.hasOwn(query,'part')&&(operation.part??result.report.part??null)!==query.part)continue;
      const index=operation.ownershipIndex??operation.layer,part=operation.part??result.report.part??null;
      if(query.index!==undefined&&(typeof operation.layerId!=='string'||index!==query.index))continue;
      if(query.repetition!==undefined&&operation.id!==query.assignment+':'+query.repetition)continue;
      for(const [ordinal,stroke] of operation.strokes.entries()){
        if(stroke.stationaryExtrusion)continue;
        const native=typeof operation.layerId==='string'&&stroke.edge;
        if(typeof operation.layerId==='string'&&!native&&result.report.depositionFamily!=='trace')continue;
        const edge=native?stroke.edge:{curve:stroke.id??ordinal};
        const repetition=operation.id.startsWith(query.assignment+':')?operation.id.slice(query.assignment.length+1):null;
        if(!native&&repetition===null)continue;
        const reference={assignment:query.assignment,part,...(typeof operation.layerId==='string'?{index}:{repetition}),edge};
        if(query.edge&&(Object.hasOwn(query.edge,'curve')?edge.curve!==query.edge.curve:edge.loop!==query.edge.loop||edge.ring!==(query.edge.ring??0)))continue;
        const closed=stroke.closed||distance(stroke.points[0],stroke.points.at(-1))<=PRINT_RESOLUTION_MM;
        const points=closed&&distance(stroke.points[0],stroke.points.at(-1))<=PRINT_RESOLUTION_MM?stroke.points.slice(0,-1):stroke.points;
        const nativeGeometry=stroke.nativePath?.geometry;
        const curve=nativeGeometry?.kind==='nurbs'?{closed,nurbs:{degree:nativeGeometry.degree,knots:nativeGeometry.knots,controlPoints:nativeGeometry.controlPoints,...(nativeGeometry.weights?{weights:nativeGeometry.weights}:{})}}:{closed,points};
        found.push({reference,closed,...(includeGeometry?{curve}:{}),widthMm:stroke.beadWidthMm??operation.process.lineWidthMm,
          materialNormal:stroke.normals?.[0]??stroke.frameSamples?.[0]?.normal??stroke.segmentMetadata?.[0]?.surfaceNormal,
          process:operation.process});
      }
    }
    requireThat(found.length,'No printed edge matches '+JSON.stringify(query));edges.push(...found);
  }
  return {edges,notes:model.summary?.limitations??model.notes??[]};
}

export async function selectManufacturedEdge(plan,reference){
  requireThat(edgeReference(reference),'Select a specific Slice perimeter or Trace curve.');
  const result=await manufacturedEdges(plan,[reference]);
  requireThat(result.edges.length===1,'Selected edge was split or belongs to several components; choose an individual printed edge.');
  return result.edges[0];
}
