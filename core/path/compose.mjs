// Source operations enter once as compact curves; execution refers to ranges.
import {requireThat,distance} from '../private/toolpath/numeric.mjs';
import {curveAt,curveRange,curveParameterAtLength,curveClosestParameter,prepareCurvePath} from './curve-path.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM} from '../dimensions.mjs';
import {orderSliceCourses,selectTraversal} from './course-order.mjs';
import {precedenceLookup,prerequisiteProofs} from './precedence.mjs';
import {prepareRangeScene} from './physical-order.mjs';
import {CoolingOrder} from './cooling-order.mjs';
import {manufacturingDependencies,constructionHistory,CONSTRUCTION_CONTRACT} from './manufacturing.mjs';
import {DEFAULT_NOZZLE_GEOMETRY} from '../geom/convex-clearance.mjs';
import {ActionAccumulator,planningResult,planContext,planFan,planNozzle,planTransfer,
  planExtrusion,planDwell,planSelection,planProcess,planDepositRange} from './planning.mjs';

export function planOperationEntry(initialState,op) {
  const contextual=planContext({...initialState,layerId:op.layerId},op.phase,op.layer,op.sourceOperation??op.id);
  const selected=planSelection(contextual.state,op.filament??initialState.defaultFilament);
  const configured=planProcess(selected.state,op.process);
  const prepared=planOperationStart(configured.state,op);
  return planningResult(prepared.state,{chunks:[selected.actions,prepared.actions]});
}

export function planOperationStart(state,op) {
  const fan=op.fanPercent!==undefined?planFan(state,op.fanPercent):planningResult(state);
  if(op.nozzleC===undefined||fan.state.nozzleC===op.nozzleC)return fan;
  const heated=planNozzle(fan.state,op.nozzleC);
  return planningResult(heated.state,{chunks:[fan.actions,heated.actions]});
}

export function planOperationEnd(state,op) {
  if(op.nozzleC===undefined||state.nozzleC===op.restoreNozzleC)return planningResult(state);
  return planNozzle(state,op.restoreNozzleC);
}

