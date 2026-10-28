// Infill clipping selects exact source intervals; row grouping establishes
// local traversal on those same spatial Paath entities before conditioning.
// These producer-internal operations consume chart-correspondent infill before
// Construction establishes its final manufacturing certification.
import {clipPatternCurves} from '../region/fill-patterns.mjs';
import {connectScanlineCells} from '../region/region2d.mjs';
import {prepareNumericalCurve,numericalCurveAt} from '../geom/curve-query.mjs';
import {requireThat,dot} from '../geom/tolerance.mjs';
import {keyed,profileAt} from '../path/curve-profiles.mjs';

function retainedPaath(source,operations,curves=source.curves,correspondence=source.correspondence){
  const active=Object.fromEntries(Object.entries(operations).filter(([,operation])=>operation.courses?.length||operation.kind!=='deposit'));
  const predecessors=(id,seen=new Set())=>{
    if(active[id]||!source.operations[id])return [id];
    requireThat(!seen.has(id),'Empty infill operations have cyclic prerequisites.');
    return (source.operations[id].after??[]).flatMap(previous=>predecessors(previous,new Set([...seen,id])));
  };
  for(const [id,operation] of Object.entries(active))active[id]={...operation,after:[...new Set((operation.after??[]).flatMap(previous=>predecessors(previous)))]};
  const ids=new Set(Object.values(active).flatMap(operation=>(operation.courses??[]).map(course=>course.curveId)));
  return {...source,operations:active,curves:Object.fromEntries([...ids].map(id=>[id,curves[id]])),
    correspondence:Object.fromEntries([...ids].map(id=>[id,correspondence[id]])),
    ...(source.operationMetadata?{operationMetadata:Object.fromEntries(Object.entries(source.operationMetadata).filter(([id])=>active[id]))}:{}),
    completions:Object.fromEntries(Object.entries(source.completions??{}).map(([id,value])=>[id,{...value,members:(value.members??[]).filter(member=>!source.operations[member]||active[member])}]))};
}

export function clipInfillPaath(paath,region,{surface=null}={}){
  const operations={},replacements=new Map(),taken=new Set(Object.values(paath.operations).flatMap(operation=>(operation.courses??[]).map(course=>course.id)));
  const originals=new Map(Object.values(paath.operations).flatMap(operation=>(operation.courses??[]).map(course=>[course.id,course])));
  const periodic=surface?.periodicU??surface?.patch?.periodicU??false,domain=surface?.domainU??surface?.patch?.domainU??[0,1],period=domain[1]-domain[0];
  const intervals=new Map();
  const clippedRanges=curveId=>{
    if(intervals.has(curveId))return intervals.get(curveId);
    const metadata=paath.correspondence[curveId],chart=metadata?.chartPoints,parameters=metadata?.parameters;
    requireThat(chart?.length>=2&&parameters?.length===chart.length,'Infill clipping needs aligned chart correspondence and source-curve parameters.');
    let shift=0;
    const points=chart.map((uv,i)=>{
      if(periodic&&i){const delta=uv[0]-chart[i-1][0];if(Math.abs(delta)<period&&delta>period/2)shift-=period;else if(Math.abs(delta)<period&&delta<-period/2)shift+=period;}
      return [uv[0]+shift,uv[1]];
    });
    let room=region;
    if(periodic&&region.length){
      const [min,max]=points.reduce(([lo,hi],[u])=>[Math.min(lo,u),Math.max(hi,u)],[Infinity,-Infinity]);
      const lo=Math.floor((min-domain[0])/period),hi=Math.floor((max-domain[0])/period);
      room=[];
      for(let cycle=lo;cycle<=hi;cycle++)room.push(...region.map(loop=>loop.map(([u,v])=>[u+cycle*period,v])));
    }
    const result=clipPatternCurves([{closed:false,points,sourceParameters:parameters}],room)
      .map(fragment=>[fragment.sourceParameters[0],fragment.sourceParameters.at(-1)]);
    intervals.set(curveId,result);return result;
  };
  for(const [id,operation] of Object.entries(paath.operations)){
    if(operation.kind!=='deposit'){operations[id]=operation;continue;}
    const courses=[];
    for(const course of operation.courses){
      const ranges=clippedRanges(course.curveId).map(([from,to])=>[Math.max(from,course.from),Math.min(to,course.to)]).filter(([from,to])=>to>from);
      const fragments=ranges.map(([from,to],index)=>{
        if(ranges.length===1&&from===course.from&&to===course.to)return course;
        let fragmentId=course.id;
        if(ranges.length>1){const base=course.id+':clip:'+index;fragmentId=base;let suffix=0;while(taken.has(fragmentId))fragmentId=base+':'+(++suffix);taken.add(fragmentId);}
        return {...course,id:fragmentId,from,to,...(fragmentId!==course.id?{sourceCourse:course.sourceCourse??course.id}:{}),
          ...(course.seamRequired?{seamRequired:false}:{})};
      });
      replacements.set(course.id,fragments.map(fragment=>fragment.id));
      for(let i=0;i<fragments.length;i++)courses.push({...fragments[i],
        ...(course.orderGroup!==undefined&&i?{after:[...(fragments[i].after??[]),fragments[i-1].id]}:{})});
    }
    operations[id]={...operation,courses};
  }
  const prerequisites=(id,seen=new Set())=>{
    const retained=replacements.get(id);
    if(retained===undefined||retained.length)return retained??[id];
    requireThat(!seen.has(id),'Empty infill courses have cyclic prerequisites.');
    return (originals.get(id)?.after??[]).flatMap(previous=>prerequisites(previous,new Set([...seen,id])));
  };
  for(const operation of Object.values(operations))if(operation.courses)operation.courses=operation.courses.map(course=>course.after?{...course,
    after:[...new Set(course.after.flatMap(id=>prerequisites(id)))]}:course);
  return retainedPaath(paath,operations);
}

