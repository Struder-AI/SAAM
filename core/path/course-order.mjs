// Contract only proven prerequisites: intact native slices execute together;
// conflicting slice contractions expose the courses at their boundaries.
import {distance,requireThat} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';

export function dependencyComponents(nodes,parents){
  const following=new Map(nodes.map(id=>[id,[]])),seen=new Set(),finished=[],result=[];
  for(const [id,before] of parents)for(const parent of before)following.get(parent).push(id);
  for(const root of nodes){
    if(seen.has(root))continue;
    seen.add(root);const pending=[{id:root,at:0}];
    while(pending.length){
      const frame=pending.at(-1),next=following.get(frame.id);
      if(frame.at===next.length){finished.push(frame.id);pending.pop();continue;}
      const id=next[frame.at++];if(!seen.has(id)){seen.add(id);pending.push({id,at:0});}
    }
  }
  seen.clear();
  for(const root of finished.toReversed()){
    if(seen.has(root))continue;
    const part=[],pending=[root];seen.add(root);
    while(pending.length){const id=pending.pop();part.push(id);for(const parent of parents.get(id))if(!seen.has(parent)){seen.add(parent);pending.push(parent);}}
    result.push(part);
  }
  return result;
}

export function slicePartitions(operations,prerequisites){
  const slices=new Map(),membership=new Map(),state={groups:[]};
  for(const op of operations){
    const id=op.barrier?op.id:op.layerId??op.sourceOperation??op.id;
    if(!slices.has(id))slices.set(id,[]);
    slices.get(id).push(op.id);
  }
  for(const ids of slices.values()){state.groups.push(ids);for(const id of ids)membership.set(id,ids);}
  for(;;){
    const parents=new Map(state.groups.map(group=>[group,new Set()]));
    for(const [id,before] of prerequisites)for(const parent of before){
      const a=membership.get(id),b=membership.get(parent);if(a!==b)parents.get(a).add(b);
    }
    const cycles=dependencyComponents(state.groups,parents).filter(part=>part.length>1);
    if(!cycles.length)break;
    const exposed=new Set();
    for(const cycle of cycles){
      const inside=new Set(cycle);
      for(const group of cycle)for(const id of group)for(const parent of prerequisites.get(id))
        if(membership.get(parent)!==group&&inside.has(membership.get(parent))){exposed.add(id);exposed.add(parent);}
    }
    const next=[],change={split:false};
    for(const group of state.groups){
      if(group.length===1||!group.some(id=>exposed.has(id))){next.push(group);continue;}
      change.split=true;
      const rest=group.filter(id=>!exposed.has(id));if(rest.length)next.push(rest);
      for(const id of group)if(exposed.has(id))next.push([id]);
    }
    if(!change.split)break; // A course-level cycle is reported by the ordinary solver.
    state.groups=next;for(const group of next)for(const id of group)membership.set(id,group);
  }
  const material=new Set(operations.filter(op=>!op.barrier).map(op=>op.id));
  const native=new Set(operations.filter(op=>material.has(op.id)&&op.layerId!==null&&op.layerId!==undefined).map(op=>op.layerId));
  const refinedSlices=[...native].filter(id=>{const ids=slices.get(id).filter(id=>material.has(id));return ids.some(id=>membership.get(id)!==membership.get(ids[0]));}).length;
  return {groups:state.groups,summary:{slices:native.size,wholeSlices:native.size-refinedSlices,refinedSlices,
    executionUnits:state.groups.filter(group=>group.some(id=>material.has(id))).length,courses:new Set(operations.filter(op=>!op.barrier).flatMap(op=>op.ranges?.map(range=>range.id)??[op.id])).size}};
}

