// Readiness policy over cached geometric contact footprints. Qualification
// never substitutes straightened geometry for the immutable printed toolpath.
import {contactWidthIntervals} from '../geom/section-contact.mjs';
import {curveRange,curveClosestParameter} from './curve-path.mjs';
import {PRINT_RESOLUTION_MM,CONSTRUCTION_TOLERANCE_MM} from '../dimensions.mjs';
import {DEFAULT_MINIMUM_BRIDGE_RATIO} from './process-controls.mjs';
import {CONSTRUCTION_CONTRACT} from './manufacturing.mjs';
import {coversContactRange,prepareSupportPermit} from './support-permit.mjs';

export function prepareBeadQualification(scene,{needsQualification,acceptMaterial}){
  const {reader}=scene,depositedRanges=new Map(),groups=new Map(),foundations=new Map(),
    stats={courses:0,checks:0,cacheHits:0,wholeGroupChecks:0,declaredGroups:0,bedGroups:0,emptyGroups:0,straightBridgeChecks:0,foundations:[],localRefinements:[]};
  for(const {unit} of scene.byId.values()){
    const id=unit.layerId??unit.sourceOperation;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(unit);
  }
  function foundation(unit){
    const id=unit.layerId??unit.sourceOperation;
    if(foundations.has(id))return foundations.get(id);
    const members=groups.get(id),declared=scene.source.manufacturing?.contract===CONSTRUCTION_CONTRACT&&
      members.every(member=>member.operation.kind!=='deposit'||member.ranges.every(range=>!needsQualification(member,range)));
    stats.wholeGroupChecks++;
    const fact=declared?{kind:'declared-prerequisites',scope:{groupId:id,completionId:scene.source.layers[id]?.completionId??null,
      operations:[...new Set(members.map(member=>member.sourceOperation))],whole:true}}:scene.foundation?.(unit)??
      {kind:'unresolved',scope:{groupId:id},reason:'Whole-group foundation summary is unavailable'};
    foundations.set(id,fact);
    if(fact.kind==='declared-prerequisites'){stats.declaredGroups++;stats.foundations.push(fact);}
    else if(fact.kind==='bed-section-crossing'){stats.bedGroups++;stats.foundations.push(fact);}
    else if(fact.kind==='empty'){stats.emptyGroups++;stats.foundations.push(fact);}
    else stats.localRefinements.push({scope:fact.scope,reason:fact.reason,
      missingInterface:'Producer-owned whole-layer material/foundation summary for uncovered provider relationships'});
    return fact;
  }
  function depositedQualification(unit,range){
    if(!needsQualification(unit,range))return false;
    const key=JSON.stringify([range.curveId,range.from,range.to]);
    if(!depositedRanges.has(key))depositedRanges.set(key,curveRange(reader,range.curveId,range.from,range.to).areaMm2[1]>0);
    return depositedRanges.get(key);
  }
  function declaredIntervals(range){
    return (range.founded??[]).map(([a,b])=>[Math.max(a,range.from),Math.min(b,range.to)]).filter(([a,b])=>b>a);
  }
  function parameter(cell,x){
    if(x<=0)return cell.ref.from;if(x>=cell.size)return cell.ref.to;
    if(scene.source.curves[cell.ref.curveId].geometry.kind==='polyline')return cell.ref.from+(cell.ref.to-cell.ref.from)*x/cell.size;
    const at=cell.fromPoint.map((v,k)=>v+(cell.toPoint[k]-v)*x/cell.size);
    return curveClosestParameter(reader,cell.ref.curveId,cell.ref.from,cell.ref.to,at,{toleranceMm:PRINT_RESOLUTION_MM/4});
  }
  // Each receiver cell's provider chunks are contiguous in contactCells().
  // Union them before thresholding, then retain only source-param coverage and
  // the first compact witness for each contributing provider.
  function measure(unit,available,membership){
    const coverage={contactsById:new Map(),wholeById:new Map(),providers:new Map()},byCourse=new Map();
    const ranges=membership.map(range=>{
      // Declared foundation intervals count as full-width contact, as the bed does.
      const required=depositedQualification(unit,range),declared=required?declaredIntervals(range):[[range.from,range.to]];
      const value={range,required,intervals:[...declared],whole:[...declared]};
      if(!byCourse.has(range.id))byCourse.set(range.id,[]);byCourse.get(range.id).push(value);return value;
    });
    let cell=null;
    function finishCell(){
      if(!cell)return;
      const physical=cell.wholePlate?null:contactWidthIntervals(cell.contacts.map(contact=>contact.polygon),cell.widthMm/2);
      for(const value of byCourse.get(cell.ref.id)??[]){
        const {range}=value;if(cell.ref.to<=range.from||cell.ref.from>=range.to)continue;
        const clipped=[Math.max(range.from,cell.ref.from),Math.min(range.to,cell.ref.to)];
        if(cell.wholePlate){value.intervals.push(clipped);value.whole.push(clipped);continue;}
        if(coversContactRange(0,cell.size,physical,(a,b)=>b-a))value.whole.push(clipped);
        for(const [a,b] of physical){
          const from=Math.max(range.from,parameter(cell,a)),to=Math.min(range.to,parameter(cell,b));
          if(to>from)value.intervals.push([from,to]);
        }
      }
      cell=null;
    }
    const owners=new Map(membership.map(range=>[range.id,range]));
    for(const chunk of scene.contactCells(unit,id=>available.has(id)&&acceptMaterial(unit,scene.byId.get(id).unit),
      ref=>{const range=owners.get(ref.id)??unit.ranges.find(candidate=>candidate.id===ref.id);
        return range&&depositedQualification(unit,range)&&!declaredIntervals(range).some(([a,b])=>a<=ref.from&&b>=ref.to);},available)){
      if(cell&&(cell.ref.id!==chunk.ref.id||cell.ref.from!==chunk.ref.from||cell.ref.to!==chunk.ref.to))finishCell();
      cell??={...chunk,contacts:[]};
      for(const contact of chunk.contacts){
        if(contact.polygon)cell.contacts.push(contact);
        if(contact.provider===null||coverage.providers.has(contact.provider))continue;
        let lo=Infinity,hi=-Infinity;for(const point of contact.polygon){lo=Math.min(lo,point[0]);hi=Math.max(hi,point[0]);}
        const from=parameter(chunk,lo),to=parameter(chunk,hi),receiver={...chunk.ref,from,to},material={...contact.witness.material};
        // Contact inside a declared interval founds nothing the Scheduler owns.
        const owner=owners.get(chunk.ref.id);
        if(owner&&declaredIntervals(owner).some(([a,b])=>a<=from&&b>=to))continue;
        coverage.providers.set(contact.provider,{receiver,material,substrate:true,
          contactCuts:[{courseId:receiver.id,parameters:[from,to]},{courseId:material.id,parameters:[material.from,material.to]}]});
      }
    }
    finishCell();
    for(const {range,required,intervals,whole} of ranges){
      intervals.sort((a,b)=>a[0]-b[0]);const merged=[];
      for(const [a,b] of intervals){
        const last=merged.at(-1);
        // A gap shorter than construction accuracy is not a measurable bridge.
        if(last&&(a<=last[1]||curveRange(reader,range.curveId,last[1],a,{lengthToleranceMm:PRINT_RESOLUTION_MM/4}).lengthMm[1]<=CONSTRUCTION_TOLERANCE_MM))last[1]=Math.max(b,last[1]);
        else merged.push([a,b]);
      }
      const anchors=required?merged.filter(([a,b])=>curveRange(reader,range.curveId,a,b).lengthMm[0]>PRINT_RESOLUTION_MM):merged;
      for(const [table,values] of [[coverage.contactsById,anchors],[coverage.wholeById,whole]]){
        if(!table.has(range.id))table.set(range.id,[]);for(const value of values)table.get(range.id).push(value);
      }
    }
    for(const table of [coverage.contactsById,coverage.wholeById])for(const intervals of table.values())intervals.sort((a,b)=>a[0]-b[0]);
    return coverage;
  }
  function assess(unit,available){
    const ready=foundation=>({result:{status:'ready',...(foundation?{foundation}:{})},providers:new Map()});
    if(unit.barrier||unit.operation.kind!=='deposit')return ready();
    if(scene.source.manufacturing?.contract!==CONSTRUCTION_CONTRACT&&!unit.ranges.some(range=>needsQualification(unit,range)))return ready();
    const whole=foundation(unit);if(whole.kind!=='unresolved')return ready(whole);
    if(!unit.ranges.some(range=>depositedQualification(unit,range)))return ready();
    stats.checks++;
    // Drain only this implicated receiver's current-prefix query. An earlier
    // sufficient proof must not hide entry choices supplied by more material.
    // Entry selection may already have rotated a loop into two source ranges.
    // A fixed traversal's membership preserves the original complete receiver.
    const membership=unit.traversals?.[0]?.ranges??unit.ranges;
    const coverage=measure(unit,available,membership),proof=prepareSupportPermit(reader,coverage,unit.process.minimumBridgeRatio??DEFAULT_MINIMUM_BRIDGE_RATIO,stats);
    const candidates=unit.traversals?.length?unit.traversals.map(variant=>variant.ranges):[membership];
    let failure=null,qualified=false;
    for(const ranges of candidates){const result=proof.qualify(ranges,false);failure??=result;qualified||=result.ready;}
    if(!qualified)return {result:{status:'waiting',failure},providers:coverage.providers};
    const seams=membership.length===1&&membership[0].seamRequired===false?coverage.contactsById.get(membership[0].id).map(([a,b])=>(a+b)/2):[];
    stats.courses+=membership.length;return {result:{status:'ready',permits:proof.permits,seams},providers:coverage.providers};
  }
  // Contact geometry is fixed, so a receiver's verdict changes only when a unit
  // that can touch it is deposited. Its potential providers come from one
  // assessment against all acceptable material; repeated ready-set checks
  // reuse the verdict until that intersection grows.
  const potentials=new Map(),verdicts=new Map(),group=unit=>unit.layerId??unit.sourceOperation;
  function potential(unit){
    if(!potentials.has(unit.id)){
      const providers=assess(unit,new Set(scene.byId.keys())).providers;
      potentials.set(unit.id,{ids:[...providers.keys()],providers});
    }
    return potentials.get(unit.id);
  }
  // A stack declares its own support design (overhangs, bridges) beyond its
  // predecessor. For those intervals the Scheduler determines what lies
  // underneath: the receiver waits for every other group's material it rests
  // on, and needs no bead proof of its own.
  const stackOwned=unit=>unit.operation.foundation==='stack';
  function underneath(unit){
    const {ids,providers}=potential(unit),own=group(unit);
    return {ids:ids.filter(id=>group(scene.byId.get(id).unit)!==own),providers};
  }
  function unresolvedReceiver(unit){
    return !(unit.barrier||unit.operation.kind!=='deposit'||!unit.ranges.some(range=>depositedQualification(unit,range))||foundation(unit).kind!=='unresolved');
  }
  function check(unit,available){
    if(!unresolvedReceiver(unit))return assess(unit,available).result;
    if(stackOwned(unit)){
      const missing=underneath(unit).ids.filter(id=>!available.has(id));
      return missing.length?{status:'waiting',failure:{ready:false,reason:'material underneath is not yet deposited',courseId:unit.ranges[0].id,providers:missing}}:{status:'ready'};
    }
    potential(unit);
    const key=potentials.get(unit.id).ids.filter(id=>available.has(id)).join(),prior=verdicts.get(unit.id);
    if(prior?.key===key){stats.cacheHits++;return prior.result;}
    const result=assess(unit,available).result;verdicts.set(unit.id,{key,result});return result;
  }
  function waiting(unit,available,canUse){
    if(unresolvedReceiver(unit)&&stackOwned(unit)){
      const {ids,providers}=underneath(unit),requirements=ids.filter(id=>!available.has(id)&&canUse(id)).map(id=>({before:id,after:unit.id,kind:'substrate',witness:providers.get(id)}));
      return {status:'waiting',requirements,foundation:foundation(unit)};
    }
    const future=[...scene.byId.keys()].filter(id=>!available.has(id)&&acceptMaterial(unit,scene.byId.get(id).unit));
    const chosen=new Set(available);for(const id of future)if(canUse(id))chosen.add(id);
    let potential=assess(unit,chosen);
    if(potential.result.status!=='ready'){for(const id of future)chosen.add(id);potential=assess(unit,chosen);}
    if(potential.result.status!=='ready')return {status:'unqualified',failure:potential.result.failure,operation:unit.sourceOperation,foundation:foundation(unit)};
    // Preserve stable provider tie order. Recompute the selected union instead
    // of retaining all explored polygons or thresholding providers separately.
    for(let i=future.length-1;i>=0;i--){
      const id=future[i];if(!chosen.has(id))continue;chosen.delete(id);
      if(!potential.providers.has(id))continue;
      const candidate=assess(unit,chosen);
      if(candidate.result.status==='ready')potential=candidate;else chosen.add(id);
    }
    const requirements=future.filter(id=>chosen.has(id)).map(id=>({before:id,after:unit.id,kind:'substrate',witness:potential.providers.get(id)}));
    return {status:'waiting',requirements,foundation:foundation(unit)};
  }
  return {check,waiting,stats};
}
