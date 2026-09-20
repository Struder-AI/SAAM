import {readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {defaults, validatePlan} from '../../../core/print/plan.mjs';
import {loadMachine} from '../../../core/machine/profile.mjs';
import {requireThat} from '../../../core/geom/tolerance.mjs';

// A calibration ladder: upright test walls, each commanded at a different bead width and
// printed on its own layer grid, held together by two low rails across their ends. The piece is
// no wider than its walls. A person calipers each wall and compares it with what was commanded.
export const LADDER_DEFAULTS = Object.freeze({
  widthsMm: [0.25, 0.5, 1, 1.5, 2, 2.5], pitchMm: 15, wallLengthMm: 20, heightMm: 3, layerRatio: 0.5, frameCourses: 2, nominalWidthMm: 0.4
});

// A rounded bead (a rectangle with semicircular sides) holding the same area as a
// width x height rectangle is wider than it by (1 - pi/4) x height. SAAM's volume model
// is the rectangle; this is the hypothesis a measurement can confirm or refute.
export const ROUNDED_EXCESS = 1 - Math.PI / 4;
export const predictWidths = (widthMm, layerMm) => ({
  rectangleMm: widthMm, roundedMm: +(widthMm + ROUNDED_EXCESS * layerMm).toFixed(4)
});

const idFor = width => 'wall-' + String(width).replace('.', 'p');

// Geometry only: the walls' own layer grids follow the layer-to-width ratio, and each
// wall gets as many whole courses as fit under heightMm. `slotMm` is a wall's place at the
// ladder's pitch; the walls that print are placed by `assembleLadder`.
export function ladderNetworks(options = {}) {
  const o = {...LADDER_DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined))};
  requireThat(o.widthsMm.length >= 1 && o.widthsMm.every(w => w > 0) && new Set(o.widthsMm).size === o.widthsMm.length, 'Ladder widths must be distinct and positive.');
  requireThat(o.pitchMm > Math.max(...o.widthsMm) && o.wallLengthMm > 2 * o.nominalWidthMm && o.heightMm > 0 && o.layerRatio > 0 && Number.isInteger(o.frameCourses) && o.frameCourses >= 1, 'Invalid ladder dimensions.');
  const walls = o.widthsMm.map((w, i) => {
    const layerMm = +(w * o.layerRatio).toFixed(6), courses = Math.max(1, Math.floor(o.heightMm / layerMm + 1e-9));
    return {id: idFor(w), widthMm: w, layerMm, courses, heightMm: +(courses * layerMm).toFixed(6), slotMm: (i + 1) * o.pitchMm, ...predictWidths(w, layerMm)};
  });
  return {walls, options: o, ...assembleLadder(walls, o)};
}

// Place the walls that print and tie them with two rails across their ends. The first wall's
// outer face is at x = 0 and the rails run only from the first wall to the last, on the wall
// ends' own footprint, so the piece is exactly as wide and as long as the walls: the outer
// walls are its sides. Coordinates are millimetres, y along the walls.
export function assembleLadder(walls, o) {
  requireThat(walls.length >= 2, `A ladder needs at least two walls to tie together; only ${walls.length} can be printed.`);
  const first = walls[0], last = walls.at(-1), shift = first.widthMm / 2 - first.slotMm;
  const placed = walls.map(w => ({...w, xMm: +(w.slotMm + shift).toFixed(6)}));
  const xa = placed[0].xMm, xb = placed.at(-1).xMm, half = o.nominalWidthMm / 2;
  const frame = {id: 'frame', layers: o.frameCourses,
    strokes: [half, o.wallLengthMm - half].map(y => ({closed: false, points: [[xa, y], [xb, y]]}))};
  const networks = [frame, ...placed.map(w => ({id: w.id, layers: w.courses,
    process: {firstLayerMm: w.layerMm, layerMm: w.layerMm, lineWidthMm: w.widthMm},
    strokes: [{closed: false, points: [[w.xMm, 0], [w.xMm, o.wallLengthMm]]}]}))];
  return {networks, placed, extentMm: [+(xb - xa + first.widthMm / 2 + last.widthMm / 2).toFixed(6), o.wallLengthMm]};
}

// Whether one wall's width and layer height pass the machine's own limits: the same
// validation the print would get, in ordinary and then in experimental deposition.
export function wallFeasibility(machine, wall, {experimental}) {
  const plan = defaults(machine);
  for (const settings of Object.values(plan.skills)) settings.enabled = false;
  Object.assign(plan.process, {experimentalDeposition: experimental, minimumLayerSeconds: 0});
  Object.assign(plan.skills['line-network'], {enabled: true, layers: 1, networks: [{id: 'probe', layers: 1,
    process: {firstLayerMm: wall.layerMm, layerMm: wall.layerMm, lineWidthMm: wall.widthMm}, strokes: [{closed: false, points: [[0, 0], [1, 0]]}]}]});
  try { validatePlan(plan, machine); return {ok: true}; } catch (error) { return {ok: false, reason: error.message}; }
}

