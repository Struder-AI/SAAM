// Source operations enter once as compact curves; execution refers to ranges.
import {requireThat,distance} from '../private/toolpath/numeric.mjs';
import {curveAt,curveRange,curveParameterAtLength,curveClosestParameter,prepareCurvePath} from './curve-path.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM} from '../dimensions.mjs';
import {orderSliceCourses,selectTraversal} from './course-order.mjs';
import {precedenceLookup,prerequisiteProofs} from './precedence.mjs';
import {prepareRangeScene} from './physical-order.mjs';
import {ActionAccumulator,planningResult,planContext,planFan,planNozzle,planPark,planTravel,
  planExtrusion,planDwell,planLayerCooling,planSelection,planProcess,planDepositRange} from './planning.mjs';

export function planOperationEntry(initialState,op,{layerSeconds=0,nozzleScene}={}) {
  const contextual=planContext({...initialState,layerSeconds,layerId:op.layerId},op.phase,op.layer,op.sourceOperation??op.id);
  const selected=planSelection(contextual.state,op.filament??initialState.defaultFilament);
  const configured=planProcess(selected.state,op.process);
  const prepared=planOperationStart(configured.state,op,nozzleScene);
  return planningResult(prepared.state,{chunks:[selected.actions,prepared.actions]});
}

export function planOperationStart(state,op,nozzleScene) {
  const fan=op.fanPercent!==undefined?planFan(state,op.fanPercent):planningResult(state);
  if(op.nozzleC===undefined||fan.state.nozzleC===op.nozzleC)return fan;
  const parked=planPark(fan.state,nozzleScene),heated=planNozzle(parked.state,op.nozzleC);
  return planningResult(heated.state,{chunks:[fan.actions,parked.actions,heated.actions]});
}

export function planOperationEnd(state,op,nozzleScene) {
  if(op.nozzleC===undefined||state.nozzleC===op.restoreNozzleC)return planningResult(state);
  const parked=planPark(state,nozzleScene),restored=planNozzle(parked.state,op.restoreNozzleC);
  return planningResult(restored.state,{chunks:[parked.actions,restored.actions]});
}

export function prepareOperationPriorities(operations,resultIndex) {
  return new Map(operations.map((op,index)=>[op.id,{result:op.constructionRank??resultIndex.get(op.sourceOperation??op.id),index}]));
}

export function prepareOperationDependencies(operations,byId,{order=[],dependencies=[]}={}) {
  const prerequisites = new Map(operations.map(op => [op.id, new Set(op.after ?? [])]));
  for (const [id, after] of prerequisites) for (const predecessor of after)
    requireThat(byId.has(predecessor) && id !== predecessor, id===predecessor
      ?`Operation ${id} cannot depend on itself.`:`Operation ${id} depends on unknown operation ${predecessor}; use an exact operation ID.`);
  // Recipe composition entries that name no operation of this path match
  // nothing; a repeated order entry keeps its first place.
  for (const edge of dependencies)
    if (byId.has(edge.before) && byId.has(edge.after) && edge.before !== edge.after) prerequisites.get(edge.after).add(edge.before);
  const sequence = [...new Set(order)].filter(id => byId.has(id));
  // Explicit order is an additional precedence constraint, never permission to
  // bypass geometry/support dependencies. Omitted operations remain schedulable.
  for (let i = 1; i < sequence.length; i++) prerequisites.get(sequence[i]).add(sequence[i - 1]);
  return prerequisites;
}

// Compact-source graph. Whole-operation prerequisites use completion barriers,
// so an operation with N courses followed by M courses needs O(N+M) edges.
// Neither polyline vertices nor profile keys create scheduling nodes.