export function prepareOperationPriorities(operations,resultIndex) {
  return new Map(operations.map((op,index)=>[op.id,{result:op.constructionRank??resultIndex.get(op.sourceOperation??op.id),index}]));
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
export function prepareSourceUnits(source,reader,{cuts=new Map(),relaxedChunks=null,blockedTraversals=new Set(),openedCourses=new Set()}={}){
  const operations=Object.values(source.operations),manufacturing=manufacturingDependencies(source);
  const originals=new Map(operations.flatMap(operation=>(operation.courses??[]).map(course=>[course.id,course])));
  const units=[],nodes=[],groups=new Map(),prerequisites=new Map(),courseGroups=new Map(),counter={next:0};
  // Forward requirements can live inside a soft traversal chunk. Exclude
  // backwards or external endpoints; these must remain explicit graph nodes.
  const constrained=new Set();
  for(const completion of Object.values(source.completions??{}))if(completion.kind==='edge')
    for(const member of completion.members)constrained.add(member);
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
      const loop=ranges.length===1&&ranges[0].interruptible&&ranges[0].seamRequired===false&&
        source.manufacturing?.courseTraversal?.[ranges[0].id]?.seamFree!==false&&distance(entry.point,exit.point)<=ROUNDING_MM?ranges[0]:null;
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
          if(variant.ranges.some(range=>{
            const policy=source.manufacturing?.courseTraversal?.[range.id];
            return policy&&!policy.directions.includes(Boolean(range.reverse));
          }))return false;
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
      function appendChunk(ranges){
        if(!ranges.length)return;
        if(ranges.length>1&&ranges.some(range=>source.manufacturing?.courseTraversal?.[range.id]?.directions.length===1)){
          for(const range of ranges)members.push(node(operation,[range]));return;
        }
        const key=JSON.stringify(ranges.map(course=>[course.id,course.from,course.to])),opened=openedCourses;
        if(opened?.size&&ranges.some(course=>opened.has(course.id))){
          const segment={from:0};
          for(const [i,course] of ranges.entries())if(opened.has(course.id)){
            appendChunk(ranges.slice(segment.from,i));members.push(node(operation,[course]));segment.from=i+1;
          }
          appendChunk(ranges.slice(segment.from));
        }else if(ranges.length>1&&!relaxedChunks?.has(key))members.push(node(operation,ranges,null,key));
        else for(const course of ranges)members.push(node(operation,[course]));
      }
      function flush(){
        appendChunk(pending);pending=[];
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
  const completionNodes=new Map(),layerGroups=new Map(),prototype=operations[0];
  for(const [id,start] of manufacturing.starts){
    const group=groups.get(id);
    if(group){completionNodes.set(start,group.begin);completionNodes.set(manufacturing.ends.get(id),group.end);continue;}
    const begin=node(prototype,[],'completion-begin'),end=node(prototype,[],'completion-end');
    begin.layerId=null;end.layerId=null;completionNodes.set(start,begin);completionNodes.set(manufacturing.ends.get(id),end);
  }
  for(const id of manufacturing.courseStarts.keys()){
    const group=courseGroups.get(id);
    const begin=group.members.length===1?group.members[0]:node(group.operation,[],'course-begin');
    const end=group.members.length===1?group.members[0]:node(group.operation,[],'course-end');
    if(group.members.length>1)for(const member of group.members){prerequisites.get(member.id).add(begin.id);prerequisites.get(end.id).add(member.id);}
    completionNodes.set(manufacturing.courseStarts.get(id),begin);completionNodes.set(manufacturing.courseEnds.get(id),end);
  }
  for(const [id,layer] of Object.entries(source.layers))if(layer.completionId)layerGroups.set(id,{id,index:layer.index,
    begin:completionNodes.get(manufacturing.starts.get(layer.completionId)),end:completionNodes.get(manufacturing.ends.get(layer.completionId))});
  for(const [id,parents] of manufacturing.parents){
    const after=completionNodes.get(id);
    for(const parent of parents){const before=completionNodes.get(parent);if(before!==after)prerequisites.get(after.id).add(before.id);}
  }
  for(const [id,group] of courseGroups)if(group.members.length>1){
    const course=originals.get(id);
    if(course.directionRequired!==false)for(let i=1;i<group.members.length;i++)prerequisites.get(group.members[i].id).add(group.members[i-1].id);
    else if(course.seamRequired===true)for(const member of group.members.slice(1))prerequisites.get(member.id).add(group.members[0].id);
  }
  return {units,nodes,groups,prerequisites,layerGroups,byId:new Map(nodes.map(node=>[node.id,node]))};
}

function retainedNozzleEdges(graph,requirements){
  const courses=new Map(),edges=[];
  for(const unit of graph.units)for(const range of unit.ranges){
    if(!courses.has(range.id))courses.set(range.id,[]);
    courses.get(range.id).push({unit,range});
  }
  for(const witness of requirements.values()){
    const receiver=witness.receiver,material=witness.material;
    const a=courses.get(receiver.id)?.find(({range})=>range.from<=receiver.from&&range.to>=receiver.to);
    const b=courses.get(material.id)?.find(({range})=>range.from<=material.from&&range.to>=material.to);
    // A chunk change preserves the witnessed intervals. A cut through either
    // interval needs a fresh contact query instead of lifting the old edge.
    if(a&&b&&a.unit!==b.unit)edges.push({before:a.unit.id,after:b.unit.id,kind:'nozzle-access',witness,
      beforeOperation:a.unit.sourceOperation,afterOperation:b.unit.sourceOperation});
  }
  return edges;
}

export function resolveSourceOrder(source,reader,{onProgress,start,nozzleGeometry,nozzleGeometries=null}={}){
  const cuts=new Map(),relaxedChunks=new Set(),openedCourses=new Set(),blockedTraversals=new Set(),history={solves:0,refinements:0};
  const accessGeometry=nozzleGeometry??source.manufacturing?.accessGeometry??DEFAULT_NOZZLE_GEOMETRY;
  const certified=source.manufacturing?.contract===CONSTRUCTION_CONTRACT&&
    [accessGeometry,...(nozzleGeometries?[nozzleGeometries.default,...Object.values(nozzleGeometries.filaments??{})]:[])].filter(Boolean).every(geometry=>
      geometry.includedAngleDeg<=source.manufacturing.accessGeometry.includedAngleDeg&&geometry.tipDiameterMm<=source.manufacturing.accessGeometry.tipDiameterMm);
  const construction=source.manufacturing?.contract===CONSTRUCTION_CONTRACT?constructionHistory(source):null;
  const trusted=certified?construction:null;
  const unbound=unit=>construction&&(unit.ranges.length?unit.ranges.map(range=>range.id):[unit.sourceOperation]).some(id=>
    !(construction.hasPrerequisites(id)??construction.hasPrerequisites(unit.sourceOperation)));
  const related=(before,after)=>trusted&&(trusted.covers(before,after)||trusted.covers(after,before));
  function trustedUnits(a,b){
    if(!trusted)return false;
    if(related(a.sourceOperation,b.sourceOperation))return true;
    const left=a.ranges.length?a.ranges.map(range=>range.id):[a.sourceOperation],right=b.ranges.length?b.ranges.map(range=>range.id):[b.sourceOperation];
    return left.every(x=>right.every(y=>related(x,y)||related(x,b.sourceOperation)||related(a.sourceOperation,y)));
  }
  const selfProofs={entries:new Map(),bytes:0};
  const nozzleRequirements=new Map();
  const courseOwners=new Map(Object.values(source.operations).flatMap(operation=>(operation.courses??[]).map(course=>[course.id,{operation,course}])));
  const sourceDependencies=manufacturingDependencies(source);
  const authored=precedenceLookup([...sourceDependencies.parents.keys()],[...sourceDependencies.parents].flatMap(([after,parents])=>[...parents].map(before=>({before,after}))));
  for(;;){
    const graph=prepareSourceUnits(source,reader,{cuts,relaxedChunks,blockedTraversals,openedCourses});
    const priorities=prepareOperationPriorities(graph.nodes,new Map()),state={scene:null,edges:retainedNozzleEdges(graph,nozzleRequirements)};history.solves++;
    for(const edge of state.edges)graph.prerequisites.get(edge.after).add(edge.before);
    try{
      // Establish native groups and process barriers before any fine occupancy.
      const coarse=orderSliceCourses(graph.nodes,priorities,graph.prerequisites,{start,physicalEdges:state.edges});
      state.scene=prepareRangeScene(source,reader,graph.units,{onProgress,nozzleGeometry:accessGeometry,nozzleGeometries,selfProofs});
      const proofs=prerequisiteProofs(graph.nodes.map(node=>node.id)),progress={cyclic:false};
      for(const node of coarse.operations)for(const before of graph.prerequisites.get(node.id))proofs.record(before,node.id);
      function nativeBefore(before,after){
        const a=source.layers[before],b=source.layers[after];
        return Boolean(a?.completionId&&b?.completionId&&a.stackId===b.stackId&&a.index<b.index);
      }
      function precedes(before,after){
        return nativeBefore(graph.byId.get(before).layerId,graph.byId.get(after).layerId)||proofs.proves(before,after);
      }
      function producer(unit){return source.layers[unit.layerId]?.stackId??unit.operation.construction;}
      function relevant(a,b){return (!certified||producer(a)!==producer(b))&&!state.scene.proofs.producerClear(producer(a),producer(b));}
      function addEdge(before,after,kind,witness){
        if(before===after||precedes(before,after))return;
        if(precedes(after,before))progress.cyclic=true;
        graph.prerequisites.get(after).add(before);proofs.record(before,after);state.edges.push({before,after,kind,witness,
          beforeOperation:graph.byId.get(before).sourceOperation,afterOperation:graph.byId.get(after).sourceOperation});
      }
      for(const unit of graph.units){
        for(const requirement of unit.operation.requiredMaterial??[]){
          for(const hit of state.scene.requiredHits(requirement,id=>{
            const other=graph.byId.get(id);
            return other.sourceOperation!==unit.sourceOperation&&(other.operation.part??null)===(requirement.part??null)&&
              (!requirement.layerIds||requirement.layerIds.includes(other.layerId??null));
          }))addEdge(hit.unit.id,graph.groups.get(unit.sourceOperation).begin.id,'required-material',hit.witness);
        }
        if(progress.cyclic)break;
      }
      const producerOf=unit=>source.layers[unit.layerId]?.stackId??unit.operation.construction;
      const substrateUnits=graph.units.filter(unit=>unbound(unit)&&graph.units.some(other=>
        producerOf(other)!==producerOf(unit)&&!trustedUnits(unit,other)));
      for(const [index,unit] of substrateUnits.entries()){
        onProgress?.({stage:'Resolving material support',completed:index,total:substrateUnits.length,assignment:unit.operation.id});
        for(const hit of state.scene.substrateHits(unit,id=>id!==unit.id&&!precedes(id,unit.id)&&
          producerOf(unit)!==producerOf(graph.byId.get(id))&&!trustedUnits(unit,graph.byId.get(id))))
          addEdge(hit.unit.id,unit.id,'substrate',hit.witness);
      }
      if(substrateUnits.length)onProgress?.({stage:'Resolving material support',completed:substrateUnits.length,total:substrateUnits.length});
      // Every native slice or unlayered operation is an aggregate query group.
      // An unresolved Inject/Trace group does not disable proofs for its peers.
      const accessGroups=new Set(),queryGroups=new Map(),groupId=unit=>unit.layerId??unit.sourceOperation;
      for(const unit of graph.units){const id=groupId(unit);if(!queryGroups.has(id))queryGroups.set(id,[]);queryGroups.get(id).push(unit);}
      const ids=[...queryGroups.keys()];
      const peerGroups=new Map();
      for(const id of ids){const unit=queryGroups.get(id)[0],owner=producer(unit);if(!peerGroups.has(owner))
        peerGroups.set(owner,ids.filter(other=>relevant(unit,queryGroups.get(other)[0])));}
      function groupBefore(a,b){
        if(nativeBefore(a,b))return true;
        const before=graph.layerGroups.get(a)??graph.groups.get(a),after=graph.layerGroups.get(b)??graph.groups.get(b);
        return a!==b&&proofs.proves(before.end.id,after.begin.id);
      }
      const historyId=id=>source.layers[id]?.completionId??id;
      const trustedGroupPairs=new Set();
      for(const id of ids)if(peerGroups.get(producer(queryGroups.get(id)[0])).every(other=>{
        if(related(historyId(id),historyId(other))){trustedGroupPairs.add(JSON.stringify([id,other]));return true;}
        return state.scene.proofs.clear(id,other)||groupBefore(id,other);
      }))accessGroups.add(id);
      state.scene.proofs.summary.trustedHistoryPairs=trustedGroupPairs.size;
      Object.assign(state.scene.proofs.summary,{resolvedAccessGroups:accessGroups.size});
      if(!progress.cyclic)onProgress?.({stage:'Resolving deposition group access',completed:accessGroups.size,total:queryGroups.size});
      // Follow discovered blockers first, then collect independent conflicts
      // in this graph before opening implicated traversal chunks.
      const access={pending:graph.units.toReversed(),visited:new Set()};
      if(!progress.cyclic)while(access.pending.length){
        const unit=access.pending.pop();if(access.visited.has(unit.id))continue;
        const completed=access.visited.size;access.visited.add(unit.id);
        if(accessGroups.has(groupId(unit)))continue;
        onProgress?.({stage:'Resolving curve nozzle access',completed,total:graph.units.length});
        for(const hit of state.scene.nozzleHits(unit,id=>id!==unit.id&&relevant(unit,graph.byId.get(id))&&!trustedUnits(unit,graph.byId.get(id))&&!state.scene.proofs.clear(groupId(unit),groupId(graph.byId.get(id)))&&
          !precedes(unit.id,id))){
          if(!hit.witness?.provisional){
            const witness=state.scene.mutualConflict(hit.witness?.receiver,hit.witness?.material);
            if(witness)throw Object.assign(Error('Two deposited sections mutually block nozzle access; changing their order or splitting the curves cannot resolve it.'),
              {code:'NOZZLE_MUTUAL_CONFLICT',witness,operations:[unit.sourceOperation,hit.unit.sourceOperation]});
            if(hit.witness?.receiver&&hit.witness.material){
              const a=hit.witness.receiver,b=hit.witness.material;
              nozzleRequirements.set(JSON.stringify([a.id,a.from,a.to,a.at,b.id,b.from,b.to,b.at]),hit.witness);
            }
          }
          addEdge(unit.id,hit.unit.id,'nozzle-access',hit.witness);
          if(!access.visited.has(hit.unit.id))access.pending.push(hit.unit);
        }
      }
      const cooling=graph.units.some(unit=>unit.process.minimumLayerSeconds>0)?new CoolingOrder(source,state.scene):null;
      const ordered=orderSliceCourses(graph.nodes,priorities,graph.prerequisites,{start,physicalEdges:state.edges,cooling});
      for(const unit of ordered.operations)if(!unit.barrier&&!certified){
        const body=state.scene.byId.get(unit.id);
        // Certify the selected traversal after external ordering has settled;
        // conflict refinement can split these convenience chunks beforehand.
        if(!(body.records.length===unit.ranges.length&&body.records.every((record,i)=>record.ref.id===unit.ranges[i]?.id&&record.ref.from===unit.ranges[i].from&&
          record.ref.to===unit.ranges[i].to&&Boolean(record.ref.reverse)===Boolean(unit.ranges[i].reverse))))body.records=unit.ranges.map(state.scene.interval);
        try{state.scene.verifySelf(unit);}catch(error){
          if(unit.traversalChoice&&unit.traversalAlternatives>1)error.traversalChoice=unit.traversalChoice.key;
          throw error;
        }
      }
      return {units:ordered.operations.filter(unit=>!unit.barrier),scene:state.scene,internalCertified:certified,hierarchy:ordered.hierarchy,cooling:cooling?.summary??null,
        edges:state.edges,refinement:{...history,relaxedTraversalChunks:relaxedChunks?.size??0,rejectedTraversals:blockedTraversals.size,
          splitCourses:cuts.size}};
    }catch(error){
      if(error.traversalChoice&&!blockedTraversals.has(error.traversalChoice)){blockedTraversals.add(error.traversalChoice);continue;}
      if(error.code!=='PRINT_ORDER_CONFLICT'&&error.code!=='CONTINUOUS_NOZZLE_CONFLICT')throw error;
      const implicated=new Set(error.refinementCourses??error.operations??[]),before=openedCourses.size;
      const witnesses=error.witness?[error.witness]:(error.physicalDependencies??[]).map(edge=>edge.witness).filter(Boolean);
      const involved=new Set(witnesses.flatMap(witness=>[witness.receiver?.id,witness.material?.id]).filter(Boolean));
      for(const unit of graph.units)if(implicated.has(unit.id)&&unit.traversalKey){
        const opened=new Set(unit.ranges.filter(range=>involved.has(range.id)).map(range=>range.id));
        if(!opened.size)continue;
        for(const id of opened)openedCourses.add(id);
        relaxedChunks.add(unit.traversalKey);
      }
      if(openedCourses.size>before)continue;
      if(!state.scene){
        if(!state.edges.length)throw error;
        state.scene=prepareRangeScene(source,reader,graph.units,{onProgress,nozzleGeometry:accessGeometry,nozzleGeometries,selfProofs});
      }
      const reasons=error.physicalDependencies??[];
      if(authored.cyclic||reasons.some(edge=>edge.kind==='nozzle-access'&&authored.has(
        sourceDependencies.ends.get(graph.byId.get(edge.after).sourceOperation),sourceDependencies.starts.get(graph.byId.get(edge.before).sourceOperation))))throw error;
      for(const edge of reasons)if(edge.kind==='nozzle-access'){
        const witness=state.scene.mutualConflict(edge.witness?.receiver,edge.witness?.material);
        if(witness)throw Object.assign(Error('Two deposited sections mutually block nozzle access; changing their order or splitting the curves cannot resolve it.'),
          {code:'NOZZLE_MUTUAL_CONFLICT',witness,operations:[graph.byId.get(edge.before).sourceOperation,graph.byId.get(edge.after).sourceOperation]});
      }
      for(const required of reasons.filter(edge=>edge.kind==='required-material'))for(const blocked of reasons.filter(edge=>edge.kind==='nozzle-access')){
        if(required.afterOperation!==blocked.beforeOperation)continue;
        const witness=state.scene.materialAccessConflict(required.witness,blocked.witness);
        if(witness)throw Object.assign(Error('Required enclosure material blocks its consumer at the same deposition event.'),
          {code:'MATERIAL_ACCESS_CONFLICT',operation:required.afterOperation,witness});
      }
      const added=[];
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

export function planSourceComposition(initialState,source,reader,onProgress,order=null){
  const solved=order??resolveSourceOrder(source,reader,{onProgress,start:initialState.position}),scene=solved.scene;
  const actions=new ActionAccumulator(),cursor={state:initialState};
  for(const [completed,unit] of solved.units.entries()){
    const operation={...unit.operation,process:unit.process,phase:unit.operation.phase??unit.operation.kind,layer:unit.operation.layer??source.layers[unit.layerId]?.index??0};
    const entered=planOperationEntry(cursor.state,operation);
    cursor.state=entered.state;actions.add(entered.actions);
    // Process changes can park the nozzle after ordering. Choose
    // this chunk's entry from that actual position, preserving the proven DAG.
    if(unit.traversals?.length)selectTraversal(unit,{point:cursor.state.position,axis:cursor.state.pose.toolAxis},selected=>{
      scene.byId.get(selected.id).records=selected.ranges.map(scene.interval);if(!solved.internalCertified)scene.verifySelf(selected);
    });
    if(operation.kind==='inject'){
      const injection=operation.injection,approached=planTransfer(cursor.state,injection.at,injection.pose);
      const extruded=planExtrusion(approached.state,injection.volumeMm3,injection.flowMm3S),held=planDwell(extruded.state,injection.holdSeconds);
      cursor.state=held.state;
      actions.add(approached.actions);actions.add(extruded.actions);actions.add(held.actions);scene.recordDeposit(unit.id,0);
    }else for(const [i,range] of unit.ranges.entries()){
      const entry=curveAt(reader,range.curveId,range.reverse?range.to:range.from,range.reverse?{side:'left'}:{}),approached=planTransfer(cursor.state,entry.point,entry.pose);
      const deposited=planDepositRange(approached.state,source,reader,range,scene.byId.get(unit.id).records[i]);
      cursor.state=deposited.state;actions.add(approached.actions);actions.add(deposited.actions);
      scene.recordDeposit(unit.id,i+1);
    }
    const ended=planOperationEnd(cursor.state,operation);cursor.state=ended.state;actions.add(ended.actions);
    onProgress?.({stage:'Planning source ranges',completed:completed+1,total:solved.units.length});
  }
  const count=kind=>solved.edges.filter(edge=>edge.kind===kind).length;
  return planningResult({...planProcess(cursor.state).state,operationId:undefined},actions.finish(),{
    summary:{hierarchy:solved.hierarchy,cooling:solved.cooling,aggregateProofs:scene.proofs.summary,refinement:solved.refinement,executionUnits:solved.units.length,
      physicalOrdering:{nozzleDependencies:count('nozzle-access'),materialDependencies:count('required-material')+count('substrate')},queries:{...scene.stats}}});
}

// Ordering-only callers use the same admitted source and solver as scheduling.
export function scheduleOperations(source,options={}){
  requireThat(source?.schema==='saampath/2','Operation ordering requires compact constructed SAAMpath.');
  return resolveSourceOrder(source,prepareCurvePath(source),options).units;
}
