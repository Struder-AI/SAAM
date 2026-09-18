// draped-skin: layers that follow the part's top surface instead of stepping
// across it in flat slices.
//
// The surface is used directly. For a point on the bed, the height and normal
// of the part's top surface come from a vertical solve against the shell's
// patches, so a stroke is a true 3D polyline lying on the surface rather than a
// staircase approximation of it. Skins stack downwards from the surface at a
// fixed spacing measured along the normal.
//
// The machine's max-nonplanar-angle limits where this can run: with a fixed
// vertical nozzle, surface steeper than that angle cannot be followed. Steep
// area is excluded from the skin and reported, so the person sees what is not
// covered before approving the plan; it is not silently printed flat.

import { topAt } from '../../../core/geom/query.mjs';
import { scanlineFill, regionArea, loopArea } from '../../../core/region/region2d.mjs';
import { offsetRegion } from '../../../core/region/offset.mjs';
import { levelSetRegion, intersect, SENTINEL } from '../../../core/region/boolean.mjs';
import { composeResults } from '../../../core/path/compose.mjs';
import {surfacePolicy} from '../../../core/path/builder.mjs';
import { requireThat, distance, distance2 } from '../../../core/geom/tolerance.mjs';
import {lineSpacing} from '../../../core/path/spacing.mjs';

export const DRAPED_SKIN_DEFAULTS = {
  spacingFactor: 1,
  layers: 2,
  normalMm: 0.2,
  strokeAngleDeg: 0,
  sampleStepMm: 0.5,
  surveyStepMm: 0.5,
  // A per-print experimental value. The machine profile remains authoritative
  // for its declared limit; an override is visibly reported, never inferred.
  maxAngleDegOverride: null
};

export const machineMaxAngle = machine => {
  const limit = machine.nonplanar?.maxAngleDeg;
  requireThat(Number.isFinite(limit) && limit > 0 && limit < 90,
    'The machine file must declare nonplanar.maxAngleDeg for the draped-skin skill.');
  return limit;
};

// Survey the top surface once: the reserve height the body must stay under, and
// the area the angle limit allows to be skinned.
export function surveySurface(shell, { layers, normalMm, surveyStepMm }, maxAngleDeg) {
  requireThat(Number.isFinite(surveyStepMm)&&surveyStepMm>0,'Sampling step must be positive.');
  const [minX, minY] = shell.bounds.min, [maxX, maxY] = shell.bounds.max;
  const columns = Math.max(2, Math.ceil((maxX - minX) / surveyStepMm));
  const rows = Math.max(2, Math.ceil((maxY - minY) / surveyStepMm));
  // One ring of samples outside the part, so a footprint that fills the whole
  // sampled area still produces a closed boundary contour.
  const stepX = (maxX - minX) / columns, stepY = (maxY - minY) / rows;
  const xs = [], ys = [], reserve = [], allowed = [];
  for (let i = -1; i <= columns + 1; i++) xs.push(minX + stepX * i);
  for (let j = -1; j <= rows + 1; j++) ys.push(minY + stepY * j);
  let maxReserve = -Infinity, insideCount = 0, steepCount = 0, maxSlopeDeg = 0;
  for (let i = 0; i < xs.length; i++) {
    reserve.push(new Float64Array(ys.length));
    allowed.push(new Float64Array(ys.length));
    for (let j = 0; j < ys.length; j++) {
      const top = topAt(shell, xs[i], ys[j]);
      // The reserve survey already covers the report's complete interior grid.
      // Include bottom hits in this statistic, matching the top-surface survey,
      // but keep the outside padding out of the reported slope range.
      if(top&&i>0&&j>0&&i<xs.length-1&&j<ys.length-1)maxSlopeDeg=Math.max(maxSlopeDeg,top.slopeDeg);
      // The named base patch closes the shell but is never a roof. At a side
      // boundary its upward-flipped normal can otherwise look like a zero-height
      // top hit and carve an accidental hole in the body's reserve field.
      if (!top || top.patch === 'bottom') {
        // Outside the footprint nothing is reserved and nothing is skinned; the
        // section itself bounds the body there.
        reserve[i][j] = SENTINEL;
        allowed[i][j] = -SENTINEL;
        continue;
      }
      insideCount++;
      const skinnable = top.slopeDeg <= maxAngleDeg;
      // The body only gives space back to a skin that will actually be printed.
      // An over-limit side is excluded from draping, but it must still receive
      // its ordinary planar body layers instead of becoming a hollow omission.
      const thickness = layers * normalMm / Math.cos(top.slopeDeg * Math.PI / 180);
      reserve[i][j] = skinnable ? top.zMm - thickness : shell.bounds.max[2];
      allowed[i][j] = maxAngleDeg - top.slopeDeg;
      if (!skinnable) steepCount++;
      maxReserve = Math.max(maxReserve, reserve[i][j]);
    }
  }
  // Locate the skinnable boundary on the surface itself rather than on the
  // sampling grid: bisect between a skinnable sample and an unskinnable one.
  const skinnable = (x, y) => {
    const top = topAt(shell, x, y);
    return Boolean(top) && top.patch !== 'bottom' && top.slopeDeg <= maxAngleDeg;
  };
  const refine = (inside, outside) => {
    let a = inside, b = outside;
    for (let step = 0; step < 24; step++) {
      const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (skinnable(...middle)) a = middle; else b = middle;
    }
    return a;
  };
  const skinRegion = levelSetRegion({ xs, ys, values: allowed }, 0, { refine });
  return {
    field: { xs, ys, values: extrapolate(reserve, SENTINEL) },
    maxMm: maxReserve,
    skinRegion,
    maxSlopeDeg,
    limitDeg: maxAngleDeg,
    steepFraction: insideCount ? steepCount / insideCount : 0,
    skinAreaMm2: Math.abs(regionArea(skinRegion)),
    stepMm: surveyStepMm
  };
}

