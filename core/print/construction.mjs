// Application prepares material ownership, retries failed assignments, and calls Toolpath.
import {prepareSliceContexts} from './slice-material.mjs';
import {AssignmentFailure,constructDepositionResults} from './slice-deposition.mjs';
import {prepareDepositionWork} from './deposition-work.mjs';

import {finalizeConstructionReferences} from './construction-references.mjs';
import {assignmentGeneration} from './assignment-generation.mjs';

// Deposition of every assignment. A failing assignment produces nothing and
// says why; retries retain completed work only while its prepared inputs and
// producers remain unchanged. -> {results,
// summary, notes}: notes are the slice stacks' notes, each result's report
// notes (such as its contact spans) and each failure.
export function finalizedSliceResults(args){
  const generation=args.generation??assignmentGeneration(args.plan),retainedWork=new Map(),preparedConstructions=new Map(),preparedLayouts=new Map();
  generation.register(args.plan,args.assignmentOwners);
  for(const [id,error] of args.geometryFailures??[])generation.fail(id,error);
  for(;;){
    try{const result=finalizeAssignments({...args,generation,retainedWork,preparedConstructions,preparedLayouts});if(result)return result;}catch(error){
      if(error.name==='AbortError'||!error.assignment||generation.hasFailed(error.assignment))throw error;
      const owner=args.assignmentOwners?.get(error.assignment)??error.assignment;
      const failure=owner!==error.assignment?new AssignmentFailure({sourceId:owner,kind:error.family??'slice'},error.cause??error):error instanceof AssignmentFailure?error:new AssignmentFailure({sourceId:error.assignment,kind:'slice'},error);
      args.onProgress?.({stage:'Deposition failed',assignment:failure.assignment,family:failure.family,error:{name:failure.cause.name,message:failure.cause.message,stack:failure.cause.stack}});
      generation.fail(failure.assignment,failure);
    }
  }
}
function finalizeAssignments(args){
  const generation=args.generation,excluded=id=>generation.hasFailed(id);
  const plan=generation.retain(args.plan);
  const sliced=prepareSliceContexts({...args,plan,bands:(args.bands??[]).filter(band=>!excluded(band.sourceId)),
    geometryCuts:(args.geometryCuts??[]).filter(cut=>!excluded(cut.sourceId)),solidVolumes:(args.solidVolumes??[]).filter(volume=>!excluded(volume.sourceId))});
  const contexts=sliced.contexts;
  const constructions=(args.constructions??[]).filter(context=>!excluded(context.assignment.id));
  const work=(args.work??[]).filter(node=>!excluded(node.sourceId??node.key));
  const curveSources=(args.curveSources??[]).filter(context=>!excluded(context.assignment.id));
  const nodes=prepareDepositionWork(contexts,constructions,work,args.workDependencies,curveSources,{plan,shells:args.shells,onProgress:args.onProgress,
    preparedConstructions:args.preparedConstructions,preparedLayouts:args.preparedLayouts});
  generation.captureWork(nodes);
  if(nodes.some(node=>excluded(node.sourceId??node.key)))return null;
  const generated=constructDepositionResults({...args,nodes,curveSources},contexts);
  const produced=finalizeConstructionReferences(plan,generated.results);
  if(produced.some(result=>excluded(result.report?.owner??result.id)))return null;
  const nothing=!produced.some(result=>result.operations.length);
  return {...generated,results:produced,notes:[...sliced.notes,...produced.flatMap(result=>result.report?.notes??[]),...generation.notes(),...(nothing?['Nothing to print: no assignment produced material.']:[])]};
}

