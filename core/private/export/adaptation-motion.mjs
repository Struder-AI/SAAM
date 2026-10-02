import {distance,requireThat} from './numeric.mjs';
import {bedPoint} from './frame.mjs';

// Motion needed only to enter a selected installation and service its material
// changes. The authored deposition/travel actions are retained by Export.
export class AdaptationMotion {
  constructor({start,process,retracted=false,pose=null,motion=null}){
    this.position=[...start];this.process=process;this.retracted=retracted;
    this.pose=pose;this.motion=motion??{retreatMm:process.liftMm,transitionSeconds:1,rotaryCenterMm:[0,0,0]};
    this.depositedMaxZ=0;this.phase='start';this.layer=0;this.operationId=null;this.actions=[];
  }
  context(action){this.phase=action.phase;this.layer=action.layer;this.operationId=action.operation??null;}
  append(action){this.actions.push({...action,phase:this.phase,layer:this.layer,...(this.operationId?{operation:this.operationId}:{})});}
  move(to,speed,volumeMm3=0,extra={}){
    const length=distance(this.position,to),pose=extra.pose??null;
    if(length<1e-10&&!pose){requireThat(volumeMm3===0,'A zero-length move needs stationary extrusion.');return;}
    requireThat(Number.isFinite(speed)&&speed>0,'Machine adaptation needs positive speed.');
    const durationSeconds=pose?(extra.durationSeconds??(length?length/speed:this.motion.transitionSeconds)):undefined;
    this.append({kind:'move',to:[...to],speedMmS:speed,volumeMm3,...extra,...(pose?{durationSeconds}:{} )});
    if(volumeMm3>0)this.depositedMaxZ=Math.max(this.depositedMaxZ,this.position[2],to[2]);
    this.position=[...to];this.pose=pose;
  }
  retract(){
    if(this.retracted||!(this.process.retractMm>0))return;
    this.append({kind:'retract',filamentMm:this.process.retractMm,speedMmS:this.process.retractSpeedMmS});this.retracted=true;
  }
  recover(){
    if(!this.retracted)return;
    this.append({kind:'recover',filamentMm:this.process.retractMm,speedMmS:this.process.retractSpeedMmS});this.retracted=false;
  }
  travel(target,targetPose=null){
    if(targetPose&&this.pose){
      this.retract();
      const retreat=this.position.map((v,i)=>v-this.pose.toolAxis[i]*this.motion.retreatMm);
      this.move(retreat,this.process.travelSpeedMmS,0,{travel:'tool-retreat'});
      const room=bedPoint(this.position,this.pose.rotaryDeg,this.motion.rotaryCenterMm);
      const held=bedPoint(room,targetPose.rotaryDeg,this.motion.rotaryCenterMm,true);
      this.move(held,this.process.travelSpeedMmS,0,{pose:targetPose,durationSeconds:this.motion.transitionSeconds,travel:'reorient'});
      const approach=target.map((v,i)=>v-targetPose.toolAxis[i]*this.motion.retreatMm);
      this.move(approach,this.process.travelSpeedMmS,0,{pose:targetPose,travel:'position'});
      this.move(target,this.process.travelSpeedMmS,0,{pose:targetPose,travel:'approach'});
      this.recover();return;
    }
    if(distance(this.position,target)>1e-9){
      this.retract();
      const z=Math.max(this.depositedMaxZ+this.process.liftMm,this.position[2],target[2]);
      this.move([this.position[0],this.position[1],z],this.process.zSpeedMmS);
      this.move([target[0],target[1],z],this.process.travelSpeedMmS);
      this.move(target,this.process.zSpeedMmS);
    }
    this.recover();
    if(targetPose)this.move(target,this.process.travelSpeedMmS,0,{pose:targetPose,durationSeconds:this.motion.transitionSeconds,travel:'reorient'});
  }
  park(){
    this.retract();
    if(this.pose){this.move(this.position.map((v,i)=>v-this.pose.toolAxis[i]*this.motion.retreatMm),this.process.travelSpeedMmS,0,{travel:'tool-retreat'});return;}
    const z=Math.max(this.depositedMaxZ+this.process.liftMm,this.position[2]);
    this.move([this.position[0],this.position[1],z],this.process.zSpeedMmS);
  }
}

export function machinePriming(motion,machine,bounds,geometryBounds){
  const settings=machine.startup?.primingStrokes;
  if(!settings)return;
  const {lineLengthMm:length,clearanceMm:gap}=settings,p=motion.process,w=p.lineWidthMm,z=p.firstLayerMm,bed=bounds??machine.bounds;
  requireThat(Number.isFinite(length)&&length>0&&Number.isFinite(gap)&&gap>0,'Invalid machine priming strokes.');
  const candidates=[];
  for(const axis of [1,0])for(const sign of [-1,1]){
    const along=1-axis,edge=sign<0?bed.min[axis]+w/2:bed.max[axis]-w/2,start=bed.min[along]+w/2;
    const point=(a,b)=>{const q=[0,0,z];q[axis]=a;q[along]=b;return q;};
    const points=[point(edge,start),point(edge,start+length),point(edge-sign*w,start+length),point(edge-sign*w,start)];
    if(points.every(q=>q.every((v,i)=>v>=bed.min[i]+(i<2?w/2:0)&&v<=bed.max[i]-(i<2?w/2:0)))){
      if(distance(motion.position,points.at(-1))<distance(motion.position,points[0]))points.reverse();candidates.push(points);
    }
  }
  requireThat(candidates.length,'No room for the machine priming lane inside the selected tool bounds.');
  const available=geometryBounds?candidates.filter(points=>[0,1].some(axis=>
    Math.max(...points.map(q=>q[axis]))+w/2+gap<=geometryBounds.min[axis]||
    Math.min(...points.map(q=>q[axis]))-w/2-gap>=geometryBounds.max[axis])):candidates;
  requireThat(available.length,'No room for machine priming strokes outside the complete part/support/deposition footprint.');
  available.sort((a,b)=>distance(motion.position,a[0])-distance(motion.position,b[0]));
  const points=available[0];
  motion.phase='prime';motion.layer=0;motion.operationId=null;
  motion.travel(points[0]);
  for(const point of points.slice(1))motion.move(point,p.firstLayerSpeedMmS,distance(motion.position,point)*w*z,{role:'prime'});
  motion.park();
}