export function selectTraversal(operation,cursor,verify=null){
  const entryCost=(entry,process)=>distance(cursor.point,entry?.point??cursor.point)+
    (cursor.axis&&entry?.pose?.toolAxis?(process?.lineWidthMm??.4)*(1-cursor.axis.reduce((sum,v,i)=>sum+v*entry.pose.toolAxis[i],0)):0);
  const proposed=operation.barrier?null:operation.traversalsAt?.(cursor.point)??operation.traversals;
  const choices=operation.supportAllows?proposed?.filter(choice=>operation.supportAllows(choice.ranges)):proposed;
  requireThat(!proposed?.length||choices.length,'No permitted traversal starts on qualified material.');
  if(!choices?.length)return entryCost(operation.entry,operation.process);
  operation.traversalAlternatives=choices.length;
  const remaining=[...choices],cost=variant=>entryCost(variant.entry,operation.process)+variant.extraDistance;
  let failure;
  while(remaining.length){
    const choice=remaining.reduce((best,variant)=>cost(variant)<cost(best)-PRINT_RESOLUTION_MM?variant:best);
    remaining.splice(remaining.indexOf(choice),1);
    Object.assign(operation,{ranges:choice.ranges,entry:choice.entry,exit:choice.exit,traversalChoice:choice});
    try{verify?.(operation);return cost(choice);}catch(error){
      if(error.code!=='CONTINUOUS_NOZZLE_CONFLICT'&&error.code!=='CURVE_CLEARANCE_UNRESOLVED')throw error;
      failure=error;
    }
  }
  throw failure;
}
function nearest(ready,cursor,{cooling=null,wholeSlice=false}={}){
  const best={index:0,cost:Infinity,heat:Infinity},closest={index:0,cost:Infinity};
  for(const [i,node] of ready.entries()){
    const cost=selectTraversal(node.op,cursor),previous=ready[best.index];
    const heat=cooling&&ready.length>1?cooling.heat(wholeSlice?node.unit.operations:node.thermalOperations):0;
    const nearestNode=ready[closest.index];
    if(cost<closest.cost-PRINT_RESOLUTION_MM||Math.abs(cost-closest.cost)<=PRINT_RESOLUTION_MM&&
      (node.result<nearestNode.result||node.result===nearestNode.result&&node.index<nearestNode.index)){closest.index=i;closest.cost=cost;}
    if(heat<best.heat||heat===best.heat&&(cost<best.cost-PRINT_RESOLUTION_MM||Math.abs(cost-best.cost)<=PRINT_RESOLUTION_MM&&
      (node.result<previous.result||node.result===previous.result&&node.index<previous.index))){best.index=i;best.cost=cost;best.heat=heat;}
  }
  if(cooling&&best.index!==closest.index){if(wholeSlice)cooling.summary.sliceChoices++;else cooling.summary.courseChoices++;}
  return best;
}

function dependencyCycle(operations,prerequisites){
  const done=new Set();
  for(const operation of operations){
    if(done.has(operation.id))continue;
    const stack=[{id:operation.id,parents:[...prerequisites.get(operation.id)],at:0}],positions=new Map([[operation.id,0]]);
    while(stack.length){
      const frame=stack.at(-1);
      if(frame.at===frame.parents.length){done.add(frame.id);positions.delete(frame.id);stack.pop();continue;}
      const next=frame.parents[frame.at++];
      if(positions.has(next))return stack.slice(positions.get(next)).map(item=>item.id);
      if(!done.has(next)){positions.set(next,stack.length);stack.push({id:next,parents:[...prerequisites.get(next)],at:0});}
    }
  }
  return [];
}