// The ladder for a machine. Walls the machine's limits refuse are left out and reported, and
// the rails run between the walls that remain; experimental deposition is chosen when any wall
// needs it (its limits contain the ordinary ones).
export function buildLadder({machineId, ...options}) {
  const machine = loadMachine(machineId), ladder = ladderNetworks({...options, widthsMm: options.widthsMm ?? LADDER_DEFAULTS.widthsMm}).walls;
  const o = {...LADDER_DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined))};
  const ordinary = ladder.map(w => wallFeasibility(machine, w, {experimental: false}));
  const experimental = ladder.map(w => wallFeasibility(machine, w, {experimental: true}));
  const useExperimental = ordinary.some((r, i) => !r.ok && experimental[i].ok);
  const verdict = useExperimental ? experimental : ordinary;
  const checked = ladder.map((w, i) => ({...w, feasible: verdict[i].ok, ...(verdict[i].ok ? {} : {reason: verdict[i].reason})}));
  const kept = checked.filter(w => w.feasible);
  requireThat(kept.length >= 2, `A ladder needs at least two walls to tie together; ${machineId} allows ${kept.length} of them (${checked.filter(w => !w.feasible).map(w => `${w.widthMm} mm: ${w.reason}`).join('; ') || 'none refused'}).`);
  const assembled = assembleLadder(kept, o), xById = new Map(assembled.placed.map(w => [w.id, w.xMm]));
  const walls = checked.map(w => xById.has(w.id) ? {...w, xMm: xById.get(w.id)} : w);
  return {
    machineId, experimental: useExperimental, walls, skipped: walls.filter(w => !w.feasible), extentMm: assembled.extentMm,
    lineNetwork: {enabled: true, layers: Math.max(...assembled.networks.map(n => n.layers)), networks: assembled.networks},
    process: {experimentalDeposition: useExperimental}
  };
}

// An `adjust` patch that makes this print: line-network on and every other pattern off.
export function ladderPatch(built, {placement, maxFlowMm3S, planarSpeedMmS} = {}) {
  const skills = {};
  for (const name of Object.keys(defaults(loadMachine(built.machineId)).skills)) skills[name] = {enabled: false};
  skills['line-network'] = built.lineNetwork;
  const process = {...built.process};
  if (maxFlowMm3S !== undefined) process.maxFlowMm3S = maxFlowMm3S;
  if (planarSpeedMmS !== undefined) process.planarSpeedMmS = planarSpeedMmS;
  return {skills, process, ...(placement ? {placement: {xMm: placement[0], yMm: placement[1]}} : {})};
}

const mean = values => values.reduce((a, b) => a + b, 0) / values.length;

// Compare caliper readings with what was commanded. `readings` maps a commanded width
// (as printed, for example "0.5") to the measured thicknesses in mm, a few per wall.
export function analyzeMeasurements(walls, readings) {
  const rows = [];
  for (const wall of walls) {
    const values = readings[String(wall.widthMm)];
    if (!values?.length) continue;
    requireThat(values.every(v => Number.isFinite(v) && v > 0), `Readings for the ${wall.widthMm} mm wall must be positive numbers.`);
    const m = mean(values), sd = values.length > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1)) : 0;
    rows.push({widthMm: wall.widthMm, layerMm: wall.layerMm, meanMm: +m.toFixed(4), spreadMm: +sd.toFixed(4), errorMm: +(m - wall.widthMm).toFixed(4),
      errorPercent: +(100 * (m - wall.widthMm) / wall.widthMm).toFixed(1), excessOverLayer: +((m - wall.widthMm) / wall.layerMm).toFixed(3),
      rectangleMm: wall.rectangleMm, roundedMm: wall.roundedMm});
  }
  requireThat(rows.length >= 1, 'No readings match the ladder walls.');
  let fit = null;
  if (rows.length >= 2) {
    const xs = rows.map(r => r.widthMm), ys = rows.map(r => r.meanMm), mx = mean(xs), my = mean(ys);
    const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    fit = {slope: +slope.toFixed(4), interceptMm: +(my - slope * mx).toFixed(4)};
  }
  // How well each model explains the readings: mean absolute error, in mm.
  const misfit = key => +mean(rows.map(r => Math.abs(r.meanMm - r[key]))).toFixed(4);
  return {rows, fit, meanAbsoluteErrorMm: {rectangleModel: misfit('rectangleMm'), roundedModel: misfit('roundedMm')},
    meanExcessOverLayer: +mean(rows.map(r => r.excessOverLayer)).toFixed(3), roundedModelExcessOverLayer: +ROUNDED_EXCESS.toFixed(3)};
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2), take = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args.splice(i, 2)[1]; };
  const machineId = take('--machine', 'bambu-h2d'), out = take('--out', null), measure = take('--measure', null);
  const widths = take('--widths', null)?.split(',').map(Number), ratio = take('--ratio', undefined), place = take('--place', undefined)?.split(',').map(Number);
  const height = take('--height', undefined), length = take('--length', undefined), pitch = take('--pitch', undefined);
  const flow = take('--max-flow', undefined), speed = take('--speed', undefined);
  const options = {machineId, ...(widths ? {widthsMm: widths} : {}), ...(ratio ? {layerRatio: Number(ratio)} : {}), ...(height ? {heightMm: Number(height)} : {}),
    ...(length ? {wallLengthMm: Number(length)} : {}), ...(pitch ? {pitchMm: Number(pitch)} : {})};
  const built = buildLadder(options);
  if (measure) {
    console.log(JSON.stringify(analyzeMeasurements(built.walls, JSON.parse(readFileSync(measure, 'utf8'))), null, 2));
  } else {
    if (out) writeFileSync(out, JSON.stringify(ladderPatch(built, {placement: place, maxFlowMm3S: flow ? Number(flow) : undefined, planarSpeedMmS: speed ? Number(speed) : undefined}), null, 2) + '\n');
    console.log(JSON.stringify({machine: machineId, experimentalDeposition: built.experimental, extentMm: built.extentMm, patch: out,
      walls: built.walls.map(w => ({id: w.id, commandedMm: w.widthMm, layerMm: w.layerMm, courses: w.courses, heightMm: w.heightMm, feasible: w.feasible,
        predictedRectangleMm: w.rectangleMm, predictedRoundedMm: w.roundedMm, ...(w.reason ? {reason: w.reason} : {})})),
      skipped: built.skipped.map(w => `${w.widthMm} mm: ${w.reason}`)}, null, 2));
  }
}
