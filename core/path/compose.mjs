import {curveAt} from './curve-path.mjs';
import {ROUNDING_MM} from '../dimensions.mjs';
import {requireThat,distance} from '../private/toolpath/numeric.mjs';
import {orderSliceCourses} from './course-order.mjs';
import {precedenceLookup,prerequisiteProofs} from './precedence.mjs';
export {orderReadyOperations} from './course-order.mjs';
import {depositionCourses,physicalOrdering,refineCourseStrokes,prepareRangeScene} from './physical-order.mjs';
// Skill results describe deposition operations. The composer advances explicit
// planning state through scheduled operations and returns action chunks.

import {ActionAccumulator,planningResult,planContext,planFan,planNozzle,planPark,planTravel,planMove,
  planExtrusion,planDwell,planLayerCooling,planSelection,planProcess,planDepositRange} from './planning.mjs';

// Schedule once, then advance explicit motion state through operations. Layer and
// obstacle ledgers are local scheduling work, never shared builder state.
export function planComposition(initialState,skillResults,rules={},onProgress) {
  const resolved=resolveOperationOrder(skillResults,rules,{onProgress,start:initialState.position});
  const operations=resolved.operations.map(op=>{
    const layerId=initialState.selections&&/^planar:[\d.e+-]+$/.test(op.layerId)?'planar:'+Number(Number(op.layerId.slice(7)).toFixed(5)):op.layerId;
    return {...op,layerId};
  });
  const nozzleScene={index:resolved.physical.index,beads:resolved.physical.beads,byStart:resolved.physical.byStart,occupied:new Set(),withinGroups:new Set(),groupPrefixes:new Map()};
  const elapsed=new Map(),paid=new Map(),actions=new ActionAccumulator(),layers=new Set();
  const layerIndices=initialState.selections?new Map([...new Set(operations.map(op=>op.layerId))].map((id,i)=>[id,i])):null;
  let state=initialState,completed=0,last=null;
  onProgress?.({stage:'Planning print moves',completed,total:operations.length});
  for(const op of operations){
    if(last&&last.layerId!==op.layerId&&!last.continuous){
      const cooling=planLayerCooling({...state,layerSeconds:(elapsed.get(last.layerId)??0)+(paid.get(last.layerId)??0)},nozzleScene);
      state=cooling.state;actions.add(cooling.actions);paid.set(last.layerId,(paid.get(last.layerId)??0)+(cooling.coolingSeconds??0));
    }
    const planned=planOperation(state,layerIndices?{...op,layer:layerIndices.get(op.layerId)}:op,{nozzleScene,layerSeconds:elapsed.get(op.layerId)??0});
    state=planned.state;actions.add(planned.actions);elapsed.set(op.layerId,planned.operationSeconds);layers.add(op.layerId);last=op;
    onProgress?.({stage:'Planning print moves',completed:++completed,total:operations.length});
  }
  if(last&&!last.continuous){const cooled=planLayerCooling({...state,layerSeconds:(elapsed.get(last.layerId)??0)+(paid.get(last.layerId)??0)},nozzleScene);state=cooled.state;actions.add(cooled.actions);}
  return planningResult({...state,operationId:undefined},actions.finish(),{nozzleScene,summary:{operationOrder:operations.map(op=>op.id),layers:layers.size,
    hierarchy:resolved.hierarchy,physicalOrdering:{substrateDependencies:resolved.physical.substrateDependencies,nozzleDependencies:resolved.physical.nozzleDependencies,materialDependencies:resolved.physical.materialDependencies,
      nozzle:'Effectively infinite sharp cone; 15 degree included angle; carriage unchecked.'}}});
}

export function planOperation(initialState,op,options={}) {
  const entered=planOperationEntry(initialState,op,options);
  const deposited=planPreparedOperation(entered.state,op,options);
  return planningResult(deposited.state,{chunks:[entered.actions,deposited.actions]},{operationSeconds:deposited.operationSeconds});
}

