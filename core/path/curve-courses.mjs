import {requireThat} from '../geom/tolerance.mjs';
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
    const top=Math.max(...strokes.flatMap(s=>s.points.map(p=>p[2]))),key=course.key??index,operationId=`${id}:${key}`;
    const travel=course.travel??{kind:'clearance'},clearance=travel.clearanceZ??top+process.liftMm;
    const travelPolicy=travel.kind==='planar'?planarPolicy(travel.region,{layerZ:travel.zMm??top,liftMm:process.liftMm,maxCombMm:travel.maxCombMm??process.maxCombMm,lineWidthMm:course.widthMm??process.lineWidthMm}):
      {maxCombMm:0,clearanceFor:()=>clearance,...(travel.poseJoinMm===undefined?{}:{poseJoinMm:travel.poseJoinMm}),...(travel.constant?{constantClearanceZ:clearance}:{})};
    operations.push({id:operationId,layerId:course.layerId??operationId,phase:course.phase??'curves',layer:course.layer??index,rank:course.rank??index,
      after:[...new Set([...previous,...(course.after??[])])],strokes,order:course.order??'given',...(course.join?{continuous:joined.continuous}:{}),
      ...(course.connectNearby===undefined?{}:{connectNearby:course.connectNearby}),...(course.regionId===undefined?{}:{regionId:course.regionId}),
      ...(course.fanPercent===undefined?{}:{fanPercent:course.fanPercent}),...(filament===null?{}:{filament}),travelPolicy});
    if(sequential)previous=[operationId];
  }
  return operations;
}
