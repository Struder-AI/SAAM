// Native roof survey for reserved material and supported surface courses.
import {topAt} from '../geom/query.mjs';
import {regionArea} from './region2d.mjs';
import {levelSetRegion,SENTINEL} from './boolean.mjs';
import {requireThat,TOLERANCE} from '../geom/tolerance.mjs';

// Survey the top surface once: the reserve height the body must stay under, and
// the area the angle limit allows to be skinned.
export function surveyRoofRegion(shell, { layers, normalMm, surveyStepMm }, maxAngleDeg) {
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
    while(Math.hypot(a[0]-b[0],a[1]-b[1])>TOLERANCE.point) {
      const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      requireThat(middle.some((v,k)=>v!==a[k])&&middle.some((v,k)=>v!==b[k]),'Roof boundary refinement cannot progress at floating-point precision.');
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
  // The fill front ends on its own criterion: every sentinel filled, or a pass
  // that changed nothing because no sentinel touches a known value.
  for (;;) {
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