export function planOperationEntry(initialState,op,{layerSeconds=0,nozzleScene}={}) {
  const contextual=planContext({...initialState,layerSeconds,layerId:op.layerId},op.phase,op.layer,op.sourceOperation??op.id);
  const selected=planSelection(contextual.state,op.filament??initialState.defaultFilament);
  const configured=planProcess(selected.state,op.process);
  const prepared=planOperationStart(configured.state,op,nozzleScene);
  return planningResult(prepared.state,{chunks:[selected.actions,prepared.actions]});
}

// The caller has already applied selection, temperature and parking actions.
export function planPreparedOperation(initialState,op,{nozzleScene,finishLayer=false}={}) {
  const strokes=op.strokes;
  const actions=new ActionAccumulator();
  let state=initialState;
  for(const stroke of strokes){
    const approached=planStrokeApproach(state,stroke,op,nozzleScene);
    const depositedStroke=planStrokeDeposition(approached.state,stroke,op);
    state=depositedStroke.state;actions.add(approached.actions);actions.add(depositedStroke.actions);
    for(const point of stroke.points)for(const i of nozzleScene.byStart.get(point)??[])if(nozzleScene.beads[i].operationId===op.id){
      nozzleScene.occupied.add(i);nozzleScene.groupPrefixes.set(op.id,Math.max(nozzleScene.groupPrefixes.get(op.id)??-1,i));}
    if(!nozzleScene.withinGroups.has(op.id))nozzleScene.withinGroups=new Set([...nozzleScene.withinGroups,op.id]);
  }
  const restored=planOperationEnd(state,op,nozzleScene),operationSeconds=restored.state.layerSeconds;
  const cooled=finishLayer?planLayerCooling(restored.state,nozzleScene):planningResult(restored.state);
  actions.add(restored.actions);actions.add(cooled.actions);
  return planningResult(planProcess(cooled.state).state,actions.finish(),{operationSeconds});
}

export function planOperationStart(state,op,nozzleScene) {
  const fan=op.fanPercent!==undefined?planFan(state,op.fanPercent):planningResult(state);
  if(op.nozzleC===undefined)return fan;
  const parked=planPark(fan.state,nozzleScene),heated=planNozzle(parked.state,op.nozzleC);
  return planningResult(heated.state,{chunks:[fan.actions,parked.actions,heated.actions]});
}

export function planOperationEnd(state,op,nozzleScene) {
  if(op.nozzleC===undefined)return planningResult(state);
  const parked=planPark(state,nozzleScene),restored=planNozzle(parked.state,op.restoreNozzleC);
  return planningResult(restored.state,{chunks:[parked.actions,restored.actions]});
}

function segmentExtras(stroke,op,index) {
  return {role:stroke.role,...(stroke.poses?{pose:stroke.poses[index+1]}:{}),
    ...(stroke.beadWidthMm!==undefined?{beadWidthMm:stroke.beadWidthMm}:{}),
    ...(stroke.beadHeightMm!==undefined?{beadHeightMm:stroke.beadHeightMm}:{}),
    ...(op.regionId?{region:op.regionId}:{}),...(stroke.segmentMetadata?.[index]??{})};
}

export function planStrokeApproach(state,stroke,op,nozzleScene) {
  requireThat(stroke.points.length>=(stroke.stationaryExtrusion?1:2),'An operation stroke needs at least two points or an explicit stationary extrusion.');
  requireThat(!stroke.poses||stroke.poses.length===stroke.points.length,'Stroke pose/point count differs.');
  // Depositing connections are explicit finalized strokes, never late material.
  const travel=planTravel(state,stroke.points[0],nozzleScene,stroke.poses?.[0]);
  return planningResult(travel.state,travel.actions,
    {connected:false,travelKind:travel.travelKind});
}

