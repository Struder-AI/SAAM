// Downstream scheduling consumes the exact immutable source saved by Bundle.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {prepareCurvePath,curveAt} from './curve-path.mjs';
import {planSourceComposition} from './compose.mjs';
import {createPlanningState,planFan,planningPath} from './planning.mjs';
import {planFinishing} from './toolpath.mjs';
import {NEUTRAL_PATH_CONTRACT} from './dependencies.mjs';
import {CONSTRUCTION_CONTRACT} from './manufacturing.mjs';

export function schedulePath(path,{sourcePathId,onProgress}={}){
  requireThat(path.manufacturing?.contract===CONSTRUCTION_CONTRACT&&path.completions,'Scheduling needs producer-owned manufacturing prerequisites and validity; regenerate the source.');
  return planExecutionPath(path,{sourcePathId,onProgress});
}

export function planExecutionPath(path,{sourcePathId,onProgress,order=null}={}){
  requireThat(path.schema==='saampath/2'&&path.operations&&path.planning,'Scheduling requires compact constructed SAAMpath; regenerate an older source.');
  requireThat(typeof sourcePathId==='string'&&sourcePathId.length>0,'Scheduling requires the exact Bundle source path identity.');
  const operations=Object.values(path.operations),first=operations[0],reader=prepareCurvePath(path);
  requireThat(first,'There are no deposition operations to schedule.');
  const initial=first.kind==='inject'?{point:first.injection.at,pose:first.injection.pose}:curveAt(reader,first.courses[0].curveId,first.courses[0].from);
  const motion=path.planning.motion,pose=motion?.initialPose??initial.pose;
  const start=path.planning.start??initial.point;
  const started=planFan(createPlanningState({...path.planning,start,motion:{...motion,initialPose:pose},sourcePathId,generatorVersion:path.generatorVersion}),0);
  const composed=planSourceComposition(started.state,path,reader,onProgress,order),finished=planFinishing(composed.state);
  return planningPath(finished.state,[started.actions,composed.actions,finished.actions],{
    composition:composed.summary,construction:{operations:operations.length,
      courses:operations.reduce((n,operation)=>n+(operation.courses?.length??0),0),
      dependencies:operations.reduce((n,operation)=>n+operation.after.length,0)}
  },{contract:NEUTRAL_PATH_CONTRACT,transfers:'intent'});
}