// Proof subdivisions are not execution fragments. Keep source coverage exact,
// canonicalize only proposed interruption locations, and re-solve all contacts.
function executionCut(reader,course,u,existing){
  if(!(u>course.from&&u<course.to)||existing.has(u))return null;
  const boundaries=[course.from,...existing,course.to].sort((a,b)=>a-b),i=boundaries.findIndex(value=>value>u),a=boundaries[i-1],b=boundaries[i];
  const measured=(from,to)=>curveRange(reader,course.curveId,from,to,{lengthToleranceMm:ROUNDING_MM}).lengthMm;
  const left=measured(a,u),right=measured(u,b);
  if(a!==course.from&&left[1]<=PRINT_RESOLUTION_MM||b!==course.to&&right[1]<=PRINT_RESOLUTION_MM)return null;
  const target=PRINT_RESOLUTION_MM+ROUNDING_MM;
  if(left[0]<PRINT_RESOLUTION_MM)u=curveParameterAtLength(reader,course.curveId,a,b,target);
  else if(right[0]<PRINT_RESOLUTION_MM)u=curveParameterAtLength(reader,course.curveId,a,b,target,{fromEnd:true});
  if(!(u>a&&u<b))return null;
  return measured(a,u)[0]>=PRINT_RESOLUTION_MM&&measured(u,b)[0]>=PRINT_RESOLUTION_MM?u:null;
}
function courseCuts(reader,course,values){
  const retained=new Set();
  for(const u of [...new Set(values)].sort((a,b)=>a-b)){
    const cut=executionCut(reader,course,u,retained);if(cut!==null)retained.add(cut);
  }
  return [...retained].sort((a,b)=>a-b);
}
export function prepareSourceUnits(source,reader,{cuts=new Map(),relaxedChunks=null,blockedTraversals=new Set()}={}){
  const operations=Object.values(source.operations),bySource=new Map(operations.map(op=>[op.id,op]));
  const declared=prepareOperationDependencies(operations,bySource,source.composition);
  const originals=new Map(operations.flatMap(operation=>(operation.courses??[]).map(course=>[course.id,course])));
  const units=[],nodes=[],groups=new Map(),prerequisites=new Map(),courseGroups=new Map(),counter={next:0};
  // Forward requirements can live inside a soft traversal chunk. Exclude
  // backwards or external endpoints; these must remain explicit graph nodes.
  const constrained=new Set();
  for(const operation of operations){
    const courses=operation.courses??[];if(!courses.some(course=>course.after?.length))continue;
    const positions=new Map(courses.map((course,index)=>[course.id,index]));
    for(const [index,course] of courses.entries())for(const previous of course.after??[])
      if(!positions.has(previous)||positions.get(previous)>=index){constrained.add(course.id);constrained.add(previous);}
  }
  function node(operation,ranges,barrier=null,traversalKey=null){
    const id='schedule:'+counter.next++,injection=operation.kind==='inject'?operation.injection:null;
    const entry=barrier?null:injection?{point:injection.at,pose:injection.pose}:curveAt(reader,ranges[0].curveId,ranges[0].from);
    const last=ranges.at(-1),exit=barrier?null:injection?entry:curveAt(reader,last.curveId,last.to,{side:'left'});
    const value={id,sourceOperation:operation.id,layerId:operation.layerId,operation,process:source.processes[operation.processId],
      ranges,entry,exit,barrier,label:operation.id+(ranges.length===1?' ['+ranges[0].id+' '+ranges[0].from+'..'+ranges[0].to+']':''),
      constructionRank:operation.constructionRank??0,...(traversalKey?{traversalKey}:{})};
    if(!barrier&&!injection&&operation.interruptible&&!operation.continuous){
      const endpoint=(range,end)=>curveAt(reader,range.curveId,end?range.to:range.from,end?{side:'left'}:{});
      const reversible=ranges.every(range=>range.directionRequired===false&&(range.seamRequired!==true||
        range.from!==originals.get(range.id).from||distance(endpoint(range,false).point,endpoint(range,true).point)<=ROUNDING_MM));
      const loop=ranges.length===1&&ranges[0].interruptible&&ranges[0].seamRequired===false&&distance(entry.point,exit.point)<=ROUNDING_MM?ranges[0]:null;
      if(reversible||loop){
        const variants=[ranges];
        if(reversible){
          variants.push(ranges.toReversed().map(range=>({...range,reverse:true})));
          if(ranges.length>1)variants.push(ranges.toReversed(),ranges.map(range=>({...range,reverse:true})));
        }
        const traversal=ranges=>{
          const ends=ranges.map(range=>{const a=endpoint(range,false),b=endpoint(range,true);return range.reverse?[b,a]:[a,b];});
          const key=JSON.stringify(ranges.map(range=>[range.id,range.from,range.to,Boolean(range.reverse)]));
          return {key,ranges,entry:ends[0][0],exit:ends.at(-1)[1],
            extraDistance:ends.slice(1).reduce((sum,[start],i)=>sum+distance(ends[i][1].point,start.point),0)};
        };
        const requiredOrder=ranges.some(range=>range.after?.length);
        const allowed=variant=>{
          if(blockedTraversals.has(variant.key))return false;
          if(!requiredOrder)return true;
          const positions=new Map(variant.ranges.map((range,index)=>[range.id,index]));
          return variant.ranges.every((range,index)=>(range.after??[]).every(previous=>!positions.has(previous)||positions.get(previous)<index));
        };
        value.traversals=variants.map(traversal).filter(allowed);
        if(loop){
          const memo={point:null,choices:null};
          value.traversalsAt=point=>{
            if(memo.point?.every((v,i)=>v===point[i]))return memo.choices;
            const closest=curveClosestParameter(reader,loop.curveId,loop.from,loop.to,point,{toleranceMm:PRINT_RESOLUTION_MM});
            const seam=executionCut(reader,loop,closest,new Set()),choices=[...value.traversals];
            if(seam!==null){
              const head={...loop,to:seam},tail={...loop,from:seam};choices.push(traversal([tail,head]));
              if(reversible)choices.push(traversal([{...head,reverse:true},{...tail,reverse:true}]));
            }
            memo.point=[...point];memo.choices=choices.filter(allowed);return memo.choices;
          };
        }
      }
    }
    nodes.push(value);prerequisites.set(id,new Set());
    if(!barrier){
      units.push(value);
      for(const range of ranges){if(!courseGroups.has(range.id))courseGroups.set(range.id,{operation,members:[]});courseGroups.get(range.id).members.push(value);}
    }
    return value;
  }
  for(const operation of operations){
    const members=[];
    if(operation.kind==='inject'||!operation.interruptible)members.push(node(operation,operation.courses??[]));
    else {
      let pending=[];
      function flush(){
        if(!pending.length)return;
        const key=JSON.stringify(pending.map(course=>[course.id,course.from,course.to]));
        if(pending.length>1&&!relaxedChunks?.has(key))members.push(node(operation,pending,null,key));
        else for(const course of pending)members.push(node(operation,[course]));
        pending=[];
      }
      for(const course of operation.courses){
        const breaks=course.interruptible?courseCuts(reader,course,cuts.get(course.id)??[]):[];
        if(relaxedChunks===null||breaks.length||constrained.has(course.id)){
          flush();const parameters=[course.from,...breaks,course.to];
          for(let i=1;i<parameters.length;i++)members.push(node(operation,[{...course,from:parameters[i-1],to:parameters[i]}]));
          continue;
        }
        const previous=pending.at(-1),cell=previous?.orderGroup??previous?.provenance?.cell;
        if(previous&&!(cell!==undefined&&cell===(course.orderGroup??course.provenance?.cell))&&
          distance(curveAt(reader,previous.curveId,previous.to,{side:'left'}).point,curveAt(reader,course.curveId,course.from).point)>ROUNDING_MM)flush();
        pending.push(course);
      }
      flush();
    }
    requireThat(members.length>0,'Source operation has no execution unit.');
    const begin=members.length===1?members[0]:node(operation,[],'begin');
    const end=members.length===1?members[0]:node(operation,[],'end');
    if(members.length>1)for(const member of members){prerequisites.get(member.id).add(begin.id);prerequisites.get(end.id).add(member.id);}
    groups.set(operation.id,{members,begin,end});
  }
  for(const [id,parents] of declared)for(const parent of parents)prerequisites.get(groups.get(id).begin.id).add(groups.get(parent).end.id);
  for(const [id,group] of courseGroups)if(originals.get(id).seamRequired===true&&group.members.length>1)
    for(const member of group.members.slice(1))prerequisites.get(member.id).add(group.members[0].id);
  for(const operation of operations)for(const course of operation.courses??[])for(const previous of course.after??[]){
    const before=courseGroups.get(previous),after=courseGroups.get(course.id);
    requireThat(before,'Required course predecessor is absent.');
    if(before.members[0]===after.members[0])continue;
    if(!before.end){
      before.end=before.members.length===1?before.members[0]:node(before.operation,[],'course-end');
      if(before.members.length>1)for(const member of before.members)prerequisites.get(before.end.id).add(member.id);
    }
    for(const member of after.members)prerequisites.get(member.id).add(before.end.id);
  }
  return {units,nodes,groups,prerequisites,declared,byId:new Map(nodes.map(node=>[node.id,node]))};
}

