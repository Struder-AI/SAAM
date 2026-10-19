// One assignment's construction failing is that assignment's
// failure, named with its error.
export class AssignmentFailure extends Error {
  constructor(node,error){super(error.message,{cause:error});this.assignment=node.sourceId??node.key;this.family=node.kind;}
}
export function assignmentWork(node,work){
  try{return work();}catch(error){throw error instanceof AssignmentFailure||error.name==='AbortError'?error:new AssignmentFailure(node,error);}
}

const INTERNAL_ERRORS=['TypeError','RangeError','ReferenceError','SyntaxError'];
export const assignmentFailureNote=({assignment,family,cause})=>`${family[0].toUpperCase()+family.slice(1)} ${assignment} produced nothing: ${INTERNAL_ERRORS.includes(cause.name)
  ?`internal error (${cause.name}: ${cause.message}); this is a SAAM bug, report it with saam call report_bug`:cause.message}`;