function reversedProfile(profile){
  if(!keyed(profile))return profile;
  if(profile.interpolation!=='step')return {...profile,knots:profile.knots.toReversed().map(([u,value])=>[1-u,value])};
  const knots=[[0,profileAt(profile,1,'left')]];
  for(const [u] of profile.knots.slice(1,-1).toReversed()){
    const left=profileAt(profile,u),right=profileAt(profile,u,'left');
    knots.push([1-u,left]);if(left!==right)knots.push([1-u,right]);
  }
  knots.push([1,profileAt(profile,0)]);
  return {...profile,interpolation:'linear',knots};
}

function reversedGeometry(geometry){
  if(geometry.kind==='polyline')return {...geometry,points:geometry.points.toReversed()};
  requireThat(geometry.kind==='nurbs','Row reversal needs moving curve geometry.');
  const sum=geometry.knots[0]+geometry.knots.at(-1);
  return {...geometry,controlPoints:geometry.controlPoints.toReversed(),knots:geometry.knots.toReversed().map(u=>sum-u),
    ...(geometry.weights?{weights:geometry.weights.toReversed()}:{})};
}

export function groupInfillPaathRows(paath,{surface=null,along=null}={}){
  const curves={...paath.curves},correspondence={...paath.correspondence},operations={},reversedIds=new Map();
  const reverseCourse=course=>{
    requireThat(course.directionRequired!==true,'Infill row direction conflicts with the requested alternating traversal.');
    let curveId=reversedIds.get(course.curveId);
    if(!curveId){
      const base=course.curveId+':row-reversed';curveId=base;let suffix=0;while(curves[curveId])curveId=base+':'+(++suffix);
      const source=paath.curves[course.curveId],metadata=paath.correspondence[course.curveId],reversed={...metadata};
      curves[curveId]={...source,geometry:reversedGeometry(source.geometry),profiles:Object.fromEntries(Object.entries(source.profiles).map(([key,profile])=>[key,reversedProfile(profile)]))};
      for(const field of ['chartPoints','sourceParameters','curveParameters','normals','frameSamples','referenceAlong','cellWidthsMm','widthsMm','heightsMm','flowMultipliers','segmentMetadata'])
        if(Array.isArray(metadata[field]))reversed[field]=metadata[field].toReversed();
      if(metadata.parameters)reversed.parameters=metadata.parameters.toReversed().map(u=>1-u);
      reversed.sourceCurve=metadata.sourceCurve??course.curveId;correspondence[curveId]=reversed;reversedIds.set(course.curveId,curveId);
    }
    return {...course,curveId,from:1-course.to,to:1-course.from,sourceCurve:course.sourceCurve??course.curveId};
  };
  for(const [id,operation] of Object.entries(paath.operations)){
    if(!operation.courses){operations[id]=operation;continue;}
    const families=new Map(),unaffected=[];
    for(const course of operation.courses){
      const row=paath.correspondence[course.curveId]?.row;
      if(!row){unaffected.push(course);continue;}
      const axis=row.along??along;
      requireThat(Array.isArray(axis)&&axis.length===3&&axis.every(Number.isFinite),'Infill row grouping needs a physical along direction.');
      const curve=prepareNumericalCurve(paath.curves[course.curveId].geometry),cuts=[course.from,...curve.breaks.filter(u=>u>course.from&&u<course.to),course.to];
      const positions=cuts.map(u=>dot(axis,numericalCurveAt(curve,u).point)),entry=positions[0],exit=positions.at(-1);
      if(!families.has(row.family))families.set(row.family,new Map());
      const rows=families.get(row.family),spans=rows.get(row.lineIndex)??[];
      const [left,right]=positions.reduce(([lo,hi],position)=>[Math.min(lo,position),Math.max(hi,position)],[Infinity,-Infinity]);
      spans.push({left,right,row:{course,forward:exit>=entry}});rows.set(row.lineIndex,spans);
    }
    const ordered=[...unaffected];
    for(const [family,rows] of families){
      const indices=[...rows.keys()].sort((a,b)=>a-b);
      function* scanlines(){
        let previous=null;
        for(const line of indices){
          if(previous!==null&&line>previous+1)yield [];
          yield rows.get(line).sort((a,b)=>a.left-b.left||a.right-b.right);previous=line;
        }
      }
      for(const [cell,members] of connectScanlineCells(scanlines()).entries()){
        let previous=null;
        for(const [index,member] of members.entries()){
          const course=member.forward===(index%2===0)?member.course:reverseCourse(member.course),orderGroup='rows:'+family+':'+cell;
          ordered.push({...course,orderGroup,cellId:orderGroup,directionRequired:true,
            ...(previous?{after:[...new Set([...(course.after??[]),previous])]}:{})});previous=course.id;
        }
      }
    }
    operations[id]={...operation,courses:ordered};
  }
  return retainedPaath(paath,operations,curves,correspondence);
}
