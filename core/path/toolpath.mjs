import {planContext,planFan} from './planning.mjs';

export function planFinishing(state) {
  // Selected-machine preparation performs checked parking and retraction.
  return planFan(planContext(state,'finish',0).state,0);
}
