// Address prepared material partitions without changing the reviewed outer shape.
// Whole-component selections remain the default; partitions are opt-in regions.
export function geometrySelections(geometry){
  if(geometry?.shape==='spatial')return geometry.solid?geometrySelections(geometry.solid):new Map();
  const result=new Map();
  const append=(owner,shape,xMm=0,yMm=0,zMm=0)=>{
    // A repeated component id selects the first component with it.
    if(result.has(owner))return;
    result.set(owner,{geometry:shape,xMm,yMm,zMm,owner,material:null});
    if(!shape.materialParts)return;
    for(const part of shape.materialParts??[]){
      const key=(owner===null?'':owner+'/')+part.id;
      result.set(key,{geometry:part.geometry??shape.base,xMm,yMm,zMm,owner,material:part.id,
        detailsFrom:part.id==='base'?shape:null});
    }
  };
  if(geometry.shape==='assembly')for(const part of assemblyComponents(geometry.parts))append(part.id,part.geometry,part.xMm,part.yMm,part.zMm);
  else append(null,geometry);
  return result;
}

// One level of components: a nested assembly's component inner within outer
// is outer/inner at their summed offsets.
export function assemblyComponents(parts,prefix='',offset=[0,0,0]){
  return parts.flatMap(part=>{
    if(!part||typeof part!=='object')return [];
    const id=prefix?prefix+part.id:part.id,at=[part.xMm,part.yMm,part.zMm].map((value,i)=>value+offset[i]);
    if(part.geometry?.shape==='assembly'&&Array.isArray(part.geometry.parts))return assemblyComponents(part.geometry.parts,id+'/',at);
    return [{...part,id,xMm:at[0],yMm:at[1],zMm:at[2]}];
  });
}
