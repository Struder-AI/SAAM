import {createPlanningState,planningResult,planContext,planFan,planPark,planningPath} from './planning.mjs';
import {planPriming} from './prime.mjs';
import {planComposition} from './compose.mjs';

// Complete path boundary: prepared geometry operations and locked machine/process
// settings in; delivered actions, accounting and composition summary out.
export function planToolpath(planningSettings,skillResults,{geometryBounds,rules={},prime=true,summary={},onProgress}={}) {
  const initialState=createPlanningState(planningSettings);
  const started=planFan(initialState,0);
  const primed=prime?planPriming(started.state,geometryBounds,skillResults):planningResult(started.state);
  const composed=planComposition(primed.state,skillResults,rules,onProgress);
  const finished=planFinishing(composed.state);
  return planningPath(finished.state,[started.actions,primed.actions,composed.actions,finished.actions],
    {...summary,composition:composed.summary});
}

export function planFinishing(state) {
  const contextual=planContext(state,'finish',0),parked=planPark(contextual.state),cooled=planFan(parked.state,0);
  return planningResult(cooled.state,{chunks:[parked.actions,cooled.actions]});
}