export function planStrokeDeposition(initialState,stroke,op) {
  const actions=new ActionAccumulator();
  let state=initialState;
  if(stroke.stationaryExtrusion){
    requireThat(stroke.points.length===1&&!stroke.closed,'Stationary extrusion needs one point.');
    const extruded=planExtrusion(state,stroke.stationaryExtrusion.volumeMm3,stroke.stationaryExtrusion.flowMm3S);
    const holdSeconds=stroke.stationaryExtrusion.holdSeconds??0,held=planDwell(extruded.state,holdSeconds);
    state={...held.state,layerSeconds:held.state.layerSeconds+holdSeconds};actions.add(extruded.actions);actions.add(held.actions);
  }
  for(let i=1;i<stroke.points.length;i++){
    const volume=stroke.volumesMm3?stroke.volumesMm3[i-1]:distance(stroke.points[i-1],stroke.points[i])*stroke.beadAreaMm2;
    requireThat(Number.isFinite(volume)&&volume>=0,'Invalid operation deposition volume.');
    const speed=stroke.segmentMetadata?.[i-1]?.speedMmS??stroke.speedMmS;
    requireThat(Number.isFinite(speed),'Invalid operation deposition speed.');
    const moved=planMove(state,stroke.points[i],speed,volume,segmentExtras(stroke,op,i-1));
    state=moved.state;actions.add(moved.actions);
  }
  return planningResult(state,actions.finish());
}

export function scheduleOperations(skillResults,rules={}) {
  return resolveOperationOrder(skillResults,rules).operations;
}

function resolveOperationOrder(skillResults,rules,{onProgress,start}={}){
  const batch=validateOperationBatch(skillResults);
  const declared=prepareOperationDependencies(batch.operations,batch.byId,rules),splitConnectors=new Set(),splitStrokes=new Map();
  const declaredBefore=precedenceLookup(batch.operations.map(operation=>operation.id),
    [...declared].flatMap(([after,parents])=>[...parents].map(before=>({before,after}))));
  for(;;){
    const partition=depositionCourses(batch.operations,{splitConnectors,splitStrokes});
    try{return solveCourseOrder(batch,declared,partition,{onProgress,start});}
    catch(error){
      if(!['PRINT_ORDER_CONFLICT','CONTINUOUS_NOZZLE_CONFLICT'].includes(error.code))throw error;
      // An authored prerequisite requires the entire source operation first.
      // Subdividing either unchanged path cannot remove a witnessed nozzle hit
      // against that material; reject this contradiction without grid refinement.
      const sourceOf=new Map(partition.courses.map(course=>[course.id,course.sourceOperation]));
      if(declaredBefore.cyclic||error.physicalDependencies?.some(edge=>edge.kind==='nozzle-access'&&
        declaredBefore.has(sourceOf.get(edge.after),sourceOf.get(edge.before))))throw error;
      const affected=new Set(error.refinementCourses??error.operations??[error.operation]);
      const refinable=partition.courses.filter(course=>affected.has(course.id)&&!splitConnectors.has(course.sourceOperation)&&
        course.strokes.length>1&&!course.continuous&&!course.strokes.some(stroke=>stroke.stationaryExtrusion));
      if(!refinable.length){
        if(!refineCourseStrokes(partition,affected,splitStrokes))throw error;
        onProgress?.({stage:'Refining interruptible strokes',completed:splitStrokes.size,total:batch.operations.reduce((count,operation)=>count+operation.strokes.length,0)});continue;
      }
      for(const course of refinable)splitConnectors.add(course.sourceOperation);
      onProgress?.({stage:'Refining interruptible connections',completed:splitConnectors.size,total:batch.operations.length});
    }
  }
}

function solveCourseOrder(batch,declared,{courses,groups,sequence},{onProgress,start}){
  const prerequisites=new Map(courses.map(course=>[course.id,new Set([...declared.get(course.sourceOperation)].flatMap(id=>groups.get(id)))]));
  for(const edge of sequence)prerequisites.get(edge.after).add(edge.before);
  const physical=physicalOrdering(courses,{onProgress,prerequisites});
  for(const edge of physical.edges)prerequisites.get(edge.after).add(edge.before);
  const priorityById=prepareOperationPriorities(courses,batch.resultIndex);
  const ordered=orderSliceCourses(courses,priorityById,prerequisites,{start,physicalEdges:[...sequence,...physical.edges]});
  return {...ordered,physical};
}

