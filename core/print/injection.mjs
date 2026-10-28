import {pointInjectionOperation} from '../path/injection.mjs';

export function injectionAssignment({id,...options}){
  return structuredClone({id,construction:'inject',part:null,filament:null,toolIndex:null,process:null,nozzleC:null,points:[],
    dependencies:{afterParts:[],beforeParts:[],after:[]},description:'',...options});
}

export function injectionResult(assignment,{process,restoreNozzleC}){
  const operations=assignment.points.map((record,index)=>{
    return pointInjectionOperation(record,{id:`${assignment.id}:${index}`,phase:'inject',
      layer:index,layerIndex:index,layerCount:assignment.points.length,layerId:null,rank:record.point[2],
      after:[...assignment.dependencies.after,...(index?[`${assignment.id}:${index-1}`]:[])],
      ...(assignment.filament===null?{}:{filament:assignment.filament}),...(assignment.toolIndex===null?{}:{toolIndex:assignment.toolIndex}),process,restoreNozzleC,nozzleC:assignment.nozzleC});
  });
  return {id:assignment.id,operations,report:{owner:assignment.id,depositionFamily:'inject',construction:'inject',points:operations.length,
    authoredVolumeMm3:assignment.points.reduce((sum,p)=>sum+p.volumeMm3,0),materialCoverage:'unspecified-point-volume'}};
}
