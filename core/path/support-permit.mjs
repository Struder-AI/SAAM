// Compact fixed-prefix support proof. This scope must never own a scene,
// qualification policy, contact polygon, iterator or other receiver's model.
import {curveAt,curveRange} from './curve-path.mjs';
import {distance} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM,ROUNDING_MM} from '../dimensions.mjs';

export function coversContactRange(from,to,intervals,gapLength){
  const coverage={end:from,found:false};
  for(const [a,b] of intervals){
    if(b<=from||a>=to)continue;
    if(a>coverage.end&&!(gapLength(coverage.end,a)<=ROUNDING_MM))return false;
    coverage.end=Math.max(coverage.end,b);coverage.found=true;
    if(coverage.end>=to)return true;
  }
  return coverage.found&&gapLength(coverage.end,to)<=ROUNDING_MM;
}

export function prepareSupportPermit(reader,coverage,minimumBridgeRatio,stats){
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
  function chain(ranges,contactsById,wholeById,minimumBridgeRatio,requireEntry){
    // A short supported course cannot lend its exemption to attached work:
    // every selected range of this connected traversal must be fully covered.
    if(ranges.every(range=>coversContactRange(range.from,range.to,wholeById.get(range.id),(a,b)=>arc(range,a,b))))return {ready:true};
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
      const parts=spans(from,to,wrap),chordMm=distance(at(from),at(to)),limit=(chordMm+PRINT_RESOLUTION_MM)/minimumBridgeRatio;
      const resolution=PRINT_RESOLUTION_MM/4;
      if(!parts.length)return null;
      stats.straightBridgeChecks++;
      const a=at(from),b=at(to),delta=b.map((v,k)=>v-a[k]),squared=chordMm**2;
      function distanceToChord(p){
        const t=squared?Math.max(0,Math.min(1,p.reduce((sum,v,k)=>sum+(v-a[k])*delta[k],0)/squared)):0;
        return distance(p,a.map((v,k)=>v+t*delta[k]));
      }
      // Shared Geometry bounds enclose the unchanged source curve. Only a
      // straddling bound opens numerical children; these are never executions.
      const pending=[...parts];
      while(pending.length){
        const part=pending.pop(),bounds=curveRange(reader,part.range.curveId,part.from,part.to),
          left=point(part.range,part.from),right=point(part.range,part.to),endpointError=Math.max(distanceToChord(left),distanceToChord(right));
        if(endpointError>PRINT_RESOLUTION_MM)return failure('curved bridge',from,to,{wrap,straightnessToleranceMm:PRINT_RESOLUTION_MM});
        if(Number.isFinite(bounds.chordErrorMm)&&bounds.chordErrorMm+endpointError<=PRINT_RESOLUTION_MM)continue;
        const middle=(part.from+part.to)/2,cut=bounds.breaks.length?bounds.breaks.reduce((best,u)=>Math.abs(u-middle)<Math.abs(best-middle)?u:best,bounds.breaks[0]):middle;
        if(!(cut>part.from&&cut<part.to))return failure('straight bridge proof unresolved at source precision',from,to,{wrap,proofStatus:'unavailable',straightnessToleranceMm:PRINT_RESOLUTION_MM});
        pending.push({...part,to:cut},{...part,from:cut});
      }
      // A collinear retrace is not a straight anchored bridge. Arc/chord bounds
      // expose it independently of the configurable ratio (including zero).
      let straightTolerance;
      for(;;){
        const [lo,hi]=lengthBounds(parts,straightTolerance);
        if(hi<=chordMm+PRINT_RESOLUTION_MM)break;
        if(lo>chordMm+PRINT_RESOLUTION_MM)return failure('bridge backtracking',from,to,{wrap,straightnessToleranceMm:PRINT_RESOLUTION_MM});
        if(straightTolerance===resolution)return failure('straight bridge length unresolved',from,to,{wrap,proofStatus:'unavailable',straightnessToleranceMm:PRINT_RESOLUTION_MM});
        straightTolerance=Math.max(resolution,(hi-lo)/4);
      }
      if(minimumBridgeRatio===0)return null;
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
  function qualify(ranges,requireEntry){
    for(const rangesInChain of connectedChains(ranges)){
      const result=chain(rangesInChain,coverage.contactsById,coverage.wholeById,minimumBridgeRatio,requireEntry);
      if(!result.ready)return result;
    }
    return {ready:true};
  }
  return {qualify,permits:ranges=>qualify(ranges,true).ready};
}
