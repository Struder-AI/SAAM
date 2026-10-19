// Membrane and general bridging share the same geometric-edge construction.
export async function editEdgeBridge(source,request,{Recipe}){
  if(!Recipe?.constructEdgePaths)throw Error('Bridging needs the common geometric-edge construction interface.');
  if(source.slices?.assignments?.some(assignment=>assignment.id===request.id))throw Error('The bridge id already exists.');
  const made=await Recipe.constructEdgePaths({...request,mode:'span'});
  return {assignmentRequests:[...(source.slices?.assignments??[]),made.assignment],report:made.report};
}
