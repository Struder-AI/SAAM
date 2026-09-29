// Point-volume deposition owns no inferred footprint. Its explicit approach and
// stationary material use the same strokes/composition as every other operation.
import {requireThat} from '../geom/tolerance.mjs';
import {requireProcessControl,validateNozzleC} from './process-controls.mjs';
import {toolBounds} from '../machine/profile.mjs';

export function validateInjectionPoint(record){
  requireThat(record&&Object.keys(record).sort().join()==='approachMm,flowMm3S,holdSeconds,point,volumeMm3','Injection point needs point, volumeMm3, flowMm3S, holdSeconds and approachMm.');
  requireThat(Array.isArray(record.point)&&record.point.length===3&&record.point.every(Number.isFinite),'Injection point must be finite XYZ.');
  for(const key of ['volumeMm3','flowMm3S'])requireThat(Number.isFinite(record[key])&&record[key]>0,`Injection ${key} must be positive.`);
  for(const key of ['holdSeconds','approachMm'])requireThat(Number.isFinite(record[key])&&record[key]>=0,`Injection ${key} must be nonnegative.`);
  return record;
}

export function pointInjectionOperation(record,{plan,machine,nozzleC=null,role='injection',...operation}){
  validateInjectionPoint(record);requireProcessControl(machine);
  requireThat(record.flowMm3S<=plan.process.maxFlowMm3S+1e-8,`Injection ${operation.id} exceeds the selected material flow limit (${plan.process.maxFlowMm3S} mm³/s).`);
  if(nozzleC!==null)validateNozzleC(nozzleC,plan,machine);
  const point=[...record.point],approach=[point[0],point[1],point[2]+record.approachMm];
  const bounds=toolBounds(machine,plan.setup.tool);
  requireThat([point,approach].every(p=>p.every((v,axis)=>v>=bounds.min[axis]-1e-8&&v<=bounds.max[axis]+1e-8)),`Injection ${operation.id} point or approach exceeds selected tool bounds.`);
  const strokes=record.approachMm>0?[{points:[approach,point],closed:false,role:'injection-approach',
    beadAreaMm2:0,beadWidthMm:plan.process.lineWidthMm,speedMmS:plan.process.zSpeedMmS,volumesMm3:[0],segmentMetadata:[{travel:'injection-approach'}]}]:[];
  strokes.push({points:[point],closed:false,role,stationaryExtrusion:{volumeMm3:record.volumeMm3,flowMm3S:record.flowMm3S,holdSeconds:record.holdSeconds}});
  return {...operation,order:'given',connectNearby:false,strokes,
    fanPercent:plan.process.fanPercent,
    ...(nozzleC===null?{}:{nozzleC,restoreNozzleC:plan.setup.nozzleC}),
    clearanceZ:approach[2],travelPolicy:{maxCombMm:0,canTravelDirect:()=>false,clearanceFor:()=>approach[2],constantClearanceZ:approach[2]}};
}