export function validateOperationBatch(skillResults) {
  const operations = skillResults.flatMap(result => result.operations);
  const resultIndex = new Map(skillResults.flatMap((r,i)=>r.operations.map(op=>[op.id,i])));
  const byId = new Map();
  for (const operation of operations) {
    requireThat(typeof operation.id === 'string' && operation.id && !byId.has(operation.id), 'Duplicate or missing operation id.');
    requireThat(typeof operation.layerId === 'string' && operation.layerId && Number.isFinite(operation.rank), 'Operation needs a layer reference and finite scheduling rank.');
    requireThat(Array.isArray(operation.strokes)&&!operation.travelPolicy,'Operation needs deposition strokes, without runtime travel callbacks.');
    requireThat(operation.order==='given','Scheduling consumes finalized deposition order.');
    byId.set(operation.id, operation);
  }
  return {operations,resultIndex,byId};
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
export function prepareSourceUnits(source,reader,{cuts=new Map()}={}){
  const operations=Object.values(source.operations),bySource=new Map(operations.map(op=>[op.id,op]));
  const declared=prepareOperationDependencies(operations,bySource,source.composition);
  const units=[],nodes=[],groups=new Map(),prerequisites=new Map(),counter={next:0};
  function node(operation,ranges,barrier=null){
    const id='schedule:'+counter.next++,injection=operation.kind==='inject'?operation.injection:null;
    const entry=barrier?null:injection?{point:injection.at,pose:injection.pose}:curveAt(reader,ranges[0].curveId,ranges[0].from);
    const last=ranges.at(-1),exit=barrier?null:injection?entry:curveAt(reader,last.curveId,last.to,{side:'left'});
    const value={id,sourceOperation:operation.id,layerId:operation.layerId,operation,process:source.processes[operation.processId],
      ranges,entry,exit,barrier,label:operation.id+(ranges.length===1?' ['+ranges[0].id+' '+ranges[0].from+'..'+ranges[0].to+']':''),
      constructionRank:operation.constructionRank??0};
    nodes.push(value);prerequisites.set(id,new Set());if(!barrier)units.push(value);return value;
  }
  for(const operation of operations){
    const members=[];
    if(operation.kind==='inject'||!operation.interruptible)members.push(node(operation,operation.courses??[]));
    else for(const course of operation.courses){
      const breaks=course.interruptible?[...new Set(cuts.get(course.id)??[])].filter(u=>u>course.from&&u<course.to).sort((a,b)=>a-b):[];
      const parameters=[course.from,...breaks,course.to];
      for(let i=1;i<parameters.length;i++)members.push(node(operation,[{...course,from:parameters[i-1],to:parameters[i]}]));
    }
    requireThat(members.length>0,'Source operation has no execution unit.');
    const begin=members.length===1?members[0]:node(operation,[],'begin');
    const end=members.length===1?members[0]:node(operation,[],'end');
    if(members.length>1)for(const member of members){prerequisites.get(member.id).add(begin.id);prerequisites.get(end.id).add(member.id);}
    groups.set(operation.id,{members,begin,end});
  }
  for(const [id,parents] of declared)for(const parent of parents)prerequisites.get(groups.get(id).begin.id).add(groups.get(parent).end.id);
  return {units,nodes,groups,prerequisites,declared,byId:new Map(nodes.map(node=>[node.id,node]))};
}

// Layer order is an initial construction-family choice, not a fixed-height
// batch. A witnessed conflict releases only the implicated native-layer edge.
function preferNativeLayers(source,graph,relaxed){
  const layers=new Map(),stacks=new Map(),edges=[];
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
    const value={id,begin,end,index:native.index};
    if(!stacks.has(native.stackId))stacks.set(native.stackId,[]);stacks.get(native.stackId).push(value);
  }
  for(const stack of stacks.values()){
    stack.sort((a,b)=>a.index-b.index);
    for(let i=1;i<stack.length;i++){
      const a=stack[i-1],b=stack[i],key=JSON.stringify([a.id,b.id]);if(relaxed.has(key))continue;
      graph.prerequisites.get(b.begin.id).add(a.end.id);
      edges.push({before:a.end.id,after:b.begin.id,kind:'native-layer-order',key});
    }
  }
  return edges;
}

