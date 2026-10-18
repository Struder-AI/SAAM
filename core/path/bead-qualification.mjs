// Readiness policy over cached geometric contact footprints. Qualification
// never substitutes straightened geometry for the immutable printed toolpath.
import {contactWidthIntervals} from '../geom/section-contact.mjs';
import {curveAt,curveRange,curveClosestParameter} from './curve-path.mjs';
import {distance} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM} from '../dimensions.mjs';
import {DEFAULT_MINIMUM_BRIDGE_RATIO} from './process-controls.mjs';

export function prepareBeadQualification(scene,{needsQualification,acceptMaterial}){
  const {reader}=scene,models=new Map(),stats={courses:0,checks:0,cacheHits:0};
  function model(unit){
    if(models.has(unit.id))return models.get(unit.id);
    const value={iterator:null,targets:new Set(),scanned:new Set(),cells:[],byRange:new Map(),providers:new Set(),
      ranges:[...unit.ranges],memo:null,plateScanned:false,batch:1};
    models.set(unit.id,value);return value;
  }
  function discover(unit,data,available){
    if(!data.iterator){
      const targets=new Set([...available].filter(id=>!data.scanned.has(id)&&acceptMaterial(unit,scene.byId.get(id).unit)));
      if(data.plateScanned&&!targets.size)return false;
      data.targets=targets;data.batch=1;
      data.iterator=scene.contactCells(unit,id=>targets.has(id)&&acceptMaterial(unit,scene.byId.get(id).unit),range=>needsQualification(unit,range),targets);
    }
    for(let i=0;i<data.batch;i++){
      const next=data.iterator.next();
      if(next.done){for(const id of data.targets)data.scanned.add(id);data.plateScanned=true;data.iterator=null;break;}
      const cell=next.value,key=JSON.stringify([cell.ref.id,cell.ref.from,cell.ref.to]);
      const held=data.byRange.get(key);
      if(held)held.contacts.push(...cell.contacts);else {data.byRange.set(key,cell);data.cells.push(cell);}
      for(const contact of cell.contacts)if(contact.provider!==null)data.providers.add(contact.provider);
    }
    data.batch*=2;return true;
  }
  function parameter(cell,x){
    if(x<=0)return cell.ref.from;if(x>=cell.size)return cell.ref.to;
    if(scene.source.curves[cell.ref.curveId].geometry.kind==='polyline')return cell.ref.from+(cell.ref.to-cell.ref.from)*x/cell.size;
    const at=cell.fromPoint.map((v,k)=>v+(cell.toPoint[k]-v)*x/cell.size);
    return curveClosestParameter(reader,cell.ref.curveId,cell.ref.from,cell.ref.to,at,{toleranceMm:PRINT_RESOLUTION_MM/4});
  }
  function covered(range,cells,available){
    const intervals=[];
    for(const cell of cells){
      if(cell.ref.id!==range.id||cell.ref.to<=range.from||cell.ref.from>=range.to)continue;
      if(cell.wholePlate){intervals.push([Math.max(range.from,cell.ref.from),Math.min(range.to,cell.ref.to)]);continue;}
      const polygons=cell.contacts.filter(contact=>contact.provider===null||available.has(contact.provider)).map(contact=>contact.polygon);
      for(const [a,b] of contactWidthIntervals(polygons,cell.widthMm/2)){
        const from=Math.max(range.from,parameter(cell,a)),to=Math.min(range.to,parameter(cell,b));
        if(to>from)intervals.push([from,to]);
      }
    }
    intervals.sort((a,b)=>a[0]-b[0]);const merged=[];
    for(const [a,b] of intervals){const last=merged.at(-1);if(last&&(a<=last[1]||arc(range,last[1],a)<=ROUNDING_MM))last[1]=Math.max(b,last[1]);else merged.push([a,b]);}
    return merged.filter(([a,b])=>curveRange(reader,range.curveId,a,b).lengthMm[0]>PRINT_RESOLUTION_MM);
  }
  function arc(range,from,to){
    return from===to?0:curveRange(reader,range.curveId,from,to,{lengthToleranceMm:PRINT_RESOLUTION_MM/4}).lengthMm[1];
  }
  function point(range,u){return curveAt(reader,range.curveId,u).point;}
  const entry=range=>range.reverse?range.to:range.from,exit=range=>range.reverse?range.from:range.to;
  function connectedChains(ranges){
    const chains=[];
    for(const range of ranges){
      const previous=chains.at(-1)?.at(-1);
      if(!previous||distance(point(previous,exit(previous)),point(range,entry(range)))>ROUNDING_MM)chains.push([]);
      chains.at(-1).push(range);
    }
    return chains;
  }
  function chain(ranges,contactsById,minimumBridgeRatio,requireEntry){
    const first=ranges[0],last=ranges.at(-1),start={index:0,u:entry(first)},end={index:ranges.length-1,u:exit(last)};
    const at=anchor=>point(ranges[anchor.index],anchor.u),closed=distance(at(start),at(end))<=ROUNDING_MM;
    const contacts=ranges.flatMap((range,index)=>{
      const intervals=contactsById.get(range.id).map(([a,b])=>[Math.max(a,range.from),Math.min(b,range.to)]).filter(([a,b])=>b>a);
      return (range.reverse?intervals.toReversed().map(([a,b])=>[b,a]):intervals).map(([a,b])=>({from:{index,u:a},to:{index,u:b}}));
    });
    const failure=(reason,from=start,to=end,extra={})=>({ready:false,reason,courseId:ranges[from.index].id,
      courseIds:[...new Set(ranges.map(range=>range.id))],interval:[from.u,to.u],...extra});
    if(!contacts.length)return failure('no qualifying contact');
    function spans(from,to,wrap=false){
      if(wrap)return [...spans(from,end),...spans(start,to)];
      return ranges.slice(from.index,to.index+1).map((range,i)=>{
        const a=i===0?from.u:entry(range),b=i+from.index===to.index?to.u:exit(range);
        return {range,from:Math.min(a,b),to:Math.max(a,b)};
      }).filter(span=>span.to>span.from);
    }
    function lengthBounds(parts,tolerance){
      const options=tolerance===undefined?{}:{lengthToleranceMm:tolerance/parts.length};
      return parts.reduce((sum,{range,from,to})=>{
        const bounds=curveRange(reader,range.curveId,from,to,options).lengthMm;
        return [sum[0]+bounds[0],sum[1]+bounds[1]];
      },[0,0]);
    }
    function bridge(from,to,wrap=false){
      if(minimumBridgeRatio===0)return null;
      const parts=spans(from,to,wrap),chordMm=distance(at(from),at(to)),limit=(chordMm+PRINT_RESOLUTION_MM)/minimumBridgeRatio;
      const resolution=PRINT_RESOLUTION_MM/4;
      let tolerance;
      for(;;){
        const [lo,hi]=lengthBounds(parts,tolerance);
        if(hi<=PRINT_RESOLUTION_MM||hi<=limit)return null;
        if(lo>limit||tolerance===resolution)return failure('bridge ratio',from,to,{wrap,ratio:Math.min(1,chordMm/hi),minimumBridgeRatio});
        // Tighten only when existing certified length bounds straddle the
        // qualification threshold. Most spans need no precise integration.
        tolerance=Math.max(resolution,(hi-lo)/4);
      }
    }
    for(let i=1;i<contacts.length;i++){const found=bridge(contacts[i-1].to,contacts[i].from);if(found)return found;}
    if(closed){const found=bridge(contacts.at(-1).to,contacts[0].from,true);if(found)return found;}
    const allowance=range=>curveRange(reader,range.curveId,range.from,range.to).widthMm[0]/2+PRINT_RESOLUTION_MM;
    if(!closed)for(const [from,to,range] of [[start,contacts[0].from,first],[contacts.at(-1).to,end,last]])
      if(lengthBounds(spans(from,to),PRINT_RESOLUTION_MM/4)[1]>allowance(range))return failure('unanchored end',from,to);
    const entrySupported=lengthBounds(spans(start,contacts[0].from),PRINT_RESOLUTION_MM/4)[1]<=allowance(first)||
      closed&&lengthBounds(spans(contacts.at(-1).to,end),PRINT_RESOLUTION_MM/4)[1]<=allowance(first);
    if(closed&&(requireEntry||first.seamRequired!==false)&&!entrySupported)return failure('unsupported required seam',start,contacts[0].from);
    return {ready:true};
  }
  function check(unit,available){
    if(unit.barrier||unit.operation.kind!=='deposit'||!unit.ranges.some(range=>needsQualification(unit,range)))return {status:'ready'};
    const data=model(unit),eligible=[...available].filter(id=>acceptMaterial(unit,scene.byId.get(id).unit)),key=eligible.join(',');
    stats.checks++;
    if(data.memo&&(data.memo.key===key||data.memo.result.status==='ready'&&data.memo.providers.every(id=>available.has(id)))){
      stats.cacheHits++;return data.memo.result;
    }
    for(;;){
      const result=evaluate(unit,data,available);
      if(result.status==='ready'||!discover(unit,data,available)){
        data.memo={key,result,providers:[...data.providers].filter(id=>available.has(id))};return result;
      }
    }
  }
  function evaluate(unit,data,available){
    const contactsById=new Map();
    for(const range of data.ranges){
      contactsById.set(range.id,needsQualification(unit,range)?covered(range,data.cells,available):[[range.from,range.to]]);
    }
    const ratio=unit.process.minimumBridgeRatio??DEFAULT_MINIMUM_BRIDGE_RATIO;
    function qualify(ranges,requireEntry){
      for(const rangesInChain of connectedChains(ranges)){
        const result=chain(rangesInChain,contactsById,ratio,requireEntry);if(!result.ready)return result;
      }
      return {ready:true};
    }
    const candidates=unit.traversals?.length?unit.traversals.map(variant=>variant.ranges):[data.ranges];
    const results=candidates.map(ranges=>qualify(ranges,false));
    if(!results.some(result=>result.ready))return {status:'waiting',failure:results[0]};
    const seams=data.ranges.length===1&&data.ranges[0].seamRequired===false?contactsById.get(data.ranges[0].id).map(([a,b])=>(a+b)/2):[];
    const permits=ranges=>qualify(ranges,true).ready;
    stats.courses+=data.ranges.length;return {status:'ready',permits,seams};
  }
  function waiting(unit,available,canUse){
    const data=model(unit),future=[...scene.byId.keys()].filter(id=>!available.has(id)&&acceptMaterial(unit,scene.byId.get(id).unit));
    const chosen=new Set([...available,...future.filter(canUse)]);
    if(check(unit,chosen).status!=='ready')for(const id of future)chosen.add(id);
    const potential=check(unit,chosen);
    if(potential.status!=='ready')return {status:'unqualified',failure:potential.failure,operation:unit.sourceOperation};
    const pending=[...data.providers].filter(id=>!available.has(id));
    // Discard redundant alternatives against the union, rather than making
    // every intersecting provider a prerequisite. Earlier candidates win ties.
    for(const id of pending.toReversed()){
      if(!chosen.has(id))continue;chosen.delete(id);
      if(check(unit,chosen).status!=='ready')chosen.add(id);
    }
    const requirements=pending.filter(id=>chosen.has(id)).map(id=>{
      const cell=data.cells.find(cell=>cell.contacts.some(contact=>contact.provider===id)),contact=cell.contacts.find(contact=>contact.provider===id);
      const xs=contact.polygon.map(point=>point[0]),from=parameter(cell,Math.min(...xs)),to=parameter(cell,Math.max(...xs));
      const receiver={...cell.ref,from,to},material=contact.witness.material;
      return {before:id,after:unit.id,kind:'substrate',witness:{receiver,material,substrate:true,
        contactCuts:[{courseId:receiver.id,parameters:[from,to]},{courseId:material.id,parameters:[material.from,material.to]}]}};
    });
    return {status:'waiting',requirements};
  }
  return {check,waiting,stats};
}
