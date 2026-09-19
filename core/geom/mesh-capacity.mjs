// Index capacity is a representational limit of the indexed mesh arrays, not a
// work budget: no stage refuses a mesh because an estimate of its working set
// looked large. A real allocation failure is reported with its stage and size.
export function checkMeshCapacity(vertices,triangles){
  if(!Number.isSafeInteger(vertices)||!Number.isSafeInteger(triangles)||vertices<0||triangles<0||vertices>0x7ffffffe||triangles>0x3ffffffe)throw Error('Mesh index capacity exceeded.');
}
export function meshAllocationError(error,stage,vertices,triangles){
  if(!(error instanceof RangeError))return error;
  return Object.assign(Error(`${stage} could not allocate memory for ${triangles} triangles and ${vertices} vertices (${error.message}). Run with a larger --max-old-space-size or on a machine with more RAM; geometry is never simplified automatically.`),{code:'MESH_MEMORY_EXHAUSTED',vertices,triangles,cause:error});
}
export function meshAllocation(stage,vertices,triangles,allocate){
  try{return allocate();}catch(error){throw meshAllocationError(error,stage,vertices,triangles);}
}
