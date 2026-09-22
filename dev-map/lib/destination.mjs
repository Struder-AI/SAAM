// One rule decides whether an address is a map or code, shared by generation, the agent read
// and the drawing. Operators are not part of that decision: a formula is a formula whether the
// scanner recognized one loop in it or five.
import {invocationInstances} from './instances.mjs';

// What a page would draw: one box per called-declaration invocation and per operator. Ports are
// not boxes. The count uses the same expansion the drawing and the agent read use. `called`
// counts only the invocation boxes — mapped declarations and outside invocations.
export const drawnShape=page=>{
  const drawn=invocationInstances(page);
  const called=new Set((drawn.components??[]).map(c=>c.id??c.index));
  const operators=(drawn.operators??[]).map(o=>o.id);
  const wires=drawn.wires??[];
  // A state node is not a called declaration, so a wire to or from one says nothing about
  // whether two called declarations are related here.
  return {boxes:called.size+operators.length,called:called.size,
    wired:wires.some(w=>w.provenance!=='closure-state'&&(called.has(w.from)||called.has(w.to)))};
};
// A declaration page is a map when its drawing shows at least two called declarations with a
// wire on one of them, and code otherwise. Iteration, update, choice, collection and
// member-invocation operators do not make a map; they stay in the stored page and `--details`.
// Root, region and group pages are containment maps and are always graphs.
export const destinationFor=page=>{
  if(['root','region','group'].includes(page.kind))return 'graph';
  const {called,wired}=drawnShape(page);
  return called>1&&wired?'graph':'code';
};
