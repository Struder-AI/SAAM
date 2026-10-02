// Address prepared material partitions without changing the reviewed outer shape.
// Whole-component selections remain the default; partitions are opt-in regions.
export function geometrySelections(geometry){
  const result=new Map();
  const append=(owner,shape,xMm=0,yMm=0,zMm=0)=>{
    result.set(owner,{geometry:shape,xMm,yMm,zMm,owner,material:null});
    if(!shape.materialParts)return;
    for(const part of shape.materialParts??[]){
      const key=(owner===null?'':owner+'/')+part.id;
      result.set(key,{geometry:part.geometry??shape.base,xMm,yMm,zMm,owner,material:part.id,
        detailsFrom:part.id==='base'?shape:null});
    }
  };
  if(geometry.shape==='assembly')for(const part of geometry.parts)append(part.id,part.geometry,part.xMm,part.yMm,part.zMm);
  else append(null,geometry);
  return result;
}
