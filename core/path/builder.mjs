// SAAMpath construction and travel planning.
//
// One travel/retraction state is shared across composed skill operations.
// A move is classified before choosing its travel behavior:
//
//   * joined   - the next stroke starts where this one ended: keep extruding.
//   * combed   - a short hop that stays inside the material already under the
//                nozzle on this layer: move at print height, no retract, no lift.
//   * hopped   - anything else: retract, lift to the clearance this particular
//                hop needs, traverse, descend, recover.
//
// Lifted travel clears the highest material deposited so far, across every
// operation. Geometry policies only decide whether a move can stay down.

import { requireThat, distance, TOLERANCE } from '../geom/tolerance.mjs';
import {combRoute,combSegment,prepareCombCorners} from './comb.mjs';
import {materialRegion} from './material.mjs';
import {uprightPose,validatePose,samePose,bedPoint} from './pose.mjs';
import {requireProcessControl} from './process-controls.mjs';

// Candidate distance for checking whether XYZ output collapses. This is not a
// minimum printable segment length: five-decimal output can retain much shorter
// moves, and deleting them changes the start of the next volume-bearing move.
export const MINIMUM_MOVE_MM = 1e-4;
export const NEARBY_MOVE_MM = 1;
import { pointInRegion, pointSegmentDistance, SegmentIndex } from '../region/region2d.mjs';

export class PathBuilder {
  constructor({ start, process, machine, generatorVersion, motion=null, tool=null }) {
    requireThat(Array.isArray(start) && start.length === 3 && start.every(Number.isFinite), 'PathBuilder needs a 3D start position.');
    this.actions = [];
    this.start = [...start];
    this.position = [...start];
    this.process = process;
    this.machine = machine;
    this.generatorVersion = generatorVersion;
    this.motion=motion;
    this.pose=motion?structuredClone(motion.initialPose):null;
    this.retracted = false;
    this.tool = tool; // the nozzle in use, or null for a machine with one
    this.toolChange = null; // the output's nozzle-change sequence, when it has one
    this.phase = 'start';
    this.layer = 0;
    this.layerSeconds = 0;
    this.depositedMaxZ = 0;
    this.stats = { joined: 0, combed: 0, hopped: 0, travelMm: 0, retractions: 0, printMm: 0 };
  }

  setContext(phase, layer) { this.phase = phase; this.layer = layer; }

