const requireThat=(condition,message)=>{if(!condition)throw Error(message);};


export const gridfinityTemplate=()=>({shape:'gridfinity',parameters:null,vertices:[],triangles:[]});
export function validateGridfinityRecord(record){
  requireThat(Object.keys(record).sort().join()===Object.keys(gridfinityTemplate()).sort().join(),'Unexpected gridfinity geometry fields.');
  requireThat(record.parameters,'Gridfinity geometry needs its parameters. Rebuild with the gridfinity skill.');
}
export const gridfinityRecordRuntime=()=>({validate:validateGridfinityRecord});
