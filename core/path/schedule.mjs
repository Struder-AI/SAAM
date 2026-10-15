// Downstream scheduling consumes the Bundle's saved constructed SAAMpath.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {planComposition} from './compose.mjs';
import {createPlanningState,planFan,planningPath} from './planning.mjs';
import {planFinishing} from './toolpath.mjs';
import {NEUTRAL_PATH_CONTRACT} from './dependencies.mjs';
import {uprightPose} from './pose.mjs';

export function schedulePath(path,{onProgress}={}){
  requireThat(path.schema==='saampath/1'&&Array.isArray(path.operations)&&path.planning,'Scheduling needs constructed SAAMpath operations read from Bundle.');
  const first=path.operations.flatMap(op=>op.strokes).find(stroke=>stroke.points.length),motion=path.planning.motion;
  const pose=motion?.initialPose??first?.poses?.[0]??uprightPose(),entry=first?.points[0]??[0,0,0];
  const retreat=motion?.retreatMm??path.planning.process.liftMm;
  const start=path.planning.start??entry.map((v,i)=>v-pose.toolAxis[i]*retreat);
  const started=planFan(createPlanningState({...path.planning,start,motion:{...motion,initialPose:pose},generatorVersion:path.generatorVersion}),0);
  const composed=planComposition(started.state,[{id:'saampath',operations:path.operations}],path.composition,onProgress);
  const finished=planFinishing(composed.state,composed.nozzleScene);
  return planningPath(finished.state,[started.actions,composed.actions,finished.actions],{
    ...path.summary,composition:composed.summary,construction:{operations:path.operations.length,dependencies:path.operations.reduce((n,operation)=>n+(operation.after?.length??0),0)}
  },{contract:NEUTRAL_PATH_CONTRACT});
}
