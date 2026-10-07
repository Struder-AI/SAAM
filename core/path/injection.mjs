import {requireThat} from '../private/toolpath/numeric.mjs';
// Point-volume deposition owns no inferred footprint. Its explicit approach and
// stationary material use the same strokes/composition as every other operation.


export function validateInjectionPoint(record){
  requireThat(record&&Object.keys(record).sort().join()==='approachMm,flowMm3S,holdSeconds,point,volumeMm3','Injection point needs point, volumeMm3, flowMm3S, holdSeconds and approachMm.');
  requireThat(Array.isArray(record.point)&&record.point.length===3&&record.point.every(Number.isFinite),'Injection point must be finite XYZ.');
  for(const key of ['volumeMm3','flowMm3S'])requireThat(Number.isFinite(record[key])&&record[key]>0,`Injection ${key} must be positive.`);
  for(const key of ['holdSeconds','approachMm'])requireThat(Number.isFinite(record[key])&&record[key]>=0,`Injection ${key} must be nonnegative.`);
  return record;
}

export function pointInjectionOperation(record,{plan,nozzleC=null,role='injection',...operation}){
  validateInjectionPoint(record);
  requireThat(nozzleC===null||Number.isFinite(nozzleC)&&nozzleC>0,'Injection temperature must be positive or null.');
  const point=[...record.point],approach=[point[0],point[1],point[2]+record.approachMm];
  const strokes=record.approachMm>0?[{points:[approach,point],closed:false,role:'injection-approach',
    beadAreaMm2:0,beadWidthMm:plan.process.lineWidthMm,speedMmS:plan.process.zSpeedMmS,volumesMm3:[0],segmentMetadata:[{travel:'injection-approach'}]}]:[];
  strokes.push({points:[point],closed:false,role,stationaryExtrusion:{volumeMm3:record.volumeMm3,flowMm3S:record.flowMm3S,holdSeconds:record.holdSeconds}});
  return {...operation,order:'given',connectNearby:false,strokes,process:plan.process,
    fanPercent:plan.process.fanPercent,
    ...(nozzleC===null?{}:{nozzleC,restoreNozzleC:plan.setup.nozzleC}),
    clearanceZ:approach[2],travelPolicy:{maxCombMm:0,canTravelDirect:()=>false,clearanceFor:()=>approach[2],constantClearanceZ:approach[2]}};
}
