// Membrane and general bridging share the same geometric-edge construction. Bridging sees
// its request and SAAM's services only, and returns the one operation it adds.
export async function bridgeOperations(request,{Recipe}){
  if(!Recipe?.constructEdgePaths)throw Error('Bridging needs the common geometric-edge construction interface.');
  const made=await Recipe.constructEdgePaths({...request,mode:'span'});
  return {add:[made.assignment],report:made.report};
}
