// The first context resets the semantic snapshot; later records carry changes.
// Null clears an optional label. Independently composed paths retain their reset.
export const CONTEXT_KEYS=Object.freeze(['phase','layer','operation','region','role','connector','travel']);
export function actionContext(action){
  return Object.fromEntries(CONTEXT_KEYS.filter(key=>action[key]!==undefined).map(key=>[key,action[key]]));
}
export function sameContext(a,b){
  return CONTEXT_KEYS.every(key=>a[key]===b[key]);
}

// Stream physical actions and their enclosing context without allocating a
// second path. Ordinals count physical actions, preserving saved preview lines.
export function* contextualActions(path){
  let context={},index=0;
  for(const action of path.actions){
    if(action.kind==='context'){
      context=action.reset?{}:{...context};
      for(const key of CONTEXT_KEYS)if(Object.hasOwn(action,key)){
        if(action[key]===null)delete context[key];else context[key]=action[key];
      }
      continue;
    }
    if(Object.hasOwn(action,'phase'))context=actionContext(action);
    yield {action,context,index:index++};
  }
}
