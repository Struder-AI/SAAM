// Downstream scheduling consumes the exact immutable source saved by Bundle.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {prepareCurvePath,curveAt,injectionAt} from './curve-path.mjs';
import {planSourceComposition} from './compose.mjs';
import {createPlanningState,planFan,planningPath} from './planning.mjs';
import {planFinishing} from './toolpath.mjs';
import {NEUTRAL_PATH_CONTRACT} from './dependencies.mjs';
import {saamPath,joinSaamPath} from './saampath.mjs';
import {resolveSchedulingTools,sourceToolIndexes} from './scheduling-tools.mjs';

export function schedulePath(path,{sourcePathId,onProgress,nozzleTypes={}}={}){
  return planExecutionPath(path,{sourcePathId,onProgress,nozzleTypes});
}

export function planExecutionPath(path,{sourcePathId,onProgress,order=null,nozzleTypes={},resolvedTools=null}={}){
  path=saamPath(path);
  requireThat(path.schema==='saampath/3'&&path.operations&&path.planning,'Scheduling requires current Paath; regenerate an older source.');
  requireThat(typeof sourcePathId==='string'&&sourcePathId.length>0,'Scheduling requires the exact Bundle source path identity.');
  const operations=Object.values(path.operations),first=operations[0],reader=prepareCurvePath(path);
  if(!first){
    const findings=Array.isArray(path.summary?.limitations)?path.summary.limitations:[];
    throw Error(['There are no deposition operations to schedule.',...findings].join('\n'));
  }
  const tools=resolvedTools==null?resolveSchedulingTools(path,nozzleTypes):{...resolvedTools,
    provenance:Object.fromEntries(sourceToolIndexes(path).map(index=>[index,resolvedTools.provenance?.[index]??'unavailable']))};
  const initial=first.kind==='inject'?injectionAt(first):curveAt(reader,first.courses[0].curveId,first.courses[0].from);
  const motion=path.planning.motion,pose=motion?.initialPose??initial.pose;
  const start=path.planning.start??initial.point;
  const started=planFan(createPlanningState({...path.planning,start,motion:{...motion,initialPose:pose},sourcePathId,generatorVersion:path.generatorVersion}),0);
  const composed=planSourceComposition(started.state,path,reader,onProgress,order,{nozzleGeometry:tools.default,nozzleGeometries:tools}),finished=planFinishing(composed.state);
  const schedule=planningPath(finished.state,[started.actions,composed.actions,finished.actions],{
    composition:composed.summary,construction:{operations:operations.length,
      courses:operations.reduce((n,operation)=>n+(operation.courses?.length??0),0),
      dependencies:operations.reduce((n,operation)=>n+operation.after.length,0)}
  },{contract:NEUTRAL_PATH_CONTRACT,nozzleTypes:tools,transfers:'routed'});
  // Coverage belongs to the schedule being published. Later consumers reuse
  // the proof only while both admitted immutable identities are unchanged.
  joinSaamPath({sourcePathId,deposition:path,schedule});
  return schedule;
}