  // Speed is capped by the locked material flow and Z feed, exactly as the
  // plan specifies; generation makes no new process choices.
  move(to, speed, volumeMm3 = 0, extra = {}) {
    requireThat(Array.isArray(to)&&to.length===3&&to.every(Number.isFinite)&&Number.isFinite(speed)&&speed>0&&Number.isFinite(volumeMm3)&&volumeMm3>=0,'Invalid path move.');
    const length = distance(this.position, to);
    if(this.pose){
      const pose=validatePose(extra.pose??this.pose);
      if(length<MINIMUM_MOVE_MM&&samePose(this.pose,pose))return;
      const limited=volumeMm3>0?Math.min(speed,this.process.maxFlowMm3S*length/volumeMm3):speed;
      const seconds=extra.durationSeconds??(length>=MINIMUM_MOVE_MM?length/limited:this.motion.transitionSeconds);
      requireThat(Number.isFinite(seconds)&&seconds>0,'Pose motion needs positive duration.');
      this.actions.push({kind:'move',to:[...to],speedMmS:speed,volumeMm3,phase:this.phase,layer:this.layer,
        ...(this.operationId?{operation:this.operationId}:{}),...extra,pose:structuredClone(pose),durationSeconds:seconds});
      this.layerSeconds+=seconds;
      if(volumeMm3>0){this.stats.printMm+=length;this.depositedMaxZ=Math.max(this.depositedMaxZ,this.position[2],to[2]);}
      else this.stats.travelMm+=length;
      this.position=[...to];this.pose=structuredClone(pose);return;
    }
    requireThat(!extra.pose,'Machine cannot represent oriented/rotary motion.');
    // S5/H2D XYZ output uses five decimals. Decide representability from the
    // rounded coordinates, not Euclidean length: short segments can cross a
    // grid boundary. Robot Cartesian output retains still more decimals.
    const coordinateDecimals=this.machine.id==='dobot-mg400'?10:5;
    if (length < MINIMUM_MOVE_MM && this.position.every((v,i)=>
      Number(v.toFixed(coordinateDecimals))===Number(to[i].toFixed(coordinateDecimals)))) return;
    let limited = speed;
    if (volumeMm3 > 0) limited = Math.min(limited, this.process.maxFlowMm3S * length / volumeMm3);
    const dz = Math.abs(to[2] - this.position[2]);
    if (dz > 0) limited = Math.min(limited, this.process.zSpeedMmS * length / dz);
    for(let i=0;i<3;i++)if(Math.abs(to[i]-this.position[i])>0)
      limited=Math.min(limited,this.machine.maxFeedMmS['xyz'[i]]*length/Math.abs(to[i]-this.position[i]));
    const action={kind:'move',to:[...to],speedMmS:limited,volumeMm3,phase:this.phase,layer:this.layer,
      ...(this.operationId?{operation:this.operationId}:{}),...extra};
    const run=this.moveRun;
    if(run&&this.actions.at(-1)===run.action&&mergeableMove(run,action)) {
      run.action.to=action.to;
      run.action.volumeMm3+=volumeMm3;
      run.action.speedMmS=Math.min(run.action.speedMmS,limited);
    } else {
      this.actions.push(action);
      this.moveRun={action,from:[...this.position],direction:to.map((v,i)=>(v-this.position[i])/length),density:volumeMm3/length};
    }
    this.layerSeconds += length / limited;
    if (volumeMm3 > 0) {
      this.stats.printMm += length;
      this.depositedMaxZ = Math.max(this.depositedMaxZ, this.position[2], to[2]);
    } else this.stats.travelMm += length;
    this.position = [...to];
  }

  retract() {
    if (this.retracted || !(this.process.retractMm > 0)) return;
    this.actions.push({ kind: 'retract', filamentMm: this.process.retractMm, speedMmS: this.process.retractSpeedMmS, phase: this.phase, layer: this.layer });
    this.retracted = true;
    this.stats.retractions++;
  }

  recover() {
    if (!this.retracted) return;
    this.actions.push({ kind: 'recover', filamentMm: this.process.retractMm, speedMmS: this.process.retractSpeedMmS, phase: this.phase, layer: this.layer });
    this.retracted = false;
  }

  fan(percent) { this.actions.push({ kind: 'fan', percent, phase: this.phase, layer: this.layer }); }

  // Change to another nozzle: park at clearance, record the change, and adopt the new nozzle's bounds.
  // The machine's own sequence (`toolChange`, from the output profile) decides where the head goes: it lifts
  // clear of everything moved so far, runs the change at its fixed entry point, and the new nozzle is then
  // primed on a small pad. Without a declared sequence the change is recorded and the exporter refuses it.
  switchTool(index) {
    if (index === this.tool) return;
    requireThat(Number.isInteger(index) && index >= 0, 'Invalid tool index.');
    this.park();
    const change = this.toolChange, action = {kind: 'tool', fromTool: this.tool, toTool: index, phase: this.phase, layer: this.layer, operation: this.operationId};
    if (change) {
      // A lift the profile's clearance rule allows, at the export's written precision: the tallest point the head has reached, plus the margin.
      const reached = Math.max(this.start[2], ...this.actions.filter(a => a.kind === 'move').map(a => a.to[2]));
      action.lift = Math.ceil(Math.max(change.lift.minMm, reached + change.lift.aboveWorkMm) * 1000 - 1e-6) / 1000;
      action.position = [change.entry.x, change.entry.y, action.lift];
    }
    this.actions.push(action);
    this.changes = (this.changes ?? 0) + 1;
    this.tool = index;
    if (this.boundsFor) this.motionBounds = this.boundsFor(index);
    if (action.position) this.position = [...action.position];
    this.retracted = false;
    this.moveRun = null;
    if (change?.purge) this.purge(change.purge, action.lift);
  }

