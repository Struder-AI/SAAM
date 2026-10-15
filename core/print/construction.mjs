// Application prepares material ownership, retries failed assignments, and calls Toolpath.
import {prepareSliceContexts} from './slice-material.mjs';
import {AssignmentFailure,constructDepositionResults} from './slice-deposition.mjs';
import {prepareDepositionWork} from './deposition-work.mjs';

// A language error is a SAAM bug, still reported as the assignment's.
const INTERNAL_ERRORS=['TypeError','RangeError','ReferenceError','SyntaxError'];
const failureNote=({assignment,family,cause})=>`${family[0].toUpperCase()+family.slice(1)} ${assignment} produced nothing: ${INTERNAL_ERRORS.includes(cause.name)
  ?`internal error (${cause.name}: ${cause.message}); this is a SAAM bug, report it with saam call report_bug`:cause.message}`;

// Deposition of every assignment. A failing assignment produces nothing and
// says why; the print is generated again without it, so what the others
// deposit never depends on its partial work. -> {results,
// summary, notes}: notes are the slice stacks' notes, each result's report
// notes (such as its contact spans) and each failure.
export function finalizedSliceResults(args){
  const failures=[];
  for(;;){
    try{return finalizeAssignments(args,failures);}catch(error){
      if(error.name==='AbortError'||!error.assignment||failures.some(failure=>failure.assignment===error.assignment))throw error;
      const failure=error instanceof AssignmentFailure?error:new AssignmentFailure({sourceId:error.assignment,kind:'slice'},error);
      args.onProgress?.({stage:'Deposition failed',assignment:failure.assignment,family:failure.family,error:{name:failure.cause.name,message:failure.cause.message,stack:failure.cause.stack}});
      failures.push(failure);
    }
  }
}
function finalizeAssignments(args,failures){
  const excluded=new Set(failures.map(failure=>failure.assignment));
  const plan={...args.plan,slices:{...args.plan.slices,assignments:args.plan.slices.assignments.filter(a=>!excluded.has(a.id))}};
  const sliced=prepareSliceContexts({...args,plan,bands:(args.bands??[]).filter(band=>!excluded.has(band.sourceId)),
    geometryCuts:(args.geometryCuts??[]).filter(cut=>!excluded.has(cut.sourceId)),solidVolumes:(args.solidVolumes??[]).filter(volume=>!excluded.has(volume.sourceId))});
  const contexts=sliced.contexts;
  const constructions=(args.constructions??[]).filter(context=>!excluded.has(context.assignment.id));
  const work=(args.work??[]).filter(node=>!excluded.has(node.sourceId??node.key));
  const curveSources=(args.curveSources??[]).filter(context=>!excluded.has(context.assignment.id));
  const nodes=prepareDepositionWork(contexts,constructions,work,args.workDependencies,curveSources,{plan,shells:args.shells});
  const generated=constructDepositionResults({...args,nodes,curveSources},contexts);
  const produced=generated.results,nothing=!produced.some(result=>result.operations.length);
  return {...generated,notes:[...sliced.notes,...produced.flatMap(result=>result.report?.notes??[]),...failures.map(failureNote),...(nothing?['Nothing to print: no assignment produced material.']:[])]};
}

