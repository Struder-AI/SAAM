import {distance} from '../private/toolpath/numeric.mjs';
// Freeze operation-local deposition before downstream material consumers.
// Machine positioning, retraction and travel remain the composer's single pass.

import {orderStrokes,orderScanlineCells} from './stroke-order.mjs';
import {regionContainsSegment,materialHeight} from '../geom/material-envelope.mjs';
import {PRINT_RESOLUTION_MM} from '../dimensions.mjs';
import {samePose,uprightPose} from './pose.mjs';
import {strokeRange} from './deposition.mjs';

const CONNECTION_SPAN_MM=2;
// Toolpath chooses a connector's bead allowance and sag. Geometry answers the
// resulting membership/height queries without interpreting process records.
function materialContainsConnection(material,from,to){
  if(!material||material.kind==='bounds'||material.coverage==='bounds')return false;
  // Process scale: the existing 0.05 mm allowance for joining within a bead.
  const clearance=material.kind==='surface'?0:Math.max(0,material.lineWidthMm/2-0.05);
  if(!regionContainsSegment(from,to,{loops:material.loops,clearanceMm:clearance}))return false;
  if(material.kind==='planar')return Math.abs(from[2]-to[2])<=PRINT_RESOLUTION_MM;
  const steps=Math.max(2,Math.ceil(Math.hypot(to[0]-from[0],to[1]-from[1])/(material.sampleStepMm??0.5)));
  for(let i=0;i<=steps;i++){
    const t=i/steps,z=materialHeight(material,from[0]+t*(to[0]-from[0]),from[1]+t*(to[1]-from[1]));
    if(!Number.isFinite(z)||from[2]+t*(to[2]-from[2])<z-(material.sagMm??0)-PRINT_RESOLUTION_MM)return false;
  }
  return true;
}
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
