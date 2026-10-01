import {requireThat} from '../private/toolpath/numeric.mjs';

import {depositCurves,trimVanishingEnd} from './deposition.mjs';
import {joinCurveSequence} from './family-curves.mjs';
import {planarPolicy} from './builder.mjs';

// Mapped course data -> beads and ordered operations. Geometry construction,
// reference resolution and final coverage publication remain separate stages.
export function depositCurveCourses({id,courses,process,after=[],filament=null,sequential=true}){
  let previous=[...after];const operations=[];
  for(const [index,course] of courses.entries()){
    const joined=joinCurveSequence(course.curves,course.join??{});
    let strokes=depositCurves(joined.curves,{widthMm:course.widthMm??process.lineWidthMm,heightMm:course.heightMm??process.layerMm,speedMmS:course.speedMmS??process.planarSpeedMmS});
    if(course.trimEnd&&strokes.length)strokes=[...strokes.slice(0,-1),trimVanishingEnd(strokes.at(-1))];
    requireThat(strokes.length>0,'A deposition course needs at least one stroke.');
    const points=strokes.flatMap(s=>s.points),low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
    for(const p of points)for(let k=0;k<3;k++){low[k]=Math.min(low[k],p[k]);high[k]=Math.max(high[k],p[k]);}
    const top=high[2],key=course.key??index,operationId=`${id}:${key}`;
    const travel=course.travel??{kind:'clearance'},clearance=travel.clearanceZ??top+process.liftMm;
    const inferred=travel.kind==='auto',planar=inferred&&top-low[2]<1e-9;
    const width=Math.max(...strokes.map(s=>s.beadWidthMm??process.lineWidthMm));
    const min=[0,1].map(k=>low[k]-width/2),max=[0,1].map(k=>high[k]+width/2);
    const region=inferred?[[min,[max[0],min[1]],max,[min[0],max[1]]]]:travel.region;
    const travelPolicy=travel.kind==='planar'||planar?planarPolicy(region,{layerZ:travel.zMm??top,liftMm:process.liftMm,maxCombMm:inferred?0:travel.maxCombMm??process.maxCombMm,lineWidthMm:inferred?width:course.widthMm??process.lineWidthMm}):
      {maxCombMm:0,clearanceFor:()=>clearance,...(inferred||travel.direct===false?{canTravelDirect:()=>false}:{}),...(travel.poseJoinMm===undefined?{}:{poseJoinMm:travel.poseJoinMm}),...(travel.constant?{constantClearanceZ:clearance}:{})};
    operations.push({id:operationId,layerId:course.layerId??(planar?`planar:${top}`:operationId),phase:course.phase??(planar?'planar':'curves'),layer:course.layer??index,rank:course.rank??index,
      after:[...new Set([...previous,...(course.after??[])])],strokes,order:course.order??'given',...(course.join?{continuous:joined.continuous}:{}),
      ...(course.connectNearby===undefined?{}:{connectNearby:course.connectNearby}),...(course.regionId===undefined?{}:{regionId:course.regionId}),
      ...(course.layerIndex===undefined?{}:{layerIndex:course.layerIndex}),...(course.layerCount===undefined?{}:{layerCount:course.layerCount}),
      ...(inferred?{region,clearanceZ:clearance}:{}),
      ...(course.fanPercent===undefined?{}:{fanPercent:course.fanPercent}),...(filament===null?{}:{filament}),travelPolicy});
    if(sequential)previous=[operationId];
  }
  return operations;
}
