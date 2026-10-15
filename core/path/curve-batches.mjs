import {requireThat} from '../private/toolpath/numeric.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';

import {depositCurves,trimVanishingEnd} from './deposition.mjs';
import {joinCurveSequence} from './stack-curves.mjs';

// Mapped batch data -> beads and ordered operations. Geometry construction,
// reference resolution and final coverage publication remain separate stages.
export function depositCurveBatches({id,batches,process,after=[],filament=null,sequential=true}){
  let previous=[...after];const operations=[];
  for(const [index,batch] of batches.entries()){
    const joined=joinCurveSequence(batch.curves,batch.join??{});
    let strokes=depositCurves(joined.curves,{widthMm:batch.widthMm??process.lineWidthMm,heightMm:batch.heightMm??process.layerMm,speedMmS:batch.speedMmS??process.planarSpeedMmS});
    if(batch.trimEnd&&strokes.length)strokes=[...strokes.slice(0,-1),trimVanishingEnd(strokes.at(-1))];
    requireThat(strokes.length>0,'A deposition batch needs at least one stroke.');
    const points=strokes.flatMap(s=>s.points),low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
    for(const p of points)for(let k=0;k<3;k++){low[k]=Math.min(low[k],p[k]);high[k]=Math.max(high[k],p[k]);}
    const top=high[2],key=batch.key??index,operationId=`${id}:${key}`;
    const travel=batch.travel??{kind:'clearance'};
    const inferred=travel.kind==='auto',planar=inferred&&top-low[2]<=PRINT_RESOLUTION_MM;
    const width=Math.max(...strokes.map(s=>s.beadWidthMm??process.lineWidthMm));
    const min=[0,1].map(k=>low[k]-width/2),max=[0,1].map(k=>high[k]+width/2);
    const region=inferred?[[min,[max[0],min[1]],max,[min[0],max[1]]]]:travel.region;
    const materialGeometry=travel.kind==='planar'||planar?{kind:'planar',loops:region,zMm:travel.zMm??top,maxZ:travel.zMm??top,lineWidthMm:inferred?width:batch.widthMm??process.lineWidthMm,
      ...(inferred?{coverage:'bounds'}:{}),...(travel.maxCombMm===undefined?{}:{maxCombMm:travel.maxCombMm})}:
      {kind:'bounds',maxZ:top,...(travel.clearanceZ===undefined?{}:{approachZ:travel.clearanceZ}),...(travel.poseJoinMm===undefined?{}:{poseJoinMm:travel.poseJoinMm}),...(travel.constant?{constant:true}:{})};
    operations.push({id:operationId,layerId:batch.layerId??(planar?`planar:${top}`:operationId),phase:batch.phase??(planar?'planar':'curves'),layer:batch.layer??index,rank:batch.rank??index,
      after:[...new Set([...previous,...(batch.after??[])])],strokes,order:batch.order??'given',...(batch.join?{continuous:joined.continuous}:{}),
      ...(batch.connectNearby===undefined?{}:{connectNearby:batch.connectNearby}),...(batch.regionId===undefined?{}:{regionId:batch.regionId}),
      ...(batch.layerIndex===undefined?{}:{layerIndex:batch.layerIndex}),...(batch.layerCount===undefined?{}:{layerCount:batch.layerCount}),
      ...(inferred?{region}:{}),
      ...(batch.fanPercent===undefined?{}:{fanPercent:batch.fanPercent}),...(filament===null?{}:{filament}),process,materialGeometry});
    if(sequential)previous=[operationId];
  }
  return operations;
}