export function orderReadyOperations(operations,priorityById,prerequisites,{start,physicalEdges=[],partitions=null,cooling=null,groupAccess=null,readiness=null}={}){
  const nodes=operations.map(op=>({op,thermalOperations:[op],...priorityById.get(op.id),remaining:prerequisites.get(op.id).size,following:[],unit:null}));
  const byId=new Map(nodes.map(node=>[node.op.id,node]));
  const units=(partitions??operations.map(op=>[op.id])).map(ids=>({nodes:ids.map(id=>byId.get(id)),operations:ids.map(id=>byId.get(id).op),parents:new Set(),following:[],remaining:0,ready:[]}));
  for(const unit of units)for(const node of unit.nodes)node.unit=unit;
  for(const node of nodes)for(const id of prerequisites.get(node.op.id)){
    const parent=byId.get(id);parent.following.push(node);if(parent.unit!==node.unit)node.unit.parents.add(parent.unit);
  }
  for(const unit of units){unit.remaining=unit.parents.size;for(const parent of unit.parents)parent.following.push(unit);for(const node of unit.nodes)if(!node.remaining)unit.ready.push(node);}
  const entry=operations.find(operation=>operation.entry)?.entry;
  requireThat(!operations.length||start||entry,'Ordering needs a source entry position.');
  const ready=units.filter(unit=>!unit.remaining),scheduled=[],available=new Set(),cursor={point:start??entry?.point,axis:null};
  while(ready.length){
    const blocked=[];
    const qualified=readiness?ready.filter(unit=>{
      const results=unit.operations.map(op=>({op,result:readiness.check(op,available)})),waiting=results.filter(item=>item.result.status!=='ready');
      if(waiting.length){blocked.push(...waiting);return false;}
      for(const {op,result} of results){op.supportAllows=result.permits;op.supportSeams=result.seams;}
      return true;
    }):ready;
    const entries=qualified.filter(unit=>unit.ready.length).map(unit=>unit.ready[nearest(unit.ready,cursor).index]);
    if(!entries.length&&blocked.length)throw Object.assign(Error('Ready work is waiting for qualifying bead contact.'),
      {code:'BEAD_SUPPORT_WAIT',blocked,available});
    if(!entries.length)break;
    // Prefer ready aggregates that do not leave lower-access work behind.
    // This only proposes an order; the caller proves its whole deposited prefix.
    const preferred=groupAccess?entries.filter(node=>{
      const own=node.unit.operations.find(op=>!op.barrier);if(!own)return true;
      const a=own.layerId??own.sourceOperation??own.id;
      return !entries.some(other=>{
        const peer=other.unit.operations.find(op=>!op.barrier);if(!peer)return false;
        const b=peer.layerId??peer.sourceOperation??peer.id;
        return groupAccess.clear(a,b)&&!groupAccess.clear(b,a);
      });
    }):entries;
    const choices=preferred.length?preferred:entries;
    const unit=choices[nearest(choices,cursor,{cooling,wholeSlice:true}).index].unit;ready.splice(ready.indexOf(unit),1);
    while(unit.ready.length){
      const next=unit.ready.splice(nearest(unit.ready,cursor,{cooling}).index,1)[0];scheduled.push(next.op);
      if(!next.op.barrier){available.add(next.op.id);cooling?.record(next.op);cursor.point=next.op.exit.point;cursor.axis=next.op.exit.pose.toolAxis;}
      for(const node of next.following)if(!--node.remaining)node.unit.ready.push(node);
    }
    if(unit.nodes.some(node=>node.remaining))break;
    for(const following of unit.following)if(!--following.remaining)ready.push(following);
  }
  if(scheduled.length!==operations.length){
    const cycle=dependencyCycle(operations,prerequisites);
    const components=dependencyComponents(operations.map(op=>op.id),prerequisites).filter(part=>part.length>1);
    const membership=new Map(components.flatMap(part=>part.map(id=>[id,part])));
    const reasons=physicalEdges.filter(edge=>membership.has(edge.before)&&membership.get(edge.before)===membership.get(edge.after));
    const refinementCourses=components.flat();
    throw Object.assign(Error('Print ordering contains a cycle: '+cycle.map(id=>byId.get(id).op.label??id).join(' → ')),{code:'PRINT_ORDER_CONFLICT',operations:cycle,physicalDependencies:reasons,refinementCourses});
  }
  return scheduled;
}

export function orderSliceCourses(operations,priorities,prerequisites,options={}){
  const partition=slicePartitions(operations,prerequisites);
  const ordered=orderReadyOperations(operations,priorities,prerequisites,{...options,partitions:partition.groups}),sequence=[];
  for(const operation of ordered)if(!operation.barrier){
    const id=operation.layerId??operation.sourceOperation??operation.id;
    if(sequence.at(-1)!==id)sequence.push(id);
  }
  return {operations:ordered,hierarchy:partition.summary,
    groupOrder:new Set(sequence).size===sequence.length?sequence:null};
}