  // Flush the new nozzle on a pad at the machine's service edge, then leave lifted and retracted like any hop.
  // Rows alternate direction; each change prints one pad layer higher so a later pad never meets an earlier one.
  purge({x0, x1, y0, pitchMm, volumeMm3}, lift) {
    const p = this.process, area = p.lineWidthMm * p.layerMm, length = x1 - x0;
    const rows = Math.ceil(volumeMm3 / (area * (length + pitchMm)));
    const z = p.firstLayerMm + (this.changes - 1) * p.layerMm, deposit = {role: 'prime'};
    const context = [this.phase, this.layer];
    this.setContext('prime', this.changes - 1);
    this.move([x0, y0, lift], p.travelSpeedMmS);
    this.move([x0, y0, z], p.zSpeedMmS);
    this.recover();
    let x = x0;
    for (let row = 0; row < rows; row++) {
      const y = y0 + row * pitchMm, far = x === x0 ? x1 : x0;
      if (row > 0) this.move([x, y, z], p.firstLayerSpeedMmS, pitchMm * area, deposit);
      this.move([far, y, z], p.firstLayerSpeedMmS, length * area, deposit);
      x = far;
    }
    this.retract();
    this.move([x, y0 + (rows - 1) * pitchMm, lift], p.zSpeedMmS);
    this.setContext(...context);
  }

  nozzle(targetC) {
    requireProcessControl(this.machine);
    requireThat(Number.isFinite(targetC)&&targetC>0,'Invalid operation temperature.');
    this.actions.push({kind:'temperature',targetC,phase:this.phase,layer:this.layer,operation:this.operationId});
  }

  extrude(volumeMm3,flowMm3S) {
    requireProcessControl(this.machine);
    requireThat(!this.retracted&&Number.isFinite(volumeMm3)&&volumeMm3>0&&Number.isFinite(flowMm3S)&&flowMm3S>0,'Invalid stationary extrusion.');
    const flow=Math.min(flowMm3S,this.process.maxFlowMm3S);
    this.actions.push({kind:'extrude',volumeMm3,flowMm3S:flow,phase:this.phase,layer:this.layer,operation:this.operationId});
    this.layerSeconds+=volumeMm3/flow;
    this.depositedMaxZ=Math.max(this.depositedMaxZ,this.position[2]);
    this.moveRun=null;
  }

  dwell(seconds) { if (seconds > 0) this.actions.push({ kind: 'dwell', seconds, phase: this.phase, layer: this.layer }); }

  // Keep both endpoints reachable without treating a previous lift as material.
  clearanceZ(target = this.position) {
    const clearance = Math.max(this.depositedMaxZ + this.process.liftMm, this.position[2], target[2]);
    requireThat(Number.isFinite(clearance)&&(this.machine.motionChecks==='deferred'||clearance<=(this.motionBounds??this.machine.bounds).max[2]),'Travel clearance exceeds machine/tool Z bounds.');
    return clearance;
  }

  park() {
    if(this.pose&&!samePose(this.pose,uprightPose())){
      this.retract();this.move(this.position.map((v,i)=>v-this.pose.toolAxis[i]*this.motion.retreatMm),this.process.travelSpeedMmS,0,{travel:'tool-retreat'});return;
    }
    const z = this.clearanceZ();
    this.retract();
    this.move([this.position[0], this.position[1], z], this.process.zSpeedMmS);
  }

  finishLayer() {
    const remaining = this.process.minimumLayerSeconds - this.layerSeconds;
    if (remaining > 0) {
      this.park();
      this.dwell(remaining);
    }
    this.layerSeconds = 0;
  }