// Layer order is an initial construction-family choice, not a fixed-height
// batch. A witnessed conflict releases only the implicated native-layer edge.

function preferNativeLayers(source,graph,relaxed){
  const layers=new Map(),stacks=new Map(),edges=[];graph.layerGroups=new Map();graph.nativeRuns=new Map();
  function barrier(prototype,kind){
    const value={...prototype,id:'schedule:'+graph.nodes.length,ranges:[],entry:null,exit:null,barrier:kind,
      label:'native layer '+prototype.layerId};
    graph.nodes.push(value);graph.byId.set(value.id,value);graph.prerequisites.set(value.id,new Set());return value;
  }
  for(const group of graph.groups.values()){
    const layerId=group.members[0].layerId;if(layerId===null)continue;
    if(!layers.has(layerId))layers.set(layerId,[]);layers.get(layerId).push(group);
  }
  for(const [id,groups] of layers){
    const native=source.layers[id];requireThat(native,'Scheduling needs the producer native layer record.');
    const begin=barrier(groups[0].begin,'layer-begin'),end=barrier(groups[0].end,'layer-end');
    for(const group of groups){graph.prerequisites.get(group.begin.id).add(begin.id);graph.prerequisites.get(end.id).add(group.end.id);}
    const value={id,begin,end,index:native.index};graph.layerGroups.set(id,value);
    if(!stacks.has(native.stackId))stacks.set(native.stackId,[]);stacks.get(native.stackId).push(value);
  }
  for(const stack of stacks.values()){
    stack.sort((a,b)=>a.index-b.index);
    let run={};graph.nativeRuns.set(stack[0].id,{run,index:0});
    for(let i=1;i<stack.length;i++){
      const a=stack[i-1],b=stack[i],key=JSON.stringify([a.id,b.id]);
      if(relaxed.has(key))run={};
      graph.nativeRuns.set(b.id,{run,index:i});
      if(relaxed.has(key))continue;
      graph.prerequisites.get(b.begin.id).add(a.end.id);
      edges.push({before:a.end.id,after:b.begin.id,kind:'native-layer-order',key});
    }
  }
  return edges;
}

