import {planningResult,planContext,planFan,planPark} from './planning.mjs';

export function planFinishing(state) {
  const contextual=planContext(state,'finish',0),parked=planPark(contextual.state),cooled=planFan(parked.state,0);
  return planningResult(cooled.state,{chunks:[parked.actions,cooled.actions]});
}
