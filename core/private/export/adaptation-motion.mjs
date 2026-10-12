import {distance,requireThat} from './numeric.mjs';
import {samePose,uprightPose} from '../../path/pose.mjs';
import {ROUNDING_MM} from '../../dimensions.mjs';
import {moveSeconds} from '../../path/saampath.mjs';

// Motion needed only to enter a selected installation and service its material
// changes. The authored deposition/travel actions are retained by Export.
export class AdaptationMotion {
  constructor({start,process,retracted=false,pose=null,retreatMm=process.liftMm}){
    this.position=[...start];this.process=process;this.retracted=retracted;
    this.pose=pose;this.retreatMm=retreatMm;
    this.depositedMaxZ=0;this.phase='start';this.layer=0;this.operationId=null;this.actions=[];
  }
  context(action){this.phase=action.phase;this.layer=action.layer;this.operationId=action.operation??null;}
  append(action){this.actions.push({...action,phase:this.phase,layer:this.layer,...(this.operationId?{operation:this.operationId}:{})});}
  move(to,speed,volumeMm3=0,extra={}){
    const length=distance(this.position,to),pose=extra.pose??null;
    // Rounding guard: a move of zero length within rounding is no move, unless it
    // turns the tool: that reorientation is untimed (the machine's own rate).
    if(length<ROUNDING_MM){
      requireThat(volumeMm3===0,'A zero-length move needs stationary extrusion.');
      if(!pose||samePose(this.pose??uprightPose(),pose)){if(pose)this.pose=pose;return;}
    }
    requireThat(Number.isFinite(speed),'Machine adaptation needs a speed.');
    const durationSeconds=pose&&length>=ROUNDING_MM?(extra.durationSeconds??moveSeconds(length,speed)):extra.durationSeconds;
    this.append({kind:'move',to:[...to],speedMmS:speed,volumeMm3,...extra,...(durationSeconds!==undefined?{durationSeconds}:{})});
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
  // Reorientation is ordinary toolhead travel, as in neutral planning: retreat
  // along the current tool axis, travel over the deposited part to the approach
  // point while the orientation interpolates, then approach along the new axis.
  travel(target,targetPose=null){
    if(targetPose){
      const current=this.pose??uprightPose(),speed=this.process.travelSpeedMmS;
      if(distance(this.position,target)>ROUNDING_MM||!samePose(current,targetPose)){
        this.retract();
        const held=this.pose?{pose:this.pose}:{};
        this.move(this.position.map((v,i)=>v-current.toolAxis[i]*this.retreatMm),speed,0,{...held,travel:'tool-retreat'});
        const approach=target.map((v,i)=>v-targetPose.toolAxis[i]*this.retreatMm),z=Math.max(this.depositedMaxZ+this.process.liftMm,this.position[2],approach[2]);
        for(const [to,extra] of [[[this.position[0],this.position[1],z],held],[[approach[0],approach[1],z],{pose:targetPose}],[approach,{pose:targetPose}],[target,{pose:targetPose}]])
          if(distance(this.position,to)>=ROUNDING_MM)this.move(to,speed,0,{...extra,travel:to===target?'approach':'position'});
      }
      this.pose=targetPose;this.recover();return;
    }
    if(distance(this.position,target)>ROUNDING_MM){
      this.retract();
      const z=Math.max(this.depositedMaxZ+this.process.liftMm,this.position[2],target[2]);
      this.move([this.position[0],this.position[1],z],this.process.zSpeedMmS);
      this.move([target[0],target[1],z],this.process.travelSpeedMmS);
      this.move(target,this.process.zSpeedMmS);
    }
    this.recover();
  }
  park(){
    this.retract();
    if(this.pose){this.move(this.position.map((v,i)=>v-this.pose.toolAxis[i]*this.retreatMm),this.process.travelSpeedMmS,0,{pose:this.pose,travel:'tool-retreat'});return;}
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