// Samples outside the footprint carry no reserve of their own. Filling them
// from their nearest neighbour, rather than leaving a sentinel, keeps the
// reserve contour from cutting across the part at the footprint edge: the
// section already bounds the body there, and a sentinel would either invent a
// boundary inside the wall or swallow the layer entirely.
function extrapolate(values, sentinel) {
  const filled = values.map(column => Float64Array.from(column));
  const isSentinel = value => Math.abs(value) >= sentinel;
  for (let pass = 0; pass < 4096; pass++) {
    let remaining = 0, changed = 0;
    const next = filled.map(column => Float64Array.from(column));
    for (let i = 0; i < filled.length; i++)
      for (let j = 0; j < filled[i].length; j++) {
        if (!isSentinel(filled[i][j])) continue;
        let sum = 0, count = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= filled.length || b >= filled[a].length) continue;
          if (isSentinel(filled[a][b])) continue;
          sum += filled[a][b];
          count++;
        }
        if (count) { next[i][j] = sum / count; changed++; } else remaining++;
      }
    for (let i = 0; i < filled.length; i++) filled[i] = next[i];
    if (!remaining) return filled;
    if (!changed) break;
  }
  return filled;
}

export function drapedSkinResult({ shell, plan, machine, survey, id = 'draped-skin', after = [], supportTopAt=null }) {
  const operations=[];
  let previous=after;
  const process = plan.process, settings = { ...DRAPED_SKIN_DEFAULTS, ...plan.skills['draped-skin'] };
  const width = process.lineWidthMm, count = settings.layers, thickness = settings.normalMm;
  const region = offsetRegion(survey.skinRegion, -width / 2);
  requireThat(region.length > 0,
    `No surface remains for a draped skin: the top surface is steeper than the machine's ${survey.limitDeg} degree limit, or the skinnable area is narrower than one bead.`);

  const report = {
    skinLayers: count, strokes: 0, excludedFraction: survey.steepFraction,
    maxSlopeDeg: survey.maxSlopeDeg, limitDeg: survey.limitDeg,
    skinAreaMm2: survey.skinAreaMm2, minGapMm: Infinity, maxGapMm: -Infinity
  };

  const rows = scanlineFill(region, lineSpacing(width,settings), settings.strokeAngleDeg);
  // Skin layers share XY samples. Cache exact coordinates only for this result;
  // never carry roof values into another geometry revision. Bound retained data
  // on very large roofs, where avoiding unbounded memory beats cache hit rate.
  const roofSamples=new Map();let cachedSamples=0;
  const roofAt=(x,y)=>{
    let column=roofSamples.get(x);
    if(column?.has(y))return column.get(y);
    const top=topAt(shell,x,y);
    if(cachedSamples>=100000){roofSamples.clear();cachedSamples=0;column=null;}
    if(!column){column=new Map();roofSamples.set(x,column);}
    column.set(y,top);cachedSamples++;return top;
  };

  for (let skin = 1; skin <= count; skin++) {

    const below = count - skin;
    // Alternate row order between skins and stroke direction along the rows, so
    // consecutive strokes end where the next begins.
    const sequence = skin % 2 ? rows : [...rows].reverse();
    const strokes = sequence.map((row, position) => {
      const [from, to] = position % 2 ? [row.to, row.from] : [row.from, row.to];
      return { role: 'skin', closed: false, scanlineCell:row.cellId, points: samplePath(shell, from, to, settings.sampleStepMm, below, thickness, process, count,survey.limitDeg,supportTopAt,roofAt) };
    }).filter(stroke => stroke.points.length > 1);

    // The surface this skin lies on, for both clearance and direct travel.
    const surfaceZ = (x, y) => {
      const top = roofAt(x, y);
      if (!top || top.patch==='bottom' || top.slopeDeg>survey.limitDeg+1e-6) return null;
      return top.zMm - below * thickness / Math.cos(top.slopeDeg * Math.PI / 180);
    };
    const policy = drapedPolicy(shell, process, surfaceZ, thickness, survey.skinRegion, settings.sampleStepMm);
    const deposition=[];
    for (const stroke of strokes) {
      const volumesMm3=[],segmentMetadata=[];
      for (let i = 1; i < stroke.points.length; i++) {
        const previous = stroke.points[i - 1], current = stroke.points[i];
        const length = distance(previous.point, current.point);
        const gap = (previous.gapMm + current.gapMm) / 2;
        const slope = (previous.slopeDeg + current.slopeDeg) / 2;
        report.minGapMm = Math.min(report.minGapMm, gap);
        report.maxGapMm = Math.max(report.maxGapMm, gap);
        requireThat(gap > 0, 'A skin stroke would deposit into material already there; check the reserved thickness.');
        // Rectangular bead over the sampled interval: 3D length by bead width
        // by the vertical gap, converted to the normal direction.
        const volume = length * width * gap * Math.cos(slope * Math.PI / 180);
        volumesMm3.push(volume);segmentMetadata.push({gapMm:gap,slopeDeg:slope});
      }
      deposition.push({points:stroke.points.map(p=>p.point),scanlineCell:stroke.scanlineCell,role:'skin',speedMmS:process.skinSpeedMmS,volumesMm3,segmentMetadata});
      report.strokes++;
    }
    const operationId=id+':'+(skin-1);
    operations.push({id:operationId,layerId:id+':'+(skin-1),phase:'draped-skin',layer:skin-1,
      rank:shell.bounds.max[2]+skin,after:previous,strokes:deposition,order:'nearest-cells',travelPolicy:policy,clearanceZ:shell.bounds.max[2]+process.liftMm});
    previous=[operationId];
  }
  return {id,operations,report};
}

