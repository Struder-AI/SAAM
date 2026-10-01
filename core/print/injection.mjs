import {requireThat} from '../private/toolpath/numeric.mjs';

import {validateInjectionPoint,pointInjectionOperation} from '../path/injection.mjs';
import {assignmentPlan,validateAssignmentProcess} from './assignment-process.mjs';

export function injectionAssignment({id,...options}){
  return structuredClone({id,construction:'inject',part:null,filament:null,process:null,nozzleC:null,points:[],
    dependencies:{afterParts:[],beforeParts:[],after:[]},description:'',...options});
}

export function validateInjectionAssignment(assignment,{parts=[]}={}){
  requireThat(assignment&&Object.keys(assignment).sort().join()===Object.keys(injectionAssignment({})).sort().join()&&assignment.construction==='inject','Invalid inject assignment fields.');
  requireThat(typeof assignment.id==='string'&&/^[a-z][a-z0-9-]*$/.test(assignment.id),'Invalid inject assignment id.');
  requireThat(assignment.part===null||parts.includes(assignment.part),'Inject assignment names an unknown part.');
  requireThat(assignment.filament===null||Number.isInteger(assignment.filament)&&assignment.filament>=0,'Inject filament must be null or a filament index.');
  validateAssignmentProcess(assignment.process);
  requireThat(assignment.nozzleC===null||Number.isFinite(assignment.nozzleC),'Inject nozzleC must be null or finite.');
  requireThat(typeof assignment.description==='string'&&assignment.dependencies&&Object.keys(assignment.dependencies).sort().join()==='after,afterParts,beforeParts','Inject description/dependencies have invalid fields.');
  for(const key of ['afterParts','beforeParts'])requireThat(Array.isArray(assignment.dependencies[key])&&assignment.dependencies[key].every(part=>parts.length?parts.includes(part):part===null),'Inject dependency part is not selected geometry.');
  requireThat(Array.isArray(assignment.dependencies.after)&&assignment.dependencies.after.every(id=>typeof id==='string'&&id.length),'Inject after dependencies name operation IDs.');
  requireThat(Array.isArray(assignment.points)&&assignment.points.length>0,'Inject needs at least one point-volume record.');
  assignment.points.forEach(validateInjectionPoint);
  return assignment;
}

export function injectionResult(assignment,{plan,machine}){
  const selected=assignmentPlan(plan,machine,assignment);
  const operations=assignment.points.map((record,index)=>{
    const point=record.point.map((value,axis)=>value+(axis===0?plan.placement.xMm:axis===1?plan.placement.yMm:0));
    return pointInjectionOperation({...record,point},{id:`${assignment.id}:${index}`,phase:'inject',
      layer:index,layerIndex:index,layerCount:assignment.points.length,layerId:`inject:${assignment.id}:${index}`,rank:point[2],
      after:[...assignment.dependencies.after,...(index?[`${assignment.id}:${index-1}`]:[])],
      ...(assignment.filament===null?{}:{filament:assignment.filament}),plan:selected,machine,nozzleC:assignment.nozzleC});
  });
  return {id:assignment.id,operations,report:{owner:assignment.id,depositionFamily:'inject',construction:'inject',points:operations.length,
    authoredVolumeMm3:assignment.points.reduce((sum,p)=>sum+p.volumeMm3,0),materialCoverage:'unspecified-point-volume'}};
}
