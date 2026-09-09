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
// Clearance is per hop, from a callback, so a planar layer clears the layer it
// is on while a draped skin clears the surface it is crossing.

import { requireThat, distance } from '../geom/tolerance.mjs';
import {combRoute,combSegment} from './comb.mjs';

// Griffin coordinates are written with five decimals.
export const MINIMUM_MOVE_MM = 1e-4;
import { pointInRegion, pointSegmentDistance, SegmentIndex } from '../region/region2d.mjs';

export class PathBuilder {
  constructor({ start, process, machine, generatorVersion }) {
    requireThat(Array.isArray(start) && start.length === 3 && start.every(Number.isFinite), 'PathBuilder needs a 3D start position.');
    this.actions = [];
    this.start = [...start];
    this.position = [...start];
    this.process = process;
    this.machine = machine;
    this.generatorVersion = generatorVersion;
    this.retracted = false;
    this.phase = 'start';
    this.layer = 0;
    this.layerSeconds = 0;
    this.stats = { joined: 0, combed: 0, hopped: 0, travelMm: 0, retractions: 0, printMm: 0 };
  }

  setContext(phase, layer) { this.phase = phase; this.layer = layer; }

  // Speed is capped by the locked material flow and Z feed, exactly as the
  // plan specifies; generation makes no new process choices.
  move(to, speed, volumeMm3 = 0, extra = {}) {
    requireThat(Array.isArray(to)&&to.length===3&&to.every(Number.isFinite)&&Number.isFinite(speed)&&speed>0&&Number.isFinite(volumeMm3)&&volumeMm3>=0,'Invalid path move.');
    const length = distance(this.position, to);
    // Below the export's coordinate resolution a move cannot be written down:
    // it would round to the position the nozzle is already at, and SAAMpath and
    // the exported program would then disagree about how many moves exist.
    // A tenth of a micron is far below anything the process resolves.
    if (length < MINIMUM_MOVE_MM) return;
    let limited = speed;
    if (volumeMm3 > 0) limited = Math.min(limited, this.process.maxFlowMm3S * length / volumeMm3);
    const dz = Math.abs(to[2] - this.position[2]);
    if (dz > 0) limited = Math.min(limited, this.process.zSpeedMmS * length / dz);
    for(let i=0;i<3;i++)if(Math.abs(to[i]-this.position[i])>0)
      limited=Math.min(limited,this.machine.maxFeedMmS['xyz'[i]]*length/Math.abs(to[i]-this.position[i]));
    this.actions.push({ kind: 'move', to: [...to], speedMmS: limited, volumeMm3, phase: this.phase, layer: this.layer, ...(this.operationId?{operation:this.operationId}:{}), ...extra });
    this.layerSeconds += length / limited;
    if (volumeMm3 > 0) this.stats.printMm += length; else this.stats.travelMm += length;
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

  dwell(seconds) { if (seconds > 0) this.actions.push({ kind: 'dwell', seconds, phase: this.phase, layer: this.layer }); }

  // Hold the nozzle off the part for the remainder of a short layer instead of
  // parking it on the fresh bead.
  finishLayer(clearanceZ) {
    clearanceZ=Math.max(clearanceZ,this.planClearanceZ??-Infinity,this.position[2]);
    const remaining = this.process.minimumLayerSeconds - this.layerSeconds;
    if (remaining > 0) {
      this.retract();
      this.move([this.position[0], this.position[1], clearanceZ], this.process.zSpeedMmS);
      this.dwell(remaining);
    }
    this.layerSeconds = 0;
  }

  travelTo(target, policy) {
    const gap = distance(this.position, target);
    if (gap <= 1e-9) { this.stats.joined++; this.recover(); return 'joined'; }
    if (this.canComb(target, policy)) {
      this.stats.combed++;
      this.recover();
      this.move(target, this.process.travelSpeedMmS);
      return 'combed';
    }
    const route=combRoute(this.position,target,policy);
    if(route){this.stats.combed++;this.recover();for(const point of route)this.move(point,this.process.travelSpeedMmS);return 'combed';}
    this.stats.hopped++;
    this.retract();
    const clearance = Math.max(this.planClearanceZ??-Infinity,this.position[2],target[2],policy.clearanceFor(this.position, target));
    requireThat(Number.isFinite(clearance)&&clearance<=(this.motionBounds??this.machine.bounds).max[2],'Travel clearance exceeds machine/tool Z bounds.');
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
  canComb(target, policy) {
    // A policy may decide for itself: a draped skin travels over a curved
    // surface, where "same height" is the wrong question.
    if (policy.canTravelDirect) return policy.canTravelDirect(this.position, target);
    if (!policy.combRegion || !(policy.maxCombMm > 0)) return false;
    if (Math.abs(target[2] - this.position[2]) > 1e-9) return false;
    const span = Math.hypot(target[0] - this.position[0], target[1] - this.position[1]);
    if (span > policy.maxCombMm) return false;
    return combSegment(this.position,target,policy);
  }

  toPath(summary = {}) {
    return {
      schema: 'saampath/1',
      generatorVersion: this.generatorVersion,
      units: 'mm',
      materialUnits: 'mm3',
      initialPosition: this.start,
      actions: this.actions,
      summary: { ...summary, travel: { ...this.stats } }
    };
  }
}

// Travel policy for one planar layer: comb inside the layer's own outline.
export function planarPolicy(loops, { layerZ, liftMm, maxCombMm, lineWidthMm }) {
  return {
    combRegion: loops,
    combIndex: new SegmentIndex(loops, Math.max(lineWidthMm, 0.5)),
    combClearanceMm: lineWidthMm / 2,
    maxCombMm,
    clearanceFor: () => layerZ + liftMm
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

export const beadVolume = (lengthMm, widthMm, heightMm) => lengthMm * widthMm * heightMm;
export { pointSegmentDistance };
