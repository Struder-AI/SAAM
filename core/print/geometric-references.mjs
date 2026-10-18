// Geometry selection reads saved edges and prepared Slice regions. Completion
// intent is a separate symbolic value; no deposition is constructed or queried.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {compileRecipe} from './plan.mjs';
import {preparePathGeometry,prepareModelGeometry} from './generate.mjs';
import {prepareSliceContexts,prepareOwnedSliceRegions} from './slice-material.mjs';
import {prepareReferenceSliceStack} from './slice-stacks.mjs';
import {assignmentGeneration} from './assignment-generation.mjs';
import {operationPrerequisite} from './operation-references.mjs';
import {evaluateSurface} from '../geom/surface-evaluation.mjs';
import {sampleSpatialCurve} from '../geom/spatial-curve.mjs';
import {affineSurface} from '../geom/affine-surface.mjs';

export async function preparedSlices(input,{assignment,part}){
  requireThat(typeof assignment==='string'&&assignment.length,'Choose a geometric Slice assignment.');
  const compiled=compileRecipe(input),plan=compiled.plan,selected=plan.slices.assignments.find(a=>a.id===assignment);
  requireThat(selected&&!selected.construction&&!selected.join,'Choose an ordinary Slice assignment: '+assignment+'.');
  if(selected.surface.kind==='terminal')throw Error('Deprecated deposition-boundary selector: '+assignment+'.');
  const geometry=await preparePathGeometry(plan),prepared=await prepareModelGeometry(plan,geometry);
  const generation=assignmentGeneration(compiled.intent,compiled.failures);
  generation.admit({...prepared,failures:[...prepared.processFailures,...prepared.geometryFailures]});
  requireThat(!generation.hasFailed(assignment),generation.notes().join(' '));
  const retained=generation.retain(prepared.plan),active=records=>records.filter(record=>!generation.hasFailed(record.sourceId));
  const sliced=prepareSliceContexts({...prepared,plan:retained,bands:active(prepared.bands),geometryCuts:active(prepared.geometryCuts),solidVolumes:active(prepared.solidVolumes)});
  const contexts=sliced.contexts.filter(record=>record.owner.assignment.id===assignment&&(part===undefined||record.owner.part===part));
  requireThat(contexts.length===1,'Select one Slice stack and its part.');
  const record=contexts[0].reference?prepareOwnedSliceRegions(prepareReferenceSliceStack(contexts[0])):contexts[0];
  return {assignment,part:record.owner.part,process:record.context.process,notes:[...prepared.notes,...sliced.notes,...generation.notes()],
    layers:record.spec.layers.map(layer=>({index:layer.index,slice:layer.slice,region:layer.region,direction:layer.direction,
      translationMm:layer.translationMm,heightMm:layer.heightMm}))};
}

export async function geometricEdges(plan,queries,{includeGeometry=true}={}){
  requireThat(Array.isArray(queries)&&queries.length,'Select saved geometric edges or Slice boundaries.');
  const edges=[],notes=[],stacks=new Map();
  for(const query of queries){
    if(query?.assignment||query?.repetition!==undefined||query?.edge)throw Error('Deprecated deposition-edge selector: '+(query.assignment??'edge')+'.');
    requireThat(query&&Object.keys(query).every(key=>['geometry','part','slice','loop','normal','readiness'].includes(key))&&
      (query.part===undefined||query.part===null||typeof query.part==='string')&&
      (query.readiness===undefined||operationPrerequisite(query.readiness))&&
      (query.normal===undefined||Array.isArray(query.normal)&&query.normal.length===3&&query.normal.every(Number.isFinite)&&Math.hypot(...query.normal)>0),'Select geometry or a Slice boundary, with optional symbolic readiness.');
    if(query.geometry){
      requireThat(!query.slice&&query.loop===undefined&&typeof query.geometry==='string','Select a saved geometry curve by id.');
      const curve=plan.geometry?.shape==='spatial'?plan.geometry.curves?.find(curve=>curve.id===query.geometry):null;
      requireThat(curve,'Selected geometric edge is absent: '+query.geometry+'.');
      requireThat((curve.points||curve.nurbs)&&typeof curve.closed==='boolean','Select an XYZ geometry curve.');
      edges.push({selection:query,readiness:query.readiness??null,part:query.part??null,closed:curve.closed,
        ...(query.normal?{materialNormal:query.normal.map(v=>v/Math.hypot(...query.normal))}:{}),
        ...(includeGeometry?{curve:{closed:curve.closed,...(curve.points?{points:curve.points}:{nurbs:curve.nurbs})}}:{}),process:plan.process});
      continue;
    }
    const selection=query.slice;
    requireThat(query.part===undefined&&query.normal===undefined&&selection&&Object.keys(selection).every(key=>['assignment','index','part'].includes(key))&&
      typeof selection.assignment==='string'&&(selection.part===undefined||selection.part===null||typeof selection.part==='string')&&(selection.index===undefined||Number.isSafeInteger(selection.index)&&selection.index>=0)&&
      (query.loop===undefined||Number.isSafeInteger(query.loop)&&query.loop>=0),'Select a Slice assignment, optional native index/part and boundary loop.');
    const key=JSON.stringify([selection.assignment,selection.part]);
    if(!stacks.has(key))stacks.set(key,await preparedSlices(plan,selection));
    const stack=stacks.get(key);notes.push(...stack.notes);let found=0;
    for(const layer of stack.layers){
      if(selection.index!==undefined&&layer.index!==selection.index)continue;
      for(const [loop,points] of layer.region.entries()){
        if(query.loop!==undefined&&loop!==query.loop)continue;
        const chosen={slice:{assignment:stack.assignment,index:layer.index,part:stack.part},loop};
        const mapped=includeGeometry?(affineSurface(layer.slice)?points.map(point=>evaluateSurface(layer.slice,point).point):
          sampleSpatialCurve({points,closed:true,surface:layer.slice},
            {toleranceMm:stack.process.planarWallToleranceMm??PRINT_RESOLUTION_MM,sampleStepMm:stack.process.lineWidthMm/2}).samples.slice(0,-1).map(sample=>sample.point)):null;
        edges.push({selection:chosen,part:stack.part,readiness:query.readiness??chosen.slice,closed:true,
          ...(mapped?{curve:{closed:true,points:mapped}}:{}),
          materialNormal:evaluateSurface(layer.slice,points[0]).normal,heightMm:layer.heightMm,process:stack.process});found++;
      }
    }
    requireThat(found,'No geometric Slice boundary matches '+JSON.stringify(query)+'.');
  }
  return {edges,notes:[...new Set(notes)]};
}

export async function selectEdge(plan,selection){
  const {edges}=await geometricEdges(plan,[selection]);
  requireThat(edges.length===1,'Select one geometric edge or Slice boundary.');return edges[0];
}
