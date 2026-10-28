import {requireThat} from '../private/toolpath/numeric.mjs';
import {axisFrame,unitDirection} from '../geom/frame.mjs';
import {validatePose,axisPose} from './pose.mjs';
import {profileAt,keyed} from './curve-profiles.mjs';
// Point-volume deposition owns no inferred footprint. Its explicit approach and
// stationary material use the same strokes/composition as every other operation.


export function validateStationaryAction(record){
  const {volumeMm3,flowMm3S,holdSeconds}=record??{};
  requireThat(Number.isFinite(holdSeconds)&&holdSeconds>=0&&
    (Number.isFinite(volumeMm3)&&volumeMm3>0&&Number.isFinite(flowMm3S)&&flowMm3S>0||
      volumeMm3===0&&flowMm3S===0&&holdSeconds>0),'Stationary work needs positive dose/flow or zero dose/flow with positive hold.');
  return record;
}
export function stationaryAt(operation,u=0){
  requireThat(Number.isFinite(u)&&u>=0&&u<=1,'Stationary parameter must be in [0,1].');
  const injection=operation.injection,toolAxis=profileAt(injection.toolAxis,u);
  const doseSeconds=injection.volumeMm3>0?injection.volumeMm3/injection.flowMm3S:0;
  const durationSeconds=doseSeconds+injection.holdSeconds;
  return {...injection,point:injection.at,toolAxis,pose:axisPose(toolAxis),toolIndex:operation.toolIndex??operation.filament,
    u,requestedSeconds:u*durationSeconds,durationSeconds,doseSeconds};
}
export function* stationaryActions(operation,orientationToleranceRad,identity={}){
  const start=stationaryAt(operation),profile=operation.injection.toolAxis,T=start.durationSeconds,phase=start.doseSeconds/T;
  const cuts=[...new Set([0,1,...(phase>0&&phase<1?[phase]:[]),...(keyed(profile)?profile.knots.map(([u])=>u):[])])].sort((a,b)=>a-b);
  for(let i=1;i<cuts.length;i++){
    const a=cuts[i-1],b=cuts[i],left=stationaryAt(operation,a),right=stationaryAt(operation,b);
    const cross=[left.toolAxis[1]*right.toolAxis[2]-left.toolAxis[2]*right.toolAxis[1],left.toolAxis[2]*right.toolAxis[0]-left.toolAxis[0]*right.toolAxis[2],left.toolAxis[0]*right.toolAxis[1]-left.toolAxis[1]*right.toolAxis[0]];
    const angle=Math.atan2(Math.hypot(...cross),left.toolAxis.reduce((s,v,k)=>s+v*right.toolAxis[k],0));
    // A spherical arc's chord sagitta bounds its normalized linear direction
    // approximation conservatively by angle²/8 at these short local spans.
    const pieces=Math.max(1,Math.ceil(angle/Math.min(.5,Math.sqrt(8*orientationToleranceRad))));
    for(let j=0;j<pieces;j++){
      const from=a+(b-a)*j/pieces,to=a+(b-a)*(j+1)/pieces,first=stationaryAt(operation,from),last=stationaryAt(operation,to),seconds=(to-from)*T;
      const common={...identity,operation:operation.id,at:start.point,toolIndex:start.toolIndex,toolAxis:last.toolAxis,
        pose:last.pose,poseFrom:first.pose,stationaryRange:{from,to},toolAxisInterpolation:'slerp',durationSeconds:seconds};
      if(to<=phase&&start.doseSeconds>0)yield {kind:'extrude',volumeMm3:seconds*operation.injection.flowMm3S,flowMm3S:operation.injection.flowMm3S,...common};
      else if(angle>0)yield {kind:'move',to:start.point,volumeMm3:0,speedMmS:0,...common};
      else yield {kind:'dwell',seconds,...common};
    }
  }
}
export function validateInjectionPoint(record){
  const keys=record&&Object.keys(record).filter(key=>key!=='direction').sort().join();
  requireThat(keys==='approachMm,flowMm3S,holdSeconds,point,volumeMm3','Injection point needs point, volumeMm3, flowMm3S, holdSeconds and approachMm, with optional direction.');
  requireThat(Array.isArray(record.point)&&record.point.length===3&&record.point.every(Number.isFinite),'Injection point must be finite XYZ.');
  validateStationaryAction(record);
  for(const key of ['holdSeconds','approachMm'])requireThat(Number.isFinite(record[key])&&record[key]>=0,`Injection ${key} must be nonnegative.`);
  if(record.direction!==undefined)requireThat(Array.isArray(record.direction)&&record.direction.length===3&&record.direction.every(Number.isFinite)&&Math.hypot(...record.direction)>0,'Injection direction must be a finite nonzero XYZ vector pointing into the cavity.');
  return record;
}

export function pointInjectionOperation(record,{process,restoreNozzleC,nozzleC=null,role='injection',...operation}){
  validateInjectionPoint(record);
  requireThat(nozzleC===null||Number.isFinite(nozzleC)&&nozzleC>0,'Injection temperature must be positive or null.');
  const direction=unitDirection(record.direction??[0,0,-1]),frame=axisFrame(direction.map(value=>-value));
  const pose=record.direction===undefined?null:validatePose({toolAxis:direction,toolUp:frame.map(row=>row[1])});
  // The approach is clearance the nozzle occupies, not deposition: it is kept as
  // the occupied height below; the Scheduler routes travel to the point itself.
  const point=[...record.point],approach=point.map((value,i)=>value-direction[i]*record.approachMm);
  const strokes=[{points:[point],closed:false,role,...(pose?{poses:[pose]}:{}),stationaryExtrusion:{volumeMm3:record.volumeMm3,flowMm3S:record.flowMm3S,holdSeconds:record.holdSeconds}}];
  return {...operation,order:'given',connectNearby:false,strokes,process,
    fanPercent:process.fanPercent,
    ...(nozzleC===null?{}:{nozzleC,restoreNozzleC}),
    clearanceZ:Math.max(point[2],approach[2]),materialGeometry:{kind:'bounds',maxZ:point[2],approachZ:Math.max(point[2],approach[2]),constant:true}};
}