  travelTo(target, policy, targetPose) {
    if(this.pose&&(targetPose||!samePose(this.pose,uprightPose()))){
      const pose=validatePose(targetPose??uprightPose());
      if(distance(this.position,target)<1e-9&&samePose(this.pose,pose)){this.stats.joined++;this.recover();return 'joined';}
      if(policy.poseJoinMm>0&&this.actions.at(-1)?.operation===this.operationId&&Math.abs(this.position[2]-target[2])<1e-9&&distance(this.position,target)<=policy.poseJoinMm){
        this.stats.combed++;this.move(target,this.process.skinSpeedMmS,0,{pose,travel:'surface-index'});return 'combed';
      }
      this.stats.hopped++;this.retract();
      const retreat=this.position.map((v,i)=>v-this.pose.toolAxis[i]*this.motion.retreatMm);
      this.move(retreat,this.process.travelSpeedMmS,0,{travel:'tool-retreat'});
      // Hold the TCP fixed in the room while changing the bed and tool pose.
      const room=bedPoint(this.position,this.pose.rotaryDeg,this.motion.rotaryCenterMm);
      const held=bedPoint(room,pose.rotaryDeg,this.motion.rotaryCenterMm,true);
      this.move(held,this.process.travelSpeedMmS,0,{pose,durationSeconds:this.motion.transitionSeconds,travel:'reorient'});
      const approach=target.map((v,i)=>v-pose.toolAxis[i]*this.motion.retreatMm);
      this.move(approach,this.process.travelSpeedMmS,0,{pose,travel:'position'});
      this.move(target,this.process.travelSpeedMmS,0,{pose,travel:'approach'});this.recover();return 'hopped';
    }
    const gap = distance(this.position, target);
    if (gap <= 1e-9) { this.stats.joined++; this.recover(); return 'joined'; }
    // Nearby stroke starts do not need a retraction/lift cycle merely because
    // the longer combing budget is disabled or smaller. Keep the same material,
    // surface and earlier-operation checks; proximity does not bridge a hole.
    if(gap<=NEARBY_MOVE_MM&&this.canComb(target,policy,NEARBY_MOVE_MM)) {
      this.stats.combed++;this.recover();
      this.move(target,this.process.travelSpeedMmS,0,{travel:'combed'});
      return 'combed';
    }
    if (this.canComb(target, policy)) {
      this.stats.combed++;
      this.recover();
      this.move(target, this.process.travelSpeedMmS, 0, { travel: 'combed' });
      return 'combed';
    }
    const route=combRoute(this.position,target,policy);
    if(route){this.stats.combed++;this.recover();for(const point of route)this.move(point,this.process.travelSpeedMmS,0,{travel:'combed'});return 'combed';}
    this.stats.hopped++;
    this.retract();
    const clearance = this.clearanceZ(target);
    this.move([this.position[0], this.position[1], clearance], this.process.zSpeedMmS);
    this.move([target[0], target[1], clearance], this.process.travelSpeedMmS);
    this.move(target, this.process.zSpeedMmS);
    this.recover();
    return 'hopped';
  }

  // A hop may be combed when it is short, stays at one height, and the straight
  // line between the two points remains inside this layer's material with the
  // nozzle's own width to spare. Crossing the outline would drag a bead across
  // open air, so that always hops.
  canComb(target, policy, distanceLimit) {
    // A policy may decide for itself: a draped skin travels over a curved
    // surface, where "same height" is the wrong question.
    if (policy.canTravelDirect) return policy.canTravelDirect(this.position, target, distanceLimit)
      &&(!policy.combRegion||combSegment(this.position,target,{...policy,combClearanceMm:policy.directClearanceMm??policy.combClearanceMm}))
      &&(!policy.isTravelClear||policy.isTravelClear(this.position,target));
    const maxDistance=distanceLimit??policy.maxCombMm;
    if (!policy.combRegion || !(maxDistance > 0)) return false;
    if (Math.abs(target[2] - this.position[2]) > 1e-9) return false;
    const span = Math.hypot(target[0] - this.position[0], target[1] - this.position[1]);
    if (span > maxDistance) return false;
    return combSegment(this.position,target,policy)&&(!policy.isTravelClear||policy.isTravelClear(this.position,target));
  }

  toPath(summary = {}) {
    return {
      schema: 'saampath/1',
      generatorVersion: this.generatorVersion,
      units: 'mm',
      materialUnits: 'mm3',
      initialPosition: this.start,
      ...(this.motion?{initialPose:structuredClone(this.motion.initialPose),motionFrame:'part',rotaryCenterMm:this.motion.rotaryCenterMm}:{}),
      actions: this.actions,
      summary: { ...summary, travel: { ...this.stats } }
    };
  }
}