function relaxOrderChoices(error,edges,relaxed){
  const affected=new Set(error.refinementCourses??error.operations??[]),before=relaxed.size;
  for(const edge of edges)if(affected.has(edge.before)&&affected.has(edge.after))relaxed.add(edge.key);
  return relaxed.size>before;
}

export function resolveSourceOrder(source,reader,{onProgress,start,nozzleGeometry}={}){
  const cuts=new Map(),relaxed=new Set(),relaxedChunks=new Set(),blockedTraversals=new Set(),supportPrecision=new Map(),history={solves:0,refinements:0};
  const courseOwners=new Map(Object.values(source.operations).flatMap(operation=>(operation.courses??[]).map(course=>[course.id,{operation,course}])));
  const sourceDependencies=prepareOperationDependencies(Object.values(source.operations),new Map(Object.entries(source.operations)),source.composition);
  const authored=precedenceLookup(Object.keys(source.operations),[...sourceDependencies].flatMap(([after,parents])=>[...parents].map(before=>({before,after}))));
  for(;;){
    const graph=prepareSourceUnits(source,reader,{cuts,relaxedChunks,blockedTraversals}),choices=preferNativeLayers(source,graph,relaxed);
    const priorities=prepareOperationPriorities(graph.nodes,new Map()),state={scene:null,edges:[],promotions:[]};history.solves++;
    try{
      // Establish native groups and process barriers before any fine occupancy.
      const coarse=orderSliceCourses(graph.nodes,priorities,graph.prerequisites,{start,physicalEdges:choices});
      state.scene=prepareRangeScene(source,reader,graph.units,{onProgress,supportPrecision,nozzleGeometry});
      const proofs=prerequisiteProofs(graph.nodes.map(node=>node.id)),progress={cyclic:false};
      for(const node of coarse.operations)for(const before of graph.prerequisites.get(node.id))proofs.record(before,node.id);
      const promoted=new Map();
      function nativeBefore(before,after){
        const a=graph.nativeRuns.get(before),b=graph.nativeRuns.get(after);
        return Boolean(a&&b&&a.run===b.run&&a.index<b.index);
      }
      function precedes(before,after){
        return nativeBefore(graph.byId.get(before).layerId,graph.byId.get(after).layerId)||proofs.proves(before,after)||(promoted.get(before)??[]).some(id=>id===after||proofs.proves(id,after));
      }
      function addEdge(before,after,kind,witness){
        if(before===after||graph.prerequisites.get(after).has(before))return;
        if(precedes(after,before))progress.cyclic=true;
        graph.prerequisites.get(after).add(before);proofs.record(before,after);state.edges.push({before,after,kind,witness});
      }
      function preferWholeGroup(unit,hit){
        // An explicit source operation is also a useful relaxable aggregate.
        // This does not invent a native layer for a standalone Trace.
        const native=graph.layerGroups.get(hit.unit.layerId),layer=native??graph.groups.get(hit.unit.sourceOperation);
        if(progress.cyclic||!layer||unit.sourceOperation===hit.unit.sourceOperation||unit.layerId!==null&&unit.layerId===hit.unit.layerId||precedes(layer.begin.id,unit.id))return;
        const group=graph.groups.get(unit.sourceOperation),before=group.end.id;
        const key=JSON.stringify([native?'operation-layer':'operation-operation',unit.sourceOperation,native?hit.unit.layerId:hit.unit.sourceOperation]);
        if(relaxed.has(key)||precedes(before,layer.begin.id)||precedes(layer.begin.id,before))return;
        addEdge(before,layer.begin.id,native?'access-layer-choice':'access-operation-choice',null);
        const edge=state.edges.at(-1);edge.key=key;state.promotions.push(edge);
        for(const member of group.members){
          if(!promoted.has(member.id))promoted.set(member.id,[]);promoted.get(member.id).push(layer.begin.id);
        }
      }
      for(const unit of graph.units){
        for(const requirement of unit.operation.requiredMaterial??[]){
          for(const hit of state.scene.requiredHits(requirement,id=>{
            const other=graph.byId.get(id);
            return other.sourceOperation!==unit.sourceOperation&&(other.operation.part??null)===(requirement.part??null);
          }))addEdge(hit.unit.id,graph.groups.get(unit.sourceOperation).begin.id,'required-material',hit.witness);
        }
        if(progress.cyclic)break;
      }
      // Resolve whole native layers before opening their courses. A run is
      // only the still-present chain of preferred layer edges; relaxation
      // rebuilds it. Occupied/injected or unlayered material stays detailed.
      const accessLayers=new Set(),supportLayers=new Set();
      if(graph.units.every(unit=>unit.operation.kind==='deposit'&&!unit.operation.occupied&&graph.layerGroups.has(unit.layerId))){
        const ids=[...graph.layerGroups.keys()];
        for(const id of ids){
          if(ids.every(other=>state.scene.proofs.clear(id,other)||nativeBefore(id,other)))accessLayers.add(id);
          const a=source.layers[id];
          if(ids.every(other=>{
            const b=source.layers[other];
            return state.scene.proofs.layersApart(id,other)||nativeBefore(other,id)||id===other||a.surfaceId===b.surfaceId||a.stackId===b.stackId&&b.index>=a.index;
          }))supportLayers.add(id);
        }
      }
      Object.assign(state.scene.proofs.summary,{resolvedAccessLayers:accessLayers.size,resolvedSupportLayers:supportLayers.size});
      if(!progress.cyclic)onProgress?.({stage:'Resolving slice nozzle access',completed:accessLayers.size,total:graph.layerGroups.size});
      if(!progress.cyclic)for(const [completed,unit] of graph.units.entries()){
        if(accessLayers.has(unit.layerId))continue;
        onProgress?.({stage:'Resolving curve nozzle access',completed,total:graph.units.length});
        try{state.scene.verifySelf(unit);}catch(error){
          if(unit.traversalChoice&&unit.traversalAlternatives>1)error.traversalChoice=unit.traversalChoice.key;
          throw error;
        }
        for(const hit of state.scene.nozzleHits(unit,id=>id!==unit.id&&!state.scene.proofs.clear(unit.layerId,graph.byId.get(id).layerId)&&
          !precedes(unit.id,id))){
          addEdge(unit.id,hit.unit.id,'nozzle-access',hit.witness);preferWholeGroup(unit,hit);
        }
        if(progress.cyclic)break;
      }
      if(!progress.cyclic)for(const [completed,unit] of graph.units.entries()){
        if(supportLayers.has(unit.layerId))continue;
        onProgress?.({stage:'Resolving curve substrate',completed,total:graph.units.length});
        for(const hit of state.scene.supportHits(unit,id=>{
          if(id===unit.id||precedes(id,unit.id))return false;
          const other=graph.byId.get(id),a=source.layers[unit.layerId],b=source.layers[other.layerId];
          if(a&&b&&(unit.layerId===other.layerId||a.surfaceId===b.surfaceId||a.stackId===b.stackId&&b.index>=a.index))return false;
          return true;
        })){
          addEdge(hit.unit.id,unit.id,'substrate',hit.witness);preferWholeGroup(hit.unit,{unit});
        }
        if(progress.cyclic)break;
      }
      const ordered=orderSliceCourses(graph.nodes,priorities,graph.prerequisites,{start,physicalEdges:[...choices,...state.edges]});
      for(const unit of ordered.operations)if(!unit.barrier){
        const body=state.scene.byId.get(unit.id);
        if(body.records.length===unit.ranges.length&&body.records.every((record,i)=>record.ref.id===unit.ranges[i]?.id&&record.ref.from===unit.ranges[i].from&&
          record.ref.to===unit.ranges[i].to&&Boolean(record.ref.reverse)===Boolean(unit.ranges[i].reverse)))continue;
        body.records=unit.ranges.map(state.scene.interval);
        try{state.scene.verifySelf(unit);}catch(error){
          if(unit.traversalChoice&&unit.traversalAlternatives>1)error.traversalChoice=unit.traversalChoice.key;
          throw error;
        }
      }
      return {units:ordered.operations.filter(unit=>!unit.barrier),scene:state.scene,hierarchy:ordered.hierarchy,
        edges:state.edges,refinement:{...history,relaxedOrderChoices:relaxed.size,relaxedTraversalChunks:relaxedChunks.size,rejectedTraversals:blockedTraversals.size,
          wholeLayerChoices:state.promotions.filter(edge=>edge.kind==='access-layer-choice').length,wholeOperationChoices:state.promotions.filter(edge=>edge.kind==='access-operation-choice').length,splitCourses:cuts.size}};
    }catch(error){
      if(error.traversalChoice&&!blockedTraversals.has(error.traversalChoice)){blockedTraversals.add(error.traversalChoice);continue;}
      if(error.code!=='PRINT_ORDER_CONFLICT'&&error.code!=='CONTINUOUS_NOZZLE_CONFLICT')throw error;
      if(relaxOrderChoices(error,[...choices,...state.promotions],relaxed))continue;
      const implicated=new Set(error.refinementCourses??error.operations??[]),before=relaxedChunks.size;
      for(const unit of graph.units)if(implicated.has(unit.id)&&unit.traversalKey)relaxedChunks.add(unit.traversalKey);
      if(relaxedChunks.size>before)continue;
      if(!state.scene)throw error;
      const reasons=error.physicalDependencies??[];
      if(authored.cyclic||reasons.some(edge=>edge.kind==='nozzle-access'&&!edge.witness?.provisional&&authored.has(graph.byId.get(edge.after).sourceOperation,graph.byId.get(edge.before).sourceOperation)))throw error;
      for(const edge of reasons)if(edge.kind==='nozzle-access'&&!edge.witness?.provisional){
        const witness=state.scene.mutualConflict(edge.witness?.receiver,edge.witness?.material);
        if(witness)throw Object.assign(Error('Two deposited sections mutually block nozzle access; changing their order or splitting the curves cannot resolve it.'),
          {code:'NOZZLE_MUTUAL_CONFLICT',witness,operations:[graph.byId.get(edge.before).sourceOperation,graph.byId.get(edge.after).sourceOperation]});
      }
      for(const nozzle of reasons)if(nozzle.kind==='nozzle-access'&&!nozzle.witness?.provisional){
        const blocker=graph.byId.get(nozzle.after);
        const atomic=!blocker.operation.interruptible||blocker.ranges.every(range=>!range.interruptible);
        if(!atomic)continue;
        for(const support of reasons){
          if(support.before!==nozzle.after)continue;
          if(support.kind==='required-material'&&graph.byId.get(support.after).sourceOperation===graph.byId.get(nozzle.before).sourceOperation)
            throw Object.assign(Error('An atomic material prerequisite blocks nozzle access to the operation requiring it.'),{code:'MATERIAL_ACCESS_CONFLICT',physicalDependencies:[support,nozzle]});
          if(support.kind!=='substrate'||support.after!==nozzle.before||support.witness?.provisional)continue;
          const witness=state.scene.atomicSupportConflict(nozzle.witness,support.witness);
          if(witness)throw Object.assign(Error('A source section needs an atomic substrate whose deposited material blocks its nozzle.'),
            {code:'NOZZLE_SUBSTRATE_CONFLICT',witness,operations:[blocker.sourceOperation,graph.byId.get(nozzle.before).sourceOperation]});
        }
      }
      const uncertain=reasons.filter(edge=>edge.witness?.provisional);
      if(uncertain.length){
        for(const edge of uncertain){
          const witness=edge.witness,key=JSON.stringify([...(edge.kind==='nozzle-access'?['nozzle-access']:[]),witness.receiver.id,witness.material?.id??null]);
          if(witness.precision<=ROUNDING_MM)throw Object.assign(Error('Contact order is unresolved at numerical precision.'),{code:edge.kind==='nozzle-access'?'CURVE_CLEARANCE_UNRESOLVED':'SUPPORT_CONTACT_UNRESOLVED',witness});
          supportPrecision.set(key,witness.precision/2);
        }
        continue;
      }
      const witnesses=error.witness?[error.witness]:reasons.map(edge=>edge.witness).filter(Boolean),added=[];
      function addCut(id,u){
        const owner=courseOwners.get(id);if(!owner?.operation.interruptible||!owner.course.interruptible||!(u>owner.course.from&&u<owner.course.to))return;
        if(!cuts.has(id))cuts.set(id,new Set());const values=cuts.get(id),cut=executionCut(reader,owner.course,u,values);
        if(cut!==null){values.add(cut);added.push({id,u:cut});}
      }
      const proposals=witnesses.flatMap(witness=>state.scene.cutsForWitness(witness).map(proposal=>({...proposal,material:proposal.courseId===witness.material?.id}))).map(proposal=>{
        const owner=courseOwners.get(proposal.courseId),existing=cuts.get(proposal.courseId);
        const parameters=owner?.operation.interruptible&&owner.course.interruptible?[...new Set(proposal.parameters)].filter(u=>u>owner.course.from&&u<owner.course.to&&!existing?.has(u)):[];
        return {...proposal,parameters};
      }).filter(proposal=>proposal.parameters.length).sort((a,b)=>a.parameters.length-b.parameters.length||Number(b.material)-Number(a.material));
      if(proposals.length)for(const u of proposals[0].parameters)addCut(proposals[0].courseId,u);
      if(!added.length)for(const witness of witnesses)for(const ref of [witness.receiver,witness.material])if(ref){
        addCut(ref.id,ref.from);addCut(ref.id,ref.to);
        if(ref.at!==undefined)addCut(ref.id,ref.at);
        else addCut(ref.id,(ref.from+ref.to)/2);
      }
      if(!added.length)throw Object.assign(Error('Source ordering is unresolved at physical interruption resolution.'),
        {code:'SOURCE_ORDER_UNRESOLVED',cause:error,witnesses});
      history.refinements++;
      onProgress?.({stage:'Refining witnessed curve conflicts'});
    }
  }
}

