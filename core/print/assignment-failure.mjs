// One assignment's construction failing is that assignment's
// failure, named with its error.
export class AssignmentFailure extends Error {
  constructor(node,error){super(error.message,{cause:error});this.assignment=node.sourceId??node.key;this.family=node.kind;}
}
export function assignmentWork(node,work){
  try{return work();}catch(error){throw error instanceof AssignmentFailure||error.name==='AbortError'?error:new AssignmentFailure(node,error);}
}