function relaxNativeLayers(error,edges,relaxed){
  const affected=new Set(error.refinementCourses??error.operations??[]),before=relaxed.size;
  for(const edge of edges)if(affected.has(edge.before)&&affected.has(edge.after))relaxed.add(edge.key);
  return relaxed.size>before;
}

export function resolveSourceOrder(source,reader,{onProgress,start}={}){
  const cuts=new Map(),relaxed=new Set(),supportPrecision=new Map(),history={solves:0,refinements:0};
  const courseOwners=new Map(Object.values(source.operations).flatMap(operation=>(operation.courses??[]).map(course=>[course.id,{operation,course}])));
  const sourceDependencies=prepareOperationDependencies(Object.values(source.operations),new Map(Object.entries(source.operations)),source.composition);
  const authored=precedenceLookup(Object.keys(source.operations),[...sourceDependencies].flatMap(([after,parents])=>[...parents].map(before=>({before,after}))));
  for(;;){
    const graph=prepareSourceUnits(source,reader,{cuts}),layerEdges=preferNativeLayers(source,graph,relaxed);
    const priorities=prepareOperationPriorities(graph.nodes,new Map()),state={scene:null,edges:[]};history.solves++;
    try{
      // Establish native groups and process barriers before any fine occupancy.
      const coarse=orderSliceCourses(graph.nodes,priorities,graph.prerequisites,{start,physicalEdges:layerEdges});
      state.scene=prepareRangeScene(source,reader,graph.units,{onProgress,supportPrecision});
      const proofs=prerequisiteProofs(graph.nodes.map(node=>node.id)),progress={cyclic:false};
      for(const node of coarse.operations)for(const before of graph.prerequisites.get(node.id))proofs.record(before,node.id);
      function addEdge(before,after,kind,witness){
        if(before===after||graph.prerequisites.get(after).has(before))return;
        if(proofs.proves(after,before))progress.cyclic=true;
        graph.prerequisites.get(after).add(before);proofs.record(before,after);state.edges.push({before,after,kind,witness});
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
      if(!progress.cyclic)for(const [completed,unit] of graph.units.entries()){
        onProgress?.({stage:'Resolving curve substrate',completed,total:graph.units.length});
        for(const hit of state.scene.supportHits(unit,id=>{
          if(id===unit.id||proofs.proves(id,unit.id))return false;
          const other=graph.byId.get(id),a=source.layers[unit.layerId],b=source.layers[other.layerId];
          if(a&&b&&(unit.layerId===other.layerId||a.surfaceId===b.surfaceId||a.stackId===b.stackId&&b.index>=a.index))return false;
          return true;
        }))addEdge(hit.unit.id,unit.id,'substrate',hit.witness);
        if(progress.cyclic)break;
      }
      if(!progress.cyclic)for(const [completed,unit] of graph.units.entries()){
        onProgress?.({stage:'Resolving curve nozzle access',completed,total:graph.units.length});
        state.scene.verifySelf(unit);
        for(const hit of state.scene.nozzleHits(unit,id=>id!==unit.id&&!proofs.proves(unit.id,id)&&
          !state.scene.proofs.clear(unit.layerId,graph.byId.get(id).layerId)))addEdge(unit.id,hit.unit.id,'nozzle-access',hit.witness);
        if(progress.cyclic)break;
      }
      const ordered=orderSliceCourses(graph.nodes,priorities,graph.prerequisites,{start,physicalEdges:[...layerEdges,...state.edges]});
      return {units:ordered.operations.filter(unit=>!unit.barrier),scene:state.scene,hierarchy:ordered.hierarchy,
        edges:state.edges,refinement:{...history,relaxedLayerEdges:relaxed.size,splitCourses:cuts.size}};
    }catch(error){
      if(error.code!=='PRINT_ORDER_CONFLICT'&&error.code!=='CONTINUOUS_NOZZLE_CONFLICT')throw error;
      if(relaxNativeLayers(error,layerEdges,relaxed))continue;
      if(!state.scene)throw error;
      const reasons=error.physicalDependencies??[];
      if(authored.cyclic||reasons.some(edge=>edge.kind==='nozzle-access'&&authored.has(graph.byId.get(edge.after).sourceOperation,graph.byId.get(edge.before).sourceOperation)))throw error;
      for(const edge of reasons)if(edge.kind==='nozzle-access'){
        const witness=state.scene.mutualConflict(edge.witness?.receiver,edge.witness?.material);
        if(witness)throw Object.assign(Error('Two deposited sections mutually block nozzle access; changing their order or splitting the curves cannot resolve it.'),
          {code:'NOZZLE_MUTUAL_CONFLICT',witness,operations:[graph.byId.get(edge.before).sourceOperation,graph.byId.get(edge.after).sourceOperation]});
      }
      for(const nozzle of reasons)if(nozzle.kind==='nozzle-access'){
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
          const witness=edge.witness,key=JSON.stringify([witness.receiver.id,witness.material.id]);
          if(witness.precision<=ROUNDING_MM)throw Object.assign(Error('Material contact order is unresolved at numerical precision.'),{code:'SUPPORT_CONTACT_UNRESOLVED',witness});
          supportPrecision.set(key,witness.precision/2);
        }
        continue;
      }
      const witnesses=error.witness?[error.witness]:reasons.map(edge=>edge.witness).filter(Boolean),added=[];
      function addCut(id,u){
        const owner=courseOwners.get(id);if(!owner?.operation.interruptible||!owner.course.interruptible||!(u>owner.course.from&&u<owner.course.to))return;
        if(!cuts.has(id))cuts.set(id,new Set());const values=cuts.get(id);
        if(!values.has(u)){values.add(u);added.push({id,u});}
      }
      const proposals=witnesses.flatMap(witness=>state.scene.cutsForWitness(witness)).map(proposal=>{
        const owner=courseOwners.get(proposal.courseId),existing=cuts.get(proposal.courseId);
        const parameters=owner?.operation.interruptible&&owner.course.interruptible?[...new Set(proposal.parameters)].filter(u=>u>owner.course.from&&u<owner.course.to&&!existing?.has(u)):[];
        return {...proposal,parameters};
      }).filter(proposal=>proposal.parameters.length).sort((a,b)=>a.parameters.length-b.parameters.length);
      if(proposals.length)for(const u of proposals[0].parameters)addCut(proposals[0].courseId,u);
      if(!added.length)for(const witness of witnesses)for(const ref of [witness.receiver,witness.material])if(ref){
        addCut(ref.id,ref.from);addCut(ref.id,ref.to);
        if(ref.at!==undefined)addCut(ref.id,ref.at);
        else addCut(ref.id,(ref.from+ref.to)/2);
      }
      if(!added.length)throw error;
      history.refinements++;
      onProgress?.({stage:'Refining witnessed curve conflicts',completed:history.refinements,total:cuts.size});
    }
  }
}