// Sample a straight bed-plane run, lifting each sample onto the skin surface.
function samplePath(shell, from, to, stepMm, below, thickness, process, count,limitDeg,supportTopAt,roofAt) {
  const span = distance2(from, to);
  const steps = Math.max(1, Math.ceil(span / stepMm));
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from[0] + (to[0] - from[0]) * t, y = from[1] + (to[1] - from[1]) * t;
    const top = roofAt(x, y);
    requireThat(top&&top.slopeDeg<=limitDeg+1e-6,'Drape crosses an absent or unsampled steep surface; refine the survey or select a continuous roof.');
    const cos = Math.cos(top.slopeDeg * Math.PI / 180);
    const z = top.zMm - below * thickness / cos;
    if(points.length){const previous=points[points.length-1].point;
      requireThat(Math.atan2(Math.abs(z-previous[2]),Math.hypot(x-previous[0],y-previous[1]))*180/Math.PI<=limitDeg+1e-5,'Drape crosses a discontinuity or exceeds its angle limit; select a continuous roof.');
    }
    // The first skin bridges the body's stepped top, so its gap is measured to
    // the actual layer below rather than assumed equal to the skin thickness.
    const gap = below === count - 1
      ? z - (supportTopAt?supportTopAt(x,y,top.zMm-count*thickness/cos):bodyTopAt(top.zMm - count * thickness / cos, process,shell.bounds.min[2]))
      : thickness / cos;
    points.push({ point: [x, y, z], gapMm: gap, slopeDeg: top.slopeDeg });
  }
  return points;
}

export const bodyTopAt = (reserveZ, process,originZ=0) =>
  originZ+process.firstLayerMm + Math.max(0, Math.floor((reserveZ-originZ - process.firstLayerMm + 1e-9) / process.layerMm)) * process.layerMm;

// Curved combing uses this skin's local surface. Lifted moves still use the
// shared builder's global deposited height. A straight connection may stay
// down when its chord clears the local skin within the permitted sag.
// A straight line between two points on a convex surface passes slightly under
// it: over one bead spacing on a part-sized curve that is on the order of a
// micron. Allowing a fraction of the skin thickness keeps that from forcing a
// lift, and is no closer to the surface than a flat layer's own turnaround.
export function drapedPolicy(shell, process, surfaceZ = null, skinNormalMm = 0.2, region = null, sampleStepMm = 0.5) {
  return surfacePolicy(region,{surfaceZ:surfaceZ??(()=>null),maxZ:shell.bounds.max[2],
    maxCombMm:process.maxCombMm,lineWidthMm:process.lineWidthMm,liftMm:process.liftMm,
    sampleStepMm,sagMm:Math.min(0.05,skinNormalMm/4)});
}

export const skinReport = report => ({
  ...report,
  excludedPercent: Number((report.excludedFraction * 100).toFixed(2))
});

export function generateDrapedSkin(builder,options){
  const result=drapedSkinResult(options);composeResults(builder,[result]);return result.report;
}
