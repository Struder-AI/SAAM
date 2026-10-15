import {requireThat} from '../private/toolpath/numeric.mjs';
import {axisFrame,unitDirection} from '../geom/frame.mjs';
import {validatePose} from './pose.mjs';
// Point-volume deposition owns no inferred footprint. Its explicit approach and
// stationary material use the same strokes/composition as every other operation.


export function validateInjectionPoint(record){
  const keys=record&&Object.keys(record).filter(key=>key!=='direction').sort().join();
  requireThat(keys==='approachMm,flowMm3S,holdSeconds,point,volumeMm3','Injection point needs point, volumeMm3, flowMm3S, holdSeconds and approachMm, with optional direction.');
  requireThat(Array.isArray(record.point)&&record.point.length===3&&record.point.every(Number.isFinite),'Injection point must be finite XYZ.');
  for(const key of ['volumeMm3','flowMm3S'])requireThat(Number.isFinite(record[key])&&record[key]>0,`Injection ${key} must be positive.`);
  for(const key of ['holdSeconds','approachMm'])requireThat(Number.isFinite(record[key])&&record[key]>=0,`Injection ${key} must be nonnegative.`);
  if(record.direction!==undefined)requireThat(Array.isArray(record.direction)&&record.direction.length===3&&record.direction.every(Number.isFinite)&&Math.hypot(...record.direction)>0,'Injection direction must be a finite nonzero XYZ vector pointing into the cavity.');
  return record;
}

export function pointInjectionOperation(record,{plan,nozzleC=null,role='injection',...operation}){
  validateInjectionPoint(record);
  requireThat(nozzleC===null||Number.isFinite(nozzleC)&&nozzleC>0,'Injection temperature must be positive or null.');
  const direction=unitDirection(record.direction??[0,0,-1]),frame=axisFrame(direction.map(value=>-value));
  const pose=record.direction===undefined?null:validatePose({toolAxis:direction,toolUp:frame.map(row=>row[1])});
  const point=[...record.point],approach=point.map((value,i)=>value-direction[i]*record.approachMm);
  const strokes=record.approachMm>0?[{points:[approach,point],closed:false,role:'injection-approach',
    ...(pose?{poses:[pose,pose]}:{}),beadAreaMm2:0,beadWidthMm:plan.process.lineWidthMm,speedMmS:plan.process.zSpeedMmS,volumesMm3:[0],segmentMetadata:[{travel:'injection-approach'}]}]:[];
  strokes.push({points:[point],closed:false,role,...(pose?{poses:[pose]}:{}),stationaryExtrusion:{volumeMm3:record.volumeMm3,flowMm3S:record.flowMm3S,holdSeconds:record.holdSeconds}});
  if(record.approachMm>0)strokes.push({points:[point,approach],closed:false,role:'injection-withdrawal',
    ...(pose?{poses:[pose,pose]}:{}),beadAreaMm2:0,beadWidthMm:plan.process.lineWidthMm,speedMmS:plan.process.zSpeedMmS,volumesMm3:[0],segmentMetadata:[{travel:'injection-withdrawal'}]});
  return {...operation,order:'given',connectNearby:false,strokes,process:plan.process,
    fanPercent:plan.process.fanPercent,
    ...(nozzleC===null?{}:{nozzleC,restoreNozzleC:plan.setup.nozzleC}),
    clearanceZ:Math.max(point[2],approach[2]),materialGeometry:{kind:'bounds',maxZ:point[2],approachZ:Math.max(point[2],approach[2]),constant:true}};
}