// Remove subdivision in the common writer so every skill, machine export and
// Studio sees the same compact SAAMpath. Keep a fixed line for the entire run:
// a succession of tiny turns must not gradually straighten a real curve.
function mergeableMove(run,next) {
  const previous=run.action,keys=Object.keys(previous).filter(k=>!['to','volumeMm3','speedMmS'].includes(k));
  const close=(a,b)=>Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(a),Math.abs(b));
  const physical=['gapMm','normalHeightMm','slopeDeg','lowerSurfaceGapStartMm','lowerSurfaceGapEndMm','sampledGapErrorMm'];
  if(keys.length!==Object.keys(next).length-3||keys.some(k=>previous[k]!==next[k]&&
    !(physical.includes(k)&&Number.isFinite(previous[k])&&Number.isFinite(next[k])&&close(previous[k],next[k]))))return false;
  if(!close(previous.speedMmS,next.speedMmS)||(previous.volumeMm3>0)!==(next.volumeMm3>0))return false;
  const segmentLength=distance(previous.to,next.to);
  if(!close(run.density,next.volumeMm3/segmentLength))return false;
  const vector=next.to.map((v,i)=>v-run.from[i]),along=vector.reduce((s,v,i)=>s+v*run.direction[i],0);
  const before=previous.to.reduce((s,v,i)=>s+(v-run.from[i])*run.direction[i],0);
  if(along<=before)return false; // a reversal is deposition/travel, not redundancy
  return Math.hypot(...vector.map((v,i)=>v-along*run.direction[i]))<=TOLERANCE.plane;
}

// Travel policy for one planar layer: comb inside the layer's own outline.
export function planarPolicy(loops, { layerZ, liftMm, maxCombMm, lineWidthMm }) {
  const index=new SegmentIndex(loops,Math.max(lineWidthMm,0.5));
  return {
    combRegion: loops,
    combIndex: index,
    combClearanceMm: lineWidthMm / 2,
    combCorners: prepareCombCorners(loops,lineWidthMm/2),
    maxCombMm,
    material: materialRegion(loops,{maxZ:layerZ,index}),
    constantClearanceZ: layerZ + liftMm,
    clearanceFor: () => layerZ + liftMm
  };
}

// Any single-valued XY surface can share the same footprint routing as a flat
// layer. The producer owns height validity, sampling and permitted chord sag.
export function surfacePolicy(loops,{surfaceZ,maxZ,maxCombMm,lineWidthMm,liftMm,sampleStepMm=0.5,sagMm=0}) {
  requireThat(typeof surfaceZ==='function'&&Number.isFinite(sampleStepMm)&&sampleStepMm>0&&Number.isFinite(sagMm)&&sagMm>=0,'Surface travel needs a height query, positive sampling step and nonnegative sag.');
  const index=loops?new SegmentIndex(loops,Math.max(lineWidthMm,0.5)):undefined;
  const heightAlong=(from,to)=>{
    const steps=Math.max(2,Math.ceil(Math.hypot(to[0]-from[0],to[1]-from[1])/sampleStepMm));
    let high=-Infinity;
    for(let i=0;i<=steps;i++){
      const t=i/steps,z=surfaceZ(from[0]+(to[0]-from[0])*t,from[1]+(to[1]-from[1])*t);
      if(Number.isFinite(z))high=Math.max(high,z);
    }
    return high;
  };
  return {
    combRegion:loops,combIndex:index,
    // Preserve the surface's existing centerline/chord allowance for direct
    // connections. New detours retain the inset used by shared comb routing.
    directClearanceMm:0,combClearanceMm:lineWidthMm/2,combCorners:loops?prepareCombCorners(loops,lineWidthMm/2):undefined,
    combSurfaceZ:surfaceZ,combStepMm:sampleStepMm,maxCombMm,
    ...(loops?{material:materialRegion(loops,{heightAt:surfaceZ,maxZ,sampleStepMm,index})}:{}),
    heightAlong,clearanceFor:(from,to)=>Math.max(from[2],to[2],heightAlong(from,to))+liftMm,
    canTravelDirect:(from,to,limit=maxCombMm)=>{
      const span=Math.hypot(to[0]-from[0],to[1]-from[1]);
      if(!(limit>0)||span>limit)return false;
      const steps=Math.max(2,Math.ceil(span/sampleStepMm));
      for(let i=0;i<=steps;i++){
        const t=i/steps,z=surfaceZ(from[0]+(to[0]-from[0])*t,from[1]+(to[1]-from[1])*t);
        if(!Number.isFinite(z)||from[2]+(to[2]-from[2])*t<z-sagMm-TOLERANCE.plane)return false;
      }
      return true;
    }
  };
}

