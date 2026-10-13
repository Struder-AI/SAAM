// Downstream scheduling consumes the Bundle's saved constructed SAAMpath.
import {requireThat} from '../private/toolpath/numeric.mjs';
import {planComposition} from './compose.mjs';
import {createPlanningState,planFan,planningPath} from './planning.mjs';
import {planFinishing} from './toolpath.mjs';
import {NEUTRAL_PATH_CONTRACT} from './dependencies.mjs';
import {prepareHeightGeometry} from '../geom/material-envelope.mjs';

export function schedulePath(path,{onProgress}={}){
  requireThat(path.schema==='saampath/1'&&Array.isArray(path.operations)&&path.planning,'Scheduling needs constructed SAAMpath operations read from Bundle.');
  const started=planFan(createPlanningState({start:[0,0,(path.summary.boundsMm?.max[2]??0)+path.planning.process.liftMm],...path.planning,generatorVersion:path.generatorVersion}),0);
  const composed=planComposition(started.state,[{id:'saampath',operations:path.operations}],path.composition,onProgress,{geometry:path.geometry.map(prepareHeightGeometry)});
  const finished=planFinishing(composed.state);
  return planningPath(finished.state,[started.actions,composed.actions,finished.actions],{
    ...path.summary,composition:composed.summary,construction:{operations:path.operations.length,dependencies:path.operations.reduce((n,operation)=>n+(operation.after?.length??0),0)}
  },{contract:NEUTRAL_PATH_CONTRACT});
}
