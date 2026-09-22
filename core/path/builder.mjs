// Travel policies and stroke ordering for functional path planning.

import { requireThat, distance, TOLERANCE } from '../geom/tolerance.mjs';
import {prepareCombCorners} from './comb.mjs';
import {materialRegion} from './material.mjs';

import { pointInRegion, pointSegmentDistance, SegmentIndex } from '../region/region2d.mjs';

// Travel policy for one planar layer: comb inside the layer's own outline.
export function planarPolicy(loops, { layerZ, liftMm, maxCombMm, lineWidthMm }) {
  const index=new SegmentIndex(loops,Math.max(lineWidthMm,0.5));
  return {
    combRegion: loops,
    combIndex: index,
    combClearanceMm: lineWidthMm / 2,
    connectClearanceMm: Math.max(0,lineWidthMm/2-0.05),
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