// Order strokes nearest-first from the current point. Closed loops are also
// rotated to start at their closest point, which is where most of the saved
// travel comes from on perimeters.
export function orderStrokes(strokes, from) {
  const remaining = [...strokes];
  const ordered = [];
  let cursor = from;
  while (remaining.length) {
    let best = 0, bestDistance = Infinity, bestRotation = 0;
    for (let i = 0; i < remaining.length; i++) {
      const stroke = remaining[i];
      if (stroke.closed) {
        for (let k = 0; k < stroke.points.length; k++) {
          const d = distance(cursor, stroke.points[k]);
          if (d < bestDistance) { bestDistance = d; best = i; bestRotation = k; }
        }
      } else {
        const head = distance(cursor, stroke.points[0]);
        const tail = distance(cursor, stroke.points[stroke.points.length - 1]);
        const d = Math.min(head, tail);
        if (d < bestDistance) { bestDistance = d; best = i; bestRotation = tail < head ? -1 : 0; }
      }
    }
    const stroke = remaining.splice(best, 1)[0];
    let points = stroke.points;
    if (stroke.closed) {
      points = [...points.slice(bestRotation), ...points.slice(0, bestRotation)];
      points = [...points, points[0]];
    } else if (bestRotation === -1) points = [...points].reverse();
    ordered.push({ ...stroke, points });
    cursor = points[points.length - 1];
  }
  return ordered;
}

// Preserve each uninterrupted zigzag, selecting either endpoint of either end
// row from the actual nozzle position. Row order and stroke direction can change
// independently. Stable ties retain producer order; segment data stays attached.
export function orderScanlineCells(strokes, from) {
  const cells = new Map();
  for (const stroke of strokes) {
    const cell = cells.get(stroke.scanlineCell) ?? [];
    cell.push(stroke);
    cells.set(stroke.scanlineCell, cell);
  }
  const remaining = [...cells.values()], ordered = [];
  let cursor = from;
  while (remaining.length) {
    let best = 0, reverseRows = false, reverseStrokes = false, bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cell = remaining[i];
      const entries = [
        {point:cell[0].points[0],rows:false,strokes:false},
        {point:cell.at(-1).points.at(-1),rows:true,strokes:true},
        {point:cell[0].points.at(-1),rows:false,strokes:true},
        {point:cell.at(-1).points[0],rows:true,strokes:false}
      ];
      for (const entry of entries) {
        const gap = distance(cursor, entry.point);
        if (gap < bestDistance) {
          best = i; reverseRows = entry.rows; reverseStrokes = entry.strokes; bestDistance = gap;
        }
      }
    }
    let cell = remaining.splice(best, 1)[0];
    if (reverseRows) cell = [...cell].reverse();
    if (reverseStrokes) cell = cell.map(stroke => ({
      ...stroke, points: [...stroke.points].reverse(),
      ...(stroke.volumesMm3 ? {volumesMm3: [...stroke.volumesMm3].reverse()} : {}),
      ...(stroke.segmentMetadata ? {segmentMetadata: [...stroke.segmentMetadata].reverse()} : {})
    }));
    ordered.push(...cell);
    cursor = cell.at(-1).points.at(-1);
  }
  return ordered;
}

export const beadVolume = (lengthMm, widthMm, heightMm) => lengthMm * widthMm * heightMm;
export { pointSegmentDistance };
