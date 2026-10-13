import {distance} from '../private/toolpath/numeric.mjs';
// Freeze operation-local deposition before downstream material consumers.
// Machine positioning, retraction and travel remain the composer's single pass.

import {orderStrokes,orderScanlineCells} from './stroke-order.mjs';
import {materialContainsConnection} from '../geom/material-envelope.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {samePose,uprightPose} from './pose.mjs';
import {strokeRange} from './deposition.mjs';

const CONNECTION_SPAN_MM=2;
function canDepositConnection(from,to,material,fromPose,toPose){
  const gap=distance(from,to);
  if(gap<=PRINT_RESOLUTION_MM||gap>CONNECTION_SPAN_MM)return false;
  if(fromPose&&(toPose||!samePose(fromPose,uprightPose())))return material?.poseJoinMm>0&&gap<=material.poseJoinMm;
  return materialContainsConnection(material,from,to);
}

function connectionStroke(previous,next,policy){
  if(previous.stationaryExtrusion||next.stationaryExtrusion||previous.points.length<2||next.points.length<2)return null;
  const from=previous.points.at(-1),to=next.points[0],last=previous.points.length-2;
  const previousVolume=previous.volumesMm3?.[last]??distance(previous.points.at(-2),from)*previous.beadAreaMm2;
  const area=next.volumesMm3?next.volumesMm3[0]/distance(to,next.points[1]):next.beadAreaMm2;
  if(!(previousVolume>0)||!(area>0)||!canDepositConnection(from,to,policy,previous.poses?.at(-1),next.poses?.[0]))return null;
  const metadata={...next.segmentMetadata?.[0],role:next.role,connector:true,
    beadWidthMm:next.segmentMetadata?.[0]?.beadWidthMm??next.beadWidthMm};
  const stroke={points:[from,to],closed:false,role:next.role,beadWidthMm:metadata.beadWidthMm,
    speedMmS:metadata.speedMmS??next.speedMmS,volumesMm3:[distance(from,to)*area],segmentMetadata:[metadata]};
  // Preserve endpoint frames where both producers supply them. Never invent a
  // chart coordinate across unrelated charts or an authored curve parameter.
  for(const key of ['poses','frameSamples'])if(previous[key]&&next[key])stroke[key]=[previous[key].at(-1),next[key][0]];
  return stroke;
}

export function resolveDepositionConnections(result,{allowConnections=true,excludedOperationIds=[]}={}){
  const excluded=new Set(excludedOperationIds);
  let count=0,volumeMm3=0;const operationIds=[];
  const operations=result.operations.map(operation=>{
    if(operation.depositionConnectionsResolved)return operation;
    const from=operation.strokes[0]?.points[0],ordered=operation.order==='nearest'?orderStrokes(operation.strokes,from)
      :operation.order==='nearest-cells'?orderScanlineCells(operation.strokes,from):operation.strokes,strokes=[];let added=0;
    for(const input of ordered){
      const stroke=input.closed?strokeRange(input):input;
      if(allowConnections&&!excluded.has(operation.id)&&operation.connectNearby&&strokes.length){
        const connector=connectionStroke(strokes.at(-1),stroke,operation.materialGeometry);
        if(connector){strokes.push(connector);added++;volumeMm3+=connector.volumesMm3[0];}
      }
      strokes.push(stroke);
    }
    if(added){count+=added;operationIds.push(operation.id);}
    return {...operation,strokes,order:'given',connectNearby:false,depositionConnectionsResolved:true};
  });
  if(operations.every((operation,i)=>operation===result.operations[i]))return result;
  return {...result,operations,report:{...result.report,depositionConnections:{count,volumeMm3,operationIds,
    excludedOperationIds:result.operations.filter(op=>op.connectNearby&&(!allowConnections||excluded.has(op.id))).map(op=>op.id),ordering:'construction'}}};
}
