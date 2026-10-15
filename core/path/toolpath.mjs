import {planningResult,planContext,planFan,planPark} from './planning.mjs';

export function planFinishing(state,nozzleScene) {
  const contextual=planContext(state,'finish',0),parked=planPark(contextual.state,nozzleScene),cooled=planFan(parked.state,0);
  return planningResult(cooled.state,{chunks:[parked.actions,cooled.actions]});
}