export function planSourceComposition(initialState,source,reader,onProgress){
  const solved=resolveSourceOrder(source,reader,{onProgress,start:initialState.position}),scene=solved.scene;
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
    if(operation.kind==='inject'){
      const injection=operation.injection,approached=planTravel(cursor.state,injection.at,scene,injection.pose);
      const extruded=planExtrusion(approached.state,injection.volumeMm3,injection.flowMm3S),held=planDwell(extruded.state,injection.holdSeconds);
      cursor.state={...held.state,layerSeconds:held.state.layerSeconds+injection.holdSeconds};
      actions.add(approached.actions);actions.add(extruded.actions);actions.add(held.actions);scene.occupied.add(unit.id);scene.deposited.set(unit.id,0);
    }else for(const [i,range] of unit.ranges.entries()){
      const entry=curveAt(reader,range.curveId,range.from),approached=planTravel(cursor.state,entry.point,scene,entry.pose);
      const deposited=planDepositRange(approached.state,source,reader,range);
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
    summary:{hierarchy:solved.hierarchy,refinement:solved.refinement,executionUnits:solved.units.length,
      physicalOrdering:{substrateDependencies:count('substrate'),nozzleDependencies:count('nozzle-access'),materialDependencies:count('required-material'),
        conservativeSupportChoices:solved.edges.filter(edge=>edge.witness?.provisional).length},queries:{...scene.stats}}});
}