export function planSourceComposition(initialState,source,reader,onProgress){
  const solved=resolveSourceOrder(source,reader,{onProgress,start:initialState.position,nozzleGeometry:initialState.nozzleGeometry}),scene=solved.scene;
  const elapsed=new Map(),paid=new Map(),actions=new ActionAccumulator(),cursor={state:initialState,last:null};
  const keyOf=unit=>unit.layerId??unit.operation;
  function cool(unit){
    const key=keyOf(unit),cooling=planLayerCooling({...cursor.state,layerSeconds:(elapsed.get(key)??0)+(paid.get(key)??0)},scene);
    cursor.state=cooling.state;actions.add(cooling.actions);paid.set(key,(paid.get(key)??0)+(cooling.coolingSeconds??0));
  }
  for(const [completed,unit] of solved.units.entries()){
    if(cursor.last&&keyOf(cursor.last)!==keyOf(unit)&&!cursor.last.operation.continuous)cool(cursor.last);
    const key=keyOf(unit),operation={...unit.operation,process:unit.process,phase:unit.operation.phase??unit.operation.kind,layer:unit.operation.layer??source.layers[unit.layerId]?.index??0};
    const entered=planOperationEntry(cursor.state,operation,{layerSeconds:elapsed.get(key)??0,nozzleScene:scene});
    cursor.state=entered.state;actions.add(entered.actions);
    // Cooling and process changes can park the nozzle after ordering. Choose
    // this chunk's entry from that actual position, preserving the proven DAG.
    if(unit.traversals?.length)selectTraversal(unit,{point:cursor.state.position,axis:cursor.state.pose.toolAxis},selected=>{
      scene.byId.get(selected.id).records=selected.ranges.map(scene.interval);scene.verifySelf(selected);
    });
    if(operation.kind==='inject'){
      const injection=operation.injection,approached=planTravel(cursor.state,injection.at,scene,injection.pose);
      const extruded=planExtrusion(approached.state,injection.volumeMm3,injection.flowMm3S),held=planDwell(extruded.state,injection.holdSeconds);
      cursor.state={...held.state,layerSeconds:held.state.layerSeconds+injection.holdSeconds};
      actions.add(approached.actions);actions.add(extruded.actions);actions.add(held.actions);scene.occupied.add(unit.id);scene.deposited.set(unit.id,0);
    }else for(const [i,range] of unit.ranges.entries()){
      const entry=curveAt(reader,range.curveId,range.reverse?range.to:range.from,range.reverse?{side:'left'}:{}),approached=planTravel(cursor.state,entry.point,scene,entry.pose);
      const deposited=planDepositRange(approached.state,source,reader,range,scene.byId.get(unit.id).records[i]);
      cursor.state=deposited.state;actions.add(approached.actions);actions.add(deposited.actions);
      scene.occupied.add(unit.id);scene.deposited.set(unit.id,i+1);
    }
    const ended=planOperationEnd(cursor.state,operation,scene);cursor.state=ended.state;actions.add(ended.actions);
    elapsed.set(key,cursor.state.layerSeconds);cursor.last=unit;
    onProgress?.({stage:'Planning source ranges',completed:completed+1,total:solved.units.length});
  }
  if(cursor.last&&!cursor.last.operation.continuous)cool(cursor.last);
  const count=kind=>solved.edges.filter(edge=>edge.kind===kind).length;
  return planningResult({...planProcess(cursor.state).state,operationId:undefined},actions.finish(),{nozzleScene:scene,
    summary:{hierarchy:solved.hierarchy,aggregateProofs:scene.proofs.summary,refinement:solved.refinement,executionUnits:solved.units.length,
      physicalOrdering:{substrateDependencies:count('substrate'),nozzleDependencies:count('nozzle-access'),materialDependencies:count('required-material'),
        conservativeSupportChoices:solved.edges.filter(edge=>edge.kind==='substrate'&&edge.witness?.provisional).length,
        conservativeNozzleChoices:solved.edges.filter(edge=>edge.kind==='nozzle-access'&&edge.witness?.provisional).length},queries:{...scene.stats}}});
}

// Ordering-only callers use the same admitted source and solver as scheduling.
export function scheduleOperations(source,options={}){
  requireThat(source?.schema==='saampath/2','Operation ordering requires compact constructed SAAMpath.');
  return resolveSourceOrder(source,prepareCurvePath(source),options).units;
}
