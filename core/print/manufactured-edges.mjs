// Selected producer edges carry geometry and the same symbolic readiness reference.
// Source construction supplies the curves; no schedule or machine is consulted.
import {requireThat,distance} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {compileRecipe} from './plan.mjs';
import {preparePathGeometry,prepareModelInputs,generateModelResults} from './generate.mjs';
import {prepareSliceContexts} from './slice-material.mjs';
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
        const edge=native?stroke.edge:{curve:stroke.sourceCurve??stroke.id??ordinal};
        const repetition=operation.id.startsWith(query.assignment+':')?operation.id.slice(query.assignment.length+1):null;
        if(!native&&repetition===null)continue;
        const reference={assignment:query.assignment,part,...(typeof operation.layerId==='string'?{index}:{repetition}),edge};
        if(query.edge&&(Object.hasOwn(query.edge,'curve')?edge.curve!==query.edge.curve:edge.loop!==query.edge.loop||edge.ring!==(query.edge.ring??0)))continue;
        const closed=stroke.closed||distance(stroke.points[0],stroke.points.at(-1))<=PRINT_RESOLUTION_MM;
        const points=closed&&distance(stroke.points[0],stroke.points.at(-1))<=PRINT_RESOLUTION_MM?stroke.points.slice(0,-1):stroke.points;
        const nativeGeometry=stroke.nativePath?.geometry;
        const curve=nativeGeometry?.kind==='nurbs'?{closed,nurbs:{degree:nativeGeometry.degree,knots:nativeGeometry.knots,controlPoints:nativeGeometry.controlPoints,...(nativeGeometry.weights?{weights:nativeGeometry.weights}:{})}}:{closed,points};
        found.push({reference,closed,...(includeGeometry?{curve}:{}),widthMm:stroke.beadWidthMm??operation.process.lineWidthMm,
          heightMm:stroke.beadHeightMm??stroke.segmentMetadata?.[0]?.beadHeightMm??operation.process.layerMm,
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

// A saved geometry curve can define a future target without becoming printed
// work. Printed-edge selectors retain their exact manufactured prerequisite.
export async function selectEdge(plan,selection){
  if(!selection?.geometry)return selectManufacturedEdge(plan,selection);
  requireThat(Object.keys(selection).every(key=>['geometry','part'].includes(key))&&typeof selection.geometry==='string',
    'Select an existing spatial geometry curve by geometry id and optional part.');
  const curve=plan.geometry?.shape==='spatial'?plan.geometry.curves?.find(curve=>curve.id===selection.geometry):null;
  requireThat(curve,'Selected spatial geometry edge is absent: '+selection.geometry);
  requireThat((curve.points||curve.nurbs)&&typeof curve.closed==='boolean','Select a spatial XYZ curve; resolve mapped geometry to an edge first.');
  return {selection,reference:null,part:selection.part??null,closed:curve.closed,
    curve:{closed:curve.closed,...(curve.points?{points:curve.points}:{nurbs:curve.nurbs})},process:plan.process};
}

// Native nominal regions for authoring. No deposited course or schedule is read.
export async function manufacturedSlices(plan,{assignment,part}){
  requireThat(typeof assignment==='string'&&assignment.length,'Choose a native Slice producer.');
  plan=compileRecipe(plan).plan;
  const prepared=await prepareModelInputs(plan,await preparePathGeometry(plan));
  const contexts=prepareSliceContexts(prepared).contexts.filter(record=>record.owner.assignment.id===assignment&&
    (part===undefined||record.owner.part===part));
  requireThat(contexts.length===1&&!contexts[0].reference,'Choose one native Slice stack and its part.');
  const record=contexts[0];
  return {assignment,part:record.owner.part,process:record.context.process,layers:record.spec.layers.map(layer=>({
    index:layer.index,slice:layer.slice,region:layer.region,direction:layer.direction,
    translationMm:layer.translationMm,heightMm:layer.heightMm}))};
}
